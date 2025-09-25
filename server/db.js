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

export default db;