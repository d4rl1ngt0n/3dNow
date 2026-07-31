import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { createCheckoutSession, createJob, getJob, recordMaterialChoice } from './api.js';
import { state } from './state.js';
import { analyzeGeometry } from './analyzer.js';
import { Preview, setPreviewColor, createFilamentMaterial, preparePrintPreview } from './preview.js';
import { buildSolidToolpathMesh } from './toolpath-mesh.js';
import './styles.css';

const TERMINAL_JOB = new Set(['ready', 'manual-review', 'error']);
const ACTIVE_SLICE = new Set(['queued', 'analyzing', 'slicing']);

const embedMode = new URLSearchParams(window.location.search).has('embed')
  || (window.self !== window.top);
if (embedMode) {
  document.documentElement.classList.add('embed-mode');
  document.body?.classList.add('embed-mode');
  window.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('embed-mode');
  });
}

if (window.location.pathname === '/quote-engine-business') {
  void import('./business.js');
}
if (window.location.pathname === '/quote-engine-private') {
  void import('./private.js');
}

const $ = selector => document.querySelector(selector);
const colors = [['Black','#141417'],['White','#FFFFFF'],['Red','#D7263D'],['Orange','#F26419'],['Green','#2E933C'],['Pink','#E86A92'],['Bio beige','#CDBA94'],['Neon green','#B6F400'],['Neon yellow','#EEFF00'],['Blue','#1F6FEB']];
const request = { engineering: null, speed: 'standard', verification: null, contact: 'email' };
const businessFlow = window.location.pathname === '/quote-engine-business';
const privateFlow = window.location.pathname === '/quote-engine-private';
const studentFlow = !businessFlow && !privateFlow;

// Hide student-only UI immediately (do not wait for async private/business modules).
if (!studentFlow) {
  const verificationField = $('#verification-options')?.closest('fieldset');
  if (verificationField) verificationField.hidden = true;
  document.querySelectorAll('#summary-checkout, #mobile-checkout-button').forEach(button => {
    button.textContent = businessFlow ? 'Request production quote' : 'Request quote';
  });
}
state.preview = new Preview($('#preview'));

function sliceMaterialFor(material) {
  return material === 'Not sure' ? 'PLA' : material;
}

function displayMaterial() {
  return state.material;
}

function displayColor() {
  const custom = state.customColor.trim();
  if (custom) return custom;
  return colors.find(([, value]) => value === state.color)?.[0] || 'White';
}

function updateMaterialChips(selected = state.material) {
  document.querySelectorAll('.material-chip').forEach(button => {
    const active = button.dataset.material === selected;
    button.classList.toggle('is-selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateBasicDisclaimer() {
  const disclaimer = $('#basic-disclaimer');
  if (!disclaimer) return;
  const show = studentFlow && state.packageSelection === 'Basic' && Boolean(state.file);
  disclaimer.hidden = !show;
  if (!show) {
    state.basicDisclaimerAcknowledged = false;
    const checkbox = $('#basic-disclaimer-ack');
    if (checkbox) checkbox.checked = false;
  }
  renderOrderSummary();
}

function renderStudentIdPreview(file) {
  const preview = $('#student-id-preview');
  const thumb = $('#student-id-thumb');
  if (!preview || !thumb) return;
  if (!file) {
    preview.hidden = true;
    thumb.replaceChildren();
    return;
  }
  preview.hidden = false;
  $('#student-id-name').textContent = file.name;
  $('#student-id-size').textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  thumb.replaceChildren();
  if (/\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = URL.createObjectURL(file);
    image.onload = () => URL.revokeObjectURL(image.src);
    thumb.append(image);
  } else {
    thumb.textContent = 'PDF';
  }
}

function renderUploadPreview(file) {
  const preview = $('#upload-preview');
  const thumb = $('#upload-preview-thumb');
  const name = $('#upload-preview-name');
  const size = $('#upload-preview-size');
  if (!preview || !file) {
    preview?.setAttribute('hidden', '');
    $('#file-info')?.removeAttribute('hidden');
    return;
  }
  const extension = file.name.split('.').pop()?.toUpperCase() || 'FILE';
  preview.hidden = false;
  $('#file-info')?.setAttribute('hidden', '');
  name.textContent = file.name;
  size.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  thumb.replaceChildren();
  if (/\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = URL.createObjectURL(file);
    image.onload = () => URL.revokeObjectURL(image.src);
    thumb.append(image);
  } else {
    thumb.textContent = extension.slice(0, 4);
  }
}

function setPreviewProgress(percent, label = 'Building preview…') {
  const loading = $('#preview-loading');
  if (!loading) return;
  loading.hidden = false;
  $('#preview-loading-label').textContent = label;
  $('#preview-loading-percent').textContent = `${Math.round(percent)}%`;
  $('#preview-loading-fill').style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

function clearPreviewProgress() {
  const loading = $('#preview-loading');
  if (!loading) return;
  loading.hidden = true;
  $('#preview-loading-fill').style.width = '0%';
  $('#preview-loading-percent').textContent = '0%';
  state.sliceProgressDisplay = 0;
}

function placeMeshOnBed(printer) {
  if (printer) state.preview.setBuildPlate(printer);
  state.previewOnBed = true;
  state.preview.setBedVisible(true);
  if (state.modalPreview) {
    if (printer) state.modalPreview.setBuildPlate(printer);
    state.modalPreview.setBedVisible(true);
  }
}

function isEligibleStudentEmail(email) {
  const match = String(email || '').trim().toLowerCase().match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/);
  if (!match) return false;
  const domain = match[1];
  const consumer = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.de', 'hotmail.com', 'hotmail.de',
    'outlook.com', 'outlook.de', 'live.com', 'live.de', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
    'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch',
    'web.de', 't-online.de', 'mail.com', 'mail.de', 'email.de', 'freenet.de', 'online.de', 'arcor.de',
    'posteo.de', 'mailbox.org', 'yandex.com', 'yandex.ru', 'zoho.com', 'fastmail.com'
  ]);
  if (consumer.has(domain)) return false;
  if (domain.endsWith('.edu') || domain.includes('.edu.')) return true;
  if (/\.ac\.[a-z]{2,}$/.test(domain)) return true;
  if (/(university|universit|college|school|schule|academy|hochschule|studium|student|(^|[.-])(uni|fh|th|htw|hfu|hsa|hsb)([.-]|$))/i.test(domain)) {
    return true;
  }
  const tld = domain.split('.').pop();
  return tld === 'de' || tld === 'at' || tld === 'ch';
}

function updateSwatchSelection(selected) {
  document.querySelectorAll('.swatch').forEach(button => {
    button.classList.toggle('is-selected', button.dataset.color === selected);
    button.setAttribute('aria-pressed', button.dataset.color === selected ? 'true' : 'false');
  });
}

function chooseColor(value) {
  state.color = value;
  updateSwatchSelection(value);
  setPreviewColor(state.preview, value);
  setPreviewColor(state.modalPreview, value);
}

for (const [name, value] of colors) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'swatch';
  button.title = name;
  button.dataset.color = value;
  button.style.background = value;
  button.setAttribute('aria-label', name);
  button.setAttribute('aria-pressed', 'false');
  button.onclick = () => chooseColor(value);
  $('#colors').append(button);
}

