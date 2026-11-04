const CATEGORIES = Object.freeze(['Technical', 'Cultural', 'Workshop', 'Seminar', 'Sports']);

function localDateTime(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Validate a datetime-local value without interpreting it as UTC.
function isValidLocalDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const d = new Date(year, month - 1, day, hour, minute);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day &&
    d.getHours() === hour && d.getMinutes() === minute;
}

function validateEventInput(body = {}) {
  const title = String(body.title ?? '').trim();
  const category = String(body.category ?? '').trim();
  const description = String(body.description ?? '').trim();
  const venue = String(body.venue ?? '').trim();
  const organizer = String(body.organizer ?? '').trim();
  const eventDate = String(body.event_date ?? '').trim();
  const capacity = Number(body.capacity);
  if (title.length < 5 || title.length > 100) return { error: 'Title must be 5–100 characters.' };
  if (!CATEGORIES.includes(category)) return { error: 'Choose a valid event category.' };
  if (description.length < 10 || description.length > 2000) return { error: 'Description must be 10–2000 characters.' };
  if (venue.length < 3 || venue.length > 120) return { error: 'Venue must be 3–120 characters.' };
  if (organizer.length < 2 || organizer.length > 100) return { error: 'Organiser must be 2–100 characters.' };
  if (!isValidLocalDateTime(eventDate)) return { error: 'Choose a valid event date and time.' };
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 5000) return { error: 'Capacity must be between 1 and 5000.' };
  return { values: [title, category, description, venue, organizer, eventDate, capacity] };
}

// Parse route/query integers strictly; Number('1e3') and whitespace are not accepted.
function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

// Invalid, zero, negative and oversized limits fall back to the safe maximum.
function parseLimit(value, max = 200) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return max;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) return max;
  return Math.min(n, max);
}

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]);
}

module.exports = { CATEGORIES, localDateTime, isValidLocalDateTime, validateEventInput, escapeXml, parseId, parseLimit };
