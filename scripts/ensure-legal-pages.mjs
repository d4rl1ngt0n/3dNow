/**
 * Create / publish Shopify legal pages if missing.
 * Run on a host that has SHOPIFY_* in .env (e.g. /opt/3dnow).
 *
 * Usage: node --env-file=.env scripts/ensure-legal-pages.mjs
 */
const shop = (process.env.SHOPIFY_SHOP || '')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');
const clientId = process.env.SHOPIFY_CLIENT_ID || '';
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || '';

if (!shop || !clientId || !clientSecret) {
  console.error('Missing SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET');
  process.exit(1);
}

const PAGES = [
  { handle: 'impressum', title: 'Impressum', template_suffix: 'impressum', body_html: '<p></p>' },
  { handle: 'datenschutz', title: 'Datenschutz', template_suffix: 'datenschutz', body_html: '<p></p>' },
  { handle: 'agb', title: 'AGB', template_suffix: 'agb', body_html: '<p></p>' },
  { handle: 'widerruf', title: 'Widerruf', template_suffix: 'widerruf', body_html: '<p></p>' }
];

async function getToken() {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token ${res.status}: ${text}`);
  const data = JSON.parse(text);
  console.log('token scopes:', data.scope || '(none)');
  return data.access_token;
}

async function api(token, method, path, body) {
  const res = await fetch(`https://${shop}/admin/api/2024-10${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function main() {
  const token = await getToken();
  const listed = await api(token, 'GET', '/pages.json?limit=250');
  const byHandle = new Map((listed.pages || []).map((p) => [p.handle, p]));

  for (const spec of PAGES) {
    const existing = byHandle.get(spec.handle);
    if (!existing) {
      const created = await api(token, 'POST', '/pages.json', {
        page: {
          title: spec.title,
          handle: spec.handle,
          body_html: spec.body_html,
          template_suffix: spec.template_suffix,
          published: true
        }
      });
      console.log('CREATED', created.page?.handle, created.page?.id, 'published_at=', created.page?.published_at);
      continue;
    }

    const needsPublish = !existing.published_at;
    const needsTemplate = (existing.template_suffix || '') !== spec.template_suffix;
    if (!needsPublish && !needsTemplate) {
      console.log('OK', existing.handle, existing.id, 'published_at=', existing.published_at);
      continue;
    }

    const updated = await api(token, 'PUT', `/pages/${existing.id}.json`, {
      page: {
        id: existing.id,
        template_suffix: spec.template_suffix,
        published: true
      }
    });
    console.log('UPDATED', updated.page?.handle, updated.page?.id, 'published_at=', updated.page?.published_at, 'template=', updated.page?.template_suffix);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
