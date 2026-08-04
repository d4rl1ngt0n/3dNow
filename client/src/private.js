import { requestPrivateQuote } from './api.js';
import { state } from './state.js';
import { applyLangAttributes, getLang, t } from './lang.js';

document.documentElement.dataset.quoteFlow = 'private';
document.title = t('3DNow Private Customer Quote Engine', '3DNow Privatkunden-Angebot');

const introEyebrow = document.querySelector('.intro .eyebrow');
const introHeading = document.querySelector('.intro h1');
const introCopy = document.querySelector('.intro > p:last-child');
const studentProjects = document.querySelector('.student-projects');
const packageOptions = document.querySelector('#package-options');
const verificationField = document.querySelector('#verification-options')?.closest('fieldset')
  || document.querySelector('#verification-field');
const speedField = document.querySelector('#speed-options')?.closest('fieldset')
  || document.querySelector('#speed-field');
const engineeringField = document.querySelector('#engineering-options')?.closest('fieldset')
  || document.querySelector('#engineering-field');
const contactField = document.querySelector('#contact-options')?.closest('fieldset')
  || document.querySelector('#contact-field');
const privateCustomerContent = document.querySelector('#private-customer-content');
const colourField = document.querySelector('#materials');

function setBilingual(node, en, de, { html = false } = {}) {
  if (!node) return;
  node.setAttribute('data-en', en);
  node.setAttribute('data-de', de);
  if (html) node.innerHTML = getLang() === 'de' ? de : en;
  else node.textContent = getLang() === 'de' ? de : en;
}

setBilingual(introEyebrow, 'For private customers', 'Für Privatkund:innen');
setBilingual(introHeading, 'Upload &amp; get <em>your price.</em>', 'Hochladen &amp; <em>Preis erhalten.</em>', { html: true });
setBilingual(
  introCopy,
  'A repair, a one-off gift, a cosplay piece or a prototype. Drop your model, pick material, colour and quantity, and we\'ll review it and send you a price. No payment is taken here.',
  'Ersatz- und Verschleißteile, Hobby- und Tabletop-Stücke, Geschenke, Miniaturen, Cosplay-Requisiten, Wohnaccessoires und individuelle Objekte. Wenn du eine druckbare Datei hast, lade sie oben hoch. Wenn du nur eine Idee hast, beschreib sie und wir prüfen, ob wir sie für dich modellieren können.'
);
if (studentProjects) studentProjects.hidden = true;
if (packageOptions) packageOptions.hidden = true;
if (verificationField) verificationField.hidden = true;
if (speedField) speedField.hidden = true;
if (engineeringField) engineeringField.hidden = true;
if (privateCustomerContent) privateCustomerContent.hidden = false;

function setStep(field, number, en, de) {
  const legend = field?.querySelector('legend');
  if (!legend) return;
  legend.innerHTML = `<span>${number}</span> <span data-en="${en}" data-de="${de}">${getLang() === 'de' ? de : en}</span>`;
}

setStep(document.querySelector('#material-field'), '02', 'Material', 'Material');
setStep(colourField, '03', 'Colour', 'Farbe');

if (colourField && !document.querySelector('#private-quantity-field')) {
  const quantityField = document.createElement('fieldset');
  quantityField.id = 'private-quantity-field';
  quantityField.className = 'private-quantity';
  quantityField.innerHTML = `<legend><span>04</span> <span data-en="Quantity" data-de="Stückzahl">Stückzahl</span></legend><label class="quote-field"><span data-en="Quantity" data-de="Stückzahl">Stückzahl</span><input id="private-quantity" type="number" min="1" value="1" inputmode="numeric" required></label>`;
  colourField.after(quantityField);

  const quantityInput = quantityField.querySelector('#private-quantity');
  quantityInput.addEventListener('input', () => {
    quantityInput.setCustomValidity(Number(quantityInput.value) < 1 ? t('Enter at least one print.', 'Mindestens einen Druck angeben.') : '');
    document.querySelector('#summary-quantity')?.replaceChildren(document.createTextNode(`${quantityInput.value || 1}`));
    window.dispatchEvent(new Event('quote-engine:refresh-summary'));
  });

  const summaryLines = document.querySelector('.summary-lines');
  if (summaryLines && !document.querySelector('#summary-quantity')) {
    const row = document.createElement('div');
    row.innerHTML = `<dt data-en="Quantity" data-de="Stückzahl">${t('Quantity', 'Stückzahl')}</dt><dd id="summary-quantity">1</dd>`;
    summaryLines.querySelector('div:nth-child(4)')?.after(row);
  }
}

