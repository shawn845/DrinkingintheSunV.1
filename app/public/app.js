
const CSV_URL = './public/data/pubs.csv';
const FALLBACK_LOCATION = { name: 'Nottingham City Centre', lat: 52.9548, lng: -1.1581 };

const state = {
  pubs: [],
  userLocation: null,
  weather: null,
  map: null,
  markerLayer: null,
  currentView: 'list',
  modalReturnView: 'list',
  userMarker: null,
  userAccuracyCircle: null,
  weatherRefreshTimer: null
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
  weatherLine: document.getElementById('weatherLine'),
  weatherTitle: document.querySelector('.weatherTitle')
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireUi();
  state.pubs = (await loadPubs()).map(enrichPub);
  await refreshWeather(FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lng);
  renderEverything();
  initMap();
  setRowTitles();
  startWeatherRefresh();
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

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal(true);
  });

  window.addEventListener('popstate', () => {
    if (!els.modalOverlay.classList.contains('isHidden')) {
      closeModal(false);
      return;
    }
    if (location.hash === '#map') setView('map', false);
    else setView('list', false);
  });
}

function setView(view, push = true) {
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
    await refreshWeather(FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lng);
    renderEverything();
    startWeatherRefresh();
    return;
  }

  els.btnNearMe.textContent = 'Locating…';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      state.userLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        name: 'Your location',
        fallback: false
      };

      els.btnNearMe.textContent = 'Near me';
      await refreshWeather(state.userLocation.lat, state.userLocation.lng);
      renderEverything();
      updateUserLocationMarker();
      startWeatherRefresh();

      if (state.map) state.map.setView([state.userLocation.lat, state.userLocation.lng], 13);
    },
    async () => {
      state.userLocation = { ...FALLBACK_LOCATION, fallback: true };
      els.btnNearMe.textContent = 'Near me';
      await refreshWeather(FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lng);
      renderEverything();
      clearUserLocationMarker();
      startWeatherRefresh();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
  );
}

function startWeatherRefresh() {
  if (state.weatherRefreshTimer) clearInterval(state.weatherRefreshTimer);

  state.weatherRefreshTimer = setInterval(async () => {
    const loc = state.userLocation && !state.userLocation.fallback ? state.userLocation : FALLBACK_LOCATION;
    await refreshWeather(loc.lat, loc.lng);
    renderEverything();
  }, 5 * 60 * 1000);
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
    headers.forEach((h, i) => { obj[h] = String(cols[i] ?? '').trim(); });
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
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
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
  return !!(
    pub.id &&
    pub.name &&
    Number.isFinite(pub.lat) &&
    Number.isFinite(pub.lng) &&
    pub.spotA &&
    pub.baseDate &&
    pub.spotAStart &&
    pub.spotAEnd
  );
}

function enrichPub(pub) {
  const now = new Date();
  const today = formatDate(now);

  const aToday = shiftWindow(pub.lat, pub.lng, pub.baseDate, pub.spotAStart, pub.spotAEnd, today);
  const bToday = (pub.spotB && pub.spotBStart && pub.spotBEnd)
    ? shiftWindow(pub.lat, pub.lng, pub.baseDate, pub.spotBStart, pub.spotBEnd, today)
    : null;

  const best = chooseBestWindow(aToday, bToday, now);
  const distanceKm = state.userLocation
    ? haversineKm(state.userLocation.lat, state.userLocation.lng, pub.lat, pub.lng)
    : null;

  return { ...pub, spotAToday: aToday, spotBToday: bToday, bestNow: best, distanceKm };
}

function reEnrichAll() {
  state.pubs = state.pubs.map(enrichPub);
}

