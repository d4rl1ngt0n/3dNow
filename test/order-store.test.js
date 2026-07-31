import test from 'node:test';
import assert from 'node:assert/strict';
import { orderStore } from '../server/services/order-store.js';
import { customerStatusCopy, STATUS_LABELS } from '../server/services/orders.js';

test('order store creates, lists, updates status, and records notifications', async () => {
  await orderStore.clear();
  const created = await orderStore.create({
    type: 'contact',
    summary: 'Contact · Ada',
    customer: { name: 'Ada', email: 'ada@example.com', phone: null },
    details: { message: 'Need a quote for a bracket.' }
  });

  assert.equal(created.status, 'new');
  assert.equal(created.customer.email, 'ada@example.com');

  const listed = await orderStore.list({ q: 'ada' });
  assert.equal(listed.length, 1);

  const updated = await orderStore.update(created.id, {
    status: 'completed',
    statusNote: 'Done',
    notes: 'Printed and packed'
  });
  assert.equal(updated.status, 'completed');
  assert.equal(updated.notes, 'Printed and packed');
  assert.equal(updated.statusHistory.at(-1).note, 'Done');

  const notified = await orderStore.recordNotification(created.id, {
    type: 'status-update',
    status: 'completed',
    delivered: true,
    to: 'ada@example.com'
  });
  assert.equal(notified.notifications.length, 1);
  assert.equal(notified.notifications[0].delivered, true);

  const stats = await orderStore.stats();
  assert.equal(stats.total, 1);
  assert.equal(stats.byStatus.completed, 1);
  assert.equal(stats.open, 0);

  await orderStore.clear();
});

test('customer status copy covers completion and pickup', () => {
  assert.match(customerStatusCopy('completed', { filename: 'part.stl' }), /complete/i);
  assert.match(customerStatusCopy('ready-pickup', { filename: 'part.stl' }), /pickup/i);
  assert.equal(STATUS_LABELS.shipped, 'Shipped');
});
