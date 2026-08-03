import test from 'node:test';
import assert from 'node:assert/strict';
import { studentQuote } from '../server/services/quote.js';

const p = { id: 'p1s', name: 'P1S', ratePerHour: .12 };

for (const [w, name] of [[150, 'Basic'], [150.1, 'Medium'], [300, 'Medium'], [300.1, 'Large']]) {
  test(`${w} g selects ${name}`, () => {
    const q = studentQuote({ material: 'PLA', weightG: w, printTimeSec: 3600, printer: p });
    assert.equal(q.package.name, name);
    assert.equal(q.total, q.package.price);
    assert.equal(q.flow, 'student');
    assert.equal(q.quantity, 1);
    assert.equal(q.totalWeightG, w);
  });
}

test('package uses file weight × number of prints', () => {
  const basic = studentQuote({ material: 'PLA', weightG: 100, printTimeSec: 3600, printer: p, quantity: 1 });
  assert.equal(basic.package.name, 'Basic');
  const medium = studentQuote({ material: 'PLA', weightG: 100, printTimeSec: 3600, printer: p, quantity: 2 });
  assert.equal(medium.package.name, 'Medium');
  assert.equal(medium.totalWeightG, 200);
  const large = studentQuote({ material: 'PLA', weightG: 100, printTimeSec: 3600, printer: p, quantity: 4 });
  assert.equal(large.package.name, 'Large');
  assert.equal(large.totalWeightG, 400);
});
