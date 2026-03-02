/* Drinking in the Sun — LIVE (next 2 hours)
   - Loads pubs + spot in/out from CSV: ./public/data/DrinkingintheSunData.csv
   - Model A: calibration date (8 Aug) -> az/alt edge line -> recalculates for today
   - Shows 2 plan cards + ALWAYS 5 options
   - Weather shown as WMO icons (Open-Meteo weather_code)
   - Map pin tap opens bottom-sheet pub card (weather + sit + sun line + open/close)
*/

const NOTTINGHAM_CENTER = { lat: 52.9548, lng: -1.1581 };
const HORIZON_MIN = 120;
const STEP_MIN = 5;
const SWITCH_GAP_MIN = 5;

const CALIBRATION_DATE = { y: 2026, m: 8, d: 8 }; // 8 Aug 2026

const PERFECT_DAY = {
  endHourLocal: 20,
  minStopMin: 35,
  maxStopMin: 75,
  bufferMin: 5,
  maxWaitMin: 25,
  walkMaxKm: 2.2,
  cycleMaxKm: 7.5,
  cycleKmh: 15
};

// ---------- DOM ----------
const el = {
  nearBtn: document.getElementById('nearBtn'),
  nearBtnText: document.getElementById('nearBtnText'),
  louBtn: document.getElementById('louBtn'),
  favToggleBtn: document.getElementById('favToggleBtn'),
  favToggleText: document.getElementById('favToggleText'),
  viewToggleBtn: document.getElementById('viewToggleBtn'),
  viewToggleText: document.getElementById('viewToggleText'),

  listPanel: document.getElementById('listPanel'),
  mapPanel: document.getElementById('mapPanel'),

  planMeta: document.getElementById('planMeta'),
  planRefresh: document.getElementById('planRefresh'),

  plan: document.getElementById('plan'),
  results: document.getElementById('results'),
  forecastStrip: document.getElementById('forecastStrip'),
  forecastIcon: document.getElementById('forecastIcon'),
  forecastText: document.getElementById('forecastText'),

  mapCard: document.getElementById('mapCard'),

  louOverlay: document.getElementById('louOverlay'),
  louBackdrop: document.getElementById('louBackdrop'),
  louClose: document.getElementById('louClose'),
  louOut: document.getElementById('louOut'),
  louBuild: document.getElementById('louBuild'),
  louStart: document.getElementById('louStart'),
  louStops: document.getElementById('louStops'),
  modeWalk: document.getElementById('modeWalk'),
  modeCycle: document.getElementById('modeCycle'),
  louShare: document.getElementById('louShare'),
  louCopy: document.getElementById('louCopy')
};

