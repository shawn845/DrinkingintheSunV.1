
const CSV_URL = './public/data/pubs.csv';
const FALLBACK_LOCATION = { name: 'Nottingham City Centre', lat: 52.9548, lng: -1.1581 };

const state = {
  pubs: [],
  userLocation: null,
  weather: null,
  map: null,
  markerLayer: null,
  currentView: 'list'
};

const els = {
  btnList: document.getElementById('btnList'),
  btnMap: document.getElementById('btnMap'),
  btnNearMe: document.getElementById('btnNearMe'),
  listView: document.getElementById('listView'),
  mapView: document.getElementById('mapView'),
  rowNearMeWrap: document.getElementById('rowNearMeWrap'),
  rowNearMe: document.getElementById('rowNearMe'),
  rowNearMeMeta: document.getElementById('rowNearMeMeta'),
  rowSunniest: document.getElementById('rowSunniest'),
  rowSunniestMeta: document.getElementById('rowSunniestMeta'),
  allList: document.getElementById('allList'),
  allMeta: document.getElementById('allMeta'),
  modalOverlay: document.getElementById('modalOverlay'),
  modalContent: document.getElementById('modalContent'),
  btnClose: document.getElementById('btnClose'),
  weatherBar: document.getElementById('weatherBar'),
  weatherIcon: document.getElementById('weatherIcon'),
  weatherLine: document.getElementById('weatherLine')
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireUi();
  state.pubs = (await loadPubs()).map(enrichPub);
  await refreshWeather(FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lng);
  renderEverything();
  initMap();
  if (location.hash === '#map') setView('map', false);
}

function wireUi() {
  els.btnList.addEventListener('click', () => setView('list'));
  els.btnMap.addEventListener('click', () => setView('map'));
  els.btnNearMe.addEventListener('click', useNearMe);
  els.btnClose.addEventListener('click', () => closeModal(true));
  els.modalOverlay.addEventListener('click', (e) => {
    if (e.target === els.modalOverlay) closeModal(true);
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(true); });
  window.addEventListener('popstate', () => {
    if (!els.modalOverlay.classList.contains('isHidden')) {
      closeModal(false);
      return;
    }
    if (location.hash === '#map') setView('map', false);
    else setView('list', false);
  });
}

function setView(view, push=true) {
  state.currentView = view;
  const isList = view === 'list';
  els.listView.classList.toggle('isActive', isList);
  els.mapView.classList.toggle('isActive', !isList);
  els.btnList.classList.toggle('isActive', isList);
  els.btnMap.classList.toggle('isActive', !isList);
  els.btnList.setAttribute('aria-selected', String(isList));
  els.btnMap.setAttribute('aria-selected', String(!isList));
  if (!isList && state.map) setTimeout(() => state.map.invalidateSize(), 80);
  if (push) history.pushState({}, '', isList ? '#list' : '#map');
}

async function useNearMe() {
  if (!navigator.geolocation) {
    state.userLocation = { ...FALLBACK_LOCATION, fallback: true };
    renderEverything();
    return;
  }
  els.btnNearMe.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    state.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, name: 'Your location', fallback: false };
    els.btnNearMe.textContent = 'Near me';
    await refreshWeather(state.userLocation.lat, state.userLocation.lng);
    renderEverything();
    if (state.map) state.map.setView([state.userLocation.lat, state.userLocation.lng], 13);
  }, async () => {
    state.userLocation = { ...FALLBACK_LOCATION, fallback: true };
    els.btnNearMe.textContent = 'Near me';
    await refreshWeather(FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lng);
    renderEverything();
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 });
}

