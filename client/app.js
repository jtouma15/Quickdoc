const API = "http://localhost:5173/api";

const CITY_STREET_POOL = {
  hamburg: ["Elbchaussee", "Alsterufer", "Binnenfeldredder", "Feldbrunnenstraße", "Dammtorstraße", "Glashüttenstraße", "Neuer Wall", "Palmaille"],
  berlin: ["Unter den Linden", "Karl-Marx-Allee", "Torstraße", "Auguststraße", "Schönhauser Allee", "Friedrichstraße", "Invalidenstraße", "Gneisenaustraße"],
  münchen: ["Residenzstraße", "Ludwigstraße", "Maximilianstraße", "Theresienstraße", "Sendlinger Straße", "Brienner Straße", "Gabelsbergerstraße", "Altstadtring"],
  köln: ["Eigelstein", "Neumarkt", "Hahnenstraße", "Breite Straße", "Ehrenstraße", "Aachener Straße", "Brüsseler Straße", "Luxemburger Straße"],
  frankfurt: ["Goethestraße", "Kaiserstraße", "Schillerstraße", "Hanauer Landstraße", "Fahrgasse", "Leipziger Straße", "Domstraße", "Schweizer Straße"],
  stuttgart: ["Marienstraße", "Bolzstraße", "Thouretstraße", "Dorotheenstraße", "Friedrichstraße", "Eberhardstraße", "Theodor-Heuss-Straße", "Tübinger Straße"],
  düsseldorf: ["Schadowstraße", "Kaiserstraße", "Köhlstraße", "Benrather Straße", "Bastionsstraße", "Bismarckstraße", "Breite Straße", "Ratinger Straße"],
  leipzig: ["Petersstraße", "Nikolaistraße", "Grimmaische Straße", "Augustusplatz", "Gottschedstraße", "Hainstraße", "Windmühlenstraße", "Lindenauer Markt"]
};
const FALLBACK_STREETS = ["Hauptstraße", "Ringstraße", "Gartenweg", "Bahnhofstraße", "Schillerweg", "Goethestraße"];
const cityStreetCounters = new Map();
const doctorAddressOverrides = new Map(); // doctorId -> Map(addressKey -> override)

function nextStreetForCity(cityName = "") {
  const key = cityName.trim().toLowerCase() || "default";
  const pool = CITY_STREET_POOL[key] || FALLBACK_STREETS;
  const currentIndex = cityStreetCounters.get(key) || 0;
  cityStreetCounters.set(key, currentIndex + 1);
  const base = pool[currentIndex % pool.length];
  const cycle = Math.floor(currentIndex / pool.length);
  const number = 8 + cycle * 4;
  return `${base} ${number}`;
}

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