// ---------- Storage helpers ----------
function loadStr(k, fallback){ try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } }
function saveStr(k,v){ try { localStorage.setItem(k, v); } catch {} }
function loadBool(k, fallback){ try { const v = localStorage.getItem(k); return v === null ? fallback : (v === '1'); } catch { return fallback; } }
function saveBool(k,v){ try { localStorage.setItem(k, v ? '1' : '0'); } catch {} }
function loadJSON(k, fallback){ try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback; } catch { return fallback; } }
function saveJSON(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ---------- State ----------
let userLoc = loadJSON('ditS_userLoc', null);
let viewMode = loadStr('ditS_viewMode', 'list');
let favOnly = loadBool('ditS_favOnly', false);
let favourites = new Set(loadJSON('ditS_favourites', []));
let louMode = 'walk';

let map = null;
const markers = new Map();
let lastRenderToken = 0;

let PUBS = [];

// Windows cache
const windowsCache = new Map(); // key = pubId|spotName|YYYY-MM-DD|profileHash

// Weather cache
const WEATHER_TTL_MS = 30 * 60 * 1000;
const weatherCache = new Map(); // key -> {t,data}

// ---------- Helpers ----------
function pad2(n){ return String(n).padStart(2,'0'); }
function fmtHM(d){ return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function minsBetween(a,b){ return Math.max(0, Math.round((b - a) / 60000)); }
function addMinutes(d, m){ return new Date(d.getTime() + m*60*1000); }
function addDays(d, days){ return new Date(d.getTime() + days*24*60*60*1000); }
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
function normName(s){ return String(s||'').toLowerCase(); }
function isoDateLocal(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

// ---------- Distance ----------
function haversineKm(a, b){
  const R = 6371;
  const toRad = (x) => x * Math.PI/180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat/2);
  const s2 = Math.sin(dLng/2);
  const q = s1*s1 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*s2*s2;
  return 2*R*Math.asin(Math.min(1, Math.sqrt(q)));
}
function walkMinutesFromKm(km){ return Math.max(1, Math.round(km / 4.8 * 60)); }
function cycleMinutesFromKm(km){ return Math.max(1, Math.round(km / PERFECT_DAY.cycleKmh * 60)); }

// ---------- Cycling “wide-afield” bias ----------
function cycleWideBonus(pub){
  const n = normName(pub.name);
  const a = normName(pub.area);

  const named =
    (n.includes('lakeside') || a.includes('lakeside')) ? 30 :
    (n.includes('beeston')  || a.includes('beeston'))  ? 25 :
    (n.includes('basford')  || a.includes('basford'))  ? 20 :
    (n.includes('lion at basford') || n.includes('lion at baseford')) ? 25 : 0;

  const kmFromCenter = haversineKm(
    { lat: NOTTINGHAM_CENTER.lat, lng: NOTTINGHAM_CENTER.lng },
    { lat: pub.lat, lng: pub.lng }
  );

  const dist =
    kmFromCenter >= 6 ? 18 :
    kmFromCenter >= 4 ? 12 :
    kmFromCenter >= 3 ? 8  : 0;

  return named + dist;
}

// ---------- Opening/closing ----------
function toTimeHHMM(s){
  const t = String(s ?? '').trim();
  if (!t) return null;
  if (/^\d{1,2}\.\d{2}$/.test(t)){
    const [h,m] = t.split('.');
    return `${pad2(+h)}:${m}`;
  }
  if (/^\d{1,2}:\d{1,2}$/.test(t)){
    const [h,m] = t.split(':');
    return `${pad2(+h)}:${pad2(+m)}`;
  }
  if (/^\d{3,4}$/.test(t)){
    const tt = t.padStart(4,'0');
    return `${tt.slice(0,2)}:${tt.slice(2)}`;
  }
  return t;
}
function parseOpenClose(pub){
  const open = pub.openingTime ? toTimeHHMM(pub.openingTime) : null;
  const close = pub.closingTime ? toTimeHHMM(pub.closingTime) : null;
  if (!open || !close) return null;
  return { open, close };
}
function isOpenAt(pub, dateTime){
  const oc = parseOpenClose(pub);
  if (!oc) return { known:false, open:true, closesInMin:null };

  const [oh, om] = oc.open.split(':').map(Number);
  const [ch, cm] = oc.close.split(':').map(Number);

  const d = new Date(dateTime);
  const openDT = new Date(d.getFullYear(), d.getMonth(), d.getDate(), oh, om, 0, 0);
  let closeDT = new Date(d.getFullYear(), d.getMonth(), d.getDate(), ch, cm, 0, 0);
  if (closeDT <= openDT) closeDT = addDays(closeDT, 1);

  const isOpen = dateTime >= openDT && dateTime <= closeDT;
  const closesInMin = isOpen ? minsBetween(dateTime, closeDT) : null;
  return { known:true, open:isOpen, closesInMin };
}
function openLine(pub, now){
  const st = isOpenAt(pub, now);
  if (!st.known) return null;
  if (!st.open) return 'Closed now';
  if (st.closesInMin !== null && st.closesInMin <= 45) return `Open • closes in ${st.closesInMin} min`;
  return `Open now`;
}

// ---------- Favourites ----------
function setFavOnly(v){
  favOnly = v;
  saveBool('ditS_favOnly', v);
  el.favToggleText.textContent = v ? 'Favourites ✓' : 'Favourites';
  render();
}
el.favToggleBtn?.addEventListener('click', () => setFavOnly(!favOnly));

function isFav(pubId){ return favourites.has(pubId); }
function toggleFav(pubId){
  if (favourites.has(pubId)) favourites.delete(pubId);
  else favourites.add(pubId);
  saveJSON('ditS_favourites', Array.from(favourites));
  render();
}

// ---------- View mode ----------
function setViewMode(mode){
  viewMode = mode;
  saveStr('ditS_viewMode', mode);
  el.viewToggleText.textContent = mode === 'map' ? 'List' : 'Map';
  if (mode === 'map'){
    el.listPanel.style.display = 'none';
    el.mapPanel.style.display = '';
    setTimeout(() => map?.invalidateSize(), 50);
  } else {
    el.mapPanel.style.display = 'none';
    el.listPanel.style.display = '';
  }
}
el.viewToggleBtn?.addEventListener('click', () => setViewMode(viewMode === 'map' ? 'list' : 'map'));

// ---------- Near me ----------
async function requestLocation(){
  if (!navigator.geolocation){
    userLoc = null;
    saveJSON('ditS_userLoc', null);
    return;
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
        saveJSON('ditS_userLoc', userLoc);
        resolve();
      },
      () => resolve(),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}
el.nearBtn?.addEventListener('click', async () => {
  await requestLocation();
  render();
});

// ---------- Sun model (simple calibration) ----------
/*
CSV fields expected (flexible):
- name, area, lat, lng
- spot_name, spot (optional)
- aug_in, aug_out  (HH:MM, sun window on CALIBRATION_DATE)
- sit_spot / sit (optional)
- opening_time, closing_time (optional)

We convert the calibration window to sun-geometry boundaries and apply to today by shifting azimuth
(basic proxy; good enough for a lightweight MVP).
*/

function parseHM(s){
  const t = String(s ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = +m[1], mm = +m[2];
  if (hh<0||hh>23||mm<0||mm>59) return null;
  return { hh, mm };
}
function atTime(date, hm){
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hm.hh, hm.mm, 0, 0);
}

// Very lightweight sun position (approx). Not for astronomy; for UX sorting.
function sunPos(date, lat, lng){
  // Adapted from a common approximation (NOAA-ish). Returns altitude (deg) and azimuth (deg from N, clockwise).
  const rad = Math.PI/180;
  const day = (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(),0,0)) / 86400000;
  const hour = date.getHours() + date.getMinutes()/60 + date.getSeconds()/3600;

  const gamma = 2*Math.PI/365 * (day - 1 + (hour - 12)/24);
  const eqtime = 229.18*(0.000075 + 0.001868*Math.cos(gamma) - 0.032077*Math.sin(gamma) - 0.014615*Math.cos(2*gamma) - 0.040849*Math.sin(2*gamma));
  const decl = 0.006918 - 0.399912*Math.cos(gamma) + 0.070257*Math.sin(gamma) - 0.006758*Math.cos(2*gamma) + 0.000907*Math.sin(2*gamma) - 0.002697*Math.cos(3*gamma) + 0.00148*Math.sin(3*gamma);

  const timeOffset = eqtime + 4*lng; // minutes
  const tst = hour*60 + timeOffset; // true solar time (minutes)
  const ha = (tst/4 - 180) * rad; // hour angle
  const latr = lat*rad;

  const cosZen = Math.sin(latr)*Math.sin(decl) + Math.cos(latr)*Math.cos(decl)*Math.cos(ha);
  const zen = Math.acos(clamp(cosZen, -1, 1));
  const alt = 90 - zen/rad;

  const az = Math.atan2(Math.sin(ha), (Math.cos(ha)*Math.sin(latr) - Math.tan(decl)*Math.cos(latr))) / rad + 180;
  return { alt, az: (az+360)%360 };
}

function calibrationProfileHash(pub, spot){
  return `${pub.augIn||''}|${pub.augOut||''}|${spot?.name||''}`;
}

function computeWindowForToday(pub, spot, day){
  const key = `${pub.id}|${spot.name}|${isoDateLocal(day)}|${calibrationProfileHash(pub, spot)}`;
  if (windowsCache.has(key)) return windowsCache.get(key);

  const augIn = parseHM(spot.augIn);
  const augOut = parseHM(spot.augOut);
  if (!augIn || !augOut){
    const res = null;
    windowsCache.set(key, res);
    return res;
  }

  const calDay = new Date(CALIBRATION_DATE.y, CALIBRATION_DATE.m-1, CALIBRATION_DATE.d, 12, 0, 0, 0);
  const calInDT = atTime(calDay, augIn);
  const calOutDT = atTime(calDay, augOut);

  // Convert to azimuth boundaries at calibration date
  const pin = sunPos(calInDT, pub.lat, pub.lng);
  const pout = sunPos(calOutDT, pub.lat, pub.lng);

  // For "today", find times where sun azimuth crosses those boundaries near daylight range.
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8, 0, 0, 0);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 22, 0, 0, 0);

  let bestIn = null, bestOut = null;
  let lastAz = null;
  let lastT = null;

  for (let t = new Date(start); t <= end; t = addMinutes(t, STEP_MIN)){
    const p = sunPos(t, pub.lat, pub.lng);
    if (p.alt <= 0){ lastAz = p.az; lastT = t; continue; }
    if (lastAz !== null){
      // crossing pin.az
      if (!bestIn && crossed(lastAz, p.az, pin.az)){
        bestIn = new Date(t.getTime());
      }
      // crossing pout.az
      if (!bestOut && crossed(lastAz, p.az, pout.az)){
        bestOut = new Date(t.getTime());
      }
    }
    lastAz = p.az;
    lastT = t;
  }

  // If swapped (sun sets etc), normalize
  if (bestIn && bestOut && bestOut < bestIn){
    const tmp = bestIn; bestIn = bestOut; bestOut = tmp;
  }

  const res = (bestIn && bestOut) ? { start: bestIn, end: bestOut } : null;
  windowsCache.set(key, res);
  return res;
}

