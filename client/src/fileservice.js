import './styles.css';

const embedMode = new URLSearchParams(window.location.search).has('embed')
  || (window.self !== window.top);
if (embedMode) {
  document.documentElement.classList.add('embed-mode');
  document.body?.classList.add('embed-mode');
}

const $ = (selector) => document.querySelector(selector);
const form = $('#idea-form');
const status = $('#idea-status');
const ok = $('#idea-ok');
const submit = $('#idea-submit');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form) return;

  const name = $('#idea-name')?.value.trim() || '';
  const email = $('#idea-email')?.value.trim() || '';
  const phone = $('#idea-phone')?.value.trim() || '';
  const description = $('#idea-desc')?.value.trim() || '';
  const deadline = $('#idea-deadline')?.value || '';
  const file = $('#idea-file')?.files?.[0] || null;

  if (!name || !email || !description) {
    status.textContent = 'Bitte Name, E-Mail und Beschreibung ausfüllen.';
    status.className = 'idea-status is-error';
    ok.hidden = true;
    return;
  }

  submit.disabled = true;
  status.textContent = 'Wird gesendet…';
  status.className = 'idea-status';
  ok.hidden = true;

  try {
    const body = new FormData();
    body.append('name', name);
    body.append('email', email);
    body.append('phone', phone);
    body.append('description', description);
    if (deadline) body.append('deadline', deadline);
    if (file) body.append('reference', file, file.name);

    const response = await fetch('/api/submissions/idea', { method: 'POST', body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Senden fehlgeschlagen.');

    form.reset();
    status.textContent = '';
    ok.hidden = false;
  } catch (error) {
    status.textContent = error.message || 'Senden fehlgeschlagen.';
    status.className = 'idea-status is-error';
  } finally {
    submit.disabled = false;
  }
});
