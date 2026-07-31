import './admin.css';

const TOKEN_KEY = '3dnow_admin_token';
const NEEDS_ACTION = new Set(['new', 'awaiting-payment', 'quoted', 'reviewing']);

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  configured: true,
  view: 'inbox',
  inboxTab: 'needs-action',
  orders: [],
  labels: {},
  statuses: [],
  stats: null,
  settings: null,
  selectedId: null,
  filters: { q: '', type: '' },
  error: '',
  toast: ''
};

const app = document.getElementById('app');

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return headers;
}

async function api(path, options = {}) {
  const response = await fetch(`/api/admin${path}`, {
    ...options,
    headers: authHeaders(options.body && !(options.body instanceof FormData)
      ? { 'content-type': 'application/json', ...options.headers }
      : options.headers),
    body: options.body && typeof options.body === 'object' && !(options.body instanceof FormData)
      ? JSON.stringify(options.body)
      : options.body
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    clearSession();
    throw new Error(data.error || 'Sign in required.');
  }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function clearSession() {
  state.token = '';
  localStorage.removeItem(TOKEN_KEY);
}

function showToast(message) {
  state.toast = message;
  render();
  window.setTimeout(() => {
    if (state.toast === message) {
      state.toast = '';
      render();
    }
  }, 2800);
}

function formatMoney(cents) {
  if (!Number.isFinite(cents)) return 'n/a';
  return `€${(cents / 100).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function typeLabel(type) {
  return ({
    'student-order': 'Student order',
    'business-quote': 'Business quote',
    'private-quote': 'Private quote',
    contact: 'Contact',
    idea: 'Design request',
    'legacy-order': 'Legacy order'
  })[type] || type;
}

function statusBadge(status) {
  const label = state.labels[status] || status;
  return `<span class="badge badge-${status}">${escapeHtml(label)}</span>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function selectedOrder() {
  return state.orders.find(order => order.id === state.selectedId) || null;
}

function filteredOrders() {
  let list = state.orders;
  if (state.inboxTab === 'needs-action') list = list.filter(o => NEEDS_ACTION.has(o.status));
  else if (state.inboxTab === 'paid') list = list.filter(o => o.status === 'paid');
  else if (state.inboxTab === 'production') {
    list = list.filter(o => ['in-production', 'shipped', 'ready-pickup', 'completed'].includes(o.status));
  }
  return list;
}

function needsActionCount() {
  return state.orders.filter(o => NEEDS_ACTION.has(o.status)).length;
}

async function bootstrap() {
  try {
    const status = await fetch('/api/admin/status').then(r => r.json());
    state.configured = Boolean(status.configured);
  } catch {
    state.configured = false;
  }

  if (state.token) {
    try {
      await api('/me');
      await refresh();
    } catch {
      clearSession();
    }
  }
  render();
}

async function refresh() {
  const query = new URLSearchParams();
  if (state.filters.q) query.set('q', state.filters.q);
  if (state.filters.type) query.set('type', state.filters.type);
  const [list, stats] = await Promise.all([
    api(`/orders?${query}`),
    api('/stats')
  ]);
  state.orders = list.orders || [];
  state.labels = list.labels || {};
  state.statuses = list.statuses || [];
  state.stats = stats;
  if (state.selectedId && !state.orders.some(order => order.id === state.selectedId)) {
    state.selectedId = null;
  }
  const visible = filteredOrders();
  if (!state.selectedId && visible[0]) state.selectedId = visible[0].id;
}

async function loadSettings() {
  const result = await api('/settings');
  state.settings = result.settings;
}

function shell(content) {
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="sidebar-brand" href="/admin">
          <img src="/brand-logo" alt="3DNow"/>
          <span><strong>3DNow Ops</strong><span>Production desk</span></span>
        </a>
        <nav class="nav" aria-label="Ops navigation">
          <button class="nav-btn ${state.view === 'inbox' ? 'active' : ''}" type="button" data-view="inbox">
            Inbox <span class="nav-count">${needsActionCount()}</span>
          </button>
          <button class="nav-btn ${state.view === 'settings' ? 'active' : ''}" type="button" data-view="settings">
            Settings
          </button>
        </nav>
        <div class="sidebar-foot">
          <button class="btn btn-sm" type="button" id="refresh-btn">Refresh</button>
          <button class="btn btn-sm btn-danger" type="button" id="logout-btn">Sign out</button>
        </div>
      </aside>
      <div class="workspace">
        ${content}
        ${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ''}
      </div>
    </div>
  `;
}

function bindShell() {
  app.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', async () => {
      state.view = button.getAttribute('data-view');
      if (state.view === 'settings') {
        try {
          await loadSettings();
        } catch (error) {
          showToast(error.message);
        }
      }
      render();
    });
  });

  document.getElementById('refresh-btn')?.addEventListener('click', async () => {
    try {
      if (state.view === 'settings') await loadSettings();
      else await refresh();
      render();
      showToast(state.view === 'settings' ? 'Settings refreshed' : 'Inbox refreshed');
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST' }); } catch { /* ignore */ }
    clearSession();
    render();
  });
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="login-form">
        <h1>3DNow Ops</h1>
        <p class="lede">Sign in to manage orders, quotes, and handover settings.</p>
        ${state.configured ? '' : '<div class="error">Set ADMIN_PASSWORD on the server before using the dashboard.</div>'}
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}
        <div class="field">
          <label for="password">Admin password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required ${state.configured ? '' : 'disabled'}/>
        </div>
        <button class="btn btn-primary" type="submit" ${state.configured ? '' : 'disabled'}>Sign in</button>
      </form>
    </div>
  `;

  document.getElementById('login-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    state.error = '';
    const password = new FormData(event.currentTarget).get('password');
    try {
      const result = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password })
      }).then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Sign in failed.');
        return data;
      });
      state.token = result.token;
      localStorage.setItem(TOKEN_KEY, result.token);
      await refresh();
      render();
    } catch (error) {
      state.error = error.message;
      render();
    }
  });
}