function crossed(a1, a2, target){
  // Handles wrap-around at 360
  const d = ((a2 - a1) + 540) % 360 - 180; // shortest delta
  const t = ((target - a1) + 540) % 360 - 180;
  return (t >= 0 && t <= d) || (t <= 0 && t >= d);
}

// ---------- CSV parsing ----------
function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return [];

  const rows = [];
  let headers = null;

  for (const line of lines){
    const cols = splitCSVLine(line);
    if (!headers){
      headers = cols.map(h => h.trim());
      continue;
    }
    const obj = {};
    headers.forEach((h,i)=> obj[h] = (cols[i] ?? '').trim());
    rows.push(obj);
  }
  return rows;
}

function splitCSVLine(line){
  const out = [];
  let cur = '';
  let q = false;
  for (let i=0;i<line.length;i++){
    const c = line[i];
    if (c === '"'){
      if (q && line[i+1] === '"'){ cur += '"'; i++; }
      else q = !q;
    } else if (c === ',' && !q){
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function normKey(obj, keys){
  for (const k of keys){
    if (obj[k] !== undefined) return obj[k];
    const kk = Object.keys(obj).find(x => x.toLowerCase() === k.toLowerCase());
    if (kk) return obj[kk];
  }
  return '';
}

function buildPubs(rows){
  // Group by pub name
  const mapP = new Map();

  for (const r of rows){
    const name = normKey(r, ['name','pub','pub_name']);
    if (!name) continue;

    const area = normKey(r, ['area','neighbourhood','district']);
    const lat = parseFloat(normKey(r, ['lat','latitude']));
    const lng = parseFloat(normKey(r, ['lng','lon','longitude','long']));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const openingTime = normKey(r, ['opening_time','open','opens']);
    const closingTime = normKey(r, ['closing_time','close','closes']);

    const spotName = normKey(r, ['spot_name','spot','sit_spot','sit']);
    const augIn = normKey(r, ['aug_in','in_aug','august_in']);
    const augOut = normKey(r, ['aug_out','out_aug','august_out']);
    const sit = normKey(r, ['sit','sit_hint','sit_notes','sit_spot']);

    const id = slug(name);

    if (!mapP.has(id)){
      mapP.set(id, {
        id,
        name,
        area,
        lat, lng,
        openingTime,
        closingTime,
        spots: []
      });
    }
    const pub = mapP.get(id);

    pub.openingTime = pub.openingTime || openingTime;
    pub.closingTime = pub.closingTime || closingTime;

    pub.spots.push({
      name: spotName || 'Main',
      augIn: augIn || '',
      augOut: augOut || '',
      sit: sit || ''
    });
  }

  return Array.from(mapP.values());
}

function slug(s){
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,60) || 'pub';
}

// ---------- Weather (Open-Meteo) ----------
function weatherKey(lat,lng){ return `${lat.toFixed(3)},${lng.toFixed(3)}`; }

async function fetchWeather(lat, lng){
  const key = weatherKey(lat,lng);
  const now = Date.now();
  const cached = weatherCache.get(key);
  if (cached && (now - cached.t) < WEATHER_TTL_MS) return cached.data;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation');
  url.searchParams.set('hourly', 'temperature_2m,weather_code,wind_speed_10m,precipitation_probability,precipitation');
  url.searchParams.set('forecast_hours', '6');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Weather fetch failed');
  const data = await res.json();
  weatherCache.set(key, { t: now, data });
  return data;
}

function wmoToIcon(code){
  // Simple WMO icon mapping (emoji)
  const c = Number(code);
  if (c === 0) return '☀️';
  if (c === 1) return '🌤️';
  if (c === 2) return '⛅';
  if (c === 3) return '☁️';
  if (c === 45 || c === 48) return '🌫️';
  if ([51,53,55,56,57].includes(c)) return '🌦️';
  if ([61,63,65,80,81,82].includes(c)) return '🌧️';
  if ([66,67].includes(c)) return '🌧️';
  if ([71,73,75,77,85,86].includes(c)) return '🌨️';
  if ([95,96,99].includes(c)) return '⛈️';
  return '⛅';
}

function wmoMood(code){
  const c = Number(code);
  if (c === 0) return 'moodSun';
  if (c === 1 || c === 2) return 'moodSun';
  if (c === 3) return 'moodMixed';
  if (c === 45 || c === 48) return 'moodFog';
  if ([51,53,55,56,57].includes(c)) return 'moodMixed';
  if ([61,63,65,66,67,80,81,82].includes(c)) return 'moodRain';
  if ([71,73,75,77,85,86].includes(c)) return 'moodSnow';
  if ([95,96,99].includes(c)) return 'moodRain';
  return 'moodMixed';
}

function pickNextHour(weather){
  // Choose the next hourly index >= now (local)
  const t = weather?.hourly?.time || [];
  if (!t.length) return null;

  const now = new Date();
  let bestIdx = 0;
  let bestDelta = Infinity;

  for (let i=0;i<t.length;i++){
    const dt = new Date(t[i]);
    const delta = dt.getTime() - now.getTime();
    if (delta >= 0 && delta < bestDelta){
      bestDelta = delta;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function setForecastStrip(weather){
  if (!el.forecastStrip || !el.forecastIcon || !el.forecastText) return;

  try{
    const idx = pickNextHour(weather);
    const h = weather?.hourly || {};
    const code = idx !== null ? h.weather_code?.[idx] : weather?.current?.weather_code;
    const temp = idx !== null ? h.temperature_2m?.[idx] : weather?.current?.temperature_2m;
    const wind = idx !== null ? h.wind_speed_10m?.[idx] : weather?.current?.wind_speed_10m;
    const pop = idx !== null ? h.precipitation_probability?.[idx] : null;
    const precip = idx !== null ? h.precipitation?.[idx] : weather?.current?.precipitation;

    const icon = wmoToIcon(code);
    const mood = wmoMood(code);

    // reset mood classes
    el.forecastStrip.classList.remove('moodSun','moodMixed','moodFog','moodRain','moodSnow');
    el.forecastStrip.classList.add(mood);

    el.forecastIcon.textContent = icon;

    const tStr = Number.isFinite(temp) ? `${Math.round(temp)}°` : '—';
    const wStr = Number.isFinite(wind) ? `wind ${Math.round(wind)} km/h` : null;

    const popStr = (pop !== null && pop !== undefined && Number.isFinite(pop)) ? `${Math.round(pop)}%` : null;
    const prStr = (precip !== null && precip !== undefined && Number.isFinite(precip)) ? `${Math.round(precip*10)/10}mm` : null;

    const rainPart = (popStr || prStr) ? `rain ${[popStr, prStr].filter(Boolean).join(' / ')}` : null;

    const parts = [`Next hour: ${tStr}`, wStr, rainPart].filter(Boolean);
    el.forecastText.textContent = parts.join(' • ');
  } catch {
    el.forecastText.textContent = 'Next hour: —';
  }
}

// ---------- Sun evaluation ----------
function sunKindForSlot(slot, weatherCode){
  // Determine sun potential from weather code (simple heuristic)
  const c = Number(weatherCode);
  if (c === 0 || c === 1) return 'sun';
  if (c === 2) return 'mixed';
  if (c === 3 || c === 45 || c === 48) return 'mixed';
  if ([51,53,55,56,57].includes(c)) return 'mixed';
  if ([61,63,65,66,67,80,81,82,71,73,75,77,85,86,95,96,99].includes(c)) return 'rain';
  return 'mixed';
}

function clampToHorizon(win, now){
  const start = win.start < now ? now : win.start;
  const end = win.end;
  const horizonEnd = addMinutes(now, HORIZON_MIN);
  const end2 = end > horizonEnd ? horizonEnd : end;
  if (end2 <= start) return null;
  return { start, end: end2 };
}

function windowScore(win){
  // minutes of sun
  return minsBetween(win.start, win.end);
}

function bestSpotWindow(pub, now){
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12,0,0,0);
  let best = null;

  for (const spot of pub.spots){
    const w = computeWindowForToday(pub, spot, today);
    if (!w) continue;
    const c = clampToHorizon(w, now);
    if (!c) continue;
    const score = windowScore(c);
    if (!best || score > best.score){
      best = { spot, win: c, score };
    }
  }
  return best;
}

function bestSoonestWindow(pub, now){
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12,0,0,0);
  let best = null;

  for (const spot of pub.spots){
    const w = computeWindowForToday(pub, spot, today);
    if (!w) continue;

    const horizonEnd = addMinutes(now, HORIZON_MIN);
    const start = w.start < now ? now : w.start;
    const end = w.end > horizonEnd ? horizonEnd : w.end;
    if (end <= start) continue;

    const startsIn = minsBetween(now, start);
    const duration = minsBetween(start, end);

    if (!best || startsIn < best.startsIn || (startsIn === best.startsIn && duration > best.duration)){
      best = { spot, win: { start, end }, startsIn, duration };
    }
  }
  return best;
}

function classifyEffective(now, win, weather){
  // Determine kind from weather code at nearest hour to window start
  const idx = pickNextHour(weather);
  const code = idx !== null ? weather?.hourly?.weather_code?.[idx] : weather?.current?.weather_code;
  const kindWx = sunKindForSlot(null, code);

  if (!win) return { kind: 'no-sun', tint: 0, wxClass: kindWx === 'rain' ? 'wxRain' : (kindWx === 'mixed' ? 'wxMixed' : '') };

  const mins = minsBetween(win.start, win.end);
  // tint based on minutes
  const tint =
    mins >= 90 ? 4 :
    mins >= 60 ? 3 :
    mins >= 40 ? 2 :
    mins >= 20 ? 1 : 0;

  let kind = 'sun';
  if (kindWx === 'rain') kind = 'rain';
  else if (kindWx === 'mixed') kind = 'mixed';

  return {
    kind,
    tint,
    wxClass: kind === 'rain' ? 'wxRain' : (kind === 'mixed' ? 'wxMixed' : '')
  };
}

function sunLine(best, now){
  if (!best) return 'No sun in next 2 hours';
  const { win } = best;
  if (win.start > now) return `Sun ${fmtHM(win.start)}–${fmtHM(win.end)}`;
  return `Sun now until ${fmtHM(win.end)}`;
}

// ---------- Rendering ----------
function clearNode(n){ while (n.firstChild) n.removeChild(n.firstChild); }

function createEl(tag, cls, html){
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html !== undefined) d.innerHTML = html;
  return d;
}

function renderCard(pub, best, effective, distMin, now, weather){
  const icon = wmoToIcon(weather?.current?.weather_code);
  const ocLine = openLine(pub, now);

  const card = createEl('div', `card cardTint${effective.tint} ${effective.wxClass}`.trim());

  const top = createEl('div', 'cardTop');
  const left = createEl('div', '');
  left.appendChild(createEl('div', 'cardTitle', escapeHtml(pub.name)));
  left.appendChild(createEl('div', 'cardSub', `${distMin ? `${distMin} min ${louMode==='cycle'?'ride':'walk'}` : ''}${pub.area ? ` • ${escapeHtml(pub.area)}`:''}`.trim()));
  top.appendChild(left);

  const right = createEl('div', 'badges');
  const star = createEl('button', `starBtn ${isFav(pub.id)?'on':''}`.trim(), isFav(pub.id)?'★':'☆');
  star.type = 'button';
  star.addEventListener('click', (e)=>{ e.stopPropagation(); toggleFav(pub.id); });
  right.appendChild(star);

  const wx = createEl('div', 'badge wx', icon);
  right.appendChild(wx);

  top.appendChild(right);
  card.appendChild(top);

  // details
  const sit = best?.spot?.sit || '';
  const line = sunLine(best, now);
  const mini = createEl('div', 'mini', `
    ${distMin ? '' : ''}
    ${sit ? `<div> Sit: ${escapeHtml(sit)}</div>` : `<div> Sit: —</div>`}
    <div>${escapeHtml(line)}</div>
    ${ocLine ? `<div>${escapeHtml(ocLine)}</div>` : ``}
  `);
  card.appendChild(mini);

  const actions = createEl('div', 'cardActions');
  const dir = createEl('button', 'smallBtn', 'Directions');
  dir.type = 'button';
  dir.addEventListener('click', () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${pub.lat},${pub.lng}`;
    window.open(url, '_blank');
  });
  actions.appendChild(dir);

  const mapBtn = createEl('button', 'smallBtn', 'Map');
  mapBtn.type = 'button';
  mapBtn.addEventListener('click', () => {
    setViewMode('map');
    focusPubOnMap(pub.id);
  });
  actions.appendChild(mapBtn);

  card.appendChild(actions);

  // click on card -> open map card
  card.addEventListener('click', () => {
    setViewMode('map');
    focusPubOnMap(pub.id, true);
  });

  return card;
}

function buildPlanCards(bestNow, bestSoon, now){
  el.plan.innerHTML = '';

  if (!bestNow && !bestSoon){
    el.plan.appendChild(createEl('div', 'bigCard cardTint0', `
      <div class="bigTitle">No likely sun found</div>
      <div class="mini">Within the next ${HORIZON_MIN} minutes.</div>
    `));
    return;
  }

  if (bestNow){
    el.plan.appendChild(createEl('div', `bigCard cardTint${bestNow.effective.tint} ${bestNow.effective.wxClass}`.trim(), `
      <div class="bigTop">
        <div>
          <div class="bigTitle">Go now</div>
          <div class="bigSub">${escapeHtml(bestNow.pub.name)}${bestNow.pub.area?` • ${escapeHtml(bestNow.pub.area)}`:''}</div>
        </div>
        <div class="badge wx">${wmoToIcon(bestNow.weather?.current?.weather_code)}</div>
      </div>
      <div class="mini">${escapeHtml(sunLine(bestNow.best, now))}</div>
      <div class="actions">
        <button class="actionBtn primary" type="button" data-act="dir" data-id="${bestNow.pub.id}">Directions</button>
        <button class="actionBtn" type="button" data-act="map" data-id="${bestNow.pub.id}">Map</button>
      </div>
    `));
  }

  if (bestSoon){
    el.plan.appendChild(createEl('div', `bigCard cardTint${bestSoon.effective.tint} ${bestSoon.effective.wxClass}`.trim(), `
      <div class="bigTop">
        <div>
          <div class="bigTitle">Go next</div>
          <div class="bigSub">${escapeHtml(bestSoon.pub.name)}${bestSoon.pub.area?` • ${escapeHtml(bestSoon.pub.area)}`:''}</div>
        </div>
        <div class="badge wx">${wmoToIcon(bestSoon.weather?.current?.weather_code)}</div>
      </div>
      <div class="mini">${escapeHtml(sunLine(bestSoon.best, now))}</div>
      <div class="actions">
        <button class="actionBtn primary" type="button" data-act="dir" data-id="${bestSoon.pub.id}">Directions</button>
        <button class="actionBtn" type="button" data-act="map" data-id="${bestSoon.pub.id}">Map</button>
      </div>
    `));
  }

  // delegate actions
  el.plan.querySelectorAll('button[data-act]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const pub = PUBS.find(p=>p.id===id);
      if (!pub) return;
      const act = btn.getAttribute('data-act');
      if (act === 'dir'){
        const url = `https://www.google.com/maps/dir/?api=1&destination=${pub.lat},${pub.lng}`;
        window.open(url, '_blank');
      } else if (act === 'map'){
        setViewMode('map');
        focusPubOnMap(pub.id, true);
      }
    });
  });
}