setStep(contactField, '05', 'Contact details', 'Kontaktdaten');
const contactEmailSmall = contactField?.querySelector('[data-contact="email"] small');
if (contactEmailSmall) setBilingual(contactEmailSmall, 'Get updates by email', 'Updates per E-Mail erhalten');
const contactUpdatesNote = document.querySelector('#contact-updates-note');
if (contactUpdatesNote) {
  setBilingual(
    contactUpdatesNote,
    "We'll send your price to this contact, so please make sure it's correct and up to date.",
    'Wir schicken dir dein persönliches Preisangebot hierhin – bitte stell sicher, dass deine Informationen korrekt und aktuell sind.'
  );
}

const requestHeading = document.querySelector('#request-options-heading');
setBilingual(requestHeading, 'Print and contact details', 'Druck- und Kontaktdaten');

const summarySpeed = document.querySelector('#summary-speed')?.closest('div');
const summaryEngineering = document.querySelector('#summary-engineering')?.closest('div');
if (summarySpeed) summarySpeed.hidden = true;
if (summaryEngineering) summaryEngineering.hidden = true;

function setRequestLabels() {
  document.querySelectorAll('#summary-checkout, #mobile-checkout-button').forEach(button => {
    setBilingual(button, 'Request your price', 'Preis anfragen');
  });
  const hint = document.querySelector('#summary-hint');
  if (hint) {
    setBilingual(hint, 'Add your email or phone number to continue.', 'Füge deine E-Mail oder Telefonnummer hinzu, um fortzufahren.');
  }
}

setRequestLabels();
applyLangAttributes(getLang());
window.addEventListener('3dnow:lang', () => {
  document.title = t('3DNow Private Customer Quote Engine', '3DNow Privatkunden-Angebot');
  setRequestLabels();
});

function selectedValue(selector, attribute, fallback = null) {
  return document.querySelector(`${selector} .option-card.is-selected`)?.dataset[attribute] || fallback;
}

window.dispatchEvent(new Event('quote-engine:refresh-summary'));
window.addEventListener('quote-engine:refresh-summary', () => {
  document.querySelector('#summary-package')?.replaceChildren(
    document.createTextNode(`${Number(document.querySelector('#private-quantity')?.value) || 1} pieces`)
  );
  setRequestLabels();
});

document.addEventListener('click', async event => {
  const button = event.target.closest('#summary-checkout, #mobile-checkout-button');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const status = document.querySelector('#request-status');
  if (!status) return;
  const contactMethod = selectedValue('#contact-options', 'contact', 'email');
  const contactEmail = document.querySelector('#contact-email')?.value.trim() || '';
  const contactPhone = document.querySelector('#contact-phone')?.value.trim() || '';
  const quantity = Number(document.querySelector('#private-quantity')?.value || 0);
  if (!state.job) {
    status.textContent = t('Upload a file before requesting a quote.', 'Lade zuerst eine Datei hoch, bevor du einen Preis anfragst.');
    return;
  }
  if ((contactMethod === 'email' && !contactEmail) || (contactMethod === 'phone' && !contactPhone)) {
    status.textContent = t('Add your email or phone number to continue.', 'Füge deine E-Mail oder Telefonnummer hinzu, um fortzufahren.');
    return;
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    status.textContent = t('Enter the number of prints you need.', 'Gib die gewünschte Stückzahl an.');
    return;
  }

  button.disabled = true;
  status.textContent = t('Sending your quote request…', 'Preisanfrage wird gesendet…');
  try {
    await requestPrivateQuote(state.job.jobId, {
      contactMethod,
      contactEmail,
      contactPhone,
      speed: 'standard',
      engineering: null,
      material: state.material,
      color: document.querySelector('#custom-color')?.value.trim() || state.color,
      quantity
    });
    const ref = String(state.job.jobId || '').toUpperCase();
    status.textContent = ref
      ? t(`Your quote request ${ref} has been received. We will email you a price. No payment is taken here.`, `Deine Preisanfrage ${ref} ist eingegangen. Wir schicken dir einen Preis per E-Mail. Hier wird nicht bezahlt.`)
      : t('Your quote request has been received. We will email you a price. No payment is taken here.', 'Deine Preisanfrage ist eingegangen. Wir schicken dir einen Preis per E-Mail. Hier wird nicht bezahlt.');
    window.showQuoteSuccessToast?.(ref
      ? t(`Thanks, we've received your request (${ref}). We will get back to you with the next steps.`, `Danke, wir haben deine Anfrage (${ref}) erhalten und melden uns mit den nächsten Schritten.`)
      : t("Thanks, we've received your request. We will get back to you with the next steps.", 'Danke, wir haben deine Anfrage erhalten und melden uns mit den nächsten Schritten.'));
    document.querySelectorAll('#summary-checkout, #mobile-checkout-button').forEach(element => {
      element.disabled = true;
    });
  } catch (error) {
    status.textContent = error.message || t('Could not send your quote request.', 'Preisanfrage konnte nicht gesendet werden.');
    button.disabled = false;
  }
}, true);
