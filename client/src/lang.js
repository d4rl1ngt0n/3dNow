const LANG_KEY = '3dnow-lang';
const COOKIE_NAME = '3dnow_lang';
const YEAR = 60 * 60 * 24 * 365;

let currentLang = 'de';

function cookieDomain() {
  const host = window.location.hostname;
  if (host === '3d-now.de' || host.endsWith('.3d-now.de')) return '.3d-now.de';
  return '';
}

function readCookie(name) {
  const parts = String(document.cookie || '').split(';');
  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function writeCookie(name, value) {
  const domain = cookieDomain();
  const domainPart = domain ? `; Domain=${domain}` : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax${domainPart}`;
}

function decodeEntities(value) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

export function normalizeLang(lang) {
  return lang === 'en' ? 'en' : 'de';
}

export function getLang() {
  return currentLang;
}

export function t(en, de) {
  return currentLang === 'de' ? de : en;
}

export function readStoredLang() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('lang');
    if (fromQuery === 'en' || fromQuery === 'de') return fromQuery;
  } catch { /* ignore */ }

  const fromCookie = readCookie(COOKIE_NAME);
  if (fromCookie === 'en' || fromCookie === 'de') return fromCookie;

  try {
    const fromStorage = localStorage.getItem(LANG_KEY);
    if (fromStorage === 'en' || fromStorage === 'de') return fromStorage;
  } catch { /* ignore */ }

  const htmlLang = document.documentElement.getAttribute('lang');
  if (htmlLang === 'en' || htmlLang === 'de') return htmlLang;
  return 'de';
}

export function persistLang(lang) {
  const next = normalizeLang(lang);
  try { localStorage.setItem(LANG_KEY, next); } catch { /* ignore */ }
  try { writeCookie(COOKIE_NAME, next); } catch { /* ignore */ }
  return next;
}

export function applyLangAttributes(lang) {
  currentLang = normalizeLang(lang);
  document.documentElement.setAttribute('lang', currentLang);
  document.documentElement.lang = currentLang;

  document.querySelectorAll('[data-en][data-de]').forEach((node) => {
    if (node.classList?.contains('readmore-btn')) return;
    // Skip only when a descendant owns its own translation pair.
    if (node.querySelector?.('[data-en][data-de]')) return;
    const raw = node.getAttribute(`data-${currentLang}`);
    if (raw == null) return;
    if (/<[a-z][\s\S]*>/i.test(raw)) node.innerHTML = raw;
    else node.textContent = decodeEntities(raw);
  });

  document.querySelectorAll('[data-en-ph][data-de-ph]').forEach((node) => {
    const raw = node.getAttribute(`data-${currentLang}-ph`) || '';
    node.setAttribute('placeholder', decodeEntities(raw));
  });

  document.querySelectorAll('[data-en-title][data-de-title]').forEach((node) => {
    const raw = node.getAttribute(`data-${currentLang}-title`) || '';
    node.setAttribute('title', decodeEntities(raw));
  });

  document.querySelectorAll('[data-en-aria][data-de-aria]').forEach((node) => {
    const raw = node.getAttribute(`data-${currentLang}-aria`) || '';
    node.setAttribute('aria-label', decodeEntities(raw));
  });

  document.querySelectorAll('.langswitch button').forEach((button) => {
    const code = button.getAttribute('data-lang') || (button.textContent || '').trim().toLowerCase();
    const active = code === currentLang;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  window.dispatchEvent(new CustomEvent('3dnow:lang', { detail: { lang: currentLang } }));
  return currentLang;
}

export function bindLangSwitch(onChange) {
  document.querySelectorAll('.langswitch button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const code = button.getAttribute('data-lang') || (button.textContent || '').trim().toLowerCase();
      onChange(normalizeLang(code));
    });
  });
}