function renderInbox() {
  const order = selectedOrder();
  const stats = state.stats || { total: 0, open: 0, byStatus: {} };
  const list = filteredOrders();

  app.innerHTML = shell(`
    <div class="workspace-head">
      <div>
        <h1>Inbox</h1>
        <p>Orders, quotes, and form requests from anfrage and the storefront.</p>
      </div>
      <div class="workspace-actions">
        <button class="btn" type="button" id="refresh-head">Refresh</button>
      </div>
    </div>
    <div class="workspace-body">
      <div class="stats">
        <div class="stat"><strong>${needsActionCount()}</strong><span>Needs action</span></div>
        <div class="stat"><strong>${stats.byStatus?.paid || 0}</strong><span>Paid</span></div>
        <div class="stat"><strong>${stats.byStatus?.['in-production'] || 0}</strong><span>In production</span></div>
        <div class="stat"><strong>${stats.total || 0}</strong><span>Total</span></div>
      </div>

      <div class="layout">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Queue</h2>
              <p>${list.length} shown</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="tabs" role="tablist">
              ${[
                ['needs-action', 'Needs action'],
                ['all', 'All'],
                ['paid', 'Paid'],
                ['production', 'Production']
              ].map(([id, label]) => `
                <button class="tab ${state.inboxTab === id ? 'active' : ''}" type="button" data-inbox-tab="${id}">${label}</button>
              `).join('')}
            </div>

            <form class="filters" id="filter-form">
              <div class="field">
                <label for="q">Search</label>
                <input id="q" name="q" value="${escapeHtml(state.filters.q)}" placeholder="Name, email, file, job id"/>
              </div>
              <div class="field">
                <label for="type">Type</label>
                <select id="type" name="type">
                  <option value="">All types</option>
                  ${['student-order', 'business-quote', 'private-quote', 'contact', 'idea', 'legacy-order'].map(type => `
                    <option value="${type}" ${state.filters.type === type ? 'selected' : ''}>${typeLabel(type)}</option>
                  `).join('')}
                </select>
              </div>
              <div class="field">
                <label>&nbsp;</label>
                <button class="btn" type="submit">Apply</button>
              </div>
            </form>

            <div class="order-list">
              ${list.length ? list.map(item => `
                <button class="order-card ${item.id === state.selectedId ? 'active' : ''}" type="button" data-order-id="${item.id}">
                  <div class="order-card-top">
                    <strong>${escapeHtml(typeLabel(item.type))}</strong>
                    ${statusBadge(item.status)}
                  </div>
                  <div class="summary">${escapeHtml(item.summary || item.filename || 'Untitled request')}</div>
                  <div class="meta">${escapeHtml(item.customer?.email || item.customer?.phone || 'No contact')} · ${escapeHtml(formatDate(item.createdAt))}</div>
                </button>
              `).join('') : '<div class="empty">No requests in this view.</div>'}
            </div>
          </div>
        </section>

        <aside class="panel">
          <div class="panel-head">
            <div>
              <h2>Details</h2>
              <p>${order ? 'Update status, files, and customer updates.' : 'Select a request from the queue.'}</p>
            </div>
          </div>
          <div class="panel-body">
            ${order ? renderDetail(order) : '<div class="empty">Nothing selected.</div>'}
          </div>
        </aside>
      </div>
    </div>
  `);

  bindShell();

  document.getElementById('refresh-head')?.addEventListener('click', async () => {
    await refresh();
    render();
    showToast('Inbox refreshed');
  });

  app.querySelectorAll('[data-inbox-tab]').forEach(button => {
    button.addEventListener('click', () => {
      state.inboxTab = button.getAttribute('data-inbox-tab');
      const visible = filteredOrders();
      if (!visible.some(o => o.id === state.selectedId)) state.selectedId = visible[0]?.id || null;
      render();
    });
  });

  document.getElementById('filter-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.filters = {
      q: String(form.get('q') || '').trim(),
      type: String(form.get('type') || '')
    };
    await refresh();
    render();
  });

  app.querySelectorAll('[data-order-id]').forEach(button => {
    button.addEventListener('click', async () => {
      state.selectedId = button.getAttribute('data-order-id');
      try {
        const detail = await api(`/orders/${state.selectedId}`);
        const index = state.orders.findIndex(item => item.id === state.selectedId);
        if (index >= 0) state.orders[index] = detail.order;
        else state.orders.unshift(detail.order);
      } catch (error) {
        showToast(error.message);
      }
      render();
    });
  });

  bindDetailEvents(order);
}