function shiftWindow(lat, lng, baseDateStr, startHHMM, endHHMM, targetDateStr) {
  const baseDate = parseISODate(baseDateStr);
  const targetDate = parseISODate(targetDateStr);

  const baseSolar = getSolarTimesLocal(lat, lng, baseDate);
  const targetSolar = getSolarTimesLocal(lat, lng, targetDate);

  if (!baseSolar || !targetSolar) {
    return {
      start: minutesToLocalDate(targetDate, hhmmToMinutes(startHHMM)),
      end: minutesToLocalDate(targetDate, hhmmToMinutes(endHHMM))
    };
  }

  const baseStartMin = hhmmToMinutes(startHHMM);
  const baseEndMin = hhmmToMinutes(endHHMM);

  return {
    start: minutesToLocalDate(targetDate, mapSolarRelative(baseStartMin, baseSolar, targetSolar)),
    end: minutesToLocalDate(targetDate, mapSolarRelative(baseEndMin, baseSolar, targetSolar))
  };
}

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToLocalDate(dateObj, minutes) {
  const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

function mapSolarRelative(obsMinutes, baseSolar, targetSolar) {
  if (obsMinutes <= baseSolar.noon) {
    const frac = safeFraction(obsMinutes, baseSolar.sunrise, baseSolar.noon);
    return targetSolar.sunrise + frac * (targetSolar.noon - targetSolar.sunrise);
  }

  const frac = safeFraction(obsMinutes, baseSolar.noon, baseSolar.sunset);
  return targetSolar.noon + frac * (targetSolar.sunset - targetSolar.noon);
}

function safeFraction(value, min, max) {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

function getSolarTimesLocal(lat, lng, dateObj) {
  const dayNum = dayOfYear(dateObj);
  const gamma = (2 * Math.PI / 365) * (dayNum - 1);

  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const latRad = deg2rad(lat);
  const zenith = deg2rad(90.833);

  const cosH =
    (Math.cos(zenith) / (Math.cos(latRad) * Math.cos(decl))) -
    Math.tan(latRad) * Math.tan(decl);

  if (cosH < -1 || cosH > 1) return null;

  const hourAngleDeg = rad2deg(Math.acos(cosH));
  const tzHours = -dateObj.getTimezoneOffset() / 60;

  const solarNoon = 720 - (4 * lng) - eqTime + (tzHours * 60);
  const sunrise = solarNoon - (hourAngleDeg * 4);
  const sunset = solarNoon + (hourAngleDeg * 4);

  return { sunrise, noon: solarNoon, sunset };
}

function dayOfYear(dateObj) {
  const start = new Date(dateObj.getFullYear(), 0, 0);
  return Math.floor((dateObj - start) / 86400000);
}

function getWindows(pub) {
  const out = [];
  if (pub.spotAToday) out.push(pub.spotAToday);
  if (pub.spotBToday) out.push(pub.spotBToday);
  return out;
}

function getWindowStats(pub, now) {
  const windows = getWindows(pub).filter(w => w && w.end > w.start);
  const remaining = windows.filter(w => w.end > now);

  const active = remaining.find(w => now >= w.start && now <= w.end) || null;
  const next = remaining.filter(w => now < w.start).sort((a, b) => a.start - b.start)[0] || null;
  const latestRemainingWindow = remaining.sort((a, b) => b.end - a.end)[0] || null;
  const latestRemainingEnd = latestRemainingWindow ? latestRemainingWindow.end : null;

  return { activeWindow: active, nextWindow: next, latestRemainingEnd, latestRemainingWindow };
}

function weatherMood(code, wetValue = 0, cloudCover = null) {
  const rainyCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
  const cloudyCodes = [2, 3, 45, 48];
  const sunnyCodes = [0, 1];

  if (rainyCodes.includes(code) || wetValue >= 0.1) return { icon: '🌧️', className: 'rainy' };
  if (cloudyCodes.includes(code)) return { icon: '⛅', className: 'cloudy' };

  if (sunnyCodes.includes(code)) {
    if (cloudCover != null && cloudCover > 65) return { icon: '⛅', className: 'cloudy' };
    return { icon: '☀️', className: 'sunny' };
  }

  return { icon: '⛅', className: 'cloudy' };
}

function currentWeatherLabel(currentObj) {
  if (!currentObj) return 'Weather unavailable';
  const code = currentObj.code;

  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code) || currentObj.precip >= 0.1) return 'Rainy';
  if (code === 0) return currentObj.isDay ? 'Sunny' : 'Clear';
  if (code === 1) return currentObj.isDay ? 'Mostly sunny' : 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if ([45, 48].includes(code)) return 'Foggy';
  return 'Cloudy';
}