async function render(){
  const token = ++lastRenderToken;
  const now = new Date();

  // meta
  if (el.planMeta) el.planMeta.textContent = `Updated ${fmtHM(now)} • next ${HORIZON_MIN} min`;

  // Set view mode button label
  el.viewToggleText.textContent = viewMode === 'map' ? 'List' : 'Map';

  // fav label
  el.favToggleText.textContent = favOnly ? 'Favourites ✓' : 'Favourites';

  // ensure map state
  setViewMode(viewMode);

  // fetch weather once for Nottingham center for forecast strip
  try{
    const w0 = await fetchWeather(NOTTINGHAM_CENTER.lat, NOTTINGHAM_CENTER.lng);
    if (token !== lastRenderToken) return;
    setForecastStrip(w0);
  } catch {
    if (el.forecastText) el.forecastText.textContent = 'Next hour: —';
  }

  // Compute pub scoring
  const scored = [];

  for (const pub of PUBS){
    if (favOnly && !isFav(pub.id)) continue;

    const best = bestSpotWindow(pub, now); // best within horizon (sun minutes)
    const soon = bestSoonestWindow(pub, now); // soonest starting sun

    let distMin = null;
    if (userLoc){
      const km = haversineKm({lat:userLoc.lat,lng:userLoc.lng}, {lat:pub.lat,lng:pub.lng});
      distMin = walkMinutesFromKm(km);
    }

    // weather per pub (cached)
    let weather = null;
    try{
      weather = await fetchWeather(pub.lat, pub.lng);
    } catch { weather = null; }

    const effective = classifyEffective(now, best?.win || null, weather);

    // Simple score:
    // - prefer sun now > sun later
    // - prefer longer duration
    // - slight distance preference (if known)
    const dur = best ? minsBetween(best.win.start, best.win.end) : 0;
    const startsIn = best ? minsBetween(now, best.win.start) : (soon ? minsBetween(now, soon.win.start) : 999);
    const distPenalty = distMin ? Math.min(40, distMin) : 15;

    let base = 0;
    if (best){
      base = 200 - startsIn*2 + dur*2 - distPenalty;
    } else if (soon){
      const dur2 = minsBetween(soon.win.start, soon.win.end);
      base = 100 - minsBetween(now, soon.win.start)*2 + dur2*1.5 - distPenalty;
    } else {
      base = 10 - distPenalty;
    }

    // weather influence (prefer clearer)
    const c = weather?.current?.weather_code;
    const k = sunKindForSlot(null, c);
    if (k === 'sun') base += 12;
    if (k === 'mixed') base += 4;
    if (k === 'rain') base -= 8;

    scored.push({
      pub, best, soon, distMin, weather, effective,
      score: base
    });
  }

  scored.sort((a,b)=> b.score - a.score);

  // pick best now / best soon
  const nowCandidates = scored.filter(x => x.best && x.best.win.start <= now);
  const soonCandidates = scored.filter(x => x.best && x.best.win.start > now);

  const bestNow = nowCandidates[0] ? nowCandidates[0] : null;
  const bestSoon = soonCandidates[0] ? soonCandidates[0] : null;

  buildPlanCards(bestNow, bestSoon, now);

  // Options: ALWAYS 5 cards
  clearNode(el.results);

  const top5 = scored.slice(0, 5);
  for (const row of top5){
    const card = renderCard(row.pub, row.best, row.effective, row.distMin, now, row.weather);
    el.results.appendChild(card);
  }

  // update map pins
  ensureMap();
  syncMarkers(scored);

  // if currently showing a map card for a pub, refresh it
  const openId = el.mapCard?.getAttribute('data-pubid');
  if (openId){
    const row = scored.find(x => x.pub.id === openId);
    if (row) showMapCard(row.pub, row.best, row.effective, row.weather, now);
  }
}

