import './admin.css';

const TOKEN_KEY = '3dnow_admin_token';
const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  configured: true,
  orders: [],
  labels: {},
  statuses: [],
  stats: null,
  selectedId: null,
  filters: { q: '', type: '', status: '' },
  busy: false,
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
  if (state.filters.status) query.set('status', state.filters.status);
  const [list, stats] = await Promise.all([
    api(`/orders?${query}`),
    api('/stats')
  ]);
  state.orders = list.orders || [];
  state.labels = list.labels || {};
  state.statuses = list.statuses || [];
  state.stats = stats;
  if (state.selectedId && !state.orders.some(order => order.id === state.selectedId)) {
    state.selectedId = state.orders[0]?.id || null;
  }
  if (!state.selectedId && state.orders[0]) state.selectedId = state.orders[0].id;
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="login-form">
        <h1>3DNow Ops</h1>
        <p class="lede">Sign in to review inbound requests and update customers when production moves forward.</p>
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

function renderDashboard() {
  const order = selectedOrder();
  const stats = state.stats || { total: 0, open: 0, byStatus: {}, byType: {} };

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="/admin">
          <img src="/brand-logo" alt="3DNow"/>
          <span class="brand-copy"><strong>Ops</strong><span>Order management</span></span>
        </a>
        <div class="topbar-actions">
          <button class="btn" type="button" id="refresh-btn">Refresh</button>
          <button class="btn btn-danger" type="button" id="logout-btn">Sign out</button>
        </div>
      </header>

      <main class="layout">
        <section>
          <div class="stats">
            <div class="stat"><strong>${stats.open || 0}</strong><span>Open</span></div>
            <div class="stat"><strong>${stats.byStatus?.paid || 0}</strong><span>Paid</span></div>
            <div class="stat"><strong>${stats.byStatus?.['in-production'] || 0}</strong><span>In production</span></div>
            <div class="stat"><strong>${stats.total || 0}</strong><span>Total</span></div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <div>
                <h2>Inbox</h2>
                <p>Everything customers have sent through the quote engine and forms.</p>
              </div>
            </div>
            <div class="panel-body">
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
                  <label for="status">Status</label>
                  <select id="status" name="status">
                    <option value="">All statuses</option>
                    ${state.statuses.map(status => `
                      <option value="${status}" ${state.filters.status === status ? 'selected' : ''}>${escapeHtml(state.labels[status] || status)}</option>
                    `).join('')}
                  </select>
                </div>
                <div class="field">
                  <label>&nbsp;</label>
                  <button class="btn" type="submit">Filter</button>
                </div>
              </form>

              <div class="order-list">
                ${state.orders.length ? state.orders.map(item => `
                  <button class="order-card ${item.id === state.selectedId ? 'active' : ''}" type="button" data-order-id="${item.id}">
                    <div class="order-card-top">
                      <strong>${escapeHtml(typeLabel(item.type))}</strong>
                      ${statusBadge(item.status)}
                    </div>
                    <div class="summary">${escapeHtml(item.summary || item.filename || 'Untitled request')}</div>
                    <div class="meta">${escapeHtml(item.customer?.email || item.customer?.phone || 'No contact')} · ${escapeHtml(formatDate(item.createdAt))}</div>
                  </button>
                `).join('') : '<div class="empty">No requests match these filters yet.</div>'}
              </div>
            </div>
          </div>
        </section>

        <aside class="panel">
          <div class="panel-head">
            <div>
              <h2>Details</h2>
              <p>${order ? 'Update status and notify the customer.' : 'Select a request from the inbox.'}</p>
            </div>
          </div>
          <div class="panel-body">
            ${order ? renderDetail(order) : '<div class="empty">Nothing selected.</div>'}
          </div>
        </aside>
      </main>
      ${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ''}
    </div>
  `;

  document.getElementById('refresh-btn')?.addEventListener('click', async () => {
    await refresh();
    render();
    showToast('Inbox refreshed');
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST' }); } catch { /* ignore */ }
    clearSession();
    render();
  });

  document.getElementById('filter-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.filters = {
      q: String(form.get('q') || '').trim(),
      type: String(form.get('type') || ''),
      status: String(form.get('status') || '')
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

  const statusForm = document.getElementById('status-form');
  statusForm?.addEventListener('submit', async event => {
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

function renderDetail(order) {
  const details = order.details || {};
  const payment = order.payment || {};
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
          <dt>Package</dt><dd>${escapeHtml(details.packageName || order.quote?.package?.name || order.quote?.totalFormatted || 'n/a')}</dd>
          <dt>Material</dt><dd>${escapeHtml(details.material || 'n/a')}</dd>
          <dt>Quantity</dt><dd>${escapeHtml(details.quantity ?? 'n/a')}</dd>
        </dl>
      </div>

      ${order.files?.length ? `
        <div>
          <h3 style="font-size:14px;margin-bottom:8px">Files</h3>
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
          <h3 style="font-size:14px;margin-bottom:8px">Message</h3>
          <p style="white-space:pre-wrap;font-size:13px;color:var(--muted)">${escapeHtml(details.message || details.description || details.configuration)}</p>
        </div>
      ` : ''}

      <form id="status-form" class="detail-grid">
        <div class="field">
          <label for="status-select">Production status</label>
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
        <h3 style="font-size:14px">Notify customer</h3>
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
        <h3 style="font-size:14px;margin-bottom:8px">Status history</h3>
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
        <h3 style="font-size:14px;margin-bottom:8px">Notifications sent</h3>
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

function render() {
  if (!state.token) renderLogin();
  else renderDashboard();
}

bootstrap();
