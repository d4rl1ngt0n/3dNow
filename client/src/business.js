import { requestBusinessQuote, updateBusinessQuote } from './api.js';
import { state } from './state.js';
import { applyLangAttributes, getLang, t } from './lang.js';

document.documentElement.dataset.quoteFlow = 'business';
document.title = t('3DNow Business 3D Print Quote Engine', '3DNow Business 3D-Druck Angebot');

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

function setBilingual(node, en, de, { html = false } = {}) {
  if (!node) return;
  node.setAttribute('data-en', en);
  node.setAttribute('data-de', de);
  if (html) node.innerHTML = getLang() === 'de' ? de : en;
  else node.textContent = getLang() === 'de' ? de : en;
}

setBilingual(introEyebrow, 'For businesses & startups', 'Für Unternehmen & Startups');
setBilingual(introHeading, 'Build your production request.', 'Stellen Sie Ihre Produktionsanfrage zusammen.');
if (introCopy) {
  setBilingual(
    introCopy,
    'Upload your model or part, choose material and colour, and tell us the quantity you need. We review the file and send back pricing for your project, from a single prototype to small-batch production. No payment is taken until you approve the quote.',
    'Laden Sie Ihr Modell oder Bauteil hoch, wähle Material und Farbe und geben Sie die gewünschte Stückzahl an. Wir prüfen die Datei und senden Ihnen ein maßgeschneidertes Angebot.'
  );
  let note = document.querySelector('.business-intro-note');
  if (!note) {
    note = document.createElement('p');
    note.className = 'business-intro-note';
    introCopy.after(note);
  }
  setBilingual(
    note,
    'From a single prototype to production runs of 1,000+. Same files, no retooling.',
    'Vom einzelnen Prototyp bis zu Serien ab 1.000+. Dieselben Dateien, kein Umbau.'
  );
}
if (studentProjects) studentProjects.hidden = true;
const businessContent = document.querySelector('#business-content');
if (businessContent) businessContent.hidden = false;
if (packageOptions) packageOptions.hidden = true;

function setStep(field, number, en, de) {
  const legend = field?.querySelector('legend');
  if (!legend) return;
  legend.innerHTML = `<span>${number}</span> <span data-en="${en}" data-de="${de}">${getLang() === 'de' ? de : en}</span>`;
}

setStep(materialField, '02', 'Material', 'Material');
setStep(colourField, '03', 'Colour', 'Farbe');