chooseColor(state.color);
updateMaterialChips();

$('#custom-color')?.addEventListener('input', event => {
  state.customColor = event.target.value;
  renderOrderSummary();
});

document.querySelectorAll('.material-chip').forEach(button => {
  button.addEventListener('click', () => {
    void setMaterial(button.dataset.material);
  });
});

$('#basic-disclaimer-ack')?.addEventListener('change', event => {
  state.basicDisclaimerAcknowledged = event.target.checked;
  renderOrderSummary();
});

if (studentFlow) {
  const engineeringField = $('#engineering-field');
  if (engineeringField && !$('#student-file-editing-terms')) {
    const editingTerms = document.createElement('label');
    editingTerms.id = 'student-file-editing-terms';
    editingTerms.className = 'file-editing-terms';
    editingTerms.hidden = true;
    editingTerms.innerHTML = '<input id="student-file-editing-acknowledged" type="checkbox"> <span>File Editing &amp; Optimization is charged at €90 for the first hour. If we need more than one hour, we will ask for your approval before any extra charge. The final price may increase if more time is approved.</span>';
    engineeringField.append(editingTerms);
    editingTerms.querySelector('input').addEventListener('change', renderOrderSummary);
  }
}

function updateStudentEditingTerms() {
  const terms = $('#student-file-editing-terms');
  if (!terms) return;
  terms.hidden = !(studentFlow && request.engineering === 'editing');
  if (terms.hidden) {
    const checkbox = $('#student-file-editing-acknowledged');
    if (checkbox) checkbox.checked = false;
  }
}

async function setMaterial(wanted) {
  if (!wanted || wanted === state.material) return;
  state.material = wanted;
  updateMaterialChips(wanted);
  renderOrderSummary();
  if (!state.job) return;
  try {
    await recordMaterialChoice(state.job.jobId, wanted);
    status(`Material preference saved as ${wanted}. It will be included in the admin notification.`, 'ready');
  } catch (error) {
    status(error.message || 'Could not save material preference.', 'error');
  }
}

