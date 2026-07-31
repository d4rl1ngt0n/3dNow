import './styles.css';

const embedMode = new URLSearchParams(window.location.search).has('embed')
  || (window.self !== window.top);
if (embedMode) {
  document.documentElement.classList.add('embed-mode');
  document.body?.classList.add('embed-mode');
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const form = $('#idea-form');
const status = $('#idea-status');
const ok = $('#idea-ok');
const submit = $('#idea-submit');
const fileInput = $('#idea-file');
const dropzone = $('#idea-dropzone');
const fileLabel = $('#idea-file-label');

function setLang(lang) {
  const next = lang === 'en' ? 'en' : 'de';
  document.documentElement.lang = next;
  $$('[data-en][data-de]').forEach((node) => {
    const value = node.getAttribute(`data-${next}`);
    if (value != null) {
      if (node.children.length && /<[a-z][\s\S]*>/i.test(value)) node.innerHTML = value;
      else node.textContent = value;
    }
  });
  $$('[data-en-ph][data-de-ph]').forEach((node) => {
    node.placeholder = node.getAttribute(`data-${next}-ph`) || '';
  });
  $$('.langswitch button').forEach((button) => {
    const active = button.dataset.lang === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  try { localStorage.setItem('3dnow-lang', next); } catch { /* ignore */ }
}

$$('.langswitch button').forEach((button) => {
  button.addEventListener('click', () => setLang(button.dataset.lang));
});

try {
  const saved = localStorage.getItem('3dnow-lang');
  if (saved === 'en' || saved === 'de') setLang(saved);
} catch { /* ignore */ }

function updateFileLabel() {
  const file = fileInput?.files?.[0];
  if (!fileLabel) return;
  if (file) {
    fileLabel.textContent = file.name;
    dropzone?.classList.add('has-file');
  } else {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'de';
    fileLabel.textContent = fileLabel.getAttribute(`data-${lang}`) || fileLabel.textContent;
    dropzone?.classList.remove('has-file');
  }
}

fileInput?.addEventListener('change', updateFileLabel);

['dragenter', 'dragover'].forEach((eventName) => {
  dropzone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragover');
  });
});
['dragleave', 'drop'].forEach((eventName) => {
  dropzone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
  });
});
dropzone?.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file || !fileInput) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  updateFileLabel();
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form) return;

  const name = $('#idea-name')?.value.trim() || '';
  const email = $('#idea-email')?.value.trim() || '';
  const phone = $('#idea-phone')?.value.trim() || '';
  const description = $('#idea-desc')?.value.trim() || '';
  const deadline = $('#idea-deadline')?.value || '';
  const file = fileInput?.files?.[0] || null;
  const isEn = document.documentElement.lang === 'en';

  if (!name || !email || !description) {
    status.textContent = isEn
      ? 'Please fill in name, email and description.'
      : 'Bitte Name, E-Mail und Beschreibung ausfüllen.';
    status.className = 'idea-status is-error';
    ok.hidden = true;
    return;
  }

  submit.disabled = true;
  status.textContent = isEn ? 'Sending…' : 'Wird gesendet…';
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
    if (!response.ok) throw new Error(payload.error || (isEn ? 'Could not send.' : 'Senden fehlgeschlagen.'));

    form.reset();
    updateFileLabel();
    status.textContent = '';
    ok.hidden = false;
  } catch (error) {
    status.textContent = error.message || (isEn ? 'Could not send.' : 'Senden fehlgeschlagen.');
    status.className = 'idea-status is-error';
  } finally {
    submit.disabled = false;
  }
});