function nextHourLabel(nextObj) {
  if (!nextObj) return 'Unavailable';
  const code = nextObj.code;

  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code) || nextObj.rain >= 50) return 'Rainy';
  if (code === 0) return 'Sunny';
  if (code === 1) return 'Mostly sunny';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if ([45, 48].includes(code)) return 'Foggy';
  return 'Cloudy';
}

function getWeatherTone() {
  if (!state.weather || !state.weather.current) return 'cloudy';
  return weatherMood(state.weather.current.code, state.weather.current.precip, state.weather.current.cloudCover).className;
}

function getDisplayStatus(pub) {
  const tone = getWeatherTone();
  const baseState = pub.bestNow.state;

  let top = 'No more sun today';
  let line = pub.bestNow.line;
  let cls = 'statusNone';
  let pin = '#9f9f9f';

  if (baseState === 'sunny') {
    if (tone === 'sunny') {
      top = 'Sunny now';
      cls = 'statusSunBright';
      pin = '#f5c542';
    } else if (tone === 'cloudy') {
      top = 'Cloudy now';
      cls = 'statusSunMuted';
      pin = '#d6b24a';
    } else {
      top = 'Not sunny now';
      cls = 'statusSunRainy';
      pin = '#9f9f9f';
    }
  } else if (baseState === 'shade') {
    if (tone === 'rainy') {
      top = 'Rainy now';
      cls = 'statusSunRainy';
    } else if (tone === 'cloudy') {
      top = 'Cloudy now';
      cls = 'statusShade';
    } else {
      top = 'Not sunny now';
      cls = 'statusShade';
    }
  }

  return { top, line, cls, pin, tone };
}

