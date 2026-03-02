// Drinking in the Sun — GitHub Pages PWA
// CSV sun spots calibrated for 2026-08-15; we adjust to chosen date via sun-position matching.
// Weather uses next hour only (Open-Meteo).

const CONFIG = {
  DATA_URL: "./public/data/sunspots.csv",
  BASE_CAL_DATE: "2026-08-15",
  DEFAULT_CENTER: { lat: 52.9548, lon: -1.1581 }, // Nottingham
  MAX_RESULTS_RAIL: 50
};

/* -------------------------- Small utilities -------------------------- */
const $ = (id) => document.getElementById(id);

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
function pad2(n){ return String(n).padStart(2,"0"); }
function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function toLocalTimeBadge(){
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function minutesToHHMM(min){
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}
function hhmmToMinutes(hhmm){
  const [h,m] = hhmm.split(":").map(Number);
  return h*60 + m;
}

// Haversine km
function distKm(aLat,aLon,bLat,bLon){
  const R = 6371;
  const dLat = (bLat-aLat) * Math.PI/180;
  const dLon = (bLon-aLon) * Math.PI/180;
  const s1 = Math.sin(dLat/2);
  const s2 = Math.sin(dLon/2);
  const aa = s1*s1 + Math.cos(aLat*Math.PI/180)*Math.cos(bLat*Math.PI/180)*s2*s2;
  return 2*R*Math.asin(Math.sqrt(aa));
}

/* -------------------------- CSV parsing -------------------------- */
function parseCSV(text){
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;

  while (i < text.length){
    const c = text[i];

    if (c === '"'){
      if (inQuotes && text[i+1] === '"'){ field += '"'; i += 2; continue; }
      inQuotes = !inQuotes; i++; continue;
    }
    if (!inQuotes && (c === "," || c === "\n" || c === "\r")){
      if (c === "\r" && text[i+1] === "\n"){ i++; }
      row.push(field.trim());
      field = "";
      if (c === "\n" || c === "\r"){
        if (row.some(x => x.length)) rows.push(row);
        row = [];
      }
      i++; continue;
    }

    field += c;
    i++;
  }
  row.push(field.trim());
  if (row.some(x => x.length)) rows.push(row);

  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  const data = rows.slice(1).map(r => {
    const o = {};
    header.forEach((h, idx) => o[h] = (r[idx] ?? "").trim());
    return o;
  });
  return data;
}

function pick(obj, keys){
  for (const k of keys){
    if (obj[k] != null && String(obj[k]).trim() !== "") return String(obj[k]).trim();
  }
  return "";
}
function toNum(x){
  const n = Number(String(x).replace(/[^\d\.\-]/g,""));
  return Number.isFinite(n) ? n : null;
}

/* -------------------------- Sun position + adjustment -------------------------- */
// Minimal SunCalc-style math (no dependencies)
const RAD = Math.PI / 180;

function toJulian(date) { return date.valueOf() / 86400000 - 0.5 + 2440588; }
function toDays(date) { return toJulian(date) - 2451545; }

function rightAscension(l, b) {
  const e = RAD * 23.4397;
  return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
}
function declination(l, b) {
  const e = RAD * 23.4397;
  return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
}
function solarMeanAnomaly(d) { return RAD * (357.5291 + 0.98560028 * d); }
function eclipticLongitude(M) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return M + C + P + Math.PI;
}
function sunCoords(d) {
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}
function siderealTime(d, lw) { return RAD * (280.16 + 360.9856235 * d) - lw; }

function sunPosition(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const c = sunCoords(d);
  const H = siderealTime(d, lw) - c.ra;

  const az = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi)
  );
  const alt = Math.asin(
    Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H)
  );
  return { az, alt };
}

