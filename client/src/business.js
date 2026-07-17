import { requestBusinessQuote, updateBusinessQuote } from './api.js';
import { state } from './state.js';

document.documentElement.dataset.quoteFlow = 'business';
document.title = '3DNow Business 3D Print Quote Engine';

const introEyebrow = document.querySelector('.intro .eyebrow');
const introHeading = document.querySelector('.intro h1');
const introCopy = document.querySelector('.intro > p:last-child');
const studentProjects = document.querySelector('.student-projects');
const packageOptions = document.querySelector('#package-options');
const materialField = document.querySelector('#material-field');
const colourField = document.querySelector('#materials');
const speedOptions = document.querySelector('#speed-options');
const engineeringOptions = document.querySelector('#engineering-options');
const verificationOptions = document.querySelector('#verification-options');
const contactOptions = document.querySelector('#contact-options');

if (introEyebrow) introEyebrow.textContent = 'For businesses & startups';
if (introHeading) introHeading.innerHTML = 'Build your <em>production request.</em>';
if (introCopy) {
  introCopy.textContent = 'Drop your sliced file. We read the verified print time and weight, then you choose material, colour and quantity. We review the file and send back pricing for your project, from a single prototype to small-batch production. No payment is taken until you approve the quote.';
  const note = document.createElement('p');
  note.className = 'business-intro-note';
  note.textContent = 'From a single prototype to production runs of 1,000+. Same files, no retooling.';
  introCopy.after(note);
}
if (studentProjects) studentProjects.hidden = true;
if (packageOptions) packageOptions.hidden = true;

function setStep(field, number, label) {
  const legend = field?.querySelector('legend');
  if (legend) legend.innerHTML = `<span>${number}</span> ${label}`;
}

setStep(materialField, '02', 'Material');
setStep(colourField, '03', 'Preview colour');

if (colourField && !document.querySelector('#quantity-field')) {
  const quantityField = document.createElement('fieldset');
  quantityField.id = 'quantity-field';
  quantityField.className = 'business-quantity';
  quantityField.innerHTML = `
    <legend><span>04</span> Quantity</legend>
    <div class="option-grid option-grid-two" id="quantity-options">
      <button class="option-card" type="button" data-quantity-type="run" aria-pressed="false">
        <span class="option-indicator"></span><span><strong>Production run</strong><small>Set any quantity for a production estimate.</small></span>
      </button>
      <button class="option-card is-selected" type="button" data-quantity-type="prototype" aria-pressed="true">
        <span class="option-indicator"></span><span><strong>Single prototype</strong><small>One sample to validate before a batch.</small></span>
      </button>
    </div>
    <label class="business-quantity-input" id="business-quantity-input">Number of prints needed<input id="business-quantity" type="number" min="1" value="1" inputmode="numeric"></label>
  `;
  colourField.after(quantityField);

  quantityField.querySelectorAll('.option-card').forEach(card => {
    card.addEventListener('click', () => {
      const isRun = card.dataset.quantityType === 'run';
      const quantityInput = quantityField.querySelector('#business-quantity');
      quantityField.querySelectorAll('.option-card').forEach(option => {
        const selected = option === card;
        option.classList.toggle('is-selected', selected);
        option.setAttribute('aria-pressed', String(selected));
      });
      if (!isRun) quantityInput.value = '1';
      if (isRun && Number(quantityInput.value) <= 1) quantityInput.value = '100';
      refreshEstimate();
    });
  });

  quantityField.querySelector('#business-quantity').addEventListener('input', event => {
    const input = event.currentTarget;
    input.setCustomValidity(input.value && Number(input.value) < 1 ? 'Enter at least one print.' : '');
    refreshEstimate();
  });
}

const speedField = speedOptions?.closest('fieldset');
setStep(speedField, '05', 'Production speed');
if (speedOptions) {
  const speedCopy = {
    standard: ['Standard', '7-10 days', null],
    priority: ['Priority', '2-3 days', '+€59'],
    express: ['Express', '4-6 days', '+€39']
  };
  Object.entries(speedCopy).forEach(([key, [title, timing, price]]) => {
    const card = speedOptions.querySelector(`[data-speed="${key}"]`);
    if (!card) return;
    card.querySelector('strong').textContent = title;
    card.querySelector('small').textContent = timing;
    const priceNode = card.querySelector('b');
    if (priceNode && price) priceNode.textContent = price;
  });
}

const engineeringField = engineeringOptions?.closest('fieldset');
setStep(engineeringField, '06', 'Engineering support');
if (engineeringOptions) {
  const review = engineeringOptions.querySelector('[data-engineering="review"]');
  const editing = engineeringOptions.querySelector('[data-engineering="editing"]');
  if (review) {
    review.querySelector('strong').textContent = 'Get Expert Review';
    review.querySelector('b').textContent = '+€15';
  }
  if (editing) {
    editing.querySelector('strong').textContent = 'File Editing & Optimization';
    editing.querySelector('b').textContent = '€110/hour';
  }
}

