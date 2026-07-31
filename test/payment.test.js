import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrderTotal } from '../server/services/payments.js';
import { isEligibleStudentEmail } from '../server/services/student-email.js';

const job = { quote: { total: 39, package: { name: 'Basic' } } };

test('accepts .edu, institutional .de and recognized school domains', () => {
  assert.equal(isEligibleStudentEmail('student@example.edu'), true);
  assert.equal(isEligibleStudentEmail('student@uni-duesseldorf.de'), true);
  assert.equal(isEligibleStudentEmail('student@tum.de'), true);
  assert.equal(isEligibleStudentEmail('student@college.ac.uk'), true);
  assert.equal(isEligibleStudentEmail('name@ethz.ch'), true);
});

test('rejects personal and malformed email domains', () => {
  assert.equal(isEligibleStudentEmail('student@gmail.com'), false);
  assert.equal(isEligibleStudentEmail('student@gmx.de'), false);
  assert.equal(isEligibleStudentEmail('student@web.de'), false);
  assert.equal(isEligibleStudentEmail('student@yahoo.com'), false);
  assert.equal(isEligibleStudentEmail('student@example.com'), false);
  assert.equal(isEligibleStudentEmail('student@'), false);
});

test('calculates server-authoritative payment total', () => {
  assert.deepEqual(calculateOrderTotal(job, { speed: 'express', engineering: 'review' }), {
    packageName: 'Basic',
    baseCents: 3900,
    speedCents: 1900,
    reviewCents: 1500,
    editingCents: 0,
    totalCents: 7300
  });
});

test('allows students to upgrade their verified package', () => {
  assert.equal(calculateOrderTotal(job, { packageName: 'Medium' }).baseCents, 6900);
});

test('allows file editing checkout at the first-hour rate', () => {
  assert.deepEqual(calculateOrderTotal(job, { speed: 'standard', engineering: 'editing' }), {
    packageName: 'Basic',
    baseCents: 3900,
    speedCents: 0,
    reviewCents: 0,
    editingCents: 9000,
    totalCents: 12900
  });
});