const fmt = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : 'Not available';
const time = seconds => {
  if (!Number.isFinite(seconds)) return 'Not available';
  const h = Math.floor(seconds / 3600);
  const m = Math.round(seconds % 3600 / 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
};

function status(message, type = '') {
  const node = $('#status');
  node.textContent = message;
  node.className = type;
}

function customerReviewMessage(warning) {
  if (/printer could not be determined from sliced g-code metadata/i.test(warning || '')) {
    return 'We are confirming production details before issuing your quote.';
  }
  if (/server slicer is unavailable/i.test(warning || '')) {
    return 'Automatic slicing is temporarily unavailable. Upload a sliced G-code or a 3MF with embedded G-code for an instant quote, or we will review your file manually.';
  }
  return warning || 'We are reviewing your file before issuing a quote.';
}

const packagePrices = { Basic: 39, Medium: 69, Large: 89 };
const packageRank = { Basic: 0, Medium: 1, Large: 2 };

function updatePackageSelection(packageName) {
  const section = $('#package-options');
  if (packageName) {
    state.minimumPackage = packageName;
    if (!state.packageManuallySelected || packageRank[state.packageSelection] < packageRank[packageName]) {
      state.packageSelection = packageName;
    }
  }
  const minimumPackage = state.minimumPackage;
  const selectedPackage = state.packageSelection;
  document.querySelectorAll('.package-card').forEach(card => {
    const selected = card.dataset.package === selectedPackage;
    const unavailable = minimumPackage && packageRank[card.dataset.package] < packageRank[minimumPackage];
    card.classList.toggle('is-selected', selected);
    card.setAttribute('aria-current', selected ? 'true' : 'false');
    card.setAttribute('aria-pressed', String(selected));
    card.disabled = unavailable;
  });
  const reviewCard = $('#engineering-options [data-engineering="review"]');
  const expertReviewIncluded = packageRank[state.packageSelection] >= packageRank.Medium;
  if (reviewCard) {
    reviewCard.querySelector('b').textContent = expertReviewIncluded ? 'Included' : '+€15';
    reviewCard.classList.toggle('is-included', expertReviewIncluded);
  }
  $('#package-note').textContent = minimumPackage
    ? `Your ${minimumPackage} package was selected from the verified file weight. You can upgrade to any higher package, which includes Expert Review.`
    : state.file
      ? 'Verifying your file weight to select the minimum eligible package.'
      : 'Select a package to explore prices. Your minimum package will be set automatically from the verified file weight.';
  section.dataset.locked = String(Boolean(minimumPackage));
  updateBasicDisclaimer();
}

function drawMetrics(metrics, quote) {
  const rows = [
    ['Size', metrics.bboxMm ? `${fmt(metrics.bboxMm.x)} × ${fmt(metrics.bboxMm.y)} × ${fmt(metrics.bboxMm.z)} mm` : null],
    ['Filament', metrics.weightG != null ? `${fmt(metrics.weightG, 2)} g` : null],
    ['Print time', metrics.printTimeSec != null ? time(metrics.printTimeSec) : null],
    ['Filament length', metrics.filamentLengthMm != null ? `${fmt(metrics.filamentLengthMm, 0)} mm` : null],
    ['Material', metrics.gcodeMetadata?.filamentType || displayMaterial()],
    ['Printer', metrics.printer?.name]
  ].filter(([, value]) => value != null);

  $('#metrics').innerHTML = rows.map(([label, value]) => `<div class="metric-card"><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  if (privateFlow) {
    $('#metric-note').textContent = metrics.confidence === 'header' || metrics.source === 'slicer' || metrics.source === 'gcode' || metrics.source === '3mf-gcode'
      ? 'Production details from your sliced file. Final pricing is confirmed after review.'
      : 'Unsliced files are reviewed manually. A sliced G-code or 3MF gives clearer production details.';
  } else if (businessFlow) {
    $('#metric-note').textContent = quote
      ? 'Production estimate is based on verified print time, printer rate, and your requested quantity.'
      : 'Business estimates need a sliced G-code or a 3MF with embedded G-code (verified print time and printer).';
  } else if (metrics.confidence === 'header' || metrics.source === 'slicer' || metrics.source === 'gcode' || metrics.source === '3mf-gcode') {
    $('#metric-note').textContent = 'Sliced metadata is verified for an automatic student quote.';
  } else if (metrics.confidence === 'partial') {
    $('#metric-note').textContent = 'Partial sliced metadata was found. Review weight and print time before quoting.';
  } else {
    $('#metric-note').textContent = 'Geometry analysis is informational. Exact pricing requires verified sliced metadata.';
  }
  if (studentFlow) updatePackageSelection(quote?.package?.name);
  $('#results').hidden = false;
  $('#request-options').hidden = false;
  $('#mobile-checkout').hidden = false;
  renderOrderSummary();
}

document.querySelectorAll('.package-card').forEach(card => {
  card.addEventListener('click', () => {
    if (state.minimumPackage && packageRank[card.dataset.package] < packageRank[state.minimumPackage]) return;
    state.packageSelection = card.dataset.package;
    state.packageManuallySelected = Boolean(state.minimumPackage);
    updatePackageSelection();
    renderOrderSummary();
  });
});
updatePackageSelection();

function selectRequestOption(container, selected, key) {
  request[key] = selected.dataset[key];
  container.querySelectorAll('.option-card').forEach(card => {
    const isSelected = card === selected;
    card.classList.toggle('is-selected', isSelected);
    card.setAttribute('aria-pressed', String(isSelected));
  });
  renderOrderSummary();
}

function euro(value) {
  return `€${value.toFixed(2)}`;
}

function requestValues() {
  return {
    universityEmail: $('#university-email').value.trim(),
    studentId: $('#student-id').files[0],
    contactEmail: $('#contact-email').value.trim(),
    contactPhone: $('#contact-phone').value.trim()
  };
}

function missingRequirements(values = requestValues()) {
  const missing = [];
  if (!state.job) missing.push('Upload your file');
  if (businessFlow) {
    if (!state.quote) {
      missing.push(
        state.job && !state.metrics?.printTimeSec
          ? 'Upload a sliced G-code or 3MF for a production estimate'
          : 'Wait for the production estimate'
      );
    }
    if (request.contact === 'email' && !values.contactEmail) missing.push('Add your email address');
    if (request.contact === 'phone' && !values.contactPhone) missing.push('Add your phone number');
    if (request.engineering === 'editing' && !$('#file-editing-acknowledged')?.checked) {
      missing.push('Confirm the file editing terms');
    }
    return missing;
  }
  if (privateFlow) {
    const quantity = Number($('#private-quantity')?.value || 0);
    if (request.contact === 'email' && !values.contactEmail) missing.push('Add your email address');
    if (request.contact === 'phone' && !values.contactPhone) missing.push('Add your phone number');
    if (!Number.isInteger(quantity) || quantity < 1) missing.push('Enter the number of prints you need');
    if (request.engineering !== 'review' && !state.privateDisclaimerAcknowledged) {
      missing.push('Confirm the no Expert Review notice');
    }
    return missing;
  }
  if (!state.quote) missing.push('Wait for your verified package quote');
  if (state.packageSelection === 'Basic' && !state.basicDisclaimerAcknowledged) {
    missing.push('Confirm the Basic package notice');
  }
  if (request.engineering === 'editing' && !$('#student-file-editing-acknowledged')?.checked) {
    missing.push('Confirm the file editing terms');
  }
  if (!request.verification) missing.push('Choose a student verification method');
  else if (request.verification === 'email' && !values.universityEmail) missing.push('Enter your university email');
  else if (request.verification === 'email' && !isEligibleStudentEmail(values.universityEmail)) {
    missing.push('Enter a valid university or school email (.edu / .de). Personal inboxes like Gmail are not accepted');
  } else if (request.verification === 'id' && !values.studentId) {
    missing.push('Upload your student ID');
  }
  if (request.contact === 'email' && !values.contactEmail) missing.push('Add your email address');
  if (request.contact === 'phone' && !values.contactPhone) missing.push('Add your phone number');
  return missing;
}

function requestIsReady(values = requestValues()) {
  return missingRequirements(values).length === 0;
}

function summaryHintText(values = requestValues()) {
  const missing = missingRequirements(values);
  if (!missing.length) {
    if (businessFlow) return 'Ready to send your production quote request.';
    if (privateFlow) return 'Ready to send your quote request.';
    return 'Ready for secure payment.';
  }
  return missing.join(' · ');
}

function showSuccessToast(message = "Thanks, we've received your request. We will get back to you with the next steps.") {
  const toast = $('#success-toast');
  if (!toast) return;
  $('#success-toast-message').textContent = message;
  toast.hidden = false;
  clearTimeout(showSuccessToast.timer);
  showSuccessToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

function updateStudentEmailVerification(universityEmail) {
  const status = $('#student-email-verification');
  const selected = request.verification === 'email';
  const hasEmail = Boolean(universityEmail);
  const verified = selected && isEligibleStudentEmail(universityEmail);

  status.hidden = !selected || !hasEmail;
  status.classList.toggle('is-invalid', selected && hasEmail && !verified);
  status.textContent = verified
    ? 'Student email verified. You can proceed to payment.'
    : 'Personal email providers are not accepted. Use your university or school address (.edu, .de, .ac.uk, …).';
}

function updatePrivateDisclaimer() {
  const disclaimer = $('#private-disclaimer');
  if (!disclaimer) return;
  const show = privateFlow && Boolean(state.file) && request.engineering !== 'review';
  disclaimer.hidden = !show;
  if (!show) {
    state.privateDisclaimerAcknowledged = false;
    const checkbox = $('#private-disclaimer-ack');
    if (checkbox) checkbox.checked = false;
  }
}

function renderOrderSummary() {
  const quote = state.quote;
  const values = requestValues();
  const ready = requestIsReady(values);
  updatePrivateDisclaimer();
  if (businessFlow) {
    const quantity = quote?.quantity || Number($('#business-quantity')?.value) || 1;
    const engineering = request.engineering === 'review' ? 'Expert Review · +€15' : request.engineering === 'editing' ? 'Editing · €110/hour' : 'Not selected';
    $('#summary-total').textContent = quote ? euro(quote.total) : 'Pending';
    $('#mobile-total').textContent = quote ? euro(quote.total) : 'Pending';
    $('#summary-subtitle').textContent = quote ? `Production estimate for ${quantity} pieces` : 'Upload a file to calculate your production estimate.';
    $('#summary-file').textContent = state.file?.name || 'Not uploaded';
    $('#summary-weight').textContent = state.metrics?.weightG != null ? `${state.metrics.weightG.toFixed(0)} g` : 'Pending';
    $('#summary-package').textContent = `${quantity} pieces`;
    $('#summary-material').textContent = displayMaterial();
    $('#summary-speed').textContent = request.speed === 'priority' ? 'Priority · 2-3 days' : request.speed === 'express' ? 'Express · 4-6 days' : 'Standard · 7-10 days';
    $('#summary-engineering').textContent = engineering;
    document.querySelectorAll('#summary-checkout, #mobile-checkout-button').forEach(button => {
      button.textContent = 'Request production quote';
    });
    $('#summary-checkout').disabled = !ready;
    $('#mobile-checkout-button').disabled = !ready;
    $('#summary-hint').textContent = summaryHintText(values);
    return;
  }
  if (privateFlow) {
    const quantity = Number($('#private-quantity')?.value) || 1;
    const engineering = request.engineering === 'review' ? 'Expert Review · +€35' : request.engineering === 'editing' ? 'Editing · €90/hour' : 'Not selected';
    $('#summary-total').textContent = 'Quote after review';
    $('#mobile-total').textContent = 'Quote request';
    $('#summary-subtitle').textContent = state.file
      ? 'We will review your file and email you a price. No payment here.'
      : 'Upload a file to request your quote.';
    $('#summary-file').textContent = state.file?.name || 'Not uploaded';
    $('#summary-weight').textContent = state.metrics?.weightG != null ? `${state.metrics.weightG.toFixed(0)} g` : 'Pending';
    $('#summary-package').textContent = `${quantity} pieces`;
    $('#summary-material').textContent = displayMaterial();
    $('#summary-speed').textContent = request.speed === 'priority' ? 'Priority · 2-3 days' : request.speed === 'express' ? 'Express · 4-6 days' : 'Standard · 7-10 days';
    $('#summary-engineering').textContent = engineering;
    document.querySelectorAll('#summary-checkout, #mobile-checkout-button').forEach(button => {
      button.textContent = 'Request quote';
    });
    $('#summary-checkout').disabled = !ready;
    $('#mobile-checkout-button').disabled = !ready;
    $('#summary-hint').textContent = summaryHintText(values);
    return;
  }
  const base = packagePrices[state.packageSelection] ?? quote?.total ?? 39;
  const speedCost = request.speed === 'priority' ? 39 : request.speed === 'express' ? 19 : 0;
  const expertReviewIncluded = packageRank[state.packageSelection] >= packageRank.Medium;
  const reviewCost = request.engineering === 'review' && !expertReviewIncluded ? 15 : 0;
  const editingSelected = request.engineering === 'editing';
  const editingCost = editingSelected && studentFlow ? 90 : 0;
  const total = base + speedCost + reviewCost + editingCost;
  const speed = privateFlow
    ? (request.speed === 'priority' ? 'Priority · 2-3 days' : request.speed === 'express' ? 'Express · 4-6 days' : 'Standard · 7-10 days')
    : (request.speed === 'priority' ? 'Priority · 1-2 days' : request.speed === 'express' ? 'Express · 3-5 days' : 'Standard · 8-10 days');
  const engineering = privateFlow
    ? (request.engineering === 'review' ? 'Expert Review · +€35' : editingSelected ? 'Editing · €90/hour' : 'Not selected')
    : (editingSelected ? 'Editing · €90 first hour' : expertReviewIncluded ? 'Expert Review included' : request.engineering === 'review' ? 'Expert Review · +€15' : 'Not selected');

  updateStudentEmailVerification(values.universityEmail);
  updateStudentEditingTerms();
  $('#summary-total').textContent = privateFlow ? 'Quote after review' : euro(total);
  $('#mobile-total').textContent = privateFlow ? 'Quote request' : euro(total);
  $('#summary-subtitle').textContent = privateFlow
    ? (state.file ? 'We will review your file and send a price before payment.' : 'Upload a file to request your quote.')
    : (quote
      ? `Package: ${state.packageSelection} · est. ${quote.weightG.toFixed(0)} g`
      : 'Your final package is verified from the uploaded file weight.');
  $('#summary-file').textContent = state.file?.name || 'Not uploaded';
  $('#summary-weight').textContent = quote?.weightG != null ? `${quote.weightG.toFixed(0)} g` : (state.metrics?.weightG != null ? `${state.metrics.weightG.toFixed(0)} g` : 'Pending');
  $('#summary-package').textContent = privateFlow ? `${Number($('#private-quantity')?.value) || 1} pieces` : state.packageSelection;
  $('#summary-material').textContent = displayMaterial();
  $('#summary-speed').textContent = speed;
  $('#summary-engineering').textContent = engineering;
  $('#summary-checkout').disabled = !ready;
  $('#mobile-checkout-button').disabled = !ready;
  $('#summary-hint').textContent = summaryHintText(values);
}

$('#engineering-options').addEventListener('click', event => {
  if (event.target.closest('.option-desc')) return;
  const card = event.target.closest('.option-card');
  if (!card) return;
  if (card.classList.contains('is-selected')) {
    card.classList.remove('is-selected');
    card.setAttribute('aria-pressed', 'false');
    request.engineering = null;
    updateStudentEditingTerms();
    renderOrderSummary();
    return;
  }
  selectRequestOption($('#engineering-options'), card, 'engineering');
  updateStudentEditingTerms();
});
$('#private-disclaimer-ack')?.addEventListener('change', event => {
  state.privateDisclaimerAcknowledged = event.target.checked;
  renderOrderSummary();
});
$('#speed-options').addEventListener('click', event => {
  const card = event.target.closest('.option-card');
  if (card) selectRequestOption($('#speed-options'), card, 'speed');
});
$('#verification-options').addEventListener('click', event => {
  const card = event.target.closest('.option-card');
  if (!card) return;
  selectRequestOption($('#verification-options'), card, 'verification');
  $('#university-email-field').hidden = request.verification !== 'email';
  $('#student-id-field').hidden = request.verification !== 'id';
  renderOrderSummary();
});
$('#contact-options').addEventListener('click', event => {
  const card = event.target.closest('.option-card');
  if (!card) return;
  selectRequestOption($('#contact-options'), card, 'contact');
  $('#contact-email-field').hidden = request.contact !== 'email';
  $('#contact-phone-field').hidden = request.contact !== 'phone';
  renderOrderSummary();
});
['university-email', 'student-id', 'contact-email', 'contact-phone'].forEach(id => {
  const field = $(`#${id}`);
  field.addEventListener('input', renderOrderSummary);
  field.addEventListener('change', event => {
    if (id === 'student-id') renderStudentIdPreview(event.target.files[0]);
    renderOrderSummary();
  });
});

async function startCheckout() {
  if (!studentFlow || !state.job) return;
  const { universityEmail, studentId, contactEmail, contactPhone } = requestValues();
  const requestStatus = $('#request-status');
  const missing = missingRequirements();
  if (missing.length) {
    requestStatus.textContent = missing[0];
    return;
  }
  $('#summary-checkout').disabled = true;
  $('#mobile-checkout-button').disabled = true;
  requestStatus.textContent = 'Opening secure checkout…';
  try {
    const session = await createCheckoutSession(state.job.jobId, {
      engineering: request.engineering,
      speed: request.speed,
      packageName: state.packageSelection,
      verificationMethod: request.verification,
      universityEmail,
      contactMethod: request.contact,
      contactEmail,
      contactPhone
    }, studentId);
    window.location.assign(session.url);
  } catch (error) {
    requestStatus.textContent = error.message || 'Could not start checkout.';
  } finally {
    renderOrderSummary();
  }
}

window.showQuoteSuccessToast = showSuccessToast;
window.addEventListener('quote-engine:refresh-summary', renderOrderSummary);

if (studentFlow) {
  $('#submit-request').addEventListener('click', startCheckout);
  $('#summary-checkout').addEventListener('click', startCheckout);
  $('#mobile-checkout-button').addEventListener('click', startCheckout);
}

function display(job, { revealQuote = true } = {}) {
  state.job = job;
  state.metrics = job.metrics;
  state.quote = revealQuote ? job.quote : null;
  if (job.metrics?.printer) state.preview.setBuildPlate(job.metrics.printer);
  if (revealQuote) drawMetrics(job.metrics, job.quote);
  $('#dialog-details').textContent = `${state.file?.name || job.filename} · ${job.metrics.printer?.name || 'Printer pending'} · ${businessFlow ? (revealQuote && job.quote?.totalFormatted) || 'Estimate pending' : (revealQuote && job.quote?.package?.name) || 'Manual review'}`;
  window.dispatchEvent(new CustomEvent('quote-engine:job-updated', { detail: job }));
}

async function poll(id) {
  clearInterval(state.poll);
  const tick = async () => {
    try {
      const job = await getJob(id);
      const waiting = ACTIVE_SLICE.has(job.status) && !TERMINAL_JOB.has(job.status);

      if (waiting) {
        display(job, { revealQuote: false });
        status(
          job.status === 'analyzing' ? 'Reading sliced metadata…' : 'Processing…',
          job.status
        );
        return;
      }

      display(job, { revealQuote: true });

      if (TERMINAL_JOB.has(job.status)) {
        clearPreviewProgress();
        if (job.status === 'ready' || job.metrics?.printer) placeMeshOnBed(job.metrics?.printer);
        state.awaitingSlice = false;
        status(
          job.status === 'ready' ? 'Quote ready.'
            : job.status === 'manual-review' ? customerReviewMessage(job.warnings[0])
              : (job.error || 'Processing error'),
          job.status
        );
        clearInterval(state.poll);
        return;
      }

      status(job.error || 'Processing…', job.status);
    } catch {
      clearPreviewProgress();
      status('Server unavailable.', 'error');
      clearInterval(state.poll);
    }
  };
  await tick();
  state.poll = setInterval(tick, 750);
}

function toolpathObject(result, { align = true, onProgress } = {}) {
  const voxels = unpackToolpathResult(result);
  if (!voxels?.length) return null;
  const mesh = buildSolidToolpathMesh(voxels, createFilamentMaterial(state.color), {
    voxelSize: result?.voxelSize || 2.4,
    onProgress
  });
  if (!mesh) return null;
  return align ? preparePrintPreview(mesh) : mesh;
}

function unpackToolpathResult(result) {
  const packed = result?.segments ?? result;
  if (!packed?.length) return [];
  if (Array.isArray(packed)) {
    if (Array.isArray(packed[0]) && packed[0].length >= 6) {
      return packed.map(segment => [
        (segment[0] + segment[3]) / 2,
        (segment[1] + segment[4]) / 2,
        (segment[2] + segment[5]) / 2
      ]);
    }
    return packed;
  }
  const voxels = [];
  for (let offset = 0; offset < packed.length; offset += 3) {
    voxels.push([packed[offset], packed[offset + 1], packed[offset + 2]]);
  }
  return voxels;
}

function parseToolpath(source, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gcode-worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('G-code preview timed out. Try again, or use a smaller sliced file.'));
    }, 45000);
    worker.onmessage = event => {
      if (event.data?.type === 'progress') {
        onProgress?.(event.data.value, 'Reading toolpath…');
        return;
      }
      clearTimeout(timer);
      worker.terminate();
      if (!event.data?.segments?.length) {
        reject(new Error('This G-code has no positive extrusion moves to preview.'));
        return;
      }
      resolve(event.data);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error('Could not read G-code toolpath'));
    };

    try {
      if (source instanceof Uint8Array) {
        const copy = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
        worker.postMessage({ bytes: copy, maxVoxels: 70000 }, [copy]);
        return;
      }
      if (source instanceof ArrayBuffer) {
        worker.postMessage({ bytes: source, maxVoxels: 70000 }, [source]);
        return;
      }
      worker.postMessage({ text: String(source), maxVoxels: 70000 });
    } catch (error) {
      clearTimeout(timer);
      worker.terminate();
      reject(error);
    }
  });
}