function wrapPi(x) {
  x = (x + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
}

function bestMinuteForTarget(lat, lon, dateISO, targetAz, targetAlt) {
  const day0 = new Date(`${dateISO}T00:00:00`);
  let bestMinute = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let m = 0; m < 1440; m++) {
    const t = new Date(day0.getTime() + m * 60000);
    const { az, alt } = sunPosition(t, lat, lon);
    if (alt <= 0) continue; // ignore sun below horizon

    const da = wrapPi(az - targetAz);
    const dh = alt - targetAlt;
    const score = da * da + dh * dh;

    if (score < bestScore) {
      bestScore = score;
      bestMinute = m;
    }
  }
  return { minute: bestMinute, score: bestScore };
}

function adjustWindowToDate(spot, targetDateISO) {
  const baseDateISO = spot.baseDateISO || CONFIG.BASE_CAL_DATE;
  const baseDay0 = new Date(`${baseDateISO}T00:00:00`);

  const sMin = hhmmToMinutes(spot.baseStart);
  const eMin = hhmmToMinutes(spot.baseEnd);

  const baseStartDate = new Date(baseDay0.getTime() + sMin * 60000);
  const baseEndDate = new Date(baseDay0.getTime() + eMin * 60000);

  const startPos = sunPosition(baseStartDate, spot.lat, spot.lon);
  const endPos = sunPosition(baseEndDate, spot.lat, spot.lon);

  const sMatch = bestMinuteForTarget(spot.lat, spot.lon, targetDateISO, startPos.az, startPos.alt);
  const eMatch = bestMinuteForTarget(spot.lat, spot.lon, targetDateISO, endPos.az, endPos.alt);

  if (sMatch.minute == null || eMatch.minute == null) return null;

  let s = sMatch.minute;
  let e = eMatch.minute;
  if (e <= s) return null;

  return {
    startMin: s,
    endMin: e,
    confidence: sMatch.score + eMatch.score
  };
}

// overlap minutes between [aStart,aEnd] and [bStart,bEnd]
function overlapMinutes(aStart, aEnd, bStart, bEnd){
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return Math.max(0, e - s);
}

// sun % for "next hour starting at startMin"
function sunPercentForNextHour(window, startMin){
  const hourEnd = startMin + 60;
  const ov = overlapMinutes(startMin, hourEnd, window.startMin, window.endMin);
  return clamp(Math.round((ov / 60) * 100), 0, 100);
}

/* -------------------------- Weather (next hour only) -------------------------- */
function wmoIcon(code){
  // simple icon set
  const sunSvg = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3a1 1 0 0 1 1 1v1.1a7 7 0 0 1 5.9 5.9H20a1 1 0 1 1 0 2h-1.1A7 7 0 0 1 13 18.9V20a1 1 0 1 1-2 0v-1.1A7 7 0 0 1 5.1 13H4a1 1 0 1 1 0-2h1.1A7 7 0 0 1 11 5.1V4a1 1 0 0 1 1-1Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" fill="currentColor"/></svg>`;
  const cloudSvg = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.2 12 3.5 3.5 0 0 0 7 18Z" fill="currentColor"/></svg>`;
  const rainSvg = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 16h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.2 10 3.5 3.5 0 0 0 7 16Zm2 5 1-3m4 3 1-3m4 3 1-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const boltSvg = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M13 2 3 14h7l-1 8 12-14h-7l-1-6Z" fill="currentColor"/></svg>`;

  if (code == null) return cloudSvg;

  // WMO groups
  if (code === 0) return sunSvg;
  if ([1,2].includes(code)) return sunSvg;
  if (code === 3) return cloudSvg;
  if ([45,48].includes(code)) return cloudSvg;
  if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return rainSvg;
  if ([71,73,75,77,85,86].includes(code)) return cloudSvg;
  if ([95,96,99].includes(code)) return boltSvg;

  return cloudSvg;
}

