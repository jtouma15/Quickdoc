import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import db from "./db.js";
import session from "express-session";
import bcrypt from "bcryptjs";
// .env laden und prüfen ob richtig geladen
import 'dotenv/config';
console.log("✅ .env geladen:", process.env.SMTP_HOST, process.env.MAIL_FROM);

import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 2525),
  secure: false, // Mailtrap/Sandbox: kein SSL auf 2525
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false },
});



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

app.use(session({
  name: "qd.sid",
  secret: process.env.SESSION_SECRET || "dev-quickdoc-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

// >>> wichtig: statische Dateien ausliefern
app.use(express.static(path.resolve(__dirname, "../client"), { index: false }));

// Helpers
const nowIso = () => new Date().toISOString();

// --- AUTH API ---
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const hash = await bcrypt.hash(password, 12);
  try {
    const stmt = db.prepare(`INSERT INTO users (email, password_hash) VALUES (?, ?)`);
    const info = stmt.run(email.toLowerCase(), hash);
    req.session.user = { id: info.lastInsertRowid, email: email.toLowerCase() };
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({ error: "email already exists" });
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const user = db.prepare(`SELECT id, email, password_hash FROM users WHERE email = ?`).get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: "invalid_credentials" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });
  req.session.user = { id: user.id, email: user.email };
  res.json({ ok: true, user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json(req.session.user || null);
});

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

// --- RATINGS API ---
// Sammel-Statistiken für mehrere Ärzte (für Ergebnisliste)
app.get("/api/ratings/stats", (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n));
  if (!ids.length) return res.json({ stats: [] });

  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT doctor_id,
           ROUND(AVG(score), 2) AS avg_rating,
           COUNT(*) AS rating_count
    FROM ratings
    WHERE doctor_id IN (${placeholders})
    GROUP BY doctor_id
  `).all(...ids);

  res.json({ stats: rows });
});

// Bewertungen eines Arztes abrufen (Liste + Stats)
app.get("/api/doctors/:id/ratings", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

  const list = db.prepare(`
    SELECT id, score, comment, created_at
    FROM ratings
    WHERE doctor_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(id);

  const stat = db.prepare(`
    SELECT ROUND(AVG(score),2) AS avg_rating, COUNT(*) AS rating_count
    FROM ratings WHERE doctor_id = ?
  `).get(id) || { avg_rating: null, rating_count: 0 };

  res.json({ ratings: list, ...stat });
});

// Bewertung anlegen (1..5 Sterne + optional Kommentar)
app.post("/api/doctors/:id/ratings", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { score, comment } = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });
  const s = parseInt(score, 10);
  if (!(s >= 1 && s <= 5)) return res.status(400).json({ error: "score_1_5" });

  db.prepare(`
    INSERT INTO ratings (doctor_id, score, comment) VALUES (?, ?, ?)
  `).run(id, s, (comment || "").toString().slice(0, 500));

  const stat = db.prepare(`
    SELECT ROUND(AVG(score),2) AS avg_rating, COUNT(*) AS rating_count
    FROM ratings WHERE doctor_id = ?
  `).get(id) || { avg_rating: s, rating_count: 1 };

  res.json({ ok: true, ...stat });
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


// Buchungsbestätigung per E-Mail versenden
app.post('/api/send-booking-email', async (req, res) => {
  try {
    const { to, booking, ics } = req.body || {};
    console.log('📩 /api/send-booking-email', { to, hasBooking: !!booking, hasIcs: !!ics });

    if (!to || !booking?.startTime) {
      return res.status(400).json({ error: "Missing 'to' or 'booking.startTime'" });
    }

    const dt = new Date(booking.startTime);
    const dateStr = dt.toLocaleDateString('de-DE', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
    const timeStr = dt.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto;line-height:1.5">
        <h2 style="margin:0 0 12px">Terminbestätigung</h2>
        <p>Ihr Termin bei <strong>${booking.doctorName || 'Ihrer Praxis'}</strong>
        am <strong>${dateStr}</strong> um <strong>${timeStr}</strong>
        (Dauer: ${booking.durationMin || 20} Minuten) wurde gebucht.</p>
        <p>Ort: ${booking.location || 'Praxis/Online'}</p>
        <p style="margin-top:16px">Viele Grüße<br>QuickDoc</p>
      </div>
    `;

    const attachments = ics ? [{ filename:'termin.ics', content: ics, contentType:'text/calendar' }] : [];

    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 2525),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });

    await transporter.sendMail({
      from: process.env.MAIL_FROM || 'QuickDoc <noreply@quickdoc.demo>',
      to,
      subject: 'Ihre Terminbestätigung',
      html,
      attachments,
    });

    console.log(`✅ Email sent to ${to}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Mail error:', err);
    res.status(500).json({ error: 'Mailversand fehlgeschlagen' });
  }
});


const PORT = process.env.PORT || 5173;
app.listen(PORT, () => console.log(`API + UI running on http://localhost:${PORT}`));
