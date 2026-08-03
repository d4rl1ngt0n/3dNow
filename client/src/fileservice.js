import './styles.css';
import {
  applyLangAttributes,
  bindLangSwitch,
  persistLang,
  readStoredLang
} from './lang.js';

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
const deadlineInput = $('#idea-deadline');
const quantityInput = $('#idea-quantity');

function tomorrowIsoDate() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function applyDeadlineMin() {
  if (!deadlineInput) return;
  const min = tomorrowIsoDate();
  deadlineInput.min = min;
  if (deadlineInput.value && deadlineInput.value < min) deadlineInput.value = '';
}

applyDeadlineMin();
deadlineInput?.addEventListener('focus', applyDeadlineMin);
deadlineInput?.addEventListener('click', applyDeadlineMin);
deadlineInput?.addEventListener('change', () => {
  applyDeadlineMin();
  if (deadlineInput.value && deadlineInput.value < deadlineInput.min) {
    deadlineInput.value = '';
    deadlineInput.setCustomValidity(
      document.documentElement.lang === 'en'
        ? 'Choose a future date.'
        : 'Bitte ein Datum in der Zukunft wählen.'
    );
  } else {
    deadlineInput.setCustomValidity('');
  }
});

function setLang(lang) {
  const next = persistLang(lang);
  applyLangAttributes(next);
  return next;
}

bindLangSwitch(setLang);
setLang(readStoredLang());

const servicesMenuButton = $('#services-menu-button');
const servicesMenu = $('#services-menu');
const hamburger = $('#hamburger');
const mobileMenu = $('#mobile-menu');

servicesMenuButton?.addEventListener('click', () => {
  const isOpen = servicesMenu.classList.toggle('is-open');
  servicesMenuButton.setAttribute('aria-expanded', String(isOpen));
});

document.addEventListener('click', (event) => {
  if (!servicesMenuButton?.contains(event.target) && !servicesMenu?.contains(event.target)) {
    servicesMenu?.classList.remove('is-open');
    servicesMenuButton?.setAttribute('aria-expanded', 'false');
  }
});

hamburger?.addEventListener('click', () => {
  const isOpen = mobileMenu.classList.toggle('is-open');
  hamburger.setAttribute('aria-expanded', String(isOpen));
  hamburger.setAttribute(
    'aria-label',
    isOpen
      ? (document.documentElement.lang === 'en' ? 'Close navigation menu' : 'Menü schließen')
      : (document.documentElement.lang === 'en' ? 'Open navigation menu' : 'Menü öffnen')
  );
});

mobileMenu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  mobileMenu.classList.remove('is-open');
  hamburger?.setAttribute('aria-expanded', 'false');
  hamburger?.setAttribute(
    'aria-label',
    document.documentElement.lang === 'en' ? 'Open navigation menu' : 'Menü öffnen'
  );
}));

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

  applyDeadlineMin();
  const name = $('#idea-name')?.value.trim() || '';
  const email = $('#idea-email')?.value.trim() || '';
  const phone = $('#idea-phone')?.value.trim() || '';
  const description = $('#idea-desc')?.value.trim() || '';
  const deadline = deadlineInput?.value || '';
  const quantity = Number(quantityInput?.value || 0);
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
  if (!Number.isInteger(quantity) || quantity < 1) {
    status.textContent = isEn
      ? 'Enter how many prints you need (at least 1).'
      : 'Bitte die Anzahl der Drucke angeben (mindestens 1).';
    status.className = 'idea-status is-error';
    ok.hidden = true;
    return;
  }
  if (deadline && deadline < (deadlineInput?.min || tomorrowIsoDate())) {
    status.textContent = isEn
      ? 'Preferred deadline must be a future date.'
      : 'Der Wunschtermin muss in der Zukunft liegen.';
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
    body.append('quantity', String(quantity));
    if (deadline) body.append('deadline', deadline);
    if (file) body.append('reference', file, file.name);

    const response = await fetch('/api/submissions/idea', { method: 'POST', body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || (isEn ? 'Could not send.' : 'Senden fehlgeschlagen.'));

    form.reset();
    if (quantityInput) quantityInput.value = '1';
    applyDeadlineMin();
    updateFileLabel();
    const ref = payload.orderNumber ? String(payload.orderNumber).toUpperCase() : '';
    if (ref) {
      ok.textContent = isEn
        ? `Thanks, we received your idea (${ref}) and will get back to you with the next steps.`
        : `Danke, wir haben deine Idee erhalten (${ref}) und melden uns mit den nächsten Schritten.`;
    } else {
      ok.textContent = ok.getAttribute(isEn ? 'data-en' : 'data-de')
        || (isEn
          ? 'Thanks, we received your idea and will get back to you with the next steps.'
          : 'Danke, wir haben deine Idee erhalten und melden uns mit den nächsten Schritten.');
    }
    status.textContent = '';
    ok.hidden = false;
  } catch (error) {
    status.textContent = error.message || (isEn ? 'Could not send.' : 'Senden fehlgeschlagen.');
    status.className = 'idea-status is-error';
  } finally {
    submit.disabled = false;
  }
});