function bindDetailEvents(order) {
  document.getElementById('status-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!order) return;
    const form = new FormData(event.currentTarget);
    try {
      const result = await api(`/orders/${order.id}`, {
        method: 'PATCH',
        body: {
          status: form.get('status'),
          statusNote: form.get('statusNote') || null,
          notes: form.get('notes')
        }
      });
      replaceOrder(result.order);
      showToast('Status saved');
      render();
    } catch (error) {
      showToast(error.message);
    }
  });

  app.querySelectorAll('[data-download-order]').forEach(button => {
    button.addEventListener('click', async () => {
      const orderId = button.getAttribute('data-download-order');
      const index = button.getAttribute('data-download-index');
      try {
        const response = await fetch(`/api/admin/orders/${orderId}/files/${index}`, {
          headers: authHeaders()
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Download failed.');
        }
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^"]+)"?/i);
        const filename = match?.[1] || `file-${index}`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  app.querySelectorAll('[data-packing-label]').forEach(button => {
    button.addEventListener('click', () => {
      const orderId = button.getAttribute('data-packing-label');
      const target = state.orders.find(item => item.id === orderId) || order;
      if (target) openPackingLabel(target);
    });
  });

  document.getElementById('notify-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!order) return;
    const form = new FormData(event.currentTarget);
    try {
      const result = await api(`/orders/${order.id}/notify`, {
        method: 'POST',
        body: {
          status: form.get('status') || order.status,
          email: form.get('email') || order.customer?.email,
          message: form.get('message') || '',
          statusNote: form.get('statusNote') || null
        }
      });
      replaceOrder(result.order);
      showToast(result.delivered ? 'Customer notified by email' : `Saved, but email was not delivered${result.reason ? `: ${result.reason}` : ''}`);
      render();
    } catch (error) {
      showToast(error.message);
    }
  });
}

function replaceOrder(order) {
  const index = state.orders.findIndex(item => item.id === order.id);
  if (index >= 0) state.orders[index] = order;
  else state.orders.unshift(order);
  state.selectedId = order.id;
}

function formatShipping(address) {
  if (!address) return 'n/a';
  if (typeof address === 'string') return address;
  return [
    address.name,
    address.line1 || address.address1,
    address.line2 || address.address2,
    [address.postal_code || address.zip, address.city].filter(Boolean).join(' '),
    address.state || address.province,
    address.country,
    address.phone ? `Tel ${address.phone}` : null
  ].filter(Boolean).join(', ');
}

function shopifyAdminOrderUrl(payment) {
  if (!payment?.shopifyOrderId) return null;
  const shop = (state.settings?.shopify?.shop || 'u06a18-ue.myshopify.com')
    .replace(/\.myshopify\.com$/i, '')
    .replace(/^https?:\/\//, '');
  return `https://admin.shopify.com/store/${shop}/orders/${payment.shopifyOrderId}`;
}

function packingLabelHtml(order) {
  const details = order.details || {};
  const payment = order.payment || {};
  const shipping = formatShipping(payment.shippingAddress);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Packing label ${escapeHtml(payment.shopifyOrderName || order.id)}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:24px;color:#111}
  h1{font-size:20px;margin:0 0 12px}
  .box{border:2px solid #111;padding:16px;max-width:420px}
  .row{margin:8px 0;font-size:14px}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#555}
  @media print{body{margin:0}.noprint{display:none}}
</style></head><body>
<div class="noprint" style="margin-bottom:12px"><button onclick="window.print()">Print packing label</button></div>
<div class="box">
  <h1>3DNow student print</h1>
  <div class="row"><div class="label">Shopify order</div><strong>${escapeHtml(payment.shopifyOrderName || 'n/a')}</strong></div>
  <div class="row"><div class="label">Ship to</div>${escapeHtml(shipping)}</div>
  <div class="row"><div class="label">File / package</div>${escapeHtml(order.filename || 'n/a')} · ${escapeHtml(details.packageName || 'n/a')}</div>
  <div class="row"><div class="label">Material / speed</div>${escapeHtml(details.material || 'n/a')} · ${escapeHtml(details.speed || 'standard')}</div>
  <div class="row"><div class="label">Paid</div>${escapeHtml(payment.totalCents != null ? formatMoney(payment.totalCents) : 'n/a')}</div>
  <div class="row"><div class="label">Admin ID</div>${escapeHtml(order.id)}</div>
</div>
</body></html>`;
}

function openPackingLabel(order) {
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=520,height=720');
  if (!popup) {
    showToast('Allow pop-ups to print the packing label.');
    return;
  }
  popup.document.write(packingLabelHtml(order));
  popup.document.close();
}

function renderDetail(order) {
  const details = order.details || {};
  const payment = order.payment || {};
  const shopifyUrl = shopifyAdminOrderUrl(payment);
  return `
    <div class="detail-grid">
      <div>
        <div class="order-card-top" style="margin-bottom:10px">
          <strong>${escapeHtml(typeLabel(order.type))}</strong>
          ${statusBadge(order.status)}
        </div>
        <dl class="kv">
          <dt>Created</dt><dd>${escapeHtml(formatDate(order.createdAt))}</dd>
          <dt>Updated</dt><dd>${escapeHtml(formatDate(order.updatedAt))}</dd>
          <dt>File</dt><dd>${escapeHtml(order.filename || 'n/a')}</dd>
          <dt>Job ID</dt><dd class="mono">${escapeHtml(order.jobId || 'n/a')}</dd>
          <dt>Customer</dt><dd>${escapeHtml(order.customer?.name || 'n/a')}</dd>
          <dt>Email</dt><dd>${escapeHtml(order.customer?.email || 'n/a')}</dd>
          <dt>Phone</dt><dd>${escapeHtml(order.customer?.phone || 'n/a')}</dd>
          <dt>Payment</dt><dd>${escapeHtml(payment.status || 'n/a')}${payment.totalCents != null ? ` · ${formatMoney(payment.totalCents)}` : ''}</dd>
          <dt>Shopify</dt><dd>${payment.shopifyOrderName
            ? (shopifyUrl
              ? `<a href="${escapeHtml(shopifyUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(payment.shopifyOrderName)}</a>`
              : escapeHtml(payment.shopifyOrderName))
            : escapeHtml(payment.shopifyDraftOrderId ? `Draft ${payment.shopifyDraftOrderId}` : 'n/a')}</dd>
          <dt>Shipping</dt><dd>${escapeHtml(formatShipping(payment.shippingAddress))}</dd>
          <dt>Package</dt><dd>${escapeHtml(details.packageName || order.quote?.package?.name || order.quote?.totalFormatted || 'n/a')}</dd>
          <dt>Material</dt><dd>${escapeHtml(details.material || 'n/a')}</dd>
          <dt>Quantity</dt><dd>${escapeHtml(details.quantity ?? 'n/a')}</dd>
        </dl>
        ${order.type === 'student-order' ? `
          <div class="actions" style="margin-top:12px">
            <button class="btn" type="button" data-packing-label="${order.id}">Print packing label</button>
          </div>
        ` : ''}
      </div>

      ${order.files?.length ? `
        <div>
          <div class="section-title">Files</div>
          <div class="actions">
            ${order.files.map(file => `
              <button class="btn" type="button" data-download-order="${order.id}" data-download-index="${file.index}" ${file.available ? '' : 'disabled'}>
                ${escapeHtml(file.originalname || `File ${file.index + 1}`)}
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${details.message || details.description || details.configuration ? `
        <div>
          <div class="section-title">Message</div>
          <p style="white-space:pre-wrap;font-size:13px;color:var(--muted)">${escapeHtml(details.message || details.description || details.configuration)}</p>
        </div>
      ` : ''}

      <form id="status-form" class="detail-grid">
        <div class="section-title">Production</div>
        <div class="field">
          <label for="status-select">Status</label>
          <select id="status-select" name="status">
            ${state.statuses.map(status => `
              <option value="${status}" ${order.status === status ? 'selected' : ''}>${escapeHtml(state.labels[status] || status)}</option>
            `).join('')}
          </select>
        </div>
        <div class="field">
          <label for="statusNote">Internal note</label>
          <input id="statusNote" name="statusNote" placeholder="Optional note for the status history"/>
        </div>
        <div class="field">
          <label for="notes">Ops notes</label>
          <textarea id="notes" name="notes" placeholder="Private notes for the team">${escapeHtml(order.notes || '')}</textarea>
        </div>
        <div class="actions">
          <button class="btn btn-primary" type="submit">Save status</button>
        </div>
      </form>

      <form id="notify-form" class="detail-grid">
        <div class="section-title">Notify customer</div>
        <div class="field">
          <label for="notify-email">Email</label>
          <input id="notify-email" name="email" type="email" value="${escapeHtml(order.customer?.email || '')}" required/>
        </div>
        <div class="field">
          <label for="notify-status">Status to announce</label>
          <select id="notify-status" name="status">
            ${state.statuses.map(status => `
              <option value="${status}" ${order.status === status ? 'selected' : ''}>${escapeHtml(state.labels[status] || status)}</option>
            `).join('')}
          </select>
        </div>
        <div class="field">
          <label for="notify-message">Message (optional)</label>
          <textarea id="notify-message" name="message" placeholder="Leave blank to use the default status email"></textarea>
        </div>
        <div class="actions">
          <button class="btn btn-primary" type="submit">Send update email</button>
        </div>
      </form>

      <div>
        <div class="section-title">Status history</div>
        <div class="history">
          ${(order.statusHistory || []).slice().reverse().map(entry => `
            <div class="history-item">
              <strong>${escapeHtml(state.labels[entry.status] || entry.status)}</strong>
              <span>${escapeHtml(formatDate(entry.at))}${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}</span>
            </div>
          `).join('') || '<div class="empty">No history yet.</div>'}
        </div>
      </div>

      <div>
        <div class="section-title">Notifications sent</div>
        <div class="history">
          ${(order.notifications || []).slice().reverse().map(entry => `
            <div class="history-item">
              <strong>${entry.delivered ? 'Delivered' : 'Not delivered'} · ${escapeHtml(state.labels[entry.status] || entry.status || 'update')}</strong>
              <span>${escapeHtml(formatDate(entry.at))} · ${escapeHtml(entry.to || 'n/a')}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''}</span>
            </div>
          `).join('') || '<div class="empty">No customer updates sent yet.</div>'}
        </div>
      </div>
    </div>
  `;
}

function checkItem(label, ok) {
  return `
    <div class="check-item">
      <strong>${escapeHtml(label)}</strong>
      <span class="${ok ? 'check-ok' : 'check-bad'}">${ok ? 'Ready' : 'Needs setup'}</span>
    </div>
  `;
}

function renderSettings() {
  const s = state.settings || {
    checks: {},
    smtp: {},
    shopify: {},
    stripe: {},
    endpoints: {}
  };
  const secretPlaceholder = '••••••••';

  app.innerHTML = shell(`
    <div class="workspace-head">
      <div>
        <h1>Settings</h1>
        <p>Handover configuration for email, Shopify, and ops access. Secrets stay masked after save.</p>
      </div>
    </div>
    <div class="workspace-body">
      <div class="settings-grid">
        <section class="panel settings-card">
          <div class="panel-head"><div><h2>Setup checklist</h2><p>What must be ready before you hand over.</p></div></div>
          <div class="panel-body">
            <div class="check-list">
              ${checkItem('Admin password', s.checks?.adminPassword)}
              ${checkItem('Public URL', s.checks?.publicUrl)}
              ${checkItem('Notify email', s.checks?.notifyTo)}
              ${checkItem('SMTP email delivery', s.checks?.smtp)}
              ${checkItem('Shopify payments', s.checks?.shopify)}
            </div>
            ${s.endpoints?.shopifyWebhook ? `
              <div>
                <div class="section-title">Shopify webhook URL</div>
                <div class="endpoint-box">${escapeHtml(s.endpoints.shopifyWebhook)}</div>
              </div>
            ` : ''}
            <div class="actions">
              <button class="btn" type="button" id="shopify-check-btn">Check Shopify connection</button>
            </div>
          </div>
        </section>

        <form class="panel settings-card" id="general-form">
          <div class="panel-head"><div><h2>General</h2><p>Public site URL, alert inbox, and admin access.</p></div></div>
          <div class="panel-body">
            <div class="field">
              <label for="publicUrl">Public URL</label>
              <input id="publicUrl" name="publicUrl" value="${escapeHtml(s.publicUrl || '')}" placeholder="https://anfrage.3d-now.de"/>
              <span class="hint">Used for webhooks, emails, and admin links.</span>
            </div>
            <div class="field">
              <label for="notifyTo">Ops notify email</label>
              <input id="notifyTo" name="notifyTo" type="email" value="${escapeHtml(s.notifyTo || '')}" placeholder="ops@example.com"/>
            </div>
            <div class="field">
              <label for="adminPassword">Change admin password</label>
              <input id="adminPassword" name="adminPassword" type="password" autocomplete="new-password" placeholder="${s.adminPasswordConfigured ? secretPlaceholder : 'Set a password'}"/>
              <span class="hint">Leave blank to keep the current password. Minimum 8 characters.</span>
            </div>
            <div class="actions"><button class="btn btn-primary" type="submit">Save general</button></div>
          </div>
        </form>

        <form class="panel settings-card" id="smtp-form">
          <div class="panel-head"><div><h2>Email (SMTP)</h2><p>Customer confirmations and ops alerts.</p></div></div>
          <div class="panel-body">
            <div class="field-row">
              <div class="field">
                <label for="smtpHost">SMTP host</label>
                <input id="smtpHost" name="host" value="${escapeHtml(s.smtp?.host || '')}" placeholder="smtp.example.com"/>
              </div>
              <div class="field">
                <label for="smtpPort">Port</label>
                <input id="smtpPort" name="port" type="number" value="${escapeHtml(String(s.smtp?.port || 587))}"/>
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="smtpUser">Username</label>
                <input id="smtpUser" name="user" value="${escapeHtml(s.smtp?.user || '')}"/>
              </div>
              <div class="field">
                <label for="smtpPass">Password</label>
                <input id="smtpPass" name="pass" type="password" placeholder="${s.smtp?.passConfigured ? secretPlaceholder : 'SMTP password'}" autocomplete="new-password"/>
              </div>
            </div>
            <div class="field">
              <label for="smtpFrom">Sender (From)</label>
              <input id="smtpFrom" name="from" value="${escapeHtml(s.smtp?.from || '')}" placeholder="3DNow <support@3d-now.de>"/>
              <span class="hint">Display name and email customers will see.</span>
            </div>
            <label class="check-row">
              <input type="checkbox" name="secure" ${s.smtp?.secure ? 'checked' : ''}/>
              <span>Use SSL/TLS (usually port 465)</span>
            </label>
            <div class="field-row">
              <div class="field">
                <label for="testTo">Send test email to</label>
                <input id="testTo" name="testTo" type="email" value="${escapeHtml(s.notifyTo || '')}"/>
              </div>
              <div class="field">
                <label>&nbsp;</label>
                <button class="btn" type="button" id="test-email-btn">Send test</button>
              </div>
            </div>
            <div class="actions"><button class="btn btn-primary" type="submit">Save email</button></div>
          </div>
        </form>

        <form class="panel settings-card" id="shopify-form">
          <div class="panel-head"><div><h2>Shopify</h2><p>Draft order checkout and paid-order webhooks.</p></div></div>
          <div class="panel-body">
            <div class="field">
              <label for="shopifyShop">Shop domain</label>
              <input id="shopifyShop" name="shop" value="${escapeHtml(s.shopify?.shop || '')}" placeholder="your-store.myshopify.com"/>
            </div>
            <div class="field">
              <label for="shopifyClientId">Client ID</label>
              <input id="shopifyClientId" name="clientId" value="${escapeHtml(s.shopify?.clientId || '')}"/>
            </div>
            <div class="field">
              <label for="shopifyClientSecret">Client secret</label>
              <input id="shopifyClientSecret" name="clientSecret" type="password" placeholder="${s.shopify?.clientSecretConfigured ? secretPlaceholder : 'shpss_…'}" autocomplete="new-password"/>
            </div>
            <div class="field">
              <label for="shopifyAccessToken">Legacy access token (optional)</label>
              <input id="shopifyAccessToken" name="accessToken" type="password" placeholder="${s.shopify?.accessTokenConfigured ? secretPlaceholder : 'shpat_… only if you still have one'}" autocomplete="new-password"/>
            </div>
            <div class="field">
              <label for="shopifyWebhookSecret">Webhook signing secret</label>
              <input id="shopifyWebhookSecret" name="webhookSecret" type="password" placeholder="${s.shopify?.webhookSecretConfigured ? secretPlaceholder : 'Usually same as client secret'}" autocomplete="new-password"/>
            </div>
            <div class="actions"><button class="btn btn-primary" type="submit">Save Shopify</button></div>
          </div>
        </form>

        <form class="panel settings-card" id="stripe-form">
          <div class="panel-head"><div><h2>Stripe (optional / legacy)</h2><p>Only needed if you still use Stripe webhooks.</p></div></div>
          <div class="panel-body">
            <div class="field">
              <label for="stripeSecret">Secret key</label>
              <input id="stripeSecret" name="secretKey" type="password" placeholder="${s.stripe?.secretKeyConfigured ? secretPlaceholder : 'sk_…'}" autocomplete="new-password"/>
            </div>
            <div class="field">
              <label for="stripeWebhook">Webhook secret</label>
              <input id="stripeWebhook" name="webhookSecret" type="password" placeholder="${s.stripe?.webhookSecretConfigured ? secretPlaceholder : 'whsec_…'}" autocomplete="new-password"/>
            </div>
            <div class="actions"><button class="btn btn-primary" type="submit">Save Stripe</button></div>
          </div>
        </form>
      </div>
    </div>
  `);

  bindShell();

  document.getElementById('general-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const body = {
        publicUrl: form.get('publicUrl'),
        notifyTo: form.get('notifyTo')
      };
      const password = String(form.get('adminPassword') || '');
      if (password && !/^•+$/.test(password)) body.adminPassword = password;
      const result = await api('/settings', { method: 'PUT', body });
      state.settings = result.settings;
      showToast('General settings saved');
      render();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById('smtp-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const pass = String(form.get('pass') || '');
      const body = {
        smtp: {
          host: form.get('host'),
          port: form.get('port'),
          user: form.get('user'),
          from: form.get('from'),
          secure: form.get('secure') === 'on'
        }
      };
      if (pass && !/^•+$/.test(pass)) body.smtp.pass = pass;
      const result = await api('/settings', { method: 'PUT', body });
      state.settings = result.settings;
      showToast('Email settings saved');
      render();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById('test-email-btn')?.addEventListener('click', async () => {
    const to = document.getElementById('testTo')?.value || '';
    try {
      const result = await api('/settings/test-email', { method: 'POST', body: { to } });
      showToast(result.delivered ? `Test email sent to ${result.to}` : `Test failed: ${result.reason || 'unknown'}`);
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById('shopify-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const body = { shopify: { shop: form.get('shop'), clientId: form.get('clientId') } };
      for (const key of ['clientSecret', 'accessToken', 'webhookSecret']) {
        const value = String(form.get(key) || '');
        if (value && !/^•+$/.test(value)) body.shopify[key] = value;
      }
      const result = await api('/settings', { method: 'PUT', body });
      state.settings = result.settings;
      showToast('Shopify settings saved');
      render();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById('stripe-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const body = { stripe: {} };
      for (const key of ['secretKey', 'webhookSecret']) {
        const value = String(form.get(key) || '');
        if (value && !/^•+$/.test(value)) body.stripe[key] = value;
      }
      const result = await api('/settings', { method: 'PUT', body });
      state.settings = result.settings;
      showToast('Stripe settings saved');
      render();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById('shopify-check-btn')?.addEventListener('click', async () => {
    try {
      const result = await api('/settings/shopify-status');
      showToast(result.ok ? `Shopify OK · webhook ${result.address}` : `Shopify issue: ${result.reason}`);
    } catch (error) {
      showToast(error.message);
    }
  });
}

function render() {
  if (!state.token) renderLogin();
  else if (state.view === 'settings') renderSettings();
  else renderInbox();
}

bootstrap();