if (engineeringField && !document.querySelector('#file-editing-terms')) {
  const editingTerms = document.createElement('label');
  editingTerms.id = 'file-editing-terms';
  editingTerms.className = 'file-editing-terms';
  editingTerms.hidden = true;
  editingTerms.innerHTML = '<input id="file-editing-acknowledged" type="checkbox"> <span>I understand that File Editing &amp; Optimization includes the first hour at €110. If more time is needed, 3DNow will ask for my approval before any additional charge.</span>';
  engineeringField.append(editingTerms);
  editingTerms.querySelector('input').addEventListener('change', refreshEstimate);
}

if (verificationOptions) verificationOptions.closest('fieldset').hidden = true;
setStep(contactOptions?.closest('fieldset'), '07', 'Contact details');

const packageRow = document.querySelector('#summary-package')?.closest('div');
const packageLabel = packageRow?.querySelector('dt');
if (packageLabel) packageLabel.textContent = 'Quantity';

function selectedValue(selector, attribute, fallback = null) {
  return document.querySelector(`${selector} .option-card.is-selected`)?.dataset[attribute] || fallback;
}

function renderEstimate() {
  const quote = state.quote;
  const quantity = Number(document.querySelector('#business-quantity')?.value) || 1;
  const status = document.querySelector('#request-status');
  document.querySelectorAll('#summary-checkout, #mobile-checkout-button').forEach(button => {
    button.textContent = 'Request production quote';
  });
  if (!quote) return;
  document.querySelector('#summary-total').textContent = `€${quote.total.toFixed(2)}`;
  document.querySelector('#mobile-total').textContent = `€${quote.total.toFixed(2)}`;
  document.querySelector('#summary-subtitle').textContent = `Production estimate for ${quantity} pieces`;
  document.querySelector('#summary-package').textContent = `${quantity} pieces`;
  document.querySelector('#summary-hint').textContent = quote.editingCost
    ? 'Estimate includes the first hour of file editing. Any additional editing time requires your approval before further charges.'
    : 'Estimate includes your selected production options.';
  if (status?.textContent === 'Updating production estimate…') status.textContent = '';
}

let estimateTimer;
async function refreshEstimate() {
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(async () => {
    const quantity = Number(document.querySelector('#business-quantity')?.value);
    const status = document.querySelector('#request-status');
    if (!state.job || !Number.isInteger(quantity) || quantity < 1) return;
    status.textContent = 'Updating production estimate…';
    try {
      const updated = await updateBusinessQuote(state.job.jobId, {
        quantity,
        speed: selectedValue('#speed-options', 'speed', 'standard'),
        engineering: selectedValue('#engineering-options', 'engineering')
      });
      state.job = updated;
      state.metrics = updated.metrics;
      state.quote = updated.quote;
      renderEstimate();
      window.dispatchEvent(new Event('quote-engine:refresh-summary'));
    } catch (error) {
      status.textContent = error.message || 'Could not update production estimate.';
    }
  }, 250);
}

window.addEventListener('quote-engine:job-updated', () => refreshEstimate());
window.addEventListener('quote-engine:refresh-summary', renderEstimate);
engineeringOptions?.addEventListener('click', event => {
  if (event.target.closest('.option-desc')) return;
  const card = event.target.closest('.option-card');
  if (!card) return;
  const terms = document.querySelector('#file-editing-terms');
  if (terms) terms.hidden = card.dataset.engineering !== 'editing' || !card.classList.contains('is-selected');
  refreshEstimate();
});
speedOptions?.addEventListener('click', () => refreshEstimate());

document.addEventListener('click', async event => {
  const button = event.target.closest('#summary-checkout, #mobile-checkout-button');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const status = document.querySelector('#request-status');
  const contactMethod = selectedValue('#contact-options', 'contact', 'email');
  const contactEmail = document.querySelector('#contact-email')?.value.trim() || '';
  const contactPhone = document.querySelector('#contact-phone')?.value.trim() || '';
  if (!state.job || !state.quote) {
    status.textContent = 'Upload a sliced G-code or a 3MF with embedded G-code so we can build a production estimate.';
    return;
  }
  if ((contactMethod === 'email' && !contactEmail) || (contactMethod === 'phone' && !contactPhone)) {
    status.textContent = contactMethod === 'email' ? 'Add your email address.' : 'Add your phone number.';
    return;
  }
  if (selectedValue('#engineering-options', 'engineering') === 'editing' && !document.querySelector('#file-editing-acknowledged')?.checked) {
    status.textContent = 'Confirm the file editing terms before requesting your quote.';
    return;
  }

  button.disabled = true;
  status.textContent = 'Sending your production quote request…';
  try {
    await requestBusinessQuote(state.job.jobId, {
      contactMethod,
      contactEmail,
      contactPhone,
      speed: selectedValue('#speed-options', 'speed', 'standard'),
      engineering: selectedValue('#engineering-options', 'engineering'),
      color: document.querySelector('#custom-color')?.value.trim() || state.color,
      fileEditingAcknowledged: Boolean(document.querySelector('#file-editing-acknowledged')?.checked)
    });
    status.textContent = 'Your production quote request has been received. We will contact you with the final quote.';
    window.showQuoteSuccessToast?.("Thanks, we've received your request. We will get back to you with the next steps.");
    document.querySelectorAll('#summary-checkout, #mobile-checkout-button').forEach(element => {
      element.disabled = true;
    });
  } catch (error) {
    status.textContent = error.message || 'Could not send your production quote request.';
    button.disabled = false;
  }
}, true);
