const API = "http://localhost:5173/api";

// --- Pagination state ---
const PAGE_SIZE = 7;    // max 7 Ärzte pro Seite
let currentPage = 1;    // aktuelle Seite (1-basiert)
let lastDoctors = [];   // zwischengespeicherte gesamte Ergebnisliste
let isLoggedIn = false; // wird von authUI gesetzt

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

// kleine Hilfsfunktion: ein Star als SVG
function starSVG(cls = "") {
  return `
    <svg class="star-svg ${cls}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z"/>
    </svg>`;
}

// avg = Durchschnitt (0..5); opts.clickable = Sterne als Buttons zurückgeben
function renderStars(avg = 0, opts = {}) {
  const max = 5;
  const a = Math.max(0, Math.min(max, Number(avg) || 0));
  const full = Math.floor(a + 1e-3); // Halfstars bewusst weggelassen für klare Optik
  const empty = max - full;

  if (opts.clickable) {
    return `<span class="stars" role="radiogroup" aria-label="Bewerten (1 bis 5 Sterne)">
      ${Array.from({ length: full }).map((_,i) =>
        `<button type="button" class="star-btn" data-score="${i+1}" aria-label="${i+1} Sterne">${starSVG('star-svg--full')}</button>`
      ).join('')}
      ${Array.from({ length: empty }).map((_,i) =>
        `<button type="button" class="star-btn" data-score="${full+i+1}" aria-label="${full+i+1} Sterne">${starSVG('star-svg--empty')}</button>`
      ).join('')}
    </span>`;
  }

  return `<span class="stars" aria-label="${a.toFixed(1)} von 5 Sternen">
    ${Array.from({ length: full }).map(() => starSVG('star-svg--full')).join('')}
    ${Array.from({ length: empty }).map(() => starSVG('star-svg--empty')).join('')}
  </span>`;
}

