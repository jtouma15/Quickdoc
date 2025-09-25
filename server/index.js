import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import db from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// >>> wichtig: statische Dateien ausliefern
app.use(express.static(path.resolve(__dirname, "../client"), { index: false }));

// Helpers
const nowIso = () => new Date().toISOString();

// API
app.get("/api/specialties", (req, res) => {
  const rows = db.prepare("SELECT id, code, name FROM specialties ORDER BY name").all();
  res.json(rows);
});

app.get("/api/cities", (req, res) => {
  const rows = db.prepare("SELECT DISTINCT city FROM locations ORDER BY city").all();
  res.json(rows.map(r => r.city));
});

app.get("/api/doctors", (req, res) => {
  const { specialty_id, city, q } = req.query;
  const clauses = [];
  const params = {};
  if (specialty_id) { clauses.push("d.specialty_id = @specialty_id"); params.specialty_id = Number(specialty_id); }
  if (city) {
    clauses.push(`EXISTS (
      SELECT 1 FROM doctor_locations dl
      JOIN locations l ON l.id = dl.location_id
      WHERE dl.doctor_id = d.id AND l.city = @city
    )`);
    params.city = city;
  }
  if (q) { clauses.push("(LOWER(d.first_name || ' ' || d.last_name) LIKE @q)"); params.q = `%${q.toLowerCase()}%`; }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const sql = `
    SELECT d.id, d.first_name, d.last_name, s.name AS specialty,
           d.phone, d.email
    FROM doctors d
    JOIN specialties s ON s.id = d.specialty_id
    ${where}
    ORDER BY s.name, d.last_name, d.first_name
    LIMIT 100
  `;
  res.json(db.prepare(sql).all(params));
});

app.get("/api/doctors/:id/nextSlot", (req, res) => {
  const row = db.prepare(`
    SELECT id, start_time, duration_min
    FROM appointment_slots
    WHERE doctor_id = ? AND is_booked = 0 AND start_time >= ?
    ORDER BY start_time ASC
    LIMIT 1
  `).get(Number(req.params.id), nowIso());
  res.json(row || null);
});

app.get("/api/doctors/:id/locations", (req, res) => {
  const rows = db.prepare(`
    SELECT l.city, l.zip, l.street
    FROM doctor_locations dl
    JOIN locations l ON l.id = dl.location_id
    WHERE dl.doctor_id = ?
    ORDER BY l.city
  `).all(Number(req.params.id));
  res.json(rows);
});

app.get("/api/slots", (req, res) => {
  const { doctor_id, from } = req.query;
  if (!doctor_id) return res.status(400).json({ error: "doctor_id is required" });
  const start = from ? new Date(from).toISOString() : nowIso();
  const rows = db.prepare(`
    SELECT id, start_time, duration_min, is_booked
    FROM appointment_slots
    WHERE doctor_id = @doctor_id AND start_time >= @start
    ORDER BY start_time
    LIMIT 50
  `).all({ doctor_id: Number(doctor_id), start });
  res.json(rows);
});

app.post("/api/book", (req, res) => {
  const { slot_id } = req.body;
  if (!slot_id) return res.status(400).json({ error: "slot_id is required" });
  const slot = db.prepare(`SELECT id, is_booked FROM appointment_slots WHERE id = ?`).get(Number(slot_id));
  if (!slot) return res.status(404).json({ error: "slot not found" });
  if (slot.is_booked) return res.status(409).json({ error: "slot already booked" });
  db.prepare(`UPDATE appointment_slots SET is_booked = 1 WHERE id = ?`).run(Number(slot_id));
  res.json({ ok: true });
});

// >>> wichtig: Root-Route: wenn vorhanden, home.html ausliefern, sonst index.html
app.get("/", (_req, res) => {
  const homePath = path.resolve(__dirname, "../client/home.html");
  const fallbackIndex = path.resolve(__dirname, "../client/index.html");
  if (fs.existsSync(homePath)) {
    res.sendFile(homePath);
  } else {
    res.sendFile(fallbackIndex);
  }
});

// explizite Route für die Suchseite
app.get(["/suche", "/suche.html"], (_req, res) => {
  res.sendFile(path.resolve(__dirname, "../client/index.html"));
});

app.get("/*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.resolve(__dirname, "../client/index.html"));
});

const PORT = process.env.PORT || 5173;
app.listen(PORT, () => console.log(`API + UI running on http://localhost:${PORT}`));