function gcodeEntries(archive) {
  return Object.keys(archive)
    .filter(entry => /\.(?:gcode|gco|nc)$/i.test(entry))
    .sort();
}

async function previewEmbeddedGcode(archive) {
  const names = gcodeEntries(archive);
  if (!names.length) return null;

  const group = new THREE.Group();
  let truncated = false;
  setPreviewProgress(8, 'Building solid preview…');
  await new Promise(resolve => requestAnimationFrame(resolve));
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const fileShare = 70 / names.length;
    const fileOffset = 8 + fileShare * index;
    const bytes = archive[name];
    const result = await parseToolpath(bytes, percent => {
      setPreviewProgress(fileOffset + (percent / 100) * (fileShare * 0.7), 'Building solid preview…');
    });
    const path = await new Promise(resolve => {
      requestAnimationFrame(() => {
        resolve(toolpathObject(result, {
          align: false,
          onProgress(percent) {
            setPreviewProgress(fileOffset + fileShare * 0.7 + (percent / 100) * (fileShare * 0.3), 'Building solid preview…');
          }
        }));
      });
    });
    if (path) group.add(path);
    truncated ||= Boolean(result?.truncated);
  }
  if (!group.children.length) return null;
  preparePrintPreview(group);
  setPreviewProgress(100, 'Preview ready');
  if (truncated) status('Solid preview is simplified for speed. Quote still uses complete G-code metadata.');
  return group;
}