function buildSpotStateWeatherAware(windowObj, now) {
  const tone = getWeatherTone();

  if (!windowObj) return { status: 'Sun time unavailable', line: '', badge: 'Unavailable' };

  const inWindow = now >= windowObj.start && now <= windowObj.end;
  const upcoming = now < windowObj.start;

  if (inWindow) {
    if (tone === 'sunny') return { status: 'Sunny now', line: `Sun until ${fmtTime(windowObj.end)}`, badge: 'Best now' };
    if (tone === 'cloudy') return { status: 'Cloudy now', line: `Sun until ${fmtTime(windowObj.end)}`, badge: 'Best now' };
    return { status: 'Not sunny now', line: `Sun until ${fmtTime(windowObj.end)}`, badge: 'Best now' };
  }

  if (upcoming) {
    if (tone === 'rainy') return { status: 'Rainy now', line: `Sun from ${fmtTime(windowObj.start)}`, badge: 'Later today' };
    if (tone === 'cloudy') return { status: 'Cloudy now', line: `Sun from ${fmtTime(windowObj.start)}`, badge: 'Later today' };
    return { status: 'Not sunny now', line: `Sun from ${fmtTime(windowObj.start)}`, badge: 'Later today' };
  }

  return { status: 'Finished today', line: 'No more sun today', badge: 'Finished today' };
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

function renderEverything() {
  reEnrichAll();
  setRowTitles();
  renderSunniestNearMeRow();
  renderLatestSunTodayRow();
  renderAllList();
  renderMapMarkers();
}

function setRowTitles() {
  try {
    const nearTitle = els.rowNearMeWrap.querySelector('.rowTitle');
    if (nearTitle) nearTitle.textContent = 'Sunniest near me';

    const latestWrap = els.rowSunniest.closest('.rowWrap');
    const latestTitle = latestWrap ? latestWrap.querySelector('.rowTitle') : null;
    if (latestTitle) latestTitle.textContent = 'Latest sun today';
  } catch {}
}

function renderSunniestNearMeRow() {
  if (!state.userLocation) {
    els.rowNearMeWrap.classList.add('isHidden');
    return;
  }

  els.rowNearMeWrap.classList.remove('isHidden');
  const now = new Date();

  const pubs = [...state.pubs]
    .map(p => {
      const dist = haversineKm(state.userLocation.lat, state.userLocation.lng, p.lat, p.lng);
      const stats = getWindowStats(p, now);
      const remainingMins = (stats.activeWindow ? (stats.activeWindow.end - now) : 0) / 60000;
      return { ...p, distanceKm: dist, _remainingMins: remainingMins };
    })
    .filter(p => p.bestNow.state === 'sunny')
    .sort((a, b) => {
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return b._remainingMins - a._remainingMins;
    })
    .slice(0, 10);

  els.rowNearMe.innerHTML = '';

  if (!pubs.length) {
    els.rowNearMe.innerHTML = '<div class="emptyState">No pubs are currently in a sun window near you.</div>';
    els.rowNearMeMeta.textContent = state.userLocation.fallback ? 'Using city centre' : '';
    return;
  }

  pubs.forEach(pub => els.rowNearMe.appendChild(createCard(pub, true)));
  els.rowNearMeMeta.textContent = state.userLocation.fallback ? 'Using city centre' : 'Closest options';
}

function renderLatestSunTodayRow() {
  const now = new Date();

  const pubs = [...state.pubs]
    .map(p => {
      const stats = getWindowStats(p, now);
      return { pub: p, latestEnd: stats.latestRemainingEnd };
    })
    .filter(x => x.latestEnd)
    .sort((a, b) => b.latestEnd - a.latestEnd)
    .slice(0, 10);

  els.rowSunniest.innerHTML = '';

  if (!pubs.length) {
    els.rowSunniest.innerHTML = '<div class="emptyState">No more sun windows remaining today.</div>';
    els.rowSunniestMeta.textContent = '';
    return;
  }

  pubs.forEach(x => els.rowSunniest.appendChild(createCard(x.pub, true)));
  els.rowSunniestMeta.textContent = pubs[0].latestEnd ? `Latest ends ${fmtTime(pubs[0].latestEnd)}` : '';
}

function renderAllList() {
  const pubs = [...state.pubs].sort(compareForMainList);
  els.allList.innerHTML = '';
  pubs.forEach(pub => els.allList.appendChild(createCard(pub, false)));
  els.allMeta.textContent = `${pubs.length} pubs`;
}

function compareForMainList(a, b) {
  const now = new Date();
  const rank = p => p.bestNow.state === 'sunny' ? 0 : p.bestNow.state === 'shade' ? 1 : 2;
  const ar = rank(a), br = rank(b);
  if (ar !== br) return ar - br;

  if (a.bestNow.state === 'sunny' && b.bestNow.state === 'sunny') {
    return (b.bestNow.window.end - now) - (a.bestNow.window.end - now);
  }

  if (a.bestNow.state === 'shade' && b.bestNow.state === 'shade') {
    return a.bestNow.window.start - b.bestNow.window.start;
  }

  return a.name.localeCompare(b.name);
}

function createCard(pub, small = false) {
  const wrap = document.createElement('div');
  wrap.className = `card ${small ? 'cardSmall' : ''}`;

  const display = getDisplayStatus(pub);
  const distanceText = state.userLocation
    ? `${(pub.distanceKm ?? haversineKm(state.userLocation.lat, state.userLocation.lng, pub.lat, pub.lng)).toFixed(1)} km`
    : '';

  wrap.innerHTML = `
    <button class="cardButton" type="button" aria-label="Open ${escapeHtml(pub.name)} details">
      <img class="cardImg" loading="lazy" src="${escapeAttr(pub.imageUrl || '')}" alt="${escapeAttr(pub.name)}" onerror="this.style.display='none';" />
      <div class="cardBody">
        <h3 class="cardTitle">${escapeHtml(pub.name)}</h3>
        <div class="cardMeta">
          <div class="${display.cls}">
            <div class="statusTop">${escapeHtml(display.top)}</div>
            <div class="statusLine">${escapeHtml(display.line)}</div>
          </div>
          ${state.userLocation ? `<div class="dist">${distanceText}</div>` : ''}
        </div>
      </div>
    </button>
  `;

  wrap.querySelector('.cardButton').addEventListener('click', () => openDetail(pub.id, state.currentView));
  return wrap;
}

function openDetail(pubId, sourceView = 'list') {
  state.modalReturnView = sourceView || state.currentView;
  if (state.currentView === 'map') setView('list', false);

  const pub = state.pubs.find(p => p.id === pubId);
  if (!pub) return;

  const now = new Date();
  const aState = buildSpotStateWeatherAware(pub.spotAToday, now);
  const bState = pub.spotB && pub.spotBToday ? buildSpotStateWeatherAware(pub.spotBToday, now) : null;

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
      ${renderSpotCard('Location', pub.spotA, pub.spotAToday, aState)}
      ${pub.spotB && pub.spotBToday ? renderSpotCard('Location', pub.spotB, pub.spotBToday, bState) : ''}
    </div>
  `;

  els.modalOverlay.classList.remove('isHidden');
  history.pushState({ modal: pubId }, '', `#pub-${encodeURIComponent(pubId)}`);
}

function renderSpotCard(kicker, name, windowObj, stateObj) {
  const todayStart = new Date(windowObj.start);
  todayStart.setHours(7, 0, 0, 0);

  const todayEnd = new Date(windowObj.start);
  todayEnd.setHours(23, 0, 0, 0);

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
        <div class="timelineLabels"><span>07:00</span><span>23:00</span></div>
        <div class="timeline">
          <div class="timelineSun" style="left:${sunLeftPct}%; width:${sunWidthPct}%;"></div>
          <div class="timelineNow" style="left:${nowPct}%;"></div>
        </div>
        <div class="timelineNowLabel">now</div>
      </div>

      <div class="spotWindow">Sun today: ${fmtTime(windowObj.start)}–${fmtTime(windowObj.end)}</div>
    </section>
  `;
}

function closeModal(push = false) {
  els.modalOverlay.classList.add('isHidden');
  els.modalContent.innerHTML = '';

  const ret = state.modalReturnView || 'list';
  state.modalReturnView = 'list';

  if (ret === 'map') setView('map', false);
  if (push) history.pushState({}, '', state.currentView === 'map' ? '#map' : '#list');
}

async function refreshWeather(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code,cloud_cover,is_day&hourly=temperature_2m,precipitation_probability,weather_code,cloud_cover&forecast_days=1`;
    const res = await fetch(url);
    const data = await res.json();

    state.weather = { current: pickCurrent(data), nextHour: pickNextHour(data) };
    renderWeatherBar();
  } catch {
    state.weather = null;
    renderWeatherBar();
  }
}

