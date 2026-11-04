const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const { localDateTime, validateEventInput, escapeXml, parseId, parseLimit } = require('./domain');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set before starting EventSphere in production.');
}
if (isProduction) app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(session({
  name: 'eventsphere.sid',
  secret: process.env.SESSION_SECRET || 'eventsphere-local-demo-secret-change-before-deployment',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 4 * 60 * 60 * 1000
  }
}));

const safeUser = user => ({ id: user.id, name: user.name, email: user.email, role: user.role });
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ message: 'Please log in first.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ message: 'Please log in first.' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ message: 'Administrator access required.' });
  next();
}
function makeRateLimiter({ windowMs, max }) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    buckets.set(key, entry);
    if (buckets.size > 2000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) return res.status(429).json({ message: 'Too many attempts. Please try again later.' });
    next();
  };
}
const authLimiter = makeRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

function eventRow(id, userId = 0) {
  return db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) AS registered,
      (SELECT AVG(f.rating) FROM feedback f WHERE f.event_id=e.id) AS avg_rating,
      (SELECT COUNT(*) FROM feedback f WHERE f.event_id=e.id) AS rating_count,
      EXISTS(SELECT 1 FROM registrations r WHERE r.event_id=e.id AND r.user_id=?) AS registered_by_user
    FROM events e WHERE e.id=?
  `).get(userId || 0, id);
}
function saveSessionUser(req, res, user, status = 200, message = 'Welcome.') {
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ message: 'Could not start a secure session.' });
    req.session.user = safeUser(user);
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ message: 'Could not save your session.' });
      res.status(status).json({ user: req.session.user, message });
    });
  });
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'EventSphere API' }));
app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2 || name.length > 60) return res.status(422).json({ message: 'Name must contain 2–60 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(422).json({ message: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(422).json({ message: 'Password must be 8–72 characters and contain a letter and a number.' });
    }
    const hash = await bcrypt.hash(password, 12);
    let user;
    try {
      const result = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name, email, hash);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'That email is already registered.' });
      throw err;
    }
    saveSessionUser(req, res, user, 201, 'Account created successfully.');
  } catch (err) { next(err); }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    // Perform a hash comparison for unknown emails too, reducing account-enumeration timing differences.
    const valid = row ? await bcrypt.compare(password, row.password_hash) : await bcrypt.compare(password || 'invalid-password', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
    if (!row || !valid) return res.status(401).json({ message: 'Incorrect email or password.' });
    saveSessionUser(req, res, row, 200, 'Welcome back.');
  } catch (err) { next(err); }
});

app.post('/api/auth/logout', (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('eventsphere.sid', { httpOnly: true, sameSite: 'lax', secure: isProduction });
    res.json({ message: 'Logged out.' });
  });
});

app.get('/api/events', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const limit = parseLimit(req.query.limit, 200);
  const category = String(req.query.category || 'All');
  const when = ['upcoming', 'past', 'all'].includes(req.query.when) ? req.query.when : 'upcoming';
  const sort = ['date', 'title', 'popular'].includes(req.query.sort) ? req.query.sort : 'date';
  const now = localDateTime();
  const where = [];
  const args = [req.session.user?.id || 0];
  if (q) {
    where.push('(instr(lower(e.title),lower(?))>0 OR instr(lower(e.description),lower(?))>0 OR instr(lower(e.venue),lower(?))>0)');
    args.push(q, q, q);
  }
  if (category !== 'All') {
    where.push('e.category=?');
    args.push(category);
  }
  if (when === 'upcoming') { where.push('e.event_date>=?'); args.push(now); }
  if (when === 'past') { where.push('e.event_date<?'); args.push(now); }
  const order = sort === 'title' ? 'e.title COLLATE NOCASE ASC' : sort === 'popular' ? 'registered DESC, e.event_date ASC' : (when === 'past' ? 'e.event_date DESC' : 'e.event_date ASC');
  const sql = `SELECT e.*,
    (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) AS registered,
    (SELECT AVG(f.rating) FROM feedback f WHERE f.event_id=e.id) AS avg_rating,
    (SELECT COUNT(*) FROM feedback f WHERE f.event_id=e.id) AS rating_count,
    EXISTS(SELECT 1 FROM registrations r WHERE r.event_id=e.id AND r.user_id=?) AS registered_by_user
    FROM events e ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${order} LIMIT ?`;
  args.push(limit);
  res.json({ events: db.prepare(sql).all(...args) });
});

app.get('/api/events/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid event id.' });
  const event = eventRow(id, req.session.user?.id);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  res.json({ event });
});

// A single SQLite transaction makes the capacity/duplicate checks and insert atomic.
const createRegistration = db.transaction((userId, eventId) => {
  const event = db.prepare('SELECT id,event_date,capacity FROM events WHERE id=?').get(eventId);
  if (!event) return { error: 'Event not found.', status: 404 };
  if (event.event_date < localDateTime()) return { error: 'Registration is closed for this event.', status: 409 };
  const existing = db.prepare('SELECT id FROM registrations WHERE user_id=? AND event_id=?').get(userId, eventId);
  if (existing) return { error: 'You are already registered.', status: 409 };
  const count = db.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id=?').get(eventId).n;
  if (count >= event.capacity) return { error: 'Sorry, this event is full.', status: 409 };
  db.prepare('INSERT INTO registrations(user_id,event_id) VALUES(?,?)').run(userId, eventId);
  return { ok: true };
});
app.post('/api/events/:id/rsvp', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid event id.' });
  try {
    const result = createRegistration.immediate(req.session.user.id, id);
    if (result.error) return res.status(result.status).json({ message: result.error });
    res.json({ message: 'Your seat is reserved.', event: eventRow(id, req.session.user.id) });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'You are already registered.' });
    throw err;
  }
});
app.delete('/api/events/:id/rsvp', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid event id.' });
  db.prepare('DELETE FROM registrations WHERE user_id=? AND event_id=?').run(req.session.user.id, id);
  res.json({ message: 'Registration cancelled.' });
});

app.get('/api/my-events', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const events = db.prepare(`SELECT e.*, r.created_at AS registration_date,
    (SELECT COUNT(*) FROM registrations x WHERE x.event_id=e.id) AS registered,
    (SELECT rating FROM feedback f WHERE f.event_id=e.id AND f.user_id=?) AS my_rating,
    (SELECT comment FROM feedback f WHERE f.event_id=e.id AND f.user_id=?) AS my_comment
    FROM registrations r JOIN events e ON e.id=r.event_id
    WHERE r.user_id=? ORDER BY e.event_date`).all(userId, userId, userId);
  res.json({ events });
});
app.post('/api/events/:id/feedback', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  const rating = Number(req.body.rating);
  const comment = String(req.body.comment || '').trim();
  if (id === null) return res.status(400).json({ message: 'Invalid event id.' });
  const event = eventRow(id, req.session.user.id);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  if (event.event_date >= localDateTime()) return res.status(409).json({ message: 'Feedback is available after the event.' });
  if (!event.registered_by_user) return res.status(403).json({ message: 'Only registered attendees can leave feedback.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 300) {
    return res.status(422).json({ message: 'Choose 1–5 stars and keep comments under 300 characters.' });
  }
  db.prepare(`INSERT INTO feedback(user_id,event_id,rating,comment) VALUES(?,?,?,?)
    ON CONFLICT(user_id,event_id) DO UPDATE SET rating=excluded.rating,comment=excluded.comment,created_at=CURRENT_TIMESTAMP`)
    .run(req.session.user.id, id, rating, comment);
  res.json({ message: 'Thanks for your feedback.' });
});

app.get('/api/admin/summary', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  const upcoming = db.prepare('SELECT COUNT(*) AS n FROM events WHERE event_date>=?').get(localDateTime()).n;
  const registrations = db.prepare('SELECT COUNT(*) AS n FROM registrations').get().n;
  const avgRating = db.prepare('SELECT ROUND(AVG(rating),1) AS n FROM feedback').get().n || 0;
  const events = db.prepare(`SELECT e.id,e.title,e.category,e.description,e.venue,e.organizer,e.event_date,e.capacity,
    COUNT(r.id) AS registered FROM events e LEFT JOIN registrations r ON r.event_id=e.id
    GROUP BY e.id ORDER BY e.event_date`).all();
  const feedback = db.prepare(`SELECT f.id, f.rating, f.comment, f.created_at,
    e.id AS event_id, e.title AS event_title, u.name AS student_name, u.email AS student_email
    FROM feedback f
    JOIN events e ON e.id=f.event_id
    JOIN users u ON u.id=f.user_id
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT 100`).all();
  res.json({ summary: { total, upcoming, registrations, avgRating }, events, feedback });
});
app.post('/api/admin/events', requireAdmin, (req, res) => {
  const data = validateEventInput(req.body);
  if (data.error) return res.status(422).json({ message: data.error });
  const result = db.prepare('INSERT INTO events(title,category,description,venue,organizer,event_date,capacity) VALUES(?,?,?,?,?,?,?)').run(...data.values);
  res.status(201).json({ message: 'Event created.', event: eventRow(result.lastInsertRowid) });
});
app.put('/api/admin/events/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid event id.' });
  const data = validateEventInput(req.body);
  if (data.error) return res.status(422).json({ message: data.error });
  const registered = db.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id=?').get(id).n;
  if (data.values[6] < registered) return res.status(409).json({ message: `Capacity cannot be lower than the ${registered} existing registrations.` });
  const result = db.prepare('UPDATE events SET title=?,category=?,description=?,venue=?,organizer=?,event_date=?,capacity=? WHERE id=?').run(...data.values, id);
  if (!result.changes) return res.status(404).json({ message: 'Event not found.' });
  res.json({ message: 'Event updated.', event: eventRow(id) });
});
app.delete('/api/admin/events/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid event id.' });
  const result = db.prepare('DELETE FROM events WHERE id=?').run(id);
  if (!result.changes) return res.status(404).json({ message: 'Event not found.' });
  res.json({ message: 'Event deleted.' });
});

app.get('/feed.xml', (req, res) => {
  const events = db.prepare(`SELECT e.id,e.title,e.category,e.venue,e.event_date,e.capacity,
    (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) AS registered
    FROM events e WHERE e.event_date>=? ORDER BY e.event_date LIMIT 10`).all(localDateTime());
  const body = events.map(e => `<event id="${e.id}"><title>${escapeXml(e.title)}</title><category>${escapeXml(e.category)}</category><venue>${escapeXml(e.venue)}</venue><date>${escapeXml(e.event_date)}</date><seatsLeft>${Math.max(0, e.capacity - e.registered)}</seatsLeft></event>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><events generated="${new Date().toISOString()}">${body}</events>`);
});

if (isProduction) {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../client/dist/index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ message: 'An unexpected server error occurred.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`EventSphere server running at http://localhost:${PORT}`));
}
module.exports = app;
