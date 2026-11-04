const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(process.env.DATABASE_PATH || path.join(__dirname, 'eventsphere.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','admin')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 category TEXT NOT NULL,
 description TEXT NOT NULL,
 venue TEXT NOT NULL,
 organizer TEXT NOT NULL,
 event_date TEXT NOT NULL,
 capacity INTEGER NOT NULL CHECK(capacity > 0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS registrations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,event_id)
);
CREATE TABLE IF NOT EXISTS feedback (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,event_id)
);
`);
const bcrypt = require('bcryptjs');
if (!db.prepare('SELECT id FROM users WHERE email=?').get('admin@eventsphere.local')) {
 db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run('EventSphere Admin','admin@eventsphere.local',bcrypt.hashSync('Admin123!',12),'admin');
}
if (!db.prepare('SELECT id FROM users WHERE email=?').get('student@eventsphere.local')) {
 db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run('Demo Student','student@eventsphere.local',bcrypt.hashSync('Student123!',12),'student');
}
const count = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
if (!count) {
 const insert = db.prepare('INSERT INTO events(title,category,description,venue,organizer,event_date,capacity) VALUES(?,?,?,?,?,?,?)');
 const samples = [
  ['HackSprint 2026 – 24 Hour Hackathon','Technical','A 24-hour team hackathon focused on building practical solutions to campus and community problems.','Innovation Lab, Block 5','Coding Club','2026-11-08T09:00',120],
  ['Rangotsav Cultural Night','Cultural','An evening of music, dance, theatre and student performances.','Main Auditorium','Cultural Committee','2026-11-09T17:00',450],
  ['Full-Stack Web Workshop','Workshop','A hands-on introduction to building web applications with modern frontend and backend tools.','CS Lab 3','Web Development Club','2026-11-10T14:00',60],
  ['Cyber Security CTF','Technical','A beginner-friendly capture-the-flag challenge covering web and network security.','CS Lab 1','Cyber Cell','2026-10-30T10:00',80],
  ['Alumni Talk: Careers in Cloud','Seminar','Alumni share career journeys and practical advice about cloud computing.','Seminar Hall B','Alumni Association','2026-10-29T16:00',100],
  ['Inter-Department Football League','Sports','A campus football tournament featuring teams from multiple departments.','Sports Ground','Sports Council','2026-11-14T08:00',200]
 ];
 const tx = db.transaction(rows => rows.forEach(row => insert.run(...row)));
 tx(samples);
 const student = db.prepare('SELECT id FROM users WHERE email=?').get('student@eventsphere.local').id;
 const cyber = db.prepare("SELECT id FROM events WHERE title='Cyber Security CTF'").get().id;
 const alumni = db.prepare("SELECT id FROM events WHERE title='Alumni Talk: Careers in Cloud'").get().id;
 const reg = db.prepare('INSERT OR IGNORE INTO registrations(user_id,event_id) VALUES(?,?)');
 reg.run(student,cyber); reg.run(student,alumni);
 db.prepare('INSERT OR IGNORE INTO feedback(user_id,event_id,rating,comment) VALUES(?,?,?,?)').run(student,cyber,5,'Great beginner-friendly event.');
}
module.exports = db;