async function preview3mf(buffer) {
  const bytes = new Uint8Array(buffer);
  let archive = null;
  try {
    archive = unzipSync(bytes);
  } catch {
    archive = null;
  }
  const hasGcode = Boolean(archive && gcodeEntries(archive).length);

  let mesh;
  try {
    mesh = await new ThreeMFLoader().parse(buffer.slice(0));
    if (!mesh.getObjectByProperty('isMesh', true)) mesh = null;
  } catch {
    mesh = null;
  }
  // Prefer the real sliced toolpath when G-code is present. Bambu .gcode.3mf often has an empty mesh.
  if (hasGcode) {
    const toolpath = await previewEmbeddedGcode(archive);
    if (toolpath) return { object: toolpath, unsliced: false };
  }
  if (mesh) {
    mesh.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.material = createFilamentMaterial(state.color);
      }
    });
    return { object: preparePrintPreview(mesh, { mesh: true }), unsliced: !hasGcode };
  }

  throw new Error('This 3MF contains no previewable mesh or embedded G-code.');
}

async function previewFile(file) {
  const format = file.name.split('.').pop().toLowerCase();
  let object;
  let unsliced = ['stl', 'obj'].includes(format);

  if (['gcode', 'gco', 'nc'].includes(format)) {
    setPreviewProgress(8, 'Building solid preview…');
    await new Promise(resolve => requestAnimationFrame(resolve));
    const result = await parseToolpath(new Uint8Array(await file.arrayBuffer()), percent => {
      setPreviewProgress(8 + percent * 0.62, 'Building solid preview…');
    });
    object = await new Promise(resolve => {
      requestAnimationFrame(() => {
        resolve(toolpathObject(result, {
          onProgress(percent) {
            setPreviewProgress(70 + percent * 0.28, 'Building solid preview…');
          }
        }));
      });
    });
    if (!object) throw new Error('This G-code has no positive extrusion moves to preview.');
    if (result?.truncated) status('Solid preview is simplified for speed. Quote still uses complete G-code metadata.');
    unsliced = false;
  } else if (format === 'stl') {
    setPreviewProgress(25, 'Loading mesh preview…');
    await new Promise(resolve => requestAnimationFrame(resolve));
    object = new THREE.Mesh(new STLLoader().parse(await file.arrayBuffer()), createFilamentMaterial(state.color));
    object.castShadow = true;
    object.receiveShadow = true;
    setPreviewProgress(82, 'Preparing preview…');
    object = preparePrintPreview(object, { layFlat: true });
  } else if (format === 'obj') {
    setPreviewProgress(25, 'Loading mesh preview…');
    const url = URL.createObjectURL(file);
    try {
      object = await new OBJLoader().loadAsync(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    object.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.material = createFilamentMaterial(state.color);
      }
    });
    setPreviewProgress(82, 'Preparing preview…');
    object = preparePrintPreview(object, { layFlat: true });
  } else {
    setPreviewProgress(18, 'Reading 3MF preview…');
    const result = await preview3mf(await file.arrayBuffer());
    object = result.object;
    unsliced = result.unsliced;
  }

  setPreviewProgress(100, unsliced ? 'Mesh ready' : 'Preview ready');
  state.awaitingSlice = unsliced;
  state.previewOnBed = !unsliced;
  state.preview.set(object, { showBed: state.previewOnBed });
  const mesh = object.getObjectByProperty('isMesh', true);
  if (mesh && unsliced) {
    const metrics = analyzeGeometry(mesh.geometry);
    if (metrics) {
      drawMetrics({
        source: format,
        confidence: null,
        ...metrics,
        weightG: null,
        filamentLengthMm: null,
        filamentVolCm3: null,
        printTimeSec: null,
        printer: null,
        gcodeMetadata: null,
        plateCount: null,
        isManifold: null
      }, null);
    }
  }
  $('#expand').disabled = false;
  return { unsliced };
}