function pickCurrent(data) {
  if (!data || !data.current) return null;
  return {
    temp: data.current.temperature_2m,
    precip: data.current.precipitation ?? 0,
    code: data.current.weather_code,
    cloudCover: data.current.cloud_cover ?? null,
    isDay: Boolean(data.current.is_day)
  };
}

function pickNextHour(data) {
  if (!data || !data.hourly || !data.hourly.time?.length) return null;

  const now = new Date();
  const times = data.hourly.time.map(t => new Date(t));
  let idx = times.findIndex(t => t > now);
  if (idx === -1) idx = 0;

  return {
    time: times[idx],
    temp: data.hourly.temperature_2m[idx],
    rain: data.hourly.precipitation_probability[idx] ?? 0,
    code: data.hourly.weather_code[idx],
    cloudCover: data.hourly.cloud_cover?.[idx] ?? null
  };
}

function renderWeatherBar() {
  if (!state.weather || !state.weather.current) {
    els.weatherIcon.textContent = '⛅';
    if (els.weatherTitle) els.weatherTitle.textContent = 'Current conditions';
    els.weatherLine.textContent = 'Weather unavailable';
    els.weatherBar.className = 'weatherBar cloudy';
    return;
  }

  const current = state.weather.current;
  const next = state.weather.nextHour;
  const currentMood = weatherMood(current.code, current.precip, current.cloudCover);
  const currentLabel = currentWeatherLabel(current);
  const nextLabel = next ? nextHourLabel(next) : 'Unavailable';
  const nextTemp = next ? `${Math.round(next.temp)}°C` : '—';
  const nextRain = next ? `${Math.round(next.rain)}% rain` : '—';

  els.weatherIcon.textContent = currentMood.icon;
  if (els.weatherTitle) els.weatherTitle.textContent = 'Current conditions';
  els.weatherBar.className = `weatherBar ${currentMood.className}`;
  els.weatherLine.textContent = `${currentLabel} · ${Math.round(current.temp)}°C · Next hour: ${nextLabel} · ${nextTemp} · ${nextRain}`;
}

