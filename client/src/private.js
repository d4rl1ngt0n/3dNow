import { requestPrivateQuote } from './api.js';
import { state } from './state.js';

document.documentElement.dataset.quoteFlow = 'private';
document.title = '3DNow Private Customer Quote Engine';

const introEyebrow = document.querySelector('.intro .eyebrow');
const introHeading = document.querySelector('.intro h1');
const introCopy = document.querySelector('.intro > p:last-child');
const studentProjects = document.querySelector('.student-projects');
const packageOptions = document.querySelector('#package-options');
const verificationField = document.querySelector('#verification-options')?.closest('fieldset');
const speedOptions = document.querySelector('#speed-options');
const engineeringOptions = document.querySelector('#engineering-options');
const contactField = document.querySelector('#contact-options')?.closest('fieldset');
const privateCustomerContent = document.querySelector('#private-customer-content');
const colourField = document.querySelector('#materials');

if (introEyebrow) introEyebrow.textContent = 'For private customers';
if (introHeading) introHeading.innerHTML = 'Upload &amp; get <em>your price.</em>';
if (introCopy) {
  introCopy.textContent = "A repair, a one-off gift, a cosplay piece or a prototype. Drop your sliced file, pick material, colour and quantity, and we'll review it and send you a price. No payment is taken here.";
}
if (studentProjects) studentProjects.hidden = true;
if (packageOptions) packageOptions.hidden = true;
if (verificationField) verificationField.hidden = true;
if (privateCustomerContent) privateCustomerContent.hidden = false;

function setStep(field, number, label) {
  const legend = field?.querySelector('legend');
  if (legend) legend.innerHTML = `<span>${number}</span> ${label}`;
}

setStep(document.querySelector('#material-field'), '02', 'Material');
setStep(colourField, '03', 'Preview colour');

if (colourField && !document.querySelector('#private-quantity-field')) {
  const quantityField = document.createElement('fieldset');
  quantityField.id = 'private-quantity-field';
  quantityField.className = 'private-quantity';
  quantityField.innerHTML = '<legend><span>04</span> Number of prints needed</legend><label class="quote-field">Quantity<input id="private-quantity" type="number" min="1" value="1" inputmode="numeric" required></label>';
  colourField.after(quantityField);

  const quantityInput = quantityField.querySelector('#private-quantity');
  quantityInput.addEventListener('input', () => {
    quantityInput.setCustomValidity(Number(quantityInput.value) < 1 ? 'Enter at least one print.' : '');
    document.querySelector('#summary-quantity')?.replaceChildren(document.createTextNode(`${quantityInput.value || 1}`));
    window.dispatchEvent(new Event('quote-engine:refresh-summary'));
  });

  const summaryLines = document.querySelector('.summary-lines');
  if (summaryLines && !document.querySelector('#summary-quantity')) {
    const row = document.createElement('div');
    row.innerHTML = '<dt>Quantity</dt><dd id="summary-quantity">1</dd>';
    summaryLines.querySelector('div:nth-child(4)')?.after(row);
  }
}

setStep(speedOptions?.closest('fieldset'), '05', 'Delivery speed');
setStep(engineeringOptions?.closest('fieldset'), '06', 'Optional support');
setStep(contactField, '07', 'Contact details');

const packageRow = document.querySelector('#summary-package')?.closest('div');
const packageLabel = packageRow?.querySelector('dt');
if (packageLabel) packageLabel.textContent = 'Quantity';

const speedCopy = {
  standard: ['Standard', '7-10 days', 'Included'],
  priority: ['Priority', '2-3 days', '+€59'],
  express: ['Express', '4-6 days', '+€39']
};
Object.entries(speedCopy).forEach(([key, [title, timing, price]]) => {
  const card = speedOptions?.querySelector(`[data-speed="${key}"]`);
  if (!card) return;
  card.querySelector('strong').textContent = title;
  card.querySelector('small').textContent = timing;
  card.querySelector('b').textContent = price;
});

const review = engineeringOptions?.querySelector('[data-engineering="review"]');
const editing = engineeringOptions?.querySelector('[data-engineering="editing"]');
if (review) {
  review.querySelector('strong').textContent = 'Get Expert Review';
  review.querySelector('b').textContent = '+€35';
}
if (editing) {
  editing.querySelector('strong').textContent = 'File Editing & Optimization';
  editing.querySelector('b').textContent = '€90/hour';
}

function selectedValue(selector, attribute, fallback = null) {
  return document.querySelector(`${selector} .option-card.is-selected`)?.dataset[attribute] || fallback;
}

function setRequestLabels() {
  document.querySelectorAll('#summary-checkout, #mobile-checkout-button').forEach(button => {
    button.textContent = 'Request quote';
  });
}

setRequestLabels();
window.addEventListener('quote-engine:refresh-summary', () => {
  document.querySelector('#summary-package').textContent = `${Number(document.querySelector('#private-quantity')?.value) || 1} pieces`;
});

document.addEventListener('click', async event => {
  const button = event.target.closest('#summary-checkout, #mobile-checkout-button');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const status = document.querySelector('#request-status');
  const contactMethod = selectedValue('#contact-options', 'contact', 'email');
  const contactEmail = document.querySelector('#contact-email')?.value.trim() || '';
  const contactPhone = document.querySelector('#contact-phone')?.value.trim() || '';
  const quantity = Number(document.querySelector('#private-quantity')?.value || 0);
  const engineering = selectedValue('#engineering-options', 'engineering');
  if (!state.job) {
    status.textContent = 'Upload a file before requesting a quote.';
    return;
  }
  if ((contactMethod === 'email' && !contactEmail) || (contactMethod === 'phone' && !contactPhone)) {
    status.textContent = contactMethod === 'email' ? 'Add your email address.' : 'Add your phone number.';
    return;
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    status.textContent = 'Enter the number of prints you need.';
    return;
  }
  if (engineering !== 'review' && !document.querySelector('#private-disclaimer-ack')?.checked) {
    status.textContent = 'Confirm the no Expert Review notice.';
    return;
  }

  button.disabled = true;
  status.textContent = 'Sending your quote request…';
  try {
    await requestPrivateQuote(state.job.jobId, {
      contactMethod,
      contactEmail,
      contactPhone,
      speed: selectedValue('#speed-options', 'speed', 'standard'),
      engineering,
      material: state.material,
      color: document.querySelector('#custom-color')?.value.trim() || state.color,
      quantity
    });
    status.textContent = 'Your quote request has been received. We will contact you with a price before payment.';
    window.showQuoteSuccessToast?.("Thanks, we've received your request. We will get back to you with the next steps.");
    document.querySelectorAll('#summary-checkout, #mobile-checkout-button').forEach(element => {
      element.disabled = true;
    });
  } catch (error) {
    status.textContent = error.message || 'Could not send your quote request.';
    button.disabled = false;
  }
}, true);