$('#file').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) {
    status('File is over the 100 MB limit.', 'error');
    return;
  }
  state.file = file;
  state.job = null;
  state.metrics = null;
  state.quote = null;
  state.awaitingSlice = false;
  state.sliceProgressDisplay = 0;
  state.minimumPackage = null;
  state.packageSelection = 'Basic';
  state.packageManuallySelected = false;
  state.basicDisclaimerAcknowledged = false;
  state.privateDisclaimerAcknowledged = false;
  if ($('#basic-disclaimer-ack')) $('#basic-disclaimer-ack').checked = false;
  if ($('#private-disclaimer-ack')) $('#private-disclaimer-ack').checked = false;
  updatePackageSelection();
  updateBasicDisclaimer();
  $('#file-info').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  renderUploadPreview(file);
  renderOrderSummary();

  let previewError = null;
  try {
    status('Loading 3D preview…');
    await previewFile(file);
  } catch (error) {
    previewError = error;
    clearPreviewProgress();
  }

  try {
    clearPreviewProgress();
    status('Reading sliced metadata…');
    const quantity = businessFlow
      ? Number($('#business-quantity')?.value) || 1
      : privateFlow
        ? Number($('#private-quantity')?.value) || 1
        : 1;
    const flow = businessFlow ? 'business' : privateFlow ? 'private' : 'student';
    const created = await createJob(
      file,
      sliceMaterialFor(state.material),
      flow,
      quantity
    );
    if (state.material === 'Not sure') {
      await recordMaterialChoice(created.jobId, 'Not sure');
    }
    if (previewError) {
      status(`Preview unavailable (${previewError.message}). Still reading sliced metadata…`, 'manual-review');
    }
    poll(created.jobId);
  } catch (error) {
    clearPreviewProgress();
    status(error.message || previewError?.message || 'Upload failed.', 'error');
  }
};