async function loadPubs() {
  const res = await fetch(CSV_URL);
  const text = await res.text();
  return parseCsv(text).map(normalizeRow).filter(isValidPubRow);
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  let headers = null;
  const rows = [];
  for (const line of lines) {
    const cols = splitCsvLine(line);
    if (!headers) {
      headers = cols.map(v => String(v || '').trim());
      continue;
    }
    const obj = {};
    headers.forEach((h, i) => obj[h] = String(cols[i] ?? '').trim());
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizeRow(row) {
  const pick = (...keys) => {
    for (const k of keys) {
      if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
    }
    return '';
  };
  return {
    id: pick('id'),
    name: pick('name'),
    address: pick('address'),
    lat: parseFloat(pick('lat')),
    lng: parseFloat(pick('lng')),
    spotA: pick('spot_a', 'Spot_a'),
    baseDate: pick('base_date'),
    spotAStart: pick('spot_a_sun_start'),
    spotAEnd: pick('spot_a_sun_end'),
    spotB: pick('spot_b'),
    spotBStart: pick('spot_b_sun_start'),
    spotBEnd: pick('spot_b_sun_end'),
    imageUrl: pick('image_url'),
    notes: pick('notes')
  };
}

function isValidPubRow(pub) {
  return !!(pub.id && pub.name && Number.isFinite(pub.lat) && Number.isFinite(pub.lng) && pub.spotA && pub.baseDate && pub.spotAStart && pub.spotAEnd);
}

function enrichPub(pub) {
  const now = new Date();
  const today = formatDate(now);
  const aToday = shiftWindow(pub.baseDate, pub.spotAStart, pub.spotAEnd, today);
  const bToday = pub.spotB && pub.spotBStart && pub.spotBEnd ? shiftWindow(pub.baseDate, pub.spotBStart, pub.spotBEnd, today) : null;
  const best = chooseBestWindow(aToday, bToday, now);
  const distanceKm = state.userLocation ? haversineKm(state.userLocation.lat, state.userLocation.lng, pub.lat, pub.lng) : null;
  return { ...pub, spotAToday: aToday, spotBToday: bToday, bestNow: best, distanceKm };
}

function reEnrichAll() {
  state.pubs = state.pubs.map(enrichPub);
}

function shiftWindow(baseDateStr, startHHMM, endHHMM, targetDateStr) {
  const baseDate = parseISODate(baseDateStr);
  const targetDate = parseISODate(targetDateStr);
  const daysDiff = Math.round((targetDate - baseDate) / 86400000);
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  const shiftedStartMinutes = sh * 60 + (sm || 0) - (daysDiff * 4);
  const shiftedEndMinutes = eh * 60 + (em || 0) - (daysDiff * 4);
  const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
  return {
    start: new Date(dayStart.getTime() + shiftedStartMinutes * 60000),
    end: new Date(dayStart.getTime() + shiftedEndMinutes * 60000)
  };
}

function chooseBestWindow(a, b, now) {
  const candidates = [a, b].filter(Boolean);
  if (!candidates.length) return { state: 'none', line: 'Sun time unavailable', window: null };
  const active = candidates.find(w => now >= w.start && now <= w.end);
  if (active) return { state: 'sunny', line: `Sun until ${fmtTime(active.end)}`, window: active };
  const upcoming = candidates.filter(w => now < w.start).sort((x, y) => x.start - y.start)[0];
  if (upcoming) return { state: 'shade', line: `Sun from ${fmtTime(upcoming.start)}`, window: upcoming };
  return { state: 'none', line: 'No more sun today', window: null };
}

function buildSpotState(windowObj, now) {
  if (!windowObj) return { status: 'Sun time unavailable', line: '', badge: 'Unavailable' };
  if (now >= windowObj.start && now <= windowObj.end) return { status: 'Sunny now', line: `Sun until ${fmtTime(windowObj.end)}`, badge: 'Best now' };
  if (now < windowObj.start) return { status: 'Not sunny now', line: `Sun from ${fmtTime(windowObj.start)}`, badge: 'Later today' };
  return { status: 'Not sunny now', line: 'No more sun today', badge: 'Finished today' };
}

function renderEverything() {
  reEnrichAll();
  renderNearMeRow();
  renderSunniestRow();
  renderAllList();
  renderMapMarkers();
}

function renderNearMeRow() {
  if (!state.userLocation) {
    els.rowNearMeWrap.classList.add('isHidden');
    return;
  }
  els.rowNearMeWrap.classList.remove('isHidden');
  const pubs = [...state.pubs]
    .map(p => ({ ...p, distanceKm: haversineKm(state.userLocation.lat, state.userLocation.lng, p.lat, p.lng) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 10);
  els.rowNearMe.innerHTML = '';
  pubs.forEach(pub => els.rowNearMe.appendChild(createCard(pub, true)));
  els.rowNearMeMeta.textContent = state.userLocation.fallback ? 'Using city centre' : 'Closest pubs';
}

function renderSunniestRow() {
  const now = new Date();
  const pubs = [...state.pubs]
    .filter(p => p.bestNow.state === 'sunny')
    .sort((a, b) => (b.bestNow.window.end - now) - (a.bestNow.window.end - now))
    .slice(0, 10);
  els.rowSunniest.innerHTML = '';
  if (!pubs.length) {
    els.rowSunniest.innerHTML = '<div class="emptyState">No pubs are currently marked sunny right now.</div>';
    els.rowSunniestMeta.textContent = '';
    return;
  }
  pubs.forEach(pub => els.rowSunniest.appendChild(createCard(pub, true)));
  els.rowSunniestMeta.textContent = `${pubs.length} shown`;
}

function renderAllList() {
  const pubs = [...state.pubs].sort(compareForMainList);
  els.allList.innerHTML = '';
  pubs.forEach(pub => els.allList.appendChild(createCard(pub, false)));
  els.allMeta.textContent = `${pubs.length} pubs`;
}

function compareForMainList(a, b) {
  const rank = p => p.bestNow.state === 'sunny' ? 0 : p.bestNow.state === 'shade' ? 1 : 2;
  const ar = rank(a), br = rank(b);
  if (ar !== br) return ar - br;
  if (a.bestNow.state === 'sunny' && b.bestNow.state === 'sunny') return a.bestNow.window.end - b.bestNow.window.end;
  if (a.bestNow.state === 'shade' && b.bestNow.state === 'shade') return a.bestNow.window.start - b.bestNow.window.start;
  return a.name.localeCompare(b.name);
}

function createCard(pub, small=false) {
  const wrap = document.createElement('div');
  wrap.className = `card ${small ? 'cardSmall' : ''}`;
  const statusClass = pub.bestNow.state === 'sunny' ? 'statusSun' : pub.bestNow.state === 'shade' ? 'statusShade' : 'statusNone';
  const distanceText = state.userLocation ? `${(pub.distanceKm ?? haversineKm(state.userLocation.lat, state.userLocation.lng, pub.lat, pub.lng)).toFixed(1)} km` : '';
  wrap.innerHTML = `
    <button class="cardButton" type="button" aria-label="Open ${escapeHtml(pub.name)} details">
      <img class="cardImg" loading="lazy" src="${escapeAttr(pub.imageUrl || '')}" alt="${escapeAttr(pub.name)}" onerror="this.style.display='none';" />
      <div class="cardBody">
        <h3 class="cardTitle">${escapeHtml(pub.name)}</h3>
        <div class="cardMeta">
          <div class="${statusClass}">
            <div class="statusTop">${pub.bestNow.state === 'sunny' ? 'Sunny now' : pub.bestNow.state === 'shade' ? 'Not sunny now' : 'No more sun today'}</div>
            <div class="statusLine">${escapeHtml(pub.bestNow.line)}</div>
          </div>
          ${state.userLocation ? `<div class="dist">${distanceText}</div>` : ''}
        </div>
      </div>
    </button>`;
  wrap.querySelector('.cardButton').addEventListener('click', () => openDetail(pub.id));
  return wrap;
}

function openDetail(pubId) {
  const pub = state.pubs.find(p => p.id === pubId);
  if (!pub) return;
  const now = new Date();
  const aState = buildSpotState(pub.spotAToday, now);
  const bState = pub.spotB && pub.spotBToday ? buildSpotState(pub.spotBToday, now) : null;
  els.modalContent.innerHTML = `
    <img class="heroImg" src="${escapeAttr(pub.imageUrl || '')}" alt="${escapeAttr(pub.name)}" onerror="this.style.display='none';" />
    <div class="detailBody">
      <h2 class="detailTitle">${escapeHtml(pub.name)}</h2>
      <div class="detailAddress">${escapeHtml(pub.address || '')}</div>
      ${pub.notes ? `<div class="detailNotes">${escapeHtml(pub.notes)}</div>` : ''}
      <div class="detailActions">
        <a class="pillBtn" href="${mapsHref(pub.lat, pub.lng, pub.name)}" target="_blank" rel="noopener">Directions</a>
      </div>
    </div>
    <div class="spotList">
      ${renderSpotCard('Spot A', pub.spotA, pub.spotAToday, aState)}
      ${pub.spotB && pub.spotBToday ? renderSpotCard('Spot B', pub.spotB, pub.spotBToday, bState) : ''}
    </div>`;
  els.modalOverlay.classList.remove('isHidden');
  history.pushState({ modal: pubId }, '', `#pub-${encodeURIComponent(pubId)}`);
}

function renderSpotCard(kicker, name, windowObj, stateObj) {
  const todayStart = new Date(windowObj.start); todayStart.setHours(9,0,0,0);
  const todayEnd = new Date(windowObj.start); todayEnd.setHours(21,0,0,0);
  const spanTotal = todayEnd - todayStart;
  const sunLeftPct = clamp(((windowObj.start - todayStart) / spanTotal) * 100, 0, 100);
  const sunWidthPct = clamp(((windowObj.end - windowObj.start) / spanTotal) * 100, 0, 100);
  const nowPct = clamp(((new Date() - todayStart) / spanTotal) * 100, 0, 100);
  return `
    <section class="spotCard">
      <div class="spotHead">
        <div>
          <div class="spotKicker">${escapeHtml(kicker)}</div>
          <div class="spotName">${escapeHtml(name)}</div>
        </div>
        <div class="spotBadge">${escapeHtml(stateObj.badge)}</div>
      </div>
      <div class="spotStatus">${escapeHtml(stateObj.status)}</div>
      <div class="spotSub">${escapeHtml(stateObj.line)}</div>
      <div class="timelineWrap">
        <div class="timelineLabels"><span>09:00</span><span>21:00</span></div>
        <div class="timeline">
          <div class="timelineSun" style="left:${sunLeftPct}%; width:${sunWidthPct}%;"></div>
          <div class="timelineNow" style="left:${nowPct}%;"></div>
        </div>
        <div class="timelineNowLabel">now</div>
      </div>
      <div class="spotWindow">Sun today: ${fmtTime(windowObj.start)}–${fmtTime(windowObj.end)}</div>
    </section>`;
}

function closeModal(push=false) {
  els.modalOverlay.classList.add('isHidden');
  els.modalContent.innerHTML = '';
  if (push) history.pushState({}, '', state.currentView === 'map' ? '#map' : '#list');
}

async function refreshWeather(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation_probability,weathercode&forecast_days=1`;
    const res = await fetch(url);
    const data = await res.json();
    state.weather = pickNextHour(data);
    renderWeatherBar();
  } catch (e) {
    state.weather = null;
    renderWeatherBar();
  }
}

function pickNextHour(data) {
  if (!data || !data.hourly || !data.hourly.time?.length) return null;
  const now = new Date();
  const times = data.hourly.time.map(t => new Date(t));
  let idx = times.findIndex(t => t > now);
  if (idx === -1) idx = 0;
  return { time: times[idx], temp: data.hourly.temperature_2m[idx], rain: data.hourly.precipitation_probability[idx], code: data.hourly.weathercode[idx] };
}

function renderWeatherBar() {
  if (!state.weather) {
    els.weatherLine.textContent = 'Weather unavailable';
    els.weatherIcon.textContent = '⛅';
    els.weatherBar.className = 'weatherBar cloudy';
    return;
  }
  const mood = weatherMood(state.weather.code, state.weather.rain);
  els.weatherIcon.textContent = mood.icon;
  els.weatherLine.textContent = `${Math.round(state.weather.temp)}°C · rain ${Math.round(state.weather.rain)}%`;
  els.weatherBar.className = `weatherBar ${mood.className}`;
}

function weatherMood(code, rain) {
  if (rain >= 50 || [51,53,55,61,63,65,80,81,82].includes(code)) return { icon:'🌧️', className:'rainy' };
  if ([0].includes(code)) return { icon:'☀️', className:'sunny' };
  return { icon:'⛅', className:'cloudy' };
}

function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);
  renderMapMarkers();
}

function renderMapMarkers() {
  if (!state.map || !state.markerLayer) return;
  state.markerLayer.clearLayers();
  state.pubs.forEach(pub => {
    const color = pub.bestNow.state === 'sunny' ? '#f5c542' : '#9f9f9f';
    const marker = L.circleMarker([pub.lat, pub.lng], {
      radius: 9, color: '#555', weight: 1, fillColor: color, fillOpacity: 0.95
    });
    marker.on('click', () => openDetail(pub.id));
    marker.bindTooltip(pub.name, { direction: 'top', offset: [0, -6] });
    marker.addTo(state.markerLayer);
  });
}

function mapsHref(lat, lng, name) {
  const q = encodeURIComponent(name || `${lat},${lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}(${q})`;
}

function parseISODate(str) {
  const [y,m,d] = String(str || '').split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function fmtTime(d) {
  return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2-lat1), dLon = deg2rad(lon2-lon1);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}
function deg2rad(d){ return d * Math.PI / 180; }
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function escapeHtml(str='') {
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function escapeAttr(str=''){ return escapeHtml(str); }