async function fetchNextHourWeather(lat, lon) {
  const url =
    "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`
    + "&hourly=weather_code,temperature_2m,precipitation_probability,precipitation,wind_speed_10m"
    + "&forecast_hours=2"
    + "&timezone=auto";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`);
  const data = await res.json();

  const now = new Date();
  const times = data.hourly.time || [];
  let i = times.findIndex(t => new Date(t) > now);
  if (i < 0) i = 0;

  return {
    time: times[i],
    weather_code: data.hourly.weather_code?.[i],
    temp_c: data.hourly.temperature_2m?.[i],
    wind_kmh: data.hourly.wind_speed_10m?.[i],
    precip_mm: data.hourly.precipitation?.[i],
    precip_prob: data.hourly.precipitation_probability?.[i]
  };
}

/* -------------------------- App state -------------------------- */
let rawRows = [];
let spots = []; // normalized
let userLoc = null;
let filters = {
  types: new Set(),
  maxKm: 10,
  sort: "sun" // "sun" | "dist"
};
let favorites = new Set(JSON.parse(localStorage.getItem("dits_favs") || "[]"));

let selectedDateISO = todayISO();
let selectedTimeMin = 900; // 15:00

// Map
let map = null;
let mapMarkers = [];
let mapReady = false;
let lastMapSpots = [];

// Detail
let currentDetailSpot = null;

/* -------------------------- Normalization -------------------------- */
function normalizeRows(rows){
  const out = [];

  for (const r of rows){
    const name = pick(r, ["pub_name","Pub","pub","name","Name","venue","Venue"]);
    const address = pick(r, ["address","Address","location","Location","street","Street"]);
    const postcode = pick(r, ["postcode","Postcode","post_code","Post Code","zip","Zip"]);
    const spotName = pick(r, ["spot_name","Spot","spot","sun_spot","SunSpot","area_name"]);
    const spotType = pick(r, ["spot_type","Type","type","category","Category"]);

    const lat = toNum(pick(r, ["lat","Lat","latitude","Latitude"]));
    const lon = toNum(pick(r, ["lon","Lon","lng","Lng","longitude","Longitude"]));

    const baseStart = pick(r, ["base_start","BaseStart","start","Start","start_time","StartTime","baseStart"]);
    const baseEnd   = pick(r, ["base_end","BaseEnd","end","End","end_time","EndTime","baseEnd"]);
    const baseDateISO = pick(r, ["base_date","BaseDate","baseDateISO"]) || CONFIG.BASE_CAL_DATE;

    const photo = pick(r, ["photo_url","Photo","photo","image","Image","img","Img"]);
    const id = pick(r, ["id","ID"]) || `${name}__${spotName}__${lat},${lon}`.replace(/\s+/g,"_");

    if (!name || lat == null || lon == null || !baseStart || !baseEnd) continue;

    out.push({
      id,
      name,
      address,
      postcode,
      spotName: spotName || "Spot",
      spotType: spotType || "Spot",
      lat, lon,
      photo,
      baseStart,
      baseEnd,
      baseDateISO
    });
  }

  return out;
}

/* -------------------------- Rendering helpers -------------------------- */
function sunPillHTML(percent){
  const icon = `<svg class="sunIcon" viewBox="0 0 24 24" width="18" height="18"><path d="M12 3a1 1 0 0 1 1 1v1.1a7 7 0 0 1 5.9 5.9H20a1 1 0 1 1 0 2h-1.1A7 7 0 0 1 13 18.9V20a1 1 0 1 1-2 0v-1.1A7 7 0 0 1 5.1 13H4a1 1 0 1 1 0-2h1.1A7 7 0 0 1 11 5.1V4a1 1 0 0 1 1-1Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" fill="currentColor"/></svg>`;
  return `${icon}<span>${percent}%</span>`;
}

function shadePillHTML(){
  return `<span>Shade</span>`;
}

function fallbackPhoto(spot){
  // clean neutral placeholder
  const txt = encodeURIComponent(spot.name);
  return `https://via.placeholder.com/600x400.png?text=${txt}`;
}

function spotKey(spot){ return spot.id; }
function isFav(spot){ return favorites.has(spotKey(spot)); }