if (colourField && !document.querySelector('#quantity-field')) {
  const quantityField = document.createElement('fieldset');
  quantityField.id = 'quantity-field';
  quantityField.className = 'business-quantity';
  quantityField.innerHTML = `
    <legend><span>04</span> <span data-en="Quantity" data-de="Stückzahl">Stückzahl</span></legend>
    <div class="option-grid option-grid-two" id="quantity-options">
      <button class="option-card is-selected" type="button" data-quantity-type="run" aria-pressed="true">
        <span class="option-indicator"></span><span><strong data-en="Production run" data-de="Serienproduktion">Serienproduktion</strong><small data-en="Set the quantity in your result panel." data-de="Stückzahl im Ergebnispanel festlegen.">Stückzahl im Ergebnispanel festlegen.</small></span>
      </button>
      <button class="option-card" type="button" data-quantity-type="prototype" aria-pressed="false">
        <span class="option-indicator"></span><span><strong data-en="Single prototype" data-de="Einzelner Prototyp">Einzelner Prototyp</strong><small data-en="One sample to validate before a batch." data-de="Ein Musterteil zur Prüfung vor der Serienproduktion.">Ein Musterteil zur Prüfung vor der Serienproduktion.</small></span>
      </button>
    </div>
    <label class="business-quantity-input quote-field" id="business-quantity-input" hidden><span data-en="Number of prints needed" data-de="Benötigte Stückzahl">Benötigte Stückzahl</span><input id="business-quantity" type="number" min="1" value="100" inputmode="numeric"></label>
  `;
  colourField.after(quantityField);

  const quantityInput = quantityField.querySelector('#business-quantity');
  const syncQuantityMode = isRun => {
    if (!isRun) {
      quantityInput.min = '1';
      quantityInput.value = '1';
      quantityInput.readOnly = true;
      quantityInput.setCustomValidity('');
      return;
    }
    quantityInput.readOnly = false;
    quantityInput.min = '1';
    if (Number(quantityInput.value) < 1) quantityInput.value = '1';
    quantityInput.setCustomValidity(Number(quantityInput.value) < 1 ? t('Enter at least one print.', 'Mindestens einen Druck angeben.') : '');
  };
  const selectQuantityType = isRun => {
    quantityField.querySelectorAll('.option-card').forEach(option => {
      const selected = isRun
        ? option.dataset.quantityType === 'run'
        : option.dataset.quantityType === 'prototype';
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    });
    syncQuantityMode(isRun);
  };
  syncQuantityMode(true);

  quantityField.querySelectorAll('.option-card').forEach(card => {
    card.addEventListener('click', () => {
      const isRun = card.dataset.quantityType === 'run';
      const wasPrototype = quantityField.querySelector('[data-quantity-type="prototype"]')?.classList.contains('is-selected');
      selectQuantityType(isRun);
      if (isRun && wasPrototype && Number(quantityInput.value) <= 1) quantityInput.value = '100';
      refreshEstimate();
    });
  });

  quantityInput.addEventListener('input', event => {
    const input = event.currentTarget;
    const isRun = quantityField.querySelector('[data-quantity-type="run"]')?.classList.contains('is-selected');
    if (isRun) {
      input.setCustomValidity(!input.value || Number(input.value) < 1 ? t('Enter at least one print.', 'Mindestens einen Druck angeben.') : '');
    } else {
      input.value = '1';
      input.setCustomValidity('');
    }
    refreshEstimate();
  });

  const applySummaryQuantity = nextValue => {
    const qty = Math.max(1, Math.floor(Number(nextValue)) || 1);
    if (qty > 1) selectQuantityType(true);
    quantityInput.value = String(qty);
    quantityInput.setCustomValidity('');
    refreshEstimate();
  };

  const summaryQty = document.querySelector('#summary-quantity');
  const summaryDec = document.querySelector('#summary-qty-dec');
  const summaryInc = document.querySelector('#summary-qty-inc');
  summaryQty?.addEventListener('input', event => {
    const value = event.currentTarget.value;
    if (!value) return;
    applySummaryQuantity(value);
  });
  summaryQty?.addEventListener('change', event => {
    applySummaryQuantity(event.currentTarget.value || 1);
  });
  summaryDec?.addEventListener('click', () => {
    applySummaryQuantity(Math.max(1, (Number(quantityInput.value) || 1) - 1));
  });
  summaryInc?.addEventListener('click', () => {
    const current = Number(quantityInput.value) || 1;
    if (current === 1 && quantityField.querySelector('[data-quantity-type="prototype"]')?.classList.contains('is-selected')) {
      selectQuantityType(true);
      applySummaryQuantity(2);
      return;
    }
    applySummaryQuantity(current + 1);
  });
}

const requestPanel = document.querySelector('#request-options .request-panel');
const speedField = speedOptions?.closest('fieldset') || document.querySelector('#speed-field');
const engineeringField = engineeringOptions?.closest('fieldset') || document.querySelector('#engineering-field');
const contactField = contactOptions?.closest('fieldset') || document.querySelector('#contact-field');
const quantityFieldNode = document.querySelector('#quantity-field');

// Visual order: Quantity → Speed (05) → Engineering (06) → Contact (07)
if (requestPanel && quantityFieldNode && speedField && engineeringField && contactField) {
  requestPanel.prepend(quantityFieldNode);
  quantityFieldNode.after(speedField);
  speedField.after(engineeringField);
  engineeringField.after(contactField);
}

setStep(quantityFieldNode, '04', 'Quantity', 'Stückzahl');
setStep(speedField, '05', 'Production speed', 'Bis wann soll es fertig gedruckt sein?');
if (speedOptions) {
  const badge = speedOptions.querySelector('[data-speed="priority"] .option-badge');
  if (badge) setBilingual(badge, 'Most selected', 'Beliebteste Wahl');
  const speedCopy = {
    standard: ['Standard', 'Standard', '7–10 days', '7–10 Tage', null],
    priority: ['Priority', 'Priorität', '2–3 days', '2–3 Tage', '+€59'],
    express: ['Express', 'Express', '4–6 days', '4–6 Tage', '+€39']
  };
  Object.entries(speedCopy).forEach(([key, [enTitle, deTitle, enTiming, deTiming, price]]) => {
    const card = speedOptions.querySelector(`[data-speed="${key}"]`);
    if (!card) return;
    setBilingual(card.querySelector('strong'), enTitle, deTitle);
    setBilingual(card.querySelector('small'), enTiming, deTiming);
    const priceNode = card.querySelector('b');
    if (priceNode && price) priceNode.textContent = price;
  });
}