function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lng], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(state.map);

  state.markerLayer = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 16,
    maxClusterRadius: 40
  });
  state.map.addLayer(state.markerLayer);

  renderMapMarkers();
  updateUserLocationMarker();
}

function makePubMarker(pub) {
  const display = getDisplayStatus(pub);
  const icon = L.divIcon({
    className: 'pub-pin-wrap',
    html: `<div class="pub-pin" style="background:${display.pin};"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  return L.marker([pub.lat, pub.lng], { icon });
}

function renderMapMarkers() {
  if (!state.map || !state.markerLayer) return;
  state.markerLayer.clearLayers();

  state.pubs.forEach(pub => {
    const marker = makePubMarker(pub);
    marker.on('click', () => openDetail(pub.id, 'map'));
    marker.bindTooltip(pub.name, { direction: 'top', offset: [0, -6] });
    state.markerLayer.addLayer(marker);
  });
}

function updateUserLocationMarker() {
  if (!state.map) return;

  if (!state.userLocation || state.userLocation.fallback) {
    clearUserLocationMarker();
    return;
  }

  const latlng = [state.userLocation.lat, state.userLocation.lng];

  if (!state.userMarker) {
    state.userMarker = L.circleMarker(latlng, {
      radius: 8,
      color: '#1a73e8',
      weight: 2,
      fillColor: '#1a73e8',
      fillOpacity: 0.85
    }).addTo(state.map);
  } else {
    state.userMarker.setLatLng(latlng);
  }

  const acc = state.userLocation.accuracy;
  if (Number.isFinite(acc) && acc > 0) {
    if (!state.userAccuracyCircle) {
      state.userAccuracyCircle = L.circle(latlng, {
        radius: acc,
        color: '#1a73e8',
        weight: 1,
        fillColor: '#1a73e8',
        fillOpacity: 0.08
      }).addTo(state.map);
    } else {
      state.userAccuracyCircle.setLatLng(latlng);
      state.userAccuracyCircle.setRadius(acc);
    }
  }
}

function clearUserLocationMarker() {
  if (state.userMarker) { state.userMarker.remove(); state.userMarker = null; }
  if (state.userAccuracyCircle) { state.userAccuracyCircle.remove(); state.userAccuracyCircle = null; }
}

function mapsHref(lat, lng, name) {
  const q = encodeURIComponent(name || `${lat},${lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}(${q})`;
}

function parseISODate(str) {
  const [y, m, d] = String(str || '').split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function deg2rad(d) { return d * Math.PI / 180; }
function rad2deg(r) { return r * 180 / Math.PI; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function escapeAttr(str = '') {
  return escapeHtml(str);
}