// ---------- Map ----------
function ensureMap(){
  if (map || !document.getElementById('map')) return;

  map = L.map('map', { zoomControl: true }).setView([NOTTINGHAM_CENTER.lat, NOTTINGHAM_CENTER.lng], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
}

function markerEmoji(effective){
  if (effective.kind === 'sun') return '☀️';
  if (effective.kind === 'mixed') return '⛅';
  if (effective.kind === 'rain') return '🌧️';
  return '•';
}

function syncMarkers(scored){
  if (!map) return;

  const keep = new Set();

  for (const row of scored){
    const pub = row.pub;
    keep.add(pub.id);

    let m = markers.get(pub.id);
    const icon = L.divIcon({
      className: 'ditS-pin',
      html: `<div style="font-size:18px;line-height:18px;">${markerEmoji(row.effective)}</div>`,
      iconSize: [24,24],
      iconAnchor: [12,12]
    });

    if (!m){
      m = L.marker([pub.lat, pub.lng], { icon }).addTo(map);
      m.on('click', () => {
        const now = new Date();
        showMapCard(pub, row.best, row.effective, row.weather, now);
      });
      markers.set(pub.id, m);
    } else {
      m.setIcon(icon);
    }
  }

  // remove stale
  for (const [id, m] of markers.entries()){
    if (!keep.has(id)){
      map.removeLayer(m);
      markers.delete(id);
    }
  }
}

function focusPubOnMap(pubId, openCard=false){
  if (!map) return;
  const pub = PUBS.find(p => p.id === pubId);
  if (!pub) return;

  map.setView([pub.lat, pub.lng], 16, { animate: true });

  if (openCard){
    // find best data
    (async ()=>{
      const now = new Date();
      const best = bestSpotWindow(pub, now);
      let weather=null;
      try{ weather = await fetchWeather(pub.lat, pub.lng); } catch {}
      const effective = classifyEffective(now, best?.win || null, weather);
      showMapCard(pub, best, effective, weather, now);
    })();
  }
}

function showMapCard(pub, best, effective, weather, now){
  if (!el.mapCard) return;

  const icon = wmoToIcon(weather?.current?.weather_code);
  const line = sunLine(best, now);
  const sit = best?.spot?.sit || '';
  const ocLine = openLine(pub, now);

  el.mapCard.style.display = '';
  el.mapCard.setAttribute('data-pubid', pub.id);

  el.mapCard.innerHTML = `
    <div class="mapCardTop">
      <div>
        <div class="mapCardTitle">${escapeHtml(pub.name)} <span class="badge wx">${icon}</span></div>
        <div class="mapCardSub">${escapeHtml(pub.area || 'Nottingham')}</div>
      </div>
      <button class="mapCardClose" type="button" aria-label="Close">✕</button>
    </div>
    <div class="mapCardRow">
      ${sit ? `<div><strong>Sit:</strong> ${escapeHtml(sit)}</div>` : `<div><strong>Sit:</strong> —</div>`}
      <div><strong>${escapeHtml(line)}</strong></div>
      ${ocLine ? `<div>${escapeHtml(ocLine)}</div>` : ``}
    </div>
    <div class="mapCardActions">
      <button class="smallBtn primary" type="button" data-act="dir">Directions</button>
      <button class="smallBtn" type="button" data-act="list">Open in list</button>
    </div>
  `;

  el.mapCard.querySelector('.mapCardClose')?.addEventListener('click', () => {
    el.mapCard.style.display = 'none';
    el.mapCard.removeAttribute('data-pubid');
  });

  el.mapCard.querySelector('button[data-act="dir"]')?.addEventListener('click', () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${pub.lat},${pub.lng}`;
    window.open(url, '_blank');
  });

  el.mapCard.querySelector('button[data-act="list"]')?.addEventListener('click', () => {
    setViewMode('list');
    // scroll to pub card if visible
    const cards = Array.from(document.querySelectorAll('.card'));
    const idx = cards.findIndex(c => c.querySelector('.cardTitle')?.textContent?.trim() === pub.name.trim());
    if (idx >= 0) cards[idx].scrollIntoView({ behavior:'smooth', block:'start' });
  });
}

// ---------- Perfect Day (overlay) ----------
function openOverlay(){
  if (!el.louOverlay) return;
  el.louOverlay.style.display = '';
  el.louOverlay.setAttribute('aria-hidden', 'false');
}
function closeOverlay(){
  if (!el.louOverlay) return;
  el.louOverlay.style.display = 'none';
  el.louOverlay.setAttribute('aria-hidden', 'true');
}
el.louBtn?.addEventListener('click', openOverlay);
el.louClose?.addEventListener('click', closeOverlay);
el.louBackdrop?.addEventListener('click', closeOverlay);
document.getElementById('louClose2')?.addEventListener('click', closeOverlay);

el.modeWalk?.addEventListener('click', ()=>{
  louMode = 'walk';
  el.modeWalk.classList.add('active');
  el.modeCycle.classList.remove('active');
});
el.modeCycle?.addEventListener('click', ()=>{
  louMode = 'cycle';
  el.modeCycle.classList.add('active');
  el.modeWalk.classList.remove('active');
});

function formatLeg(km, mode){
  if (mode === 'cycle'){
    const m = cycleMinutesFromKm(km);
    return `${m} min ride • ${km.toFixed(1)} km`;
  }
  const m = walkMinutesFromKm(km);
  return `${m} min walk • ${km.toFixed(1)} km`;
}

function chooseNextStop(cands, current, now, mode){
  // choose best sun window + distance constraint
  let best = null;
  for (const pub of cands){
    const km = current ? haversineKm({lat:current.lat,lng:current.lng},{lat:pub.lat,lng:pub.lng}) : 0;
    if (mode === 'walk' && km > PERFECT_DAY.walkMaxKm) continue;
    if (mode === 'cycle' && km > PERFECT_DAY.cycleMaxKm) continue;

    const b = bestSoonestWindow(pub, now) || bestSpotWindow(pub, now);
    if (!b) continue;

    const startsIn = minsBetween(now, b.win.start);
    const dur = minsBetween(b.win.start, b.win.end);

    const wxBonus = (mode === 'cycle') ? cycleWideBonus(pub) : 0;

    const score = 200 - startsIn*3 + dur*2 - km*18 + wxBonus;
    if (!best || score > best.score){
      best = { pub, score, km, win: b.win, spot: b.spot };
    }
  }
  return best;
}

function buildPerfectDay(startTime, stops, mode){
  const now = new Date();
  const baseDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12,0,0,0);

  const [sh, sm] = startTime.split(':').map(Number);
  let t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0, 0);

  const plan = [];
  const used = new Set();

  let current = null;

  for (let i=0;i<stops;i++){
    const cands = PUBS.filter(p => !used.has(p.id));
    const choice = chooseNextStop(cands, current, t, mode);
    if (!choice) break;

    used.add(choice.pub.id);

    const arrive = new Date(t);
    const start = choice.win.start > arrive ? choice.win.start : arrive;
    const maxStay = PERFECT_DAY.maxStopMin;
    const minStay = PERFECT_DAY.minStopMin;

    const end = addMinutes(start, clamp(minStay, 0, maxStay));
    const depart = addMinutes(end, PERFECT_DAY.bufferMin);

    plan.push({
      pub: choice.pub,
      spot: choice.spot,
      kmFromPrev: choice.km,
      arrive,
      start,
      end,
      sunEnd: choice.win.end
    });

    current = choice.pub;
    t = depart;

    if (t.getHours() >= PERFECT_DAY.endHourLocal) break;
  }

  return plan;
}

function renderPerfectDay(plan){
  if (!el.louOut) return;
  if (!plan.length){
    el.louOut.innerHTML = `<div class="bigCard cardTint0"><div class="bigTitle">No route found</div><div class="mini">Try a different start time or fewer stops.</div></div>`;
    return;
  }

  const parts = [];
  for (let i=0;i<plan.length;i++){
    const s = plan[i];
    const leg = i === 0 ? '' : `<div class="mini">${formatLeg(s.kmFromPrev, louMode)}</div>`;

    parts.push(`
      <div class="card cardTint2">
        <div class="cardTop">
          <div>
            <div class="cardTitle">${escapeHtml(s.pub.name)}</div>
            <div class="cardSub">${escapeHtml(s.pub.area || 'Nottingham')}</div>
          </div>
          <div class="badge wx">☀️</div>
        </div>
        ${leg}
        <div class="mini">
          <div><strong>Arrive:</strong> ${fmtHM(s.arrive)}</div>
          <div><strong>Sun:</strong> ${fmtHM(s.start)}–${fmtHM(s.sunEnd)}</div>
          <div><strong>Leave:</strong> ${fmtHM(s.end)}</div>
        </div>
        <div class="cardActions">
          <button class="smallBtn primary" type="button" data-act="dir" data-lat="${s.pub.lat}" data-lng="${s.pub.lng}">Directions</button>
          <button class="smallBtn" type="button" data-act="map" data-id="${s.pub.id}">Map</button>
        </div>
      </div>
    `);
  }

  el.louOut.innerHTML = parts.join('');

  el.louOut.querySelectorAll('button[data-act="dir"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const lat = btn.getAttribute('data-lat');
      const lng = btn.getAttribute('data-lng');
      const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
      window.open(url, '_blank');
    });
  });
  el.louOut.querySelectorAll('button[data-act="map"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-id');
      closeOverlay();
      setViewMode('map');
      focusPubOnMap(id, true);
    });
  });
}

el.louBuild?.addEventListener('click', ()=>{
  const start = el.louStart?.value || '12:00';
  const stops = parseInt(el.louStops?.value || '5', 10);
  const plan = buildPerfectDay(start, stops, louMode);
  renderPerfectDay(plan);
});

// ---------- Refresh ----------
const nextSunCache = { t:0, text:'' };
async function updateNextSunCard(){
  // legacy removed; now using forecast strip only
  return;
}

el.planRefresh?.addEventListener('click', async () => {
  weatherCache.clear();
  windowsCache.clear();
  nextSunCache.t = 0;
  await render();
});

// ---------- Boot ----------
async function boot(){
  try{
    // load CSV
    const res = await fetch('./public/data/DrinkingintheSunData.csv', { cache: 'no-store' });
    if (!res.ok) throw new Error('CSV not found');
    const text = await res.text();
    const rows = parseCSV(text);
    PUBS = buildPubs(rows);

    // initial labels
    el.nearBtnText.textContent = userLoc ? 'Near me ✓' : 'Near me';
    el.favToggleText.textContent = favOnly ? 'Favourites ✓' : 'Favourites';
    el.viewToggleText.textContent = viewMode === 'map' ? 'List' : 'Map';

    if (userLoc){
      el.nearBtnText.textContent = 'Near me ✓';
    }
    el.nearBtn?.addEventListener('click', async () => {
      await requestLocation();
      el.nearBtnText.textContent = userLoc ? 'Near me ✓' : 'Near me';
    });

    await render();
  } catch (e){
    console.error(e);
    el.plan.innerHTML = `
      <div class="bigCard cardTint0">
        <div class="bigTitle">Data load failed</div>
        <div class="mini">Ensure the CSV is at <strong>public/data/DrinkingintheSunData.csv</strong>.</div>
      </div>
    `;
  }
}
boot();