function saveFavs(){
  localStorage.setItem("dits_favs", JSON.stringify([...favorites]));
}

/* -------------------------- Core scoring -------------------------- */
function computeMetricsForSpot(spot){
  // Adjust window for selected date
  const w = adjustWindowToDate(spot, selectedDateISO);
  if (!w) return null;

  // "Now" scoring: next hour from current time
  const now = new Date();
  const nowMin = now.getHours()*60 + now.getMinutes();
  const sunNow = sunPercentForNextHour(w, nowMin);

  // "Late sun" scoring: later end time today
  const endMin = w.endMin;

  // Selected time scoring (detail slider)
  const sunAtSel = sunPercentForNextHour(w, selectedTimeMin);

  return { window: w, sunNow, endMin, sunAtSel };
}

function passFilters(spot, km){
  if (filters.types.size && !filters.types.has(spot.spotType)) return false;
  if (km != null && km > filters.maxKm) return false;
  return true;
}

/* -------------------------- UI build -------------------------- */
function buildChips(){
  const types = [...new Set(spots.map(s => s.spotType))].sort((a,b)=>a.localeCompare(b));
  const chipRow = $("chipRow");
  chipRow.innerHTML = "";

  // Always show a few "nice" chips first if present
  const preferred = ["Beer Garden","Beer Gardens","Courtyard","Courtyards","Pavement","Roof","Terrace"];
  const ordered = [];
  for (const p of preferred){
    for (const t of types){
      if (t.toLowerCase() === p.toLowerCase() && !ordered.includes(t)) ordered.push(t);
    }
  }
  for (const t of types){
    if (!ordered.includes(t)) ordered.push(t);
  }

  for (const t of ordered.slice(0, 12)){
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.innerHTML = `<span class="chipIcon" aria-hidden="true">🍺</span><span>${t}</span>`;
    btn.addEventListener("click", () => {
      if (filters.types.has(t)) filters.types.delete(t);
      else filters.types.add(t);
      syncChipActive();
      renderAll();
    });
    btn.dataset.type = t;
    chipRow.appendChild(btn);
  }
  syncChipActive();
}

function syncChipActive(){
  const chips = $("chipRow").querySelectorAll(".chip");
  chips.forEach(ch => {
    const t = ch.dataset.type;
    ch.classList.toggle("active", filters.types.has(t));
  });
}

function buildFilterSheet(){
  const types = [...new Set(spots.map(s => s.spotType))].sort((a,b)=>a.localeCompare(b));
  const box = $("typeMulti");
  box.innerHTML = "";

  for (const t of types){
    const b = document.createElement("button");
    b.className = "multiOpt";
    b.textContent = t;
    b.dataset.type = t;
    b.classList.toggle("active", filters.types.has(t));
    b.addEventListener("click", () => {
      if (filters.types.has(t)) filters.types.delete(t);
      else filters.types.add(t);
      b.classList.toggle("active", filters.types.has(t));
    });
    box.appendChild(b);
  }

  $("distKm").value = String(filters.maxKm);
  $("distVal").textContent = String(filters.maxKm);

  $("sortSun").classList.toggle("active", filters.sort === "sun");
  $("sortDist").classList.toggle("active", filters.sort === "dist");
}

function showSheet(){
  buildFilterSheet();
  $("sheetBackdrop").hidden = false;
  $("sheet").hidden = false;
}
function hideSheet(){
  $("sheetBackdrop").hidden = true;
  $("sheet").hidden = true;
  syncChipActive();
}

