import db from "./db.js";

// Drop & Create schema
db.exec(`
  DROP TABLE IF EXISTS appointment_slots;
  DROP TABLE IF EXISTS doctor_locations;
  DROP TABLE IF EXISTS doctors;
  DROP TABLE IF EXISTS specialties;
  DROP TABLE IF EXISTS locations;

  CREATE TABLE specialties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
  );

  CREATE TABLE locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    city TEXT NOT NULL,
    zip TEXT NOT NULL,
    street TEXT NOT NULL
  );

  CREATE TABLE doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    specialty_id INTEGER NOT NULL,
    phone TEXT,
    email TEXT,
    FOREIGN KEY (specialty_id) REFERENCES specialties(id)
  );

  CREATE TABLE doctor_locations (
    doctor_id INTEGER NOT NULL,
    location_id INTEGER NOT NULL,
    PRIMARY KEY (doctor_id, location_id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (location_id) REFERENCES locations(id)
  );

  CREATE TABLE appointment_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,    -- ISO string
    duration_min INTEGER NOT NULL DEFAULT 20,
    is_booked INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
  );
`);

// Seed reference data
const specialties = [
  ["CAR", "Kardiologie"],
  ["DER", "Dermatologie"],
  ["ENT", "HNO"],
  ["NEU", "Neurologie"],
  ["ORT", "Orthopädie"],
  ["GYN", "Gynäkologie"],
  ["URO", "Urologie"],
  ["OPH", "Augenheilkunde"],
  ["DNT", "Zahnmedizin"],
  ["PSY", "Psychiatrie / Psychotherapie"],
  ["INT", "Innere Medizin"],
  ["PED", "Pädiatrie"],
  ["END", "Endokrinologie"]
];

const cities = [
  ["Hamburg", "20095", "Jungfernstieg 1"],
  ["Hamburg", "22303", "Saarlandstraße 12"],
  ["Hamburg", "22767", "Kleine Freiheit 3"],
  ["Berlin", "10115", "Invalidenstraße 44"],
  ["München", "80331", "Marienplatz 8"],
  ["Köln", "50667", "Hohe Straße 21"],
  ["Frankfurt", "60311", "Zeil 112"],
  ["Stuttgart", "70173", "Königstraße 25"],
  ["Düsseldorf", "40213", "Flinger Straße 5"],
  ["Leipzig", "04109", "Markt 10"]
];

const firstNames = ["Alex", "Sam", "Lea", "Jonas", "Mia", "Felix", "Sara", "Luca", "Noah", "Emma", "Paul", "Sofia", "Julian", "Nina", "Tom"];
const lastNames  = ["Meyer", "Schmidt", "Klein", "Vogel", "Becker", "Hoffmann", "König", "Schulz", "Keller", "Richter", "Peters", "Hartmann"];

const insSpec = db.prepare(`INSERT INTO specialties (code, name) VALUES (?, ?)`);
for (const [code, name] of specialties) insSpec.run(code, name);

const insLoc = db.prepare(`INSERT INTO locations (city, zip, street) VALUES (?, ?, ?)`);
const locationIds = cities.map(c => insLoc.run(...c).lastInsertRowid);

const getSpecId = db.prepare(`SELECT id FROM specialties WHERE code = ?`);
const insDoc = db.prepare(`
  INSERT INTO doctors (first_name, last_name, specialty_id, phone, email)
  VALUES (?, ?, ?, ?, ?)
`);
const insDocLoc = db.prepare(`INSERT INTO doctor_locations (doctor_id, location_id) VALUES (?, ?)`);

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

// Create ~40 doctors across specialties & cities
const doctorIds = [];
for (let i = 0; i < 40; i++) {
  const fn = pick(firstNames);
  const ln = pick(lastNames);
  const spec = pick(specialties)[0];
  const specId = getSpecId.get(spec).id;
  const phone = "+49 " + (300000000 + Math.floor(Math.random()*9999999));
  const email = `${fn.toLowerCase()}.${ln.toLowerCase()}@quickdoc.example`;
  const docId = insDoc.run(fn, ln, specId, phone, email).lastInsertRowid;

  // give each doctor 1–2 practice locations
  const locationCount = Math.random() < 0.7 ? 1 : 2;
  const locs = new Set();
  while (locs.size < locationCount) locs.add(pick(locationIds));
  for (const lid of locs) insDocLoc.run(docId, lid);

  doctorIds.push(docId);
}

// Generate appointment slots next 14 days, 09:00–16:00 each hour (book some)
const insSlot = db.prepare(`
  INSERT INTO appointment_slots (doctor_id, start_time, duration_min, is_booked)
  VALUES (?, ?, ?, ?)
`);

const now = new Date();
for (const dId of doctorIds) {
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    // weekdays only (Mon–Fri)
    const wd = day.getDay(); // 0 Sun ... 6 Sat
    if (wd === 0 || wd === 6) continue;

    for (let hour = 9; hour <= 16; hour++) {
      const slot = new Date(day);
      slot.setHours(hour, 0, 0, 0);
      const isBooked = Math.random() < 0.35 ? 1 : 0; // ~35% booked
      insSlot.run(dId, slot.toISOString(), 20, isBooked);
    }
  }
}

console.log("Seed complete: specialties, locations, doctors, appointment slots created.");