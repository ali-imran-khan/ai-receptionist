import Database from 'better-sqlite3';

const db = new Database('appointments.db');

db.exec(`
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  notes TEXT,
  start_iso TEXT NOT NULL,
  end_iso TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function getAppointmentsBetween(startIso, endIso) {
  const stmt = db.prepare(
    `SELECT * FROM appointments WHERE NOT (end_iso <= ? OR start_iso >= ?) ORDER BY start_iso`
  );
  return stmt.all(startIso, endIso);
}

export function createAppointment({ customer_name, customer_phone, notes, start_iso, end_iso }) {
  // [start, end) overlaps if it doesn't end before or start after
  const overlapping = db
    .prepare(
      `SELECT COUNT(1) as count FROM appointments WHERE NOT (end_iso <= ? OR start_iso >= ?)`
    )
    .get(start_iso, end_iso).count;
  if (overlapping > 0) {
    const error = new Error('Requested time overlaps with an existing appointment');
    error.code = 'OVERLAP';
    throw error;
  }

  const insert = db.prepare(
    `INSERT INTO appointments (customer_name, customer_phone, notes, start_iso, end_iso) VALUES (?, ?, ?, ?, ?)`
  );
  const info = insert.run(customer_name, customer_phone || null, notes || null, start_iso, end_iso);
  return { id: info.lastInsertRowid };
}

export function listAppointments(limit = 100, offset = 0) {
  return db.prepare(`SELECT * FROM appointments ORDER BY start_iso LIMIT ? OFFSET ?`).all(limit, offset);
}

export function deleteAppointment(id) {
  db.prepare(`DELETE FROM appointments WHERE id = ?`).run(id);
}

export default db;