// ---- Slots grouped by day ----
function fmtDay(date){
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit'
  }).format(date);
}
function fmtTime(date){
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(date);
}
function groupSlotsByDay(slots){
  const map = new Map();
  for(const s of slots){
    const start = new Date(s.start_time || s.start || s.start_at);
    const key = start.toISOString().slice(0,10); // YYYY-MM-DD
    if(!map.has(key)) map.set(key, []);
    map.get(key).push({ ...s, _startDate: start });
  }
  map.forEach(list => list.sort((a,b)=> a._startDate - b._startDate));
  return Array.from(map.entries()).sort((a,b)=> new Date(a[0]) - new Date(b[0]));
}
function renderSlotsGrid(slots){
  const days = groupSlotsByDay(slots);
  if(!days.length) return `<p class="muted">Keine freien Termine gefunden.</p>`;
  let html = `<div class="slots-grid">`;
  for(const [iso, list] of days){
    const label = fmtDay(list[0]._startDate);
    html += `<div class="day">`+
            `<div class="day__head">🗓️ ${label}</div>`+
            `<div class="day__list">`;
    for(const s of list){
      const dur = s.duration_min || s.duration_minutes || s.duration || 20;
      const t = fmtTime(s._startDate);
      const disabled = s.is_booked || s.booked || s.unavailable ? 'disabled' : '';
      html += `<button class="slot" data-slot-id="${s.id}" ${disabled}>${t} (${dur}m)</button>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  return html;
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

  // Ratings-Stats für die aktuelle Seite laden
  let statsMap = {};
  try {
    const ids = pageSlice.map(x => x.id);
    if (ids.length) {
      const resp = await getJSON(`${API}/ratings/stats?ids=${ids.join(',')}`);
      const stats = resp && resp.stats ? resp.stats : [];
      statsMap = Object.fromEntries(stats.map(s => [s.doctor_id, s]));
    }
  } catch {}

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

    // Rating anzeigen + Formular (per Toggle)
    const stat = statsMap[d.id] || { avg_rating: 0, rating_count: 0 };
    const ratingHTML = `
      <div class="rating-row">
        ${renderStars(stat.avg_rating)}
        <span class="rating-count">(${stat.rating_count || 0})</span>
        <button class="rate-toggle" type="button">Bewerten</button>
      </div>
      <div class="rating-form" data-doc="${d.id}">
        ${renderStars(0, { clickable: true })}
        <textarea placeholder="Kommentar (optional)"></textarea>
        <button class="btn btn-primary btn-sm" type="button">Senden</button>
      </div>
    `;
    const nextEl = node.querySelector(".doctor__next");
    nextEl.insertAdjacentHTML("afterend", ratingHTML);

    const $form = $card.querySelector(`.rating-form[data-doc="${d.id}"]`);
    const $toggle = nextEl.parentElement.querySelector(".rate-toggle");

    // Toggle Formular anzeigen/verstecken
    $toggle.addEventListener("click", () => {
      $form.classList.toggle("show");
    });

    // Sternwahl im Formular
    let chosen = 0;
    $form.querySelectorAll(".star-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        chosen = Number(btn.dataset.score);
        $form.querySelectorAll(".star-svg").forEach((svg, idx) => {
          svg.classList.toggle("star-svg--full", idx < chosen);
          svg.classList.toggle("star-svg--empty", idx >= chosen);
        });
      });
    });

    // Bewertung senden
    $form.querySelector(".btn").addEventListener("click", async () => {
      if (!isLoggedIn){
        alert("Bitte logge dich ein, um zu bewerten.");
        location.href = "/login.html";
        return;
      }
      if (!chosen) { alert("Bitte Sterne auswählen (1–5)."); return; }
      const comment = $form.querySelector("textarea").value.trim();

      const r = await fetch(`${API}/doctors/${d.id}/ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: chosen, comment })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { alert(data.error || "Fehler bei der Bewertung"); return; }

      // Anzeige aktualisieren und Formular einklappen/entfernen
      const row = nextEl.parentElement.querySelector(".rating-row");
      row.innerHTML = `${renderStars(data.avg_rating)} <span class="rating-count">(${data.rating_count})</span> <button class="rate-toggle" type="button">Bewerten</button>`;
      $form.classList.remove("show");
      $form.remove();
    });

    // Slots anzeigen Button
    node.querySelector(".view-slots").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const $slots = $card.querySelector(".slots");

      // Wenn bereits geöffnet → schließen und abbrechen
      if (!$slots.classList.contains("hidden")) {
        $slots.classList.add("hidden");
        $slots.style.display = "none";
        btn.setAttribute("aria-expanded", "false");
        btn.textContent = "Termine anzeigen";
        return;
      }

      // Öffnen
      $slots.classList.remove("hidden");
      $slots.style.display = ""; // Standard wiederherstellen
      btn.setAttribute("aria-expanded", "true");
      btn.textContent = "Termine ausblenden";

      // Erstmaliges Laden
      if (!$slots.dataset.loaded){
        try {
          const list = await getJSON(`${API}/slots?doctor_id=${d.id}`);
          if (!list.length){
            $slots.innerHTML = `<em>Keine Termine gefunden.</em>`;
          } else {
            const gridHTML = renderSlotsGrid(list);
            $slots.innerHTML = gridHTML;

            // Re-bind booking click handlers on each slot button
            $slots.querySelectorAll('.slot').forEach((btnSlot) => {
              btnSlot.addEventListener('click', async () => {
                if (!isLoggedIn){
                  alert("Bitte logge dich ein, um einen Termin zu buchen.");
                  location.href = "/login.html";
                  return;
                }
                if (btnSlot.disabled) return;
                const id = btnSlot.dataset.slotId;
                const ok = confirm(`Diesen Termin buchen?\n${btnSlot.textContent}`);
                if (!ok) return;
                const r = await fetch(`${API}/book`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ slot_id: id })
                });
                if (r.ok){
                  btnSlot.disabled = true;
                  alert("Gebucht (Demo)!");
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

// --- Simulierte Auth (nur Frontend) ---
const AUTH_KEY = "qd_auth_state";
function getAuth(){
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || { loggedIn:false }; }
  catch { return { loggedIn:false }; }
}
function setAuth(state){ localStorage.setItem(AUTH_KEY, JSON.stringify(state)); }
function clearAuth(){ localStorage.removeItem(AUTH_KEY); }

function pickLoginEl(){
  return document.getElementById("loginLink")
      || document.getElementById("loginIconLink")
      || document.querySelector(".site-header__login a, a[href$='login.html']");
}
function pickLogoutEl(){
  return document.getElementById("logoutLink")
      || document.querySelector("a[data-logout]");
}

function updateAuthUI(){
  const auth = getAuth();
  isLoggedIn = !!auth.loggedIn;
  const $login = pickLoginEl();
  let $logout = pickLogoutEl();

  // Falls kein expliziter Logout-Link existiert, erzeugen wir einen neben dem Login-Link
  if (!$logout && $login && $login.parentElement){
    $logout = document.createElement("a");
    $logout.href = "#";
    $logout.textContent = "Logout";
    $logout.id = "logoutLink";
    $logout.className = $login.className || "btn btn-outline";
    $logout.style.marginLeft = "8px";
    $login.parentElement.appendChild($logout);
  }

  if (isLoggedIn){
    if ($login) $login.classList.add("hidden");
    if ($logout){
      $logout.classList.remove("hidden");
      $logout.onclick = (e)=>{ e.preventDefault(); clearAuth(); updateAuthUI(); };
    }
  } else {
    if ($logout) $logout.classList.add("hidden");
    if ($login){
      $login.classList.remove("hidden");
      $login.onclick = (e)=>{
        // Zu einer Login-Seite gehen, wenn vorhanden, sonst direkt simuliert einloggen
        if (document.getElementById("loginForm")) return; // auf login.html übernimmt das Formular
        e.preventDefault();
        setAuth({ loggedIn:true, email:"demo@quickdoc.example" });
        alert("Eingeloggt (Demo)");
        updateAuthUI();
      };
    }
  }
}

// Falls eine Login-Seite mit Formular existiert, Submission abfangen und simulieren
(function wireLoginForm(){
  const form = document.getElementById("loginForm");
  if (!form) { updateAuthUI(); return; }
  form.addEventListener("submit", (e)=>{
    e.preventDefault();
    const email = (form.querySelector("input[type='email']") || {}).value || "user@example.com";
    setAuth({ loggedIn:true, email });
    alert("Login erfolgreich (Demo)");
    location.href = "/index.html"; // zurück zur Suche
  });
  updateAuthUI();
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
