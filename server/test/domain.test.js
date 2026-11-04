const test = require('node:test');
const assert = require('node:assert/strict');
const { localDateTime, isValidLocalDateTime, validateEventInput, escapeXml } = require('../domain');

test('localDateTime emits local datetime-local format', () => {
  const d = new Date(2026, 10, 4, 9, 7);
  assert.equal(localDateTime(d), '2026-11-04T09:07');
});

test('datetime-local validation rejects impossible dates and accepts valid dates', () => {
  assert.equal(isValidLocalDateTime('2026-11-04T23:59'), true);
  assert.equal(isValidLocalDateTime('2026-02-30T12:00'), false);
  assert.equal(isValidLocalDateTime('2026-11-04T24:00'), false);
  assert.equal(isValidLocalDateTime('2026-11-04T12:00:00Z'), false);
});

test('event validation enforces category, lengths, date and capacity', () => {
  const valid = { title: 'Campus Hackathon', category: 'Technical', description: 'Build a useful campus application.', venue: 'Innovation Lab', organizer: 'Coding Club', event_date: '2026-11-08T09:00', capacity: '80' };
  assert.equal(validateEventInput(valid).error, undefined);
  assert.equal(validateEventInput({ ...valid, category: 'Other' }).error, 'Choose a valid event category.');
  assert.ok(validateEventInput({ ...valid, event_date: '2026-02-30T09:00' }).error);
  assert.ok(validateEventInput({ ...valid, capacity: '0' }).error);
});

test('XML escaping protects special characters', () => {
  assert.equal(escapeXml(`A&B <Hall> "Main"`), 'A&amp;B &lt;Hall&gt; &quot;Main&quot;');
});

test('parseId accepts only positive safe integer strings', () => {
  assert.equal(require('../domain').parseId('7'), 7);
  for (const bad of ['0', '-1', '1.5', '1e3', 'abc', '', ' 3', '99999999999999999999', undefined]) {
    assert.equal(require('../domain').parseId(bad), null, String(bad));
  }
});

test('parseLimit clamps values and defaults invalid values to the maximum', () => {
  const { parseLimit } = require('../domain');
  assert.equal(parseLimit('3'), 3);
  assert.equal(parseLimit('0'), 200);
  assert.equal(parseLimit('-5'), 200);
  assert.equal(parseLimit('9999'), 200);
  assert.equal(parseLimit(undefined), 200);
  assert.equal(parseLimit('12', 50), 12);
  assert.equal(parseLimit('100', 50), 50);
});

test('event validation rejects missing and excessively long fields', () => {
  const { validateEventInput } = require('../domain');
  const valid = { title: 'Campus Hackathon', category: 'Technical', description: 'Build a useful campus application.', venue: 'Innovation Lab', organizer: 'Coding Club', event_date: '2026-11-08T09:00', capacity: '80' };
  assert.ok(validateEventInput({}).error);
  assert.ok(validateEventInput({ ...valid, title: 'x'.repeat(101) }).error);
  assert.ok(validateEventInput({ ...valid, description: 'x'.repeat(2001) }).error);
  assert.ok(validateEventInput({ ...valid, venue: 'x'.repeat(121) }).error);
  assert.ok(validateEventInput({ ...valid, organizer: 'x'.repeat(101) }).error);
});

test('event validation rejects non-integer and excessive capacity', () => {
  const { validateEventInput } = require('../domain');
  const valid = { title: 'Campus Hackathon', category: 'Technical', description: 'Build a useful campus application.', venue: 'Innovation Lab', organizer: 'Coding Club', event_date: '2026-11-08T09:00', capacity: '80' };
  assert.ok(validateEventInput({ ...valid, capacity: '1.5' }).error);
  assert.ok(validateEventInput({ ...valid, capacity: '5001' }).error);
});

test('XML escaping handles apostrophes and null values', () => {
  const { escapeXml } = require('../domain');
  assert.equal(escapeXml("It's <safe> & \"quoted\""), 'It&apos;s &lt;safe&gt; &amp; &quot;quoted&quot;');
  assert.equal(escapeXml(null), '');
});

test('datetime-local validation rejects malformed and out-of-range components', () => {
  const { isValidLocalDateTime } = require('../domain');
  for (const value of ['2026-1-01T10:00', '2026-11-04T9:00', '2026-11-04T10:60', '2026-00-04T10:00', '2026-11-00T10:00']) {
    assert.equal(isValidLocalDateTime(value), false, value);
  }
});

test('event validation accepts the minimum and maximum allowed capacity', () => {
  const { validateEventInput } = require('../domain');
  const valid = { title: 'Campus Hackathon', category: 'Technical', description: 'Build a useful campus application.', venue: 'Innovation Lab', organizer: 'Coding Club', event_date: '2026-11-08T09:00', capacity: '1' };
  assert.equal(validateEventInput(valid).error, undefined);
  assert.equal(validateEventInput({ ...valid, capacity: '5000' }).error, undefined);
});

test('event validation rejects every unsupported category', () => {
  const { validateEventInput } = require('../domain');
  const valid = { title: 'Campus Hackathon', category: 'Technical', description: 'Build a useful campus application.', venue: 'Innovation Lab', organizer: 'Coding Club', event_date: '2026-11-08T09:00', capacity: '80' };
  for (const category of ['Other', 'technical', 'Music', '']) assert.ok(validateEventInput({ ...valid, category }).error);
});

test('parseId rejects non-string numbers rather than coercing them', () => {
  const { parseId } = require('../domain');
  assert.equal(parseId(7), null);
  assert.equal(parseId(null), null);
  assert.equal(parseId('0007'), null);
});

test('parseLimit rejects decimal, exponent and whitespace input', () => {
  const { parseLimit } = require('../domain');
  for (const value of ['1.5', '1e2', ' 5', '5 ', 'abc']) assert.equal(parseLimit(value), 200, value);
});
