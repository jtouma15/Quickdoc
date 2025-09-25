const API = "http://localhost:5173/api";

// --- Pagination state ---
const PAGE_SIZE = 7;    // max 7 Ärzte pro Seite
let currentPage = 1;    // aktuelle Seite (1-basiert)
let lastDoctors = [];   // zwischengespeicherte gesamte Ergebnisliste

const $specialty = document.getElementById("specialtySelect");
const $city = document.getElementById("citySelect");
const $name = document.getElementById("nameInput");
const $search = document.getElementById("searchBtn");
const $results = document.getElementById("results");
const tpl = document.getElementById("doctor-card");

async function getJSON(url){
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

async function loadFilters(){
  const [specs, cities] = await Promise.all([
    getJSON(`${API}/specialties`),
    getJSON(`${API}/cities`)
  ]);
  specs.forEach(s => {
    const o = document.createElement("option");
    o.value = s.id; o.textContent = s.name;
    $specialty.appendChild(o);
  });
  cities.forEach(c => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    $city.appendChild(o);
  });
}

function formatDate(iso){
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday:"short", day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function renderPagination(page, totalPages) {
  let pager = document.getElementById("pager");
  if (!pager) {
    pager = document.createElement("div");
    pager.id = "pager";
    pager.className = "container";
    $results.after(pager);
  }
  if (totalPages <= 1) { pager.innerHTML = ""; return; }

  pager.innerHTML = `
    <div class="card" style="display:flex; gap:10px; align-items:center; justify-content:flex-end;">
      <button class="btn btn-outline" id="prevPage">Zurück</button>
      <span>Seite ${page} / ${totalPages}</span>
      <button class="btn btn-outline" id="nextPage">Weiter</button>
    </div>`;

  const prev = document.getElementById("prevPage");
  const next = document.getElementById("nextPage");
  prev.disabled = page <= 1;
  next.disabled = page >= totalPages;
  prev.addEventListener("click", () => { if (currentPage > 1) { currentPage--; renderDoctors(); } });
  next.addEventListener("click", () => { if (currentPage < totalPages) { currentPage++; renderDoctors(); } });
}

async function renderDoctors(){
  const params = new URLSearchParams();
  if ($specialty.value) params.set("specialty_id", $specialty.value);
  if ($city.value) params.set("city", $city.value);
  if ($name.value.trim()) params.set("q", $name.value.trim());

  const doctors = await getJSON(`${API}/doctors?${params.toString()}`);
  lastDoctors = doctors; // gesamten Satz merken

  // Paging berechnen
  const totalPages = Math.max(1, Math.ceil(doctors.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageSlice = doctors.slice(start, start + PAGE_SIZE);

  // Ergebnisse rendern
  $results.innerHTML = "";
  if (!pageSlice.length) {
    $results.innerHTML = `<div class="card">Keine Treffer – ändere Filter.</div>`;
    renderPagination(0, 0);
    return;
  }

  for (const d of pageSlice){
    const node = tpl.content.cloneNode(true);
    const $card = node.querySelector(".doctor");
    $card.dataset.id = d.id;

    node.querySelector(".doctor__title").textContent = `Dr. ${d.first_name} ${d.last_name}`;
    node.querySelector(".doctor__subtitle").textContent = d.specialty;
    node.querySelector(".doctor__meta").textContent = `${d.email} · ${d.phone}`;

    // Nächsten freien Slot laden
    getJSON(`${API}/doctors/${d.id}/nextSlot`).then(next => {
      node.querySelector(".doctor__next").textContent = next
        ? `Nächster freier Termin: ${formatDate(next.start_time)}`
        : "Kein freier Termin in den nächsten 14 Tagen";
    }).catch(()=>{
      node.querySelector(".doctor__next").textContent = "Keine Slot-Info verfügbar";
    });

    // Standorte laden
    getJSON(`${API}/doctors/${d.id}/locations`).then(locs => {
      const meta = node.querySelector(".doctor__meta");
      if (Array.isArray(locs) && locs.length){
        meta.textContent += ` · ${locs.map(l => `${l.city} (${l.zip})`).join(", ")}`;
      }
    }).catch(()=>{});

    // Slots anzeigen Button
    node.querySelector(".view-slots").addEventListener("click", async () => {
      const $slots = $card.querySelector(".slots");
      $slots.classList.toggle("hidden");
      if (!$slots.dataset.loaded){
        try {
          const list = await getJSON(`${API}/slots?doctor_id=${d.id}`);
          if (!list.length){
            $slots.innerHTML = `<em>Keine Termine gefunden.</em>`;
          } else {
            $slots.innerHTML = "";
            list.forEach(s => {
              const btn = document.createElement("button");
              btn.className = "slot-btn";
              btn.textContent = `${formatDate(s.start_time)} (${s.duration_min}m)`;
              btn.disabled = !!s.is_booked;
              btn.addEventListener("click", async () => {
                const ok = confirm(`Diesen Termin buchen?\n${btn.textContent}`);
                if (!ok) return;
                const r = await fetch(`${API}/book`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ slot_id: s.id })
                });
                if (r.ok){
                  btn.disabled = true;
                  alert("Gebucht (Demo)!");
                  // next slot text aktualisieren
                  const next = await getJSON(`${API}/doctors/${d.id}/nextSlot`);
                  $card.querySelector(".doctor__next").textContent = next
                    ? `Nächster freier Termin: ${formatDate(next.start_time)}`
                    : "Kein freier Termin in den nächsten 14 Tagen";
                } else {
                  let errMsg = "Unbekannter Fehler";
                  try { const { error } = await r.json(); if (error) errMsg = error; } catch {}
                  alert(`Fehler: ${errMsg}`);
                }
              });
              $slots.appendChild(btn);
            });
          }
          $slots.dataset.loaded = "1";
        } catch {
          $slots.innerHTML = `<em>Fehler beim Laden der Termine.</em>`;
        }
      }
    });

    $results.appendChild(node);
  }

  // Pager am Ende rendern
  renderPagination(currentPage, totalPages);
}

// Footer + legal dialogs
(() => {
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
  const prv = document.getElementById("openPrivacy");
  const dPrv = document.getElementById("privacyDialog");
  if (prv && dPrv) prv.addEventListener("click", (e)=>{ e.preventDefault(); dPrv.showModal(); });
})();

// Suche-Button → auf Seite 1 springen
$search.addEventListener("click", () => { currentPage = 1; renderDoctors(); });

// Enter im Namensfeld → auf Seite 1 springen + suchen
$name.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    currentPage = 1;
    renderDoctors();
  }
});

// Initialisierung
(async function init(){
  await loadFilters();
  await renderDoctors();
})();
