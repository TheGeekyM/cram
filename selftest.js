// Self-check for the two pieces of non-trivial scheduling logic. Run: node selftest.js
const assert = require('assert');
const { schedule, STEPS } = require('./features');
const { shouldNotify } = require('./remind');
const DAY = 864e5, now = new Date(2026, 8, 13, 20, 0).getTime();
let c = { step: -1 };
c = schedule(c, 'good', now); assert.strictEqual(c.step, 0); assert.strictEqual(c.dueAt, now + 1 * DAY);
c = schedule(c, 'good', now); assert.strictEqual(c.step, 1); assert.strictEqual(c.dueAt, now + 3 * DAY);
c = schedule(c, 'easy', now); assert.strictEqual(c.step, 3); assert.strictEqual(c.dueAt, now + 14 * DAY);
c = schedule(c, 'hard', now); assert.strictEqual(c.step, 3);
c = schedule(c, 'again', now); assert.strictEqual(c.step, 0); assert.strictEqual(c.lapses, 1); assert.strictEqual(c.reps, 5);
assert.strictEqual(schedule({ step: -1 }, 'hard', now).step, 0);
assert.strictEqual(schedule({ step: STEPS.length - 1 }, 'easy', now).step, STEPS.length - 1);
const at = h => new Date(2026, 8, 13, h, 0).getTime();
assert.strictEqual(shouldNotify({ now: at(20), last: at(20) - 21 * 36e5, hour: 19 }), true);
assert.strictEqual(shouldNotify({ now: at(18), last: at(18) - 48 * 36e5, hour: 19 }), false, 'before the hour');
assert.strictEqual(shouldNotify({ now: at(20), last: at(20) - 2 * 36e5, hour: 19 }), false, 'studied recently');
assert.strictEqual(shouldNotify({ now: at(20), last: 0, hour: 19, notifiedDay: new Date(at(20)).toDateString() }), false, 'already notified today');
console.log('selftest ok');
