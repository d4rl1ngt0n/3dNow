const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

export function isEligibleStudentEmail(value) {
  const match = String(value || '').trim().toLowerCase().match(EMAIL_PATTERN);
  if (!match) return false;

  const domain = match[1];
  return domain.endsWith('.edu')
    || /\.ac\.[a-z]{2,}$/.test(domain)
    || /(university|college|school|academy|hochschule|(^|[.-])uni([.-]|$))/.test(domain);
}
