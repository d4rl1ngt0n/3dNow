import Stripe from 'stripe';
import { config } from '../config.js';
import { studentPackageFromTotalWeight } from './quote.js';

const SHIPPING_COUNTRIES = ['AT', 'BE', 'DE', 'DK', 'ES', 'FI', 'FR', 'IE', 'IT', 'LU', 'NL', 'PL', 'PT', 'SE'];
const STUDENT_PACKAGES = {
  Basic: { rank: 0, price: 39 },
  Medium: { rank: 1, price: 69 },
  Large: { rank: 2, price: 89 }
};
const FILE_EDITING_CENTS = 8900;
let stripe;

export function getStripe() {
  if (!config.stripe.secretKey) return null;
  stripe ||= new Stripe(config.stripe.secretKey);
  return stripe;
}

export function calculateOrderTotal(job, details) {
  if (!job.quote) throw new Error('A verified automatic quote is required before checkout.');
  const quantity = Number.isInteger(Number(details.quantity)) && Number(details.quantity) > 0
    ? Number(details.quantity)
    : (job.quantity || job.quote.quantity || 1);
  const fileWeightG = Number(job.metrics?.weightG ?? job.quote.weightG);
  const totalWeightG = Number.isFinite(fileWeightG) ? fileWeightG * quantity : null;
  const automaticPackage = Number.isFinite(totalWeightG)
    ? studentPackageFromTotalWeight(totalWeightG).name
    : job.quote.package.name;
  const selectedPackage = details.packageName || automaticPackage;
  if (!STUDENT_PACKAGES[selectedPackage]) throw new Error('Choose a valid student package.');
  if (STUDENT_PACKAGES[selectedPackage].rank < STUDENT_PACKAGES[automaticPackage].rank) {
    throw new Error(`Your verified total weight (${Math.round(totalWeightG)} g) requires at least the ${automaticPackage} package.`);
  }
  job.quantity = quantity;

  const speedCents = details.speed === 'priority' ? 3900 : details.speed === 'express' ? 1900 : 0;
  const reviewCents = details.engineering === 'review' && selectedPackage === 'Basic' ? 1500 : 0;
  const editingCents = details.engineering === 'editing' ? FILE_EDITING_CENTS : 0;
  const baseCents = Math.round(STUDENT_PACKAGES[selectedPackage].price * 100);
  return {
    packageName: selectedPackage,
    baseCents,
    speedCents,
    reviewCents,
    editingCents,
    totalCents: baseCents + speedCents + reviewCents + editingCents
  };
}

export async function createCheckoutSession(job, details) {
  const client = getStripe();
  if (!client) throw new Error('Online payment is not configured yet.');

  const total = calculateOrderTotal(job, details);
  const extras = [
    details.speed === 'priority' ? 'Priority production' : details.speed === 'express' ? 'Express production' : null,
    total.packageName !== 'Basic' ? 'Expert review included' : details.engineering === 'review' ? 'Expert review' : null,
    details.engineering === 'editing' ? 'File editing first hour (€90). Extra time may increase the price after approval.' : null
  ].filter(Boolean);

  return client.checkout.sessions.create({
    mode: 'payment',
    customer_email: details.contactMethod === 'email' ? details.contactEmail : undefined,
    billing_address_collection: 'required',
    shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
    line_items: [{
      price_data: {
        currency: 'eur',
        unit_amount: total.totalCents,
        product_data: {
          name: `3DNow student print: ${total.packageName}`,
          description: [job.filename, job.requestedMaterial || job.material, ...extras].filter(Boolean).join(' · ')
        }
      },
      quantity: 1
    }],
    metadata: { jobId: job.id },
    success_url: `${config.publicUrl}/quote-engine/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.publicUrl}/quote-engine/payment-cancelled`
  });
}

export function verifyWebhook(payload, signature) {
  const client = getStripe();
  if (!client || !config.stripe.webhookSecret) throw new Error('Stripe webhook is not configured.');
  return client.webhooks.constructEvent(payload, signature, config.stripe.webhookSecret);
}