/* -------------------------- Render list/cards -------------------------- */
function renderAll(){
  $("timeBadge").textContent = toLocalTimeBadge();

  const q = $("q").value.trim().toLowerCase();

  const computed = [];
  for (const s of spots){
    // search filter
    if (q){
      const hay = `${s.name} ${s.address} ${s.postcode} ${s.spotName} ${s.spotType}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    const km = userLoc ? distKm(userLoc.lat, userLoc.lon, s.lat, s.lon) : null;
    if (!passFilters(s, km)) continue;

    const m = computeMetricsForSpot(s);
    if (!m) continue;

    computed.push({ spot:s, km, ...m });
  }

  // Sort for list
  computed.sort((a,b) => {
    if (filters.sort === "dist"){
      const da = a.km ?? 1e9;
      const db = b.km ?? 1e9;
      if (da !== db) return da - db;
      return b.sunNow - a.sunNow;
    }
    // sun sort
    if (b.sunNow !== a.sunNow) return b.sunNow - a.sunNow;
    const da = a.km ?? 1e9;
    const db = b.km ?? 1e9;
    return da - db;
  });

  $("countNote").textContent = `${computed.length} spots`;

  // Rail: sunniest now
  const nowRail = computed.slice(0, CONFIG.MAX_RESULTS_RAIL);
  $("railNow").innerHTML = nowRail.map(x => cardHTML(x)).join("");
  bindCardClicks($("railNow"), nowRail);

  // Rail: latest sun today (sort by endMin desc, then sunNow)
  const late = [...computed].sort((a,b) => (b.endMin - a.endMin) || (b.sunNow - a.sunNow)).slice(0, CONFIG.MAX_RESULTS_RAIL);
  $("railLate").innerHTML = late.map(x => cardHTML(x, { late:true })).join("");
  bindCardClicks($("railLate"), late);

  // All list
  $("listAll").innerHTML = computed.map(x => rowHTML(x)).join("");
  bindRowClicks($("listAll"), computed);

  // Map view uses top items
  lastMapSpots = computed.slice(0, 30);
  if (mapReady) updateMapPins();

  // Favs list
  renderFavs();
}

function cardHTML(x, opts={}){
  const s = x.spot;
  const photo = s.photo || fallbackPhoto(s);
  const pct = x.sunNow;

  const addrLine = [s.postcode].filter(Boolean).join(" ");
  const spotChip = `${s.spotType}`;

  const lateLabel = opts.late ? `Late sun · ends ${minutesToHHMM(x.endMin)}` : `${pct}% next hour`;

  return `
    <div class="card" data-id="${escapeAttr(s.id)}" role="button" tabindex="0">
      <div class="cardImg">
        <img src="${escapeAttr(photo)}" alt="" loading="lazy" />
        <div class="sunPill">${sunPillHTML(pct)}</div>
      </div>
      <div class="cardBody">
        <h4 class="cardTitle">${escapeHTML(s.name)}</h4>
        <div class="cardAddr">${escapeHTML(addrLine || s.address || "")}</div>
        <div class="badgeRow">
          <div class="badge">📍 <span>${escapeHTML(spotChip)}</span></div>
          <div class="badge"><small>${escapeHTML(lateLabel)}</small></div>
        </div>
      </div>
      <div class="legend">
        <span class="dotKey"><span class="dotSwatch good"></span> Good Sun</span>
        <span class="dotKey"><span class="dotSwatch some"></span> Some Sun</span>
        <span class="dotKey"><span class="dotSwatch shade"></span> Shade</span>
      </div>
    </div>
  `;
}

function rowHTML(x){
  const s = x.spot;
  const photo = s.photo || fallbackPhoto(s);
  const pct = x.sunNow;

  const isShade = pct === 0;
  const pillClass = isShade ? "miniPill shade" : "miniPill";

  const distText = x.km == null ? "" : `${x.km.toFixed(1)} km`;
  const windowText = `Sun ${minutesToHHMM(x.window.startMin)}–${minutesToHHMM(x.window.endMin)}`;

  return `
    <div class="row" data-id="${escapeAttr(s.id)}" role="button" tabindex="0">
      <div class="thumb"><img src="${escapeAttr(photo)}" alt="" loading="lazy" /></div>
      <div class="rowMain">
        <div class="rowTitle">${escapeHTML(s.name)}</div>
        <div class="rowSub">${escapeHTML(s.spotName)} · ${escapeHTML(s.spotType)}</div>
        <div class="rowSub">${escapeHTML(windowText)}</div>
      </div>
      <div class="rowRight">
        <div class="${pillClass}">${isShade ? shadePillHTML() : sunPillHTML(pct)}</div>
        <div class="miniMeta">${escapeHTML(distText)}</div>
      </div>
    </div>
  `;
}

function bindCardClicks(container, arr){
  container.querySelectorAll(".card").forEach(el => {
    el.addEventListener("click", () => openDetailById(el.dataset.id, arr));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetailById(el.dataset.id, arr); });
  });
}
function bindRowClicks(container, arr){
  container.querySelectorAll(".row").forEach(el => {
    el.addEventListener("click", () => openDetailById(el.dataset.id, arr));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetailById(el.dataset.id, arr); });
  });
}

function escapeHTML(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}
function escapeAttr(s){ return escapeHTML(s).replace(/"/g,"&quot;"); }

/* -------------------------- Detail sheet -------------------------- */
function showDetailSheet(){
  $("detailBackdrop").hidden = false;
  $("detailSheet").hidden = false;
}
function hideDetailSheet(){
  $("detailBackdrop").hidden = true;
  $("detailSheet").hidden = true;
  currentDetailSpot = null;
}

function openDetailById(id, computedArr){
  const found = computedArr.find(x => x.spot.id === id);
  if (!found) return;

  currentDetailSpot = found.spot;

  $("dTitle").textContent = found.spot.name;
  $("dAddr").textContent = found.spot.address || found.spot.postcode || "";
  $("dSpot").textContent = `${found.spot.spotName} · ${found.spot.spotType}`;

  // Set default slider to current time (rounded 5)
  const now = new Date();
  const nm = now.getHours()*60 + now.getMinutes();
  selectedTimeMin = Math.round(nm / 5) * 5;
  selectedTimeMin = clamp(selectedTimeMin, 540, 1380);
  $("timeSlider").value = String(selectedTimeMin);
  updateDetailForSelectedTime();

  // Buttons
  $("dirBtn").onclick = () => {
    const s = currentDetailSpot;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${s.lat},${s.lon}`)}&travelmode=walking`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  $("favBtn").onclick = () => {
    const s = currentDetailSpot;
    const k = spotKey(s);
    if (favorites.has(k)) favorites.delete(k);
    else favorites.add(k);
    saveFavs();
    updateFavBtn();
    renderFavs();
  };

  updateFavBtn();
  buildMiniBars();
  showDetailSheet();
}

function updateFavBtn(){
  if (!currentDetailSpot) return;
  const on = isFav(currentDetailSpot);
  $("favBtn").textContent = on ? "Saved" : "Save";
  $("favBtn").classList.toggle("primary", on);
  $("favBtn").classList.toggle("ghost", !on);
}

function updateDetailForSelectedTime(){
  if (!currentDetailSpot) return;

  const s = currentDetailSpot;
  const w = adjustWindowToDate(s, selectedDateISO);
  const pill = $("dSunPill");

  const selHH = minutesToHHMM(selectedTimeMin);
  $("selTimePill").textContent = selHH;

  if (!w){
    pill.textContent = "No sun data";
    return;
  }

  const pct = sunPercentForNextHour(w, selectedTimeMin);
  pill.innerHTML = (pct === 0)
    ? `<span>Shade next hour</span>`
    : `${sunPillHTML(pct)} <span class="muted">in sun</span>`;
}

function buildMiniBars(){
  if (!currentDetailSpot) return;
  const s = currentDetailSpot;
  const w = adjustWindowToDate(s, selectedDateISO);
  const box = $("miniBars");
  box.innerHTML = "";

  if (!w) return;

  const hours = [12,13,14,15,16,17,18];
  for (const h of hours){
    const startMin = h*60;
    const pct = sunPercentForNextHour(w, startMin);
    const fillClass = pct >= 70 ? "good" : "";
    box.innerHTML += `
      <div class="bar">
        <div class="barFill ${fillClass}" style="background:${pct===0 ? "var(--shade)" : "var(--good)"}">
          ${pct}%
        </div>
        <div class="barLabel">${pad2(h)}:00</div>
      </div>
    `;
  }
}

/* -------------------------- Favorites view -------------------------- */
function renderFavs(){
  const favList = $("listFavs");
  const favSpots = spots.filter(s => favorites.has(spotKey(s)));

  if (!favSpots.length){
    favList.innerHTML = `<div class="muted">No saved spots yet.</div>`;
    return;
  }

  // Compute with current filters (date + now) for display
  const computed = [];
  for (const s of favSpots){
    const km = userLoc ? distKm(userLoc.lat, userLoc.lon, s.lat, s.lon) : null;
    const m = computeMetricsForSpot(s);
    if (!m) continue;
    computed.push({ spot:s, km, ...m });
  }
  computed.sort((a,b)=> (b.sunNow - a.sunNow) || ((a.km??1e9)-(b.km??1e9)));

  favList.innerHTML = computed.map(x => rowHTML(x)).join("");
  bindRowClicks(favList, computed);
}

/* -------------------------- Weather strip render -------------------------- */
async function renderWeather(){
  const el = $("weatherStrip");
  el.innerHTML = `<div class="muted">Loading weather…</div>`;

  const loc = userLoc || CONFIG.DEFAULT_CENTER;

  try{
    const w = await fetchNextHourWeather(loc.lat, loc.lon);
    const icon = wmoIcon(w.weather_code);
    const t = (w.temp_c == null) ? "—" : `${Math.round(w.temp_c)}°C`;
    const wind = (w.wind_kmh == null) ? "—" : `${Math.round(w.wind_kmh)} km/h`;
    const rain = (w.precip_mm == null) ? "—" : `${Number(w.precip_mm).toFixed(1)} mm`;
    const prob = (w.precip_prob == null) ? "—" : `${Math.round(w.precip_prob)}%`;

    el.innerHTML = `
      <div class="weatherLeft">
        <div class="weatherIcon">${icon}</div>
        <div class="weatherMain">
          <div class="weatherTop">
            <div class="weatherTemp">${t}</div>
            <div class="weatherMeta">next hour</div>
          </div>
          <div class="weatherMeta">Wind ${wind} <span class="dot"></span> Rain ${prob}</div>
        </div>
      </div>
      <div class="weatherRight">
        <div>${rain}</div>
      </div>
    `;
  } catch(e){
    el.innerHTML = `<div class="muted">Weather unavailable</div>`;
  }
}

/* -------------------------- Map view -------------------------- */
function initMap(){
  if (mapReady) return;
  mapReady = true;

  const center = userLoc || CONFIG.DEFAULT_CENTER;

  map = L.map("map", { zoomControl: true }).setView([center.lat, center.lon], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  updateMapPins();
}

function clearMapPins(){
  for (const m of mapMarkers) m.remove();
  mapMarkers = [];
}

function updateMapPins(){
  if (!map) return;

  clearMapPins();

  const items = lastMapSpots || [];
  const bounds = [];

  for (const x of items){
    const s = x.spot;
    const pct = x.sunNow;
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 9,
      weight: 2,
      color: pct === 0 ? "#9a9aa0" : "#111",
      fillColor: pct === 0 ? "#d8d8dc" : "#ffd400",
      fillOpacity: 0.95
    }).addTo(map);

    marker.on("click", () => openDetailById(s.id, items));
    mapMarkers.push(marker);
    bounds.push([s.lat, s.lon]);
  }

  if (userLoc){
    const u = L.circleMarker([userLoc.lat, userLoc.lon], {
      radius: 7, weight: 2, color:"#0a66ff", fillColor:"#0a66ff", fillOpacity:0.4
    }).addTo(map);
    mapMarkers.push(u);
  }

  if (bounds.length){
    try{ map.fitBounds(bounds, { padding:[30,30] }); } catch {}
  }
}

/* -------------------------- Navigation -------------------------- */
function setTab(tab){
  // buttons
  document.querySelectorAll(".navBtn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));

  if (tab === "find") $("view-find").classList.add("active");
  if (tab === "map") {
    $("view-map").classList.add("active");
    initMap();
    setTimeout(() => { try{ map.invalidateSize(); } catch {} }, 150);
  }
  if (tab === "favs") $("view-favs").classList.add("active");
}

/* -------------------------- Geolocation -------------------------- */
async function getUserLocation(){
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("No geolocation"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

/* -------------------------- Load + init -------------------------- */
async function loadData(){
  const res = await fetch(CONFIG.DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  const text = await res.text();
  rawRows = parseCSV(text);
  spots = normalizeRows(rawRows);

  // If CSV is empty / not matching expected columns, show a clear message in UI
  if (!spots.length){
    $("listAll").innerHTML = `<div class="muted">
      No valid rows loaded from <code>${CONFIG.DATA_URL}</code>.<br/>
      Your CSV must include: pub name + lat + lon + base_start + base_end (HH:MM).
    </div>`;
  }
}

function wireUI(){
  // date default
  $("datePick").value = selectedDateISO;
  $("datePick").addEventListener("change", () => {
    selectedDateISO = $("datePick").value || todayISO();
    renderAll();
    if (currentDetailSpot){
      updateDetailForSelectedTime();
      buildMiniBars();
    }
  });

  $("q").addEventListener("input", () => renderAll());

  // bottom nav
  document.querySelectorAll(".navBtn").forEach(btn => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  // filters sheet
  $("openFilters").addEventListener("click", showSheet);
  $("closeFilters").addEventListener("click", hideSheet);
  $("sheetBackdrop").addEventListener("click", hideSheet);

  $("distKm").addEventListener("input", () => {
    $("distVal").textContent = $("distKm").value;
  });

  $("sortSun").addEventListener("click", () => {
    filters.sort = "sun";
    $("sortSun").classList.add("active");
    $("sortDist").classList.remove("active");
  });
  $("sortDist").addEventListener("click", () => {
    filters.sort = "dist";
    $("sortDist").classList.add("active");
    $("sortSun").classList.remove("active");
  });

  $("resetFilters").addEventListener("click", () => {
    filters.types.clear();
    filters.maxKm = 10;
    filters.sort = "sun";
    buildFilterSheet();
  });

  $("applyFilters").addEventListener("click", () => {
    filters.maxKm = Number($("distKm").value);
    // types already updated in sheet; keep as-is
    hideSheet();
    renderAll();
  });

  // near me
  $("nearMeBtn").addEventListener("click", async () => {
    try{
      userLoc = await getUserLocation();
      await renderWeather();
      renderAll();
      if (mapReady){
        map.setView([userLoc.lat, userLoc.lon], 14);
        updateMapPins();
      }
    }catch{
      // no prompt spam; just keep default center
    }
  });

  // detail sheet
  $("closeDetail").addEventListener("click", hideDetailSheet);
  $("detailBackdrop").addEventListener("click", hideDetailSheet);

  $("timeSlider").addEventListener("input", () => {
    selectedTimeMin = Number($("timeSlider").value);
    updateDetailForSelectedTime();
  });
}

async function start(){
  // SW
  if ("serviceWorker" in navigator){
    try{ await navigator.serviceWorker.register("./service-worker.js"); } catch {}
  }

  // time badge
  $("timeBadge").textContent = toLocalTimeBadge();

  // initial weather (default center)
  await renderWeather();

  // load data
  await loadData();

  // chips + filters
  buildChips();

  // UI listeners
  wireUI();

  // first render
  renderAll();
}

start().catch((e) => {
  console.error(e);
  $("listAll").innerHTML = `<div class="muted">App failed to start.</div>`;
});