setStep(engineeringField, '06', 'Engineering support', 'Konstruktionshilfe');
if (engineeringOptions) {
  const review = engineeringOptions.querySelector('[data-engineering="review"]');
  const editing = engineeringOptions.querySelector('[data-engineering="editing"]');
  if (review) {
    setBilingual(review.querySelector('strong'), 'Get Expert Review', 'Expertenprüfung anfordern');
    review.querySelector('b').textContent = '+€35';
  }
  if (editing) {
    setBilingual(editing.querySelector('strong'), 'File Editing & Optimization', 'Dateibearbeitung und Optimierung');
    const vat = editing.querySelector('small');
    if (vat) setBilingual(vat, 'plus 19% VAT', 'zzgl. 19 % MwSt.');
    editing.querySelector('b').textContent = '€89 / hour';
  }
}

if (engineeringField && !document.querySelector('#file-editing-terms')) {
  const editingTerms = document.createElement('label');
  editingTerms.id = 'file-editing-terms';
  editingTerms.className = 'file-editing-terms';
  editingTerms.hidden = true;
  editingTerms.innerHTML = `<input id="file-editing-acknowledged" type="checkbox"> <span data-en="I understand that File Editing &amp; Optimization includes the first hour at €89. If more time is needed, 3DNow will ask for my approval before any additional charge." data-de="Ich verstehe, dass Dateibearbeitung und Optimierung die erste Stunde für 89 € umfasst. Wenn mehr Zeit nötig ist, holt 3DNow vor Mehrkosten meine Freigabe ein.">${t('I understand that File Editing & Optimization includes the first hour at €89. If more time is needed, 3DNow will ask for my approval before any additional charge.', 'Ich verstehe, dass Dateibearbeitung und Optimierung die erste Stunde für 89 € umfasst. Wenn mehr Zeit nötig ist, holt 3DNow vor Mehrkosten meine Freigabe ein.')}</span>`;
  engineeringField.append(editingTerms);
  editingTerms.querySelector('input').addEventListener('change', refreshEstimate);
}

if (verificationOptions) verificationOptions.closest('fieldset').hidden = true;
setStep(contactField, '07', 'Contact details', 'Kontaktdaten');
const contactUpdatesNote = document.querySelector('#contact-updates-note');
if (contactUpdatesNote) {
  setBilingual(
    contactUpdatesNote,
    "We'll send your order updates here, so please make sure it's correct and up to date.",
    'Wir senden Ihre Bestellinfos hierhin – bitte stellen Sie sicher, dass die Angabe korrekt und aktuell ist.'
  );
}

const packageRow = document.querySelector('#summary-package')?.closest('div');
const packageLabel = packageRow?.querySelector('dt');
if (packageLabel) setBilingual(packageLabel, 'Quantity', 'Stückzahl');

document.querySelectorAll('#summary-checkout, #mobile-checkout-button, #submit-request').forEach(button => {
  setBilingual(button, 'Request a quote', 'Angebot anfragen');
});
const summaryHint = document.querySelector('#summary-hint');
if (summaryHint) {
  setBilingual(summaryHint, 'Add your email or phone number to continue.', 'Füge deine E-Mail oder Telefonnummer hinzu, um fortzufahren.');
}

function applyBusinessLabels() {
  setStep(quantityFieldNode, '04', 'Quantity', 'Stückzahl');
  setStep(speedField, '05', 'Production speed', 'Bis wann soll es fertig gedruckt sein?');
  setStep(engineeringField, '06', 'Engineering support', 'Konstruktionshilfe');
  setStep(contactField, '07', 'Contact details', 'Kontaktdaten');
  const badge = speedOptions?.querySelector('[data-speed="priority"] .option-badge');
  if (badge) setBilingual(badge, 'Most selected', 'Beliebteste Wahl');
  const priorityTitle = speedOptions?.querySelector('[data-speed="priority"] strong');
  if (priorityTitle) setBilingual(priorityTitle, 'Priority', 'Priorität');
  document.querySelectorAll('#summary-checkout, #mobile-checkout-button, #submit-request').forEach(button => {
    setBilingual(button, 'Request a quote', 'Angebot anfragen');
  });
  if (summaryHint) {
    setBilingual(summaryHint, 'Add your email or phone number to continue.', 'Füge deine E-Mail oder Telefonnummer hinzu, um fortzufahren.');
  }
}

applyLangAttributes(getLang());
applyBusinessLabels();
window.addEventListener('3dnow:lang', () => {
  document.title = t('3DNow Business 3D Print Quote Engine', '3DNow Business 3D-Druck Angebot');
  applyBusinessLabels();
});

