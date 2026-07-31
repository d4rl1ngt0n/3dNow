const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

// Free / consumer mail providers are never valid for student verification.
const CONSUMER_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.de',
  'hotmail.com',
  'hotmail.de',
  'outlook.com',
  'outlook.de',
  'live.com',
  'live.de',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'gmx.at',
  'gmx.ch',
  'web.de',
  't-online.de',
  'mail.com',
  'mail.de',
  'email.de',
  'freenet.de',
  'online.de',
  'arcor.de',
  'posteo.de',
  'mailbox.org',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
  'fastmail.com'
]);

const EDU_KEYWORD = /(university|universit|college|school|schule|academy|hochschule|studium|student|(^|[.-])(uni|fh|th|htw|hfu|hsa|hsb)([.-]|$))/i;

function registrableParts(domain) {
  const parts = String(domain || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return { root: domain, tld: '' };
  return {
    root: parts.slice(0, -1).join('.'),
    host: parts[parts.length - 2],
    tld: parts[parts.length - 1],
    domain
  };
}

export function isEligibleStudentEmail(value) {
  const match = String(value || '').trim().toLowerCase().match(EMAIL_PATTERN);
  if (!match) return false;

  const domain = match[1];
  if (CONSUMER_DOMAINS.has(domain)) return false;

  // Classic academic TLDs / second-level academic domains.
  if (domain.endsWith('.edu') || domain.includes('.edu.')) return true;
  if (/\.ac\.[a-z]{2,}$/.test(domain)) return true;

  // University / school naming in the domain.
  if (EDU_KEYWORD.test(domain)) return true;

  // Country institutional mail commonly ends in .de / .at / .ch (not consumer providers).
  const { tld } = registrableParts(domain);
  if (tld === 'de' || tld === 'at' || tld === 'ch') return true;

  return false;
}

export function studentEmailHint() {
  return 'Use a university or school email (.edu, .de, .ac.uk, …). Gmail, GMX, Web.de and similar personal addresses are not accepted.';
}
