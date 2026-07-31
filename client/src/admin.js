import './admin.css';

const TOKEN_KEY = '3dnow_admin_token';
const NEEDS_ACTION = new Set(['new', 'awaiting-payment', 'quoted', 'reviewing']);

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  configured: true,
  view: 'inbox',
  inboxTab: 'needs-action',
  detailTab: 'overview',
  drawerOpen: false,
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
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function typeLabel(type) {
  return ({
    'student-order': 'Student',
    'business-quote': 'Business',
    'private-quote': 'Private',
    contact: 'Contact',
    idea: 'Design',
    'legacy-order': 'Legacy'
  })[type] || type;
}

function statusBadge(status) {
  return `<span class="badge badge-${status}">${escapeHtml(state.labels[status] || status)}</span>`;
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

function icon(name) {
  const paths = {
    inbox: '<path d="M4 7h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z"/><path d="M4 10h16"/><path d="M9 14h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.2"/><path d="M21 3v6h-6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
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
    state.drawerOpen = false;
  }
}

async function loadSettings() {
  const result = await api('/settings');
  state.settings = result.settings;
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
    address.country
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>Packing label</title>
<style>body{font-family:system-ui,sans-serif;margin:24px}.box{border:2px solid #111;padding:16px;max-width:420px}.row{margin:8px 0}@media print{.noprint{display:none}}</style></head><body>
<div class="noprint"><button onclick="window.print()">Print</button></div>
<div class="box">
  <h1>3DNow student print</h1>
  <div class="row"><strong>${escapeHtml(payment.shopifyOrderName || 'n/a')}</strong></div>
  <div class="row">${escapeHtml(shipping)}</div>
  <div class="row">${escapeHtml(order.filename || 'n/a')} · ${escapeHtml(details.packageName || 'n/a')}</div>
  <div class="row">${escapeHtml(details.material || 'n/a')} · ${escapeHtml(payment.totalCents != null ? formatMoney(payment.totalCents) : 'n/a')}</div>
</div></body></html>`;
}

function openPackingLabel(order) {
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=520,height=720');
  if (!popup) return showToast('Allow pop-ups to print the packing label.');
  popup.document.write(packingLabelHtml(order));
  popup.document.close();
}

function shell(main) {
  return `
    <div class="app-shell">
      <aside class="rail" aria-label="Primary">
        <a class="rail-logo" href="/admin" title="3DNow Ops"><img src="/brand-logo" alt="3DNow"/></a>
        <nav class="rail-nav">
          <button class="rail-btn ${state.view === 'inbox' ? 'active' : ''}" type="button" data-view="inbox" title="Inbox">
            ${icon('inbox')}
            ${needsActionCount() ? `<span class="rail-badge">${needsActionCount()}</span>` : ''}
          </button>
          <button class="rail-btn ${state.view === 'settings' ? 'active' : ''}" type="button" data-view="settings" title="Settings">
            ${icon('settings')}
          </button>
        </nav>
        <div class="rail-spacer"></div>
        <div class="rail-foot">
          <button class="rail-btn" type="button" id="refresh-btn" title="Refresh">${icon('refresh')}</button>
          <button class="rail-btn" type="button" id="logout-btn" title="Sign out">${icon('logout')}</button>
        </div>
      </aside>
      <div class="main">
        ${main}
        ${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ''}
      </div>
    </div>
  `;
}

function bindShell() {
  app.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', async () => {
      state.view = button.getAttribute('data-view');
      state.drawerOpen = false;
      if (state.view === 'settings') {
        try { await loadSettings(); } catch (error) { showToast(error.message); }
      }
      render();
    });
  });
  document.getElementById('refresh-btn')?.addEventListener('click', async () => {
    try {
      if (state.view === 'settings') await loadSettings();
      else await refresh();
      render();
      showToast('Updated');
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
        <p class="lede">Sign in to run orders and configure handover settings.</p>
        ${state.configured ? '' : '<div class="error">Set ADMIN_PASSWORD on the server first.</div>'}
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}
        <div class="field">
          <label for="password">Password</label>
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
  const list = filteredOrders();
  const order = selectedOrder();
  const paid = state.stats?.byStatus?.paid || 0;
  const production = state.stats?.byStatus?.['in-production'] || 0;

  app.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>Inbox</h1>
        <p class="lede">One queue. Open a row to work the order.</p>
      </div>
    </div>

    <div class="toolbar">
      <div class="seg" role="tablist">
        <button type="button" class="${state.inboxTab === 'needs-action' ? 'active' : ''}" data-inbox-tab="needs-action">
          Needs action <span class="count">${needsActionCount()}</span>
        </button>
        <button type="button" class="${state.inboxTab === 'all' ? 'active' : ''}" data-inbox-tab="all">
          All <span class="count">${state.orders.length}</span>
        </button>
        <button type="button" class="${state.inboxTab === 'paid' ? 'active' : ''}" data-inbox-tab="paid">
          Paid <span class="count">${paid}</span>
        </button>
        <button type="button" class="${state.inboxTab === 'production' ? 'active' : ''}" data-inbox-tab="production">
          Production <span class="count">${production}</span>
        </button>
      </div>
      <form class="search" id="filter-form">
        <input name="q" value="${escapeHtml(state.filters.q)}" placeholder="Search orders" aria-label="Search"/>
        <select name="type" aria-label="Type">
          <option value="">All types</option>
          ${['student-order', 'business-quote', 'private-quote', 'contact', 'idea'].map(type => `
            <option value="${type}" ${state.filters.type === type ? 'selected' : ''}>${typeLabel(type)}</option>
          `).join('')}
        </select>
        <button class="btn btn-sm" type="submit">Search</button>
      </form>
    </div>

    <div class="content">
      <div class="table-wrap">
        <div class="table-head">
          <span>Request</span>
          <span class="cell-hide-sm">Customer</span>
          <span>Type</span>
          <span>Status</span>
          <span>Updated</span>
        </div>
        ${list.length ? list.map(item => `
          <button class="table-row ${item.id === state.selectedId && state.drawerOpen ? 'active' : ''}" type="button" data-order-id="${item.id}">
            <span>
              <div class="cell-title">${escapeHtml(item.summary || item.filename || typeLabel(item.type))}</div>
              <div class="cell-sub">${escapeHtml(item.filename || item.jobId || item.id)}</div>
            </span>
            <span class="cell-meta cell-hide-sm">${escapeHtml(item.customer?.email || item.customer?.phone || 'No contact')}</span>
            <span class="cell-meta">${escapeHtml(typeLabel(item.type))}</span>
            <span>${statusBadge(item.status)}</span>
            <span class="cell-mono">${escapeHtml(formatDate(item.updatedAt || item.createdAt))}</span>
          </button>
        `).join('') : '<div class="empty"><strong>Nothing in this view</strong>Switch tabs or clear search.</div>'}
      </div>
    </div>

    <div class="drawer-backdrop ${state.drawerOpen && order ? 'open' : ''}" id="drawer-backdrop"></div>
    <aside class="drawer ${state.drawerOpen && order ? 'open' : ''}" aria-label="Order details">
      ${order ? renderDrawer(order) : ''}
    </aside>
  `);

  bindShell();

  app.querySelectorAll('[data-inbox-tab]').forEach(button => {
    button.addEventListener('click', () => {
      state.inboxTab = button.getAttribute('data-inbox-tab');
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
      state.detailTab = 'overview';
      state.drawerOpen = true;
      try {
        const detail = await api(`/orders/${state.selectedId}`);
        replaceOrder(detail.order);
      } catch (error) {
        showToast(error.message);
      }
      render();
    });
  });

  document.getElementById('drawer-backdrop')?.addEventListener('click', () => {
    state.drawerOpen = false;
    render();
  });

  if (order && state.drawerOpen) bindDrawerEvents(order);
}

function renderDrawer(order) {
  const details = order.details || {};
  const payment = order.payment || {};
  const shopifyUrl = shopifyAdminOrderUrl(payment);

  return `
    <div class="drawer-head">
      <div>
        <h2>${escapeHtml(typeLabel(order.type))} order</h2>
        <div class="sub">${escapeHtml(order.summary || order.filename || 'Untitled')}</div>
      </div>
      <div class="actions">
        ${statusBadge(order.status)}
        <button class="icon-btn" type="button" id="drawer-close" title="Close">${icon('close')}</button>
      </div>
    </div>
    <div class="drawer-tabs">
      <button type="button" class="${state.detailTab === 'overview' ? 'active' : ''}" data-detail-tab="overview">Overview</button>
      <button type="button" class="${state.detailTab === 'produce' ? 'active' : ''}" data-detail-tab="produce">Produce</button>
      <button type="button" class="${state.detailTab === 'message' ? 'active' : ''}" data-detail-tab="message">Message</button>
    </div>
    <div class="drawer-body">
      ${state.detailTab === 'overview' ? `
        <dl class="kv">
          <dt>Created</dt><dd>${escapeHtml(formatDate(order.createdAt))}</dd>
          <dt>Customer</dt><dd>${escapeHtml(order.customer?.name || 'n/a')}</dd>
          <dt>Email</dt><dd>${escapeHtml(order.customer?.email || 'n/a')}</dd>
          <dt>Phone</dt><dd>${escapeHtml(order.customer?.phone || 'n/a')}</dd>
          <dt>Payment</dt><dd>${escapeHtml(payment.status || 'n/a')}${payment.totalCents != null ? ` · ${formatMoney(payment.totalCents)}` : ''}</dd>
          <dt>Shopify</dt><dd>${payment.shopifyOrderName
            ? (shopifyUrl ? `<a href="${escapeHtml(shopifyUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(payment.shopifyOrderName)}</a>` : escapeHtml(payment.shopifyOrderName))
            : escapeHtml(payment.shopifyDraftOrderId ? `Draft ${payment.shopifyDraftOrderId}` : 'n/a')}</dd>
          <dt>Shipping</dt><dd>${escapeHtml(formatShipping(payment.shippingAddress))}</dd>
          <dt>Package</dt><dd>${escapeHtml(details.packageName || order.quote?.package?.name || 'n/a')}</dd>
          <dt>Material</dt><dd>${escapeHtml(details.material || 'n/a')}</dd>
          <dt>File</dt><dd>${escapeHtml(order.filename || 'n/a')}</dd>
          <dt>Job</dt><dd class="mono">${escapeHtml(order.jobId || 'n/a')}</dd>
        </dl>
        ${details.message || details.description || details.configuration ? `
          <div>
            <div class="section-label">Note</div>
            <p style="margin-top:8px;white-space:pre-wrap;color:var(--muted);font-size:13px">${escapeHtml(details.message || details.description || details.configuration)}</p>
          </div>
        ` : ''}
        ${order.files?.length ? `
          <div>
            <div class="section-label">Files</div>
            <div class="actions" style="margin-top:8px">
              ${order.files.map(file => `
                <button class="btn btn-sm" type="button" data-download-order="${order.id}" data-download-index="${file.index}" ${file.available ? '' : 'disabled'}>
                  ${escapeHtml(file.originalname || `File ${file.index + 1}`)}
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
        ${order.type === 'student-order' ? `
          <div class="actions">
            <button class="btn" type="button" id="packing-btn">Print packing label</button>
          </div>
        ` : ''}
      ` : ''}

      ${state.detailTab === 'produce' ? `
        <form id="status-form" style="display:grid;gap:14px">
          <div class="field">
            <label for="status-select">Production status</label>
            <select id="status-select" name="status">
              ${state.statuses.map(status => `
                <option value="${status}" ${order.status === status ? 'selected' : ''}>${escapeHtml(state.labels[status] || status)}</option>
              `).join('')}
            </select>
          </div>
          <div class="field">
            <label for="statusNote">History note</label>
            <input id="statusNote" name="statusNote" placeholder="Optional"/>
          </div>
          <div class="field">
            <label for="notes">Ops notes</label>
            <textarea id="notes" name="notes" placeholder="Private team notes">${escapeHtml(order.notes || '')}</textarea>
          </div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Save</button>
          </div>
        </form>
        <div>
          <div class="section-label">History</div>
          <div class="history" style="margin-top:8px">
            ${(order.statusHistory || []).slice().reverse().map(entry => `
              <div class="history-item">
                <strong>${escapeHtml(state.labels[entry.status] || entry.status)}</strong>
                <span>${escapeHtml(formatDate(entry.at))}${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}</span>
              </div>
            `).join('') || '<div class="empty">No history yet.</div>'}
          </div>
        </div>
      ` : ''}

      ${state.detailTab === 'message' ? `
        <form id="notify-form" style="display:grid;gap:14px">
          <div class="field">
            <label for="notify-email">Email</label>
            <input id="notify-email" name="email" type="email" value="${escapeHtml(order.customer?.email || '')}" required/>
          </div>
          <div class="field">
            <label for="notify-status">Announce status</label>
            <select id="notify-status" name="status">
              ${state.statuses.map(status => `
                <option value="${status}" ${order.status === status ? 'selected' : ''}>${escapeHtml(state.labels[status] || status)}</option>
              `).join('')}
            </select>
          </div>
          <div class="field">
            <label for="notify-message">Message</label>
            <textarea id="notify-message" name="message" placeholder="Optional custom message"></textarea>
          </div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Send update</button>
          </div>
        </form>
        <div>
          <div class="section-label">Sent</div>
          <div class="history" style="margin-top:8px">
            ${(order.notifications || []).slice().reverse().map(entry => `
              <div class="history-item">
                <strong>${entry.delivered ? 'Delivered' : 'Failed'}</strong>
                <span>${escapeHtml(formatDate(entry.at))} · ${escapeHtml(entry.to || 'n/a')}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''}</span>
              </div>
            `).join('') || '<div class="empty">No messages yet.</div>'}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function bindDrawerEvents(order) {
  document.getElementById('drawer-close')?.addEventListener('click', () => {
    state.drawerOpen = false;
    render();
  });

  app.querySelectorAll('[data-detail-tab]').forEach(button => {
    button.addEventListener('click', () => {
      state.detailTab = button.getAttribute('data-detail-tab');
      render();
    });
  });

  document.getElementById('packing-btn')?.addEventListener('click', () => openPackingLabel(order));

  app.querySelectorAll('[data-download-order]').forEach(button => {
    button.addEventListener('click', async () => {
      const orderId = button.getAttribute('data-download-order');
      const index = button.getAttribute('data-download-index');
      try {
        const response = await fetch(`/api/admin/orders/${orderId}/files/${index}`, { headers: authHeaders() });
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

  document.getElementById('status-form')?.addEventListener('submit', async event => {
    event.preventDefault();
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

  document.getElementById('notify-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api(`/orders/${order.id}/notify`, {
        method: 'POST',
        body: {
          status: form.get('status') || order.status,
          email: form.get('email') || order.customer?.email,
          message: form.get('message') || ''
        }
      });
      replaceOrder(result.order);
      showToast(result.delivered ? 'Email sent' : `Not delivered${result.reason ? `: ${result.reason}` : ''}`);
      render();
    } catch (error) {
      showToast(error.message);
    }
  });
}

function checkItem(label, ok) {
  return `<div class="check-item"><strong>${escapeHtml(label)}</strong><span class="${ok ? 'check-ok' : 'check-bad'}">${ok ? 'Ready' : 'Needs setup'}</span></div>`;
}

function renderSettings() {
  const s = state.settings || { checks: {}, smtp: {}, shopify: {}, stripe: {}, endpoints: {} };
  const secretPlaceholder = '••••••••';

  app.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>Settings</h1>
        <p class="lede">Configure what the next operator needs. Secrets stay masked.</p>
      </div>
    </div>
    <div class="content">
      <div class="settings-page">
        <section class="settings-card">
          <div class="head"><h2>Checklist</h2><p>Handover readiness</p></div>
          <div class="body">
            <div class="check-list">
              ${checkItem('Admin password', s.checks?.adminPassword)}
              ${checkItem('Public URL', s.checks?.publicUrl)}
              ${checkItem('Notify email', s.checks?.notifyTo)}
              ${checkItem('SMTP', s.checks?.smtp)}
              ${checkItem('Shopify', s.checks?.shopify)}
            </div>
            ${s.endpoints?.shopifyWebhook ? `<div class="endpoint-box">${escapeHtml(s.endpoints.shopifyWebhook)}</div>` : ''}
            <div class="actions"><button class="btn" type="button" id="shopify-check-btn">Check Shopify</button></div>
          </div>
        </section>

        <form class="settings-card" id="general-form">
          <div class="head"><h2>General</h2><p>Site URL and access</p></div>
          <div class="body">
            <div class="field"><label>Public URL</label><input name="publicUrl" value="${escapeHtml(s.publicUrl || '')}" placeholder="https://anfrage.3d-now.de"/></div>
            <div class="field"><label>Ops notify email</label><input name="notifyTo" type="email" value="${escapeHtml(s.notifyTo || '')}"/></div>
            <div class="field"><label>New admin password</label><input name="adminPassword" type="password" autocomplete="new-password" placeholder="${s.adminPasswordConfigured ? secretPlaceholder : 'Min 8 characters'}"/></div>
            <div class="actions"><button class="btn btn-primary" type="submit">Save</button></div>
          </div>
        </form>

        <form class="settings-card" id="smtp-form">
          <div class="head"><h2>Email</h2><p>SMTP delivery</p></div>
          <div class="body">
            <div class="field-row">
              <div class="field"><label>Host</label><input name="host" value="${escapeHtml(s.smtp?.host || '')}"/></div>
              <div class="field"><label>Port</label><input name="port" type="number" value="${escapeHtml(String(s.smtp?.port || 587))}"/></div>
            </div>
            <div class="field-row">
              <div class="field"><label>Username</label><input name="user" value="${escapeHtml(s.smtp?.user || '')}"/></div>
              <div class="field"><label>Password</label><input name="pass" type="password" placeholder="${s.smtp?.passConfigured ? secretPlaceholder : ''}" autocomplete="new-password"/></div>
            </div>
            <div class="field"><label>From</label><input name="from" value="${escapeHtml(s.smtp?.from || '')}" placeholder="3DNow <support@3d-now.de>"/></div>
            <label class="check-row"><input type="checkbox" name="secure" ${s.smtp?.secure ? 'checked' : ''}/><span>SSL/TLS</span></label>
            <div class="field-row">
              <div class="field"><label>Test to</label><input id="testTo" type="email" value="${escapeHtml(s.notifyTo || '')}"/></div>
              <div class="field"><label>&nbsp;</label><button class="btn" type="button" id="test-email-btn">Send test</button></div>
            </div>
            <div class="actions"><button class="btn btn-primary" type="submit">Save email</button></div>
          </div>
        </form>

        <form class="settings-card" id="shopify-form">
          <div class="head"><h2>Shopify</h2><p>Checkout credentials</p></div>
          <div class="body">
            <div class="field"><label>Shop</label><input name="shop" value="${escapeHtml(s.shopify?.shop || '')}"/></div>
            <div class="field"><label>Client ID</label><input name="clientId" value="${escapeHtml(s.shopify?.clientId || '')}"/></div>
            <div class="field"><label>Client secret</label><input name="clientSecret" type="password" placeholder="${s.shopify?.clientSecretConfigured ? secretPlaceholder : ''}" autocomplete="new-password"/></div>
            <div class="field"><label>Legacy access token</label><input name="accessToken" type="password" placeholder="${s.shopify?.accessTokenConfigured ? secretPlaceholder : 'optional'}" autocomplete="new-password"/></div>
            <div class="field"><label>Webhook secret</label><input name="webhookSecret" type="password" placeholder="${s.shopify?.webhookSecretConfigured ? secretPlaceholder : ''}" autocomplete="new-password"/></div>
            <div class="actions"><button class="btn btn-primary" type="submit">Save Shopify</button></div>
          </div>
        </form>

        <form class="settings-card" id="stripe-form">
          <div class="head"><h2>Stripe</h2><p>Optional legacy</p></div>
          <div class="body">
            <div class="field"><label>Secret key</label><input name="secretKey" type="password" placeholder="${s.stripe?.secretKeyConfigured ? secretPlaceholder : ''}" autocomplete="new-password"/></div>
            <div class="field"><label>Webhook secret</label><input name="webhookSecret" type="password" placeholder="${s.stripe?.webhookSecretConfigured ? secretPlaceholder : ''}" autocomplete="new-password"/></div>
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
      const body = { publicUrl: form.get('publicUrl'), notifyTo: form.get('notifyTo') };
      const password = String(form.get('adminPassword') || '');
      if (password && !/^•+$/.test(password)) body.adminPassword = password;
      state.settings = (await api('/settings', { method: 'PUT', body })).settings;
      showToast('Saved');
      render();
    } catch (error) { showToast(error.message); }
  });

  document.getElementById('smtp-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const body = {
        smtp: {
          host: form.get('host'),
          port: form.get('port'),
          user: form.get('user'),
          from: form.get('from'),
          secure: form.get('secure') === 'on'
        }
      };
      const pass = String(form.get('pass') || '');
      if (pass && !/^•+$/.test(pass)) body.smtp.pass = pass;
      state.settings = (await api('/settings', { method: 'PUT', body })).settings;
      showToast('Email saved');
      render();
    } catch (error) { showToast(error.message); }
  });

  document.getElementById('test-email-btn')?.addEventListener('click', async () => {
    try {
      const result = await api('/settings/test-email', { method: 'POST', body: { to: document.getElementById('testTo')?.value || '' } });
      showToast(result.delivered ? `Sent to ${result.to}` : `Failed: ${result.reason || 'unknown'}`);
    } catch (error) { showToast(error.message); }
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
      state.settings = (await api('/settings', { method: 'PUT', body })).settings;
      showToast('Shopify saved');
      render();
    } catch (error) { showToast(error.message); }
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
      state.settings = (await api('/settings', { method: 'PUT', body })).settings;
      showToast('Stripe saved');
      render();
    } catch (error) { showToast(error.message); }
  });

  document.getElementById('shopify-check-btn')?.addEventListener('click', async () => {
    try {
      const result = await api('/settings/shopify-status');
      showToast(result.ok ? 'Shopify connected' : result.reason || 'Shopify issue');
    } catch (error) { showToast(error.message); }
  });
}

function render() {
  if (!state.token) renderLogin();
  else if (state.view === 'settings') renderSettings();
  else renderInbox();
}

bootstrap();