function selectedValue(selector, attribute, fallback = null) {
  return document.querySelector(`${selector} .option-card.is-selected`)?.dataset[attribute] || fallback;
}

function renderEstimate() {
  const quote = state.quote;
  const quantity = Number(document.querySelector('#business-quantity')?.value) || 1;
  const status = document.querySelector('#request-status');
  const prototype = quantity === 1;
  const cta = t('Request a quote', 'Angebot anfragen');
  document.querySelectorAll('#summary-checkout, #mobile-checkout-button, #submit-request').forEach(button => {
    button.setAttribute('data-en', 'Request a quote');
    button.setAttribute('data-de', 'Angebot anfragen');
    button.textContent = cta;
  });
  if (!quote) return;

  const productionTotal = Number(
    quote.productionTotal
      ?? (quote.netTotal ?? quote.total) - (quote.speedCost || 0) - (quote.reviewCost || 0) - (quote.editingCost || 0)
  );
  const speed = selectedValue('#speed-options', 'speed', 'standard');
  const engineering = selectedValue('#engineering-options', 'engineering');
  const speedCost = speed === 'priority' ? 59 : speed === 'express' ? 39 : 0;
  const reviewCost = engineering === 'review' ? 35 : 0;
  const editingCost = engineering === 'editing' ? 89 : 0;
  const netTotal = Number((productionTotal + speedCost + reviewCost + editingCost).toFixed(2));
  const vatAmount = Number((netTotal * (quote.vatRate ?? 0.19)).toFixed(2));
  const total = Number((netTotal + vatAmount).toFixed(2));
  const unitPrice = Number((total / Math.max(1, quantity)).toFixed(2));

  document.querySelector('#summary-total').textContent = `€${total.toFixed(2)}`;
  document.querySelector('#mobile-total').textContent = `€${total.toFixed(2)}`;
  document.querySelector('#summary-subtitle').textContent = t('Total due', 'Gesamtsumme');
  document.querySelector('#summary-package').textContent = prototype ? '1 prototype' : `${quantity} pieces`;
  const priceNote = document.querySelector('#summary-price-note');
  if (priceNote) {
    priceNote.hidden = true;
    priceNote.textContent = '';
  }
  const card = document.querySelector('#summary-qty-card');
  if (card) {
    card.hidden = false;
    const unitEl = document.querySelector('#summary-unit-price');
    const totalEl = document.querySelector('#summary-qty-total');
    const labelEl = document.querySelector('#summary-qty-total-label');
    const noteEl = document.querySelector('#summary-qty-note');
    const summaryQty = document.querySelector('#summary-quantity');
    if (unitEl) unitEl.textContent = `€${unitPrice.toFixed(2)}`;
    if (totalEl) totalEl.textContent = `€${total.toFixed(2)}`;
    if (labelEl) {
      labelEl.textContent = quantity === 1
        ? t('Total for 1 piece', 'Summe für 1 Stück')
        : t(`Total for ${quantity} pieces`, `Summe für ${quantity} Stück`);
    }
    if (noteEl) {
      noteEl.textContent = editingCost
        ? t(
          'Incl. 19% VAT · free shipping. First hour of file editing included; more time needs your approval.',
          'Inkl. 19% MwSt. · kostenloser Versand. Erste Stunde Dateibearbeitung inklusive; mehr Zeit braucht deine Freigabe.'
        )
        : t('Incl. 19% VAT · free shipping', 'Inkl. 19% MwSt. · kostenloser Versand');
    }
    if (summaryQty && document.activeElement !== summaryQty) summaryQty.value = String(quantity);
    if (summaryQty) {
      summaryQty.readOnly = false;
      summaryQty.disabled = false;
    }
    const dec = document.querySelector('#summary-qty-dec');
    const inc = document.querySelector('#summary-qty-inc');
    if (dec) dec.disabled = quantity <= 1;
    if (inc) inc.disabled = false;
  }
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
    const ref = String(state.job.jobId || '').toUpperCase();
    status.textContent = ref
      ? `Your production quote request ${ref} has been received. We will contact you with the final quote.`
      : 'Your production quote request has been received. We will contact you with the final quote.';
    window.showQuoteSuccessToast?.(ref
      ? `Thanks, we've received your request (${ref}). We will get back to you with the next steps.`
      : "Thanks, we've received your request. We will get back to you with the next steps.");
    document.querySelectorAll('#summary-checkout, #mobile-checkout-button').forEach(element => {
      element.disabled = true;
    });
  } catch (error) {
    status.textContent = error.message || 'Could not send your production quote request.';
    button.disabled = false;
  }
}, true);