function parseAddresses(raw, opts = {}){
  const { preferredCity = "", doctorId = null } = opts || {};
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const normalized = arr
      .filter(Boolean)
      .map(addr => ({
        street: addr.street || "",
        city: addr.city || "",
        zip: addr.zip || ""
      }))
      .filter(addr => addr.street || addr.city || addr.zip);

    if (!normalized.length) return [];

    const wantedCity = preferredCity.trim().toLowerCase();
    const source = wantedCity
      ? normalized.filter(addr => (addr.city || "").trim().toLowerCase() === wantedCity)
      : normalized;

    const deduped = [];
    const seen = new Set();
    for (const addr of (source.length ? source : normalized)) {
      const key = `${addr.street}|${addr.zip}|${addr.city}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(addr);
      }
    }

    if (!doctorId) return deduped;

    const docIdKey = Number(doctorId);
    let docMap = doctorAddressOverrides.get(docIdKey);
    if (!docMap) {
      docMap = new Map();
      doctorAddressOverrides.set(docIdKey, docMap);
    }

    const ensureOverride = (loc) => {
      const baseCity = (loc.city || preferredCity || "").trim();
      const key = [
        baseCity.toLowerCase(),
        (loc.zip || "").trim(),
        (loc.street || "").trim().toLowerCase()
      ].join("|");
      if (!docMap.has(key)) {
        const streetName = nextStreetForCity(baseCity);
        docMap.set(key, {
          street: streetName || loc.street || "Hauptstraße 1",
          city: loc.city || preferredCity || "",
          zip: loc.zip || ""
        });
      }
      return docMap.get(key);
    };

    normalized.forEach(ensureOverride);

    const subset = deduped.map(ensureOverride);
    return subset;
  } catch {
    return [];
  }
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
      html += `<button class="slot" data-slot-id="${s.id}" data-start="${s._startDate.toISOString()}" data-duration="${dur}" ${disabled}>${t} (${dur}m)</button>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  return html;
}

function setStarSelection(buttons, selected){
  buttons.forEach(btn => {
    const svg = btn.querySelector(".star-svg");
    if (!svg) return;
    const score = Number(btn.dataset.score) || 0;
    const isActive = score <= selected && selected > 0;
    if (isActive){
      svg.classList.add("star-svg--full");
      svg.classList.remove("star-svg--empty");
    } else {
      svg.classList.remove("star-svg--full");
      svg.classList.add("star-svg--empty");
    }
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function renderRatingComments(container, ratings){
  if (!container) return;
  if (!Array.isArray(ratings) || !ratings.length){
    container.innerHTML = `<p class="rating-empty muted">Noch keine Bewertungen</p>`;
    return;
  }
  container.innerHTML = "";
  ratings.forEach(r => {
    const item = document.createElement("article");
    item.className = "rating-comment";

    const header = document.createElement("div");
    header.className = "rating-comment__header";

    const author = document.createElement("strong");
    author.className = "rating-comment__author";
    const name = (r.author_name || "").toString().trim();
    author.textContent = name || "Anonym";

    const stars = document.createElement("span");
    stars.className = "rating-comment__stars";
    stars.innerHTML = renderStars(Number(r.score) || 0);

    header.append(author, stars);

    const created = r.created_at ? new Date(r.created_at) : null;
    if (created && !Number.isNaN(created.valueOf())){
      const time = document.createElement("time");
      time.className = "rating-comment__time";
      time.dateTime = created.toISOString();
      time.textContent = created.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
      header.appendChild(time);
    }

    item.appendChild(header);

    if (r.comment){
      const body = document.createElement("p");
      body.className = "rating-comment__text";
      body.textContent = r.comment;
      item.appendChild(body);
    }

    container.appendChild(item);
  });
}

async function loadDoctorRatings(doctorId, refs){
  const { starsSpan, countSpan, comments } = refs;
  if (comments){
    comments.innerHTML = `<p class="rating-empty muted">Bewertungen werden geladen …</p>`;
  }
  try{
    const data = await getJSON(`${API}/doctors/${doctorId}/ratings`);
    const avg = Number(data.avg_rating) || 0;
    const count = Number(data.rating_count) || 0;
    if (starsSpan) starsSpan.innerHTML = renderStars(avg);
    if (countSpan) countSpan.textContent = `(${count})`;
    renderRatingComments(comments, Array.isArray(data.ratings) ? data.ratings : []);
  } catch {
    if (comments){
      comments.innerHTML = `<p class="rating-error">Bewertungen konnten nicht geladen werden.</p>`;
    }
  }
}

function resolveAuthorName(){
  try{
    const auth = getAuth();
    if (auth && typeof auth.name === "string"){
      const trimmed = auth.name.trim();
      if (trimmed) return trimmed;
    }
    if (auth && typeof auth.email === "string"){
      const base = auth.email.split("@")[0] || "";
      const normalized = base.replace(/\./g, " ").trim();
      if (normalized){
        return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
  } catch {}
  return "QuickDoc Nutzer:in";
}

function initRatingSection($card, doctor, initialStat = {}){
  const container = $card.querySelector(".doctor__ratings");
  if (!container) return;

  container.innerHTML = "";

  const ratingRow = document.createElement("div");
  ratingRow.className = "rating-row";
  const starsSpan = document.createElement("span");
  starsSpan.className = "rating-stars";
  starsSpan.innerHTML = renderStars(Number(initialStat.avg_rating) || 0);
  const countSpan = document.createElement("span");
  countSpan.className = "rating-count";
  countSpan.textContent = `(${initialStat.rating_count || 0})`;
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "rate-toggle";
  toggleBtn.textContent = "Bewerten";
  toggleBtn.setAttribute("aria-expanded", "false");
  ratingRow.append(starsSpan, countSpan);

  const form = document.createElement("div");
  form.className = "rating-form";
  form.innerHTML = `
    ${renderStars(0, { clickable: true })}
    <textarea placeholder="Kommentar (optional)"></textarea>
    <button class="btn btn-primary btn-sm" type="button">Senden</button>
  `;
  form.hidden = true;
  form.setAttribute("aria-label", "Bewertung abgeben");

  const commentsToggle = document.createElement("button");
  commentsToggle.type = "button";
  commentsToggle.className = "ratings-toggle";
  commentsToggle.textContent = "Bewertungen anzeigen";
  commentsToggle.setAttribute("aria-expanded", "false");

  const commentsWrapper = document.createElement("div");
  commentsWrapper.className = "rating-comments-wrapper collapsed";

  const comments = document.createElement("div");
  comments.className = "rating-comments";
  comments.setAttribute("aria-live", "polite");
  comments.innerHTML = `<p class="rating-empty muted">Bewertungen werden geladen …</p>`;

  commentsWrapper.append(comments);

  ratingRow.append(commentsToggle);
  ratingRow.append(toggleBtn);

  container.append(ratingRow, form, commentsWrapper);

  const starButtons = Array.from(form.querySelectorAll(".star-btn"));
  const submitBtn = form.querySelector(".btn");
  const commentInput = form.querySelector("textarea");
  let chosen = 0;

  setStarSelection(starButtons, chosen);

  if (commentInput){
    commentInput.setAttribute("maxlength", "500");
    commentInput.rows = 2;
  }

  starButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      chosen = Number(btn.dataset.score) || 0;
      setStarSelection(starButtons, chosen);
    });
  });

  toggleBtn.addEventListener("click", () => {
    const willOpen = form.hidden;
    if (willOpen){
      form.hidden = false;
      form.classList.add("show");
      toggleBtn.textContent = "Abbrechen";
      if (commentInput){
        try {
          commentInput.focus({ preventScroll: true });
        } catch {
          commentInput.focus();
        }
      }
      toggleBtn.setAttribute("aria-expanded", "true");
    } else {
      form.classList.remove("show");
      form.hidden = true;
      toggleBtn.textContent = "Bewerten";
      toggleBtn.setAttribute("aria-expanded", "false");
    }
  });

  submitBtn.addEventListener("click", async () => {
    if (!isLoggedIn){
      alert("Bitte logge dich ein, um zu bewerten.");
      location.href = "/login.html";
      return;
    }
    if (!chosen){
      alert("Bitte Sterne auswählen (1–5).");
      return;
    }
    const comment = commentInput.value.trim();
    const authorName = resolveAuthorName();
    submitBtn.disabled = true;
    submitBtn.textContent = "Senden…";
    try{
      const response = await fetch(`${API}/doctors/${doctor.id}/ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: chosen, comment, authorName })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error){
        throw new Error(data.error || "Fehler bei der Bewertung");
      }
      chosen = 0;
      setStarSelection(starButtons, 0);
      commentInput.value = "";
      form.classList.remove("show");
      form.hidden = true;
      toggleBtn.textContent = "Bewerten";
      toggleBtn.setAttribute("aria-expanded", "false");
      if (starsSpan && data.avg_rating !== undefined){
        starsSpan.innerHTML = renderStars(Number(data.avg_rating) || 0);
      }
      if (countSpan && data.rating_count !== undefined){
        countSpan.textContent = `(${data.rating_count || 0})`;
      }
      await loadDoctorRatings(doctor.id, { starsSpan, countSpan, comments });
      if (commentsWrapper.classList.contains("collapsed")){
        commentsWrapper.classList.remove("collapsed");
        commentsToggle.textContent = "Bewertungen verbergen";
        commentsToggle.setAttribute("aria-expanded", "true");
      }
    } catch (err){
      alert(err.message || "Fehler bei der Bewertung");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Senden";
    }
  });

  commentsToggle.addEventListener("click", () => {
    const isCollapsed = commentsWrapper.classList.contains("collapsed");
    if (isCollapsed){
      commentsWrapper.classList.remove("collapsed");
      commentsToggle.textContent = "Bewertungen verbergen";
      commentsToggle.setAttribute("aria-expanded", "true");
    } else {
      commentsWrapper.classList.add("collapsed");
      commentsToggle.textContent = "Bewertungen anzeigen";
      commentsToggle.setAttribute("aria-expanded", "false");
    }
  });

  loadDoctorRatings(doctor.id, { starsSpan, countSpan, comments });
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

  const activeCityFilter = ($city.value || "").trim();

  for (const d of pageSlice){
    const node = tpl.content.cloneNode(true);
    const $card = node.querySelector(".doctor");
    $card.dataset.id = d.id;

    node.querySelector(".doctor__title").textContent = `Dr. ${d.first_name} ${d.last_name}`;
    node.querySelector(".doctor__subtitle").textContent = d.specialty;

    const emailLink = node.querySelector(".doctor__email");
    if (emailLink){
      emailLink.textContent = d.email || "Keine E-Mail hinterlegt";
      if (d.email){
        emailLink.href = `mailto:${d.email}`;
      } else {
        emailLink.removeAttribute("href");
      }
    }

    const phoneLink = node.querySelector(".doctor__phone");
    if (phoneLink){
      const cleanPhone = (d.phone || "").trim();
      if (cleanPhone){
        const telHref = cleanPhone.replace(/[^+\d]/g, "");
        phoneLink.textContent = cleanPhone;
        phoneLink.href = `tel:${telHref}`;
      } else {
        phoneLink.textContent = "Keine Telefonnummer hinterlegt";
        phoneLink.removeAttribute("href");
      }
    }

    const list = node.querySelector(".doctor__addresses");
    if (list){
      list.innerHTML = "";
      const addresses = parseAddresses(d.addresses, { preferredCity: activeCityFilter, doctorId: d.id });
      if (addresses.length){
        addresses.forEach(loc => {
          const li = document.createElement("li");
          li.className = "doctor__address";
          const street = document.createElement("span");
          street.className = "doctor__address-street";
          street.textContent = loc.street || "Adresse unbekannt";
          const city = document.createElement("span");
          city.className = "doctor__address-city";
          city.textContent = `${loc.zip || ""} ${loc.city || ""}`.trim();
          li.appendChild(street);
          li.appendChild(city);
          list.appendChild(li);
        });
      } else {
        const li = document.createElement("li");
        li.className = "doctor__address";
        li.textContent = "Keine Praxisadresse hinterlegt";
        list.appendChild(li);
      }
    }

    // Nächsten freien Slot laden
    getJSON(`${API}/doctors/${d.id}/nextSlot`).then(next => {
      node.querySelector(".doctor__next").textContent = next
        ? `Nächster freier Termin: ${formatDate(next.start_time)}`
        : "Kein freier Termin in den nächsten 14 Tagen";
    }).catch(()=>{
      node.querySelector(".doctor__next").textContent = "Keine Slot-Info verfügbar";
    });

    const ratingStat = statsMap[d.id] || { avg_rating: 0, rating_count: 0 };
    initRatingSection($card, d, ratingStat);

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
                const startIso = btnSlot.dataset.start;
                const durationMin = Number(btnSlot.dataset.duration) || 20;
                const doctorName = `Dr. ${d.first_name} ${d.last_name}`;
                const ok = confirm(`Diesen Termin buchen?\n${btnSlot.textContent}`);
                if (!ok) return;
                const r = await fetch(`${API}/book`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ slot_id: id })
                });
                if (r.ok){
                  sessionStorage.setItem("qd_last_booking", JSON.stringify({
                    doctorId: d.id,
                    doctorName,
                    startTime: startIso,
                    durationMin
                  }));
                  location.href = "/booking.html";
                  return;
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

function pickLoginEl(){
  return document.getElementById("loginLink")
      || document.getElementById("loginIconLink")
      || document.getElementById("loginButton")
      || document.querySelector(".site-header__login a")
      || document.querySelector("a[href$='login.html']");
}
function pickLogoutEl(){
  return document.querySelector("[data-qd-logout]")
      || document.getElementById("logoutLink")
      || document.querySelector("a[data-logout]");
}

function fallbackSyncUI(){
  const auth = fallbackAuth.getAuth();
  const loggedIn = !!auth.loggedIn;
  isLoggedIn = loggedIn;
  const loginEl = pickLoginEl();
  let logoutEl = pickLogoutEl();

  if (!logoutEl && loginEl && loginEl.parentElement){
    logoutEl = document.createElement("a");
    logoutEl.href = "#";
    logoutEl.textContent = "Logout";
    logoutEl.dataset.qdLogout = "true";
    logoutEl.className = loginEl.className || "btn btn-outline";
    logoutEl.style.marginLeft = logoutEl.style.marginLeft || "8px";
    loginEl.parentElement.appendChild(logoutEl);
  }

  if (loggedIn){
    if (loginEl){
      loginEl.classList.add("hidden");
      loginEl.setAttribute("hidden", "");
      loginEl.onclick = null;
    }
    if (logoutEl){
      logoutEl.classList.remove("hidden");
      logoutEl.removeAttribute("hidden");
      logoutEl.onclick = (ev)=>{ ev.preventDefault(); fallbackAuth.clearAuth(); };
    }
  } else {
    if (logoutEl){
      logoutEl.classList.add("hidden");
      logoutEl.setAttribute("hidden", "");
      logoutEl.onclick = null;
    }
    if (loginEl){
      loginEl.classList.remove("hidden");
      loginEl.removeAttribute("hidden");
      loginEl.onclick = (ev)=>{
        if (document.getElementById("loginForm")) return;
        ev.preventDefault();
        fallbackAuth.setAuth({ loggedIn:true, email:"demo@quickdoc.example" });
        alert("Eingeloggt (Demo)");
      };
    }
  }
}

const fallbackAuth = {
  getAuth(){
    try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || { loggedIn:false }; }
    catch { return { loggedIn:false }; }
  },
  setAuth(state){
    localStorage.setItem(AUTH_KEY, JSON.stringify(state));
    fallbackSyncUI();
  },
  clearAuth(){
    localStorage.removeItem(AUTH_KEY);
    fallbackSyncUI();
  },
  syncUI: fallbackSyncUI
};

const authService = {
  get: window.qdAuth?.getAuth || fallbackAuth.getAuth,
  set: window.qdAuth?.setAuth || fallbackAuth.setAuth,
  clear: window.qdAuth?.clearAuth || fallbackAuth.clearAuth,
  sync: window.qdAuth?.syncUI || fallbackAuth.syncUI
};

function getAuth(){
  return authService.get();
}
function setAuth(state){
  authService.set(state);
  isLoggedIn = !!(state && state.loggedIn);
}
function clearAuth(){
  authService.clear();
  isLoggedIn = false;
}

function updateAuthUI(){
  const auth = getAuth();
  isLoggedIn = !!auth.loggedIn;
  authService.sync();
}

// Falls eine Login-Seite mit Formular existiert, Submission abfangen und simulieren
(function wireLoginForm(){
  const form = document.getElementById("loginForm");
  if (!form) { updateAuthUI(); return; }
  form.addEventListener("submit", (e)=>{
    e.preventDefault();
    const email = (form.querySelector("input[type='email']") || {}).value || "user@example.com";
    const profile = window.qdAuth?.lookupProfile ? window.qdAuth.lookupProfile(email) : null;
    const fallbackName = (email.split("@")[0] || "Patient:in").replace(/\./g, " ");
    const name = profile?.name || fallbackName;
    if (window.qdAuth?.rememberProfile){
      window.qdAuth.rememberProfile(email, { email, name });
    }
    setAuth({ loggedIn:true, email, name });
    alert("Login erfolgreich (Demo)");
    location.href = "/index.html"; // zurück zur Suche
  });
  updateAuthUI();
})();

// Suche-Button → auf Seite 1 springen
if ($search){
  $search.addEventListener("click", () => { currentPage = 1; renderDoctors(); });
}

// Enter im Namensfeld → auf Seite 1 springen + suchen
if ($name){
  $name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      currentPage = 1;
      renderDoctors();
    }
  });
}

// Initialisierung
(async function init(){
  if ($specialty && $city && $results && tpl){
    await loadFilters();
    await renderDoctors();
  } else {
    updateAuthUI();
  }
})();