$('#reset').onclick = () => state.preview.reset();
$('#fit').onclick = () => state.preview.fit();
$('#rotate').onchange = event => state.preview.controls.autoRotate = event.target.checked;
$('#expand').onclick = () => {
  const dialog = $('#preview-dialog');
  state.modalPreview?.dispose();
  state.modalPreview = new Preview($('#modal-preview'));
  state.modalPreview.setBuildPlate(state.metrics?.printer);
  state.modalPreview.set(state.preview.object.clone(), { showBed: state.previewOnBed });
  state.modalPreview.setColor(state.color);
  $('#dialog-subtitle').textContent = `${state.file?.name || ''} · ${displayMaterial()} · ${displayColor()}`;
  dialog.showModal();
  $('#close-dialog').focus();
};
$('#close-dialog').onclick = () => $('#preview-dialog').close();
$('#preview-dialog').addEventListener('close', () => {
  state.modalPreview?.dispose();
  state.modalPreview = null;
  $('#expand').focus();
});
$('#modal-reset').onclick = () => state.modalPreview?.reset();
$('#modal-fit').onclick = () => state.modalPreview?.fit();
$('#modal-rotate').onchange = event => {
  if (state.modalPreview) state.modalPreview.controls.autoRotate = event.target.checked;
};

const servicesMenuButton = $('#services-menu-button');
const servicesMenu = $('#services-menu');
const hamburger = $('#hamburger');
const mobileMenu = $('#mobile-menu');

servicesMenuButton?.addEventListener('click', () => {
  const isOpen = servicesMenu.classList.toggle('is-open');
  servicesMenuButton.setAttribute('aria-expanded', String(isOpen));
});

document.addEventListener('click', event => {
  if (!servicesMenuButton?.contains(event.target) && !servicesMenu?.contains(event.target)) {
    servicesMenu?.classList.remove('is-open');
    servicesMenuButton?.setAttribute('aria-expanded', 'false');
  }
});

hamburger?.addEventListener('click', () => {
  const isOpen = mobileMenu.classList.toggle('is-open');
  hamburger.setAttribute('aria-expanded', String(isOpen));
  hamburger.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
});

mobileMenu?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  mobileMenu.classList.remove('is-open');
  hamburger?.setAttribute('aria-expanded', 'false');
  hamburger?.setAttribute('aria-label', 'Open navigation menu');
}));
