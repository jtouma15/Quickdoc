import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, "../db/clinic.db");
const db = new Database(dbPath, { verbose: null });

// Pragmas for consistency
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

// --- Auth: Users table (if not exists)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --- Ratings: Doctors can be rated with stars and comments ---
db.exec(`
  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
    comment TEXT,
    author_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
  );
`);

try {
  db.exec("ALTER TABLE ratings ADD COLUMN author_name TEXT");
} catch {}

try {
  db.exec("UPDATE ratings SET author_name = 'QuickDoc Nutzer:in' WHERE author_name IS NULL");
} catch {}

export default db;
