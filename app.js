import { $, icon, escapeHTML as esc, toast, readStore, writeStore } from './lib.js';
import { countries, countryByCode, hasRanks, detectCountry, savedServiceCountry, saveServiceCountry } from './data.js';
import { createGlobe } from './globe.js';
import { setupPWA } from './pwa.js';
import { applyLocale, countryLabel, t, lang, SUPPORTED, LANG_NAMES, setLangPref } from './i18n.js';
import { loadIndex, loadRanks, WORLD, posterUrl, displayTitle, synopsis, isOnNetflix, trailerId } from './ranks.js';
import { genreNames } from './genres.js';
import { renderUpdates } from './updates.js';

document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
document.querySelectorAll('[data-close]').forEach(el => { el.innerHTML = icon('close'); });

// `home` is the Netflix country whose catalog the user has (availability badges); `country` is the one being browsed.
const detected = detectCountry();
let home = savedServiceCountry() ?? detected.country;
let country = home;
let world = false;
let tab = 'tv';
let doc = null;
let stale = false;
let loadToken = 0;
let globe = null;

const favorites = new Set((() => {
  const saved = readStore('orbitshow-favorites', []);
  return Array.isArray(saved) ? saved.filter(code => typeof code === 'string') : [];
})());

// ---------- Country navigation ----------
const starIcon = filled => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9Z"${filled ? ' fill="currentColor"' : ''}/></svg>`;

function renderFavorite() {
  const on = favorites.has(country.code);
  const label = on ? t('ui.removeFav') : t('ui.addFav');
  const button = $('country-fav');
  button.innerHTML = starIcon(on);
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', label);
  button.title = label;
}

// With favorites saved, the arrows skip every other country.
function toggleFavorite() {
  if (!country.code) return;
  const added = !favorites.has(country.code);
  if (added) favorites.add(country.code); else favorites.delete(country.code);
  writeStore('orbitshow-favorites', [...favorites]);
  renderFavorite();
  toast(added ? (favorites.size === 1 ? t('ui.favAddedFirst') : t('ui.favAdded')) : (favorites.size ? t('ui.favRemoved') : t('ui.favRemovedLast')));
}

function renderNav() {
  const label = countryLabel(country);
  if (world) {
    $('country-code').innerHTML = icon('globe');
    $('country-name').textContent = t('ui.worldName');
    $('country-en').textContent = t('ui.worldSub');
    $('country-fav').hidden = true;
    $('rank-heading').textContent = t('ui.worldHeading');
  } else {
    $('country-code').textContent = country.code?.toUpperCase() || '—';
    $('country-name').textContent = label.name;
    $('country-en').textContent = label.sub;
    $('country-fav').hidden = false;
    renderFavorite();
    $('rank-heading').textContent = t('ui.rankHeading', { country: label.name });
  }
  const button = $('world-button');
  button.setAttribute('aria-pressed', String(world));
  button.setAttribute('aria-label', world ? t('ui.worldBack', { country: label.name }) : t('ui.worldBtnAria'));
}

function selectCountry(next) {
  closeIntro();
  country = next;
  world = false;
  globe?.setWorld(false);
  globe?.select(next);
  renderNav();
  show();
}

function enterWorld() {
  if (world) return;
  closeIntro();
  world = true;
  globe?.setWorld(true);
  renderNav();
  show();
}

function cycle(delta) {
  const all = countries.filter(hasRanks);
  const saved = all.filter(c => favorites.has(c.code));
  const pool = saved.length ? saved : all;
  const here = all.findIndex(c => c.code === country.code);
  const start = here < 0 ? (delta > 0 ? -1 : 0) : here;
  for (let step = 1; step <= all.length; step++) {
    const next = all[((start + delta * step) % all.length + all.length) % all.length];
    if (!pool.includes(next)) continue;
    if (next.code === country.code && !world) {
      if (saved.length) toast(t('ui.favNeedMore'));
      return;
    }
    selectCountry(next);
    return;
  }
}

function countryOptions(query = '') {
  const host = $('country-options');
  host.replaceChildren();
  const needle = query.toLowerCase();
  countries.filter(c => `${c.name} ${countryLabel(c).name} ${c.en} ${c.code}`.toLowerCase().includes(needle)).forEach(c => {
    const label = countryLabel(c);
    const button = document.createElement('button');
    button.innerHTML = `${esc(label.name)}<small>${esc([label.sub, hasRanks(c) ? '' : t('ui.noRankShort')].filter(Boolean).join(' · '))}</small>`;
    button.onclick = () => { $('country-dialog').close(); selectCountry(c); };
    host.append(button);
  });
}

// ---------- Ranking panel ----------
const dayFormat = iso => new Date(`${iso}T00:00:00`).toLocaleDateString(lang, { month: 'short', day: 'numeric' });
const stampFormat = iso => new Date(iso).toLocaleString(lang, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function setStatus(text, warning = false) {
  $('rank-status').textContent = text;
  $('rank-status').classList.toggle('warning', warning);
}

function setBusy(busy) {
  $('rank-list').setAttribute('aria-busy', String(busy));
  $('refresh').disabled = busy;
}

function renderSkeleton() {
  const host = $('rank-list');
  host.replaceChildren();
  for (let i = 0; i < 5; i++) {
    const row = document.createElement('div');
    row.className = 'rank-row skeleton';
    row.innerHTML = '<span class="rank-num"></span><span class="poster"></span><span class="row-meta"><strong></strong><small></small></span>';
    host.append(row);
  }
}

function renderMessage(title, body, retry = false) {
  const host = $('rank-list');
  host.replaceChildren();
  const box = document.createElement('div');
  box.className = 'state-box';
  box.innerHTML = `<h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ''}${retry ? `<button class="pill-button" id="retry">${esc(t('ui.retry'))}</button>` : ''}`;
  host.append(box);
  if (retry) $('retry').onclick = () => show();
}

function renderRank(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rank-row';
  const genres = genreNames(entry.tmdb?.genreIds, 2);
  const onNetflix = isOnNetflix(entry, home.code);
  const poster = posterUrl(entry.tmdb?.posterPath, 'w154');
  const rating = entry.tmdb?.rating;
  const availability = t(onNetflix ? 'ui.availYes' : 'ui.availNo', { cc: home.code.toUpperCase() });
  button.innerHTML = `<span class="rank-num">${entry.rank}</span>`
    + `<span class="poster">${poster ? `<img src="${esc(poster)}" alt="" loading="lazy" decoding="async">` : icon(entry.type)}</span>`
    + `<span class="row-meta"><strong>${esc(displayTitle(entry))}</strong><small>${esc(genres.join(' · ') || t('ui.genreNone'))}</small>`
    + `<span class="badge ${onNetflix ? 'ok' : 'no'}">${icon(onNetflix ? 'check' : 'x')}${esc(availability)}</span></span>`
    + `<span class="score${rating == null ? ' none' : ''}" title="${esc(t('ui.rating'))}">${icon('star')}<b>${rating == null ? '—' : rating.toFixed(1)}</b></span>`;
  button.querySelector('img')?.addEventListener('error', event => { event.target.parentElement.innerHTML = icon(entry.type); }, { once: true });
  button.onclick = () => openDetail(entry);
  return button;
}

function renderRows() {
  const rows = doc.lists[tab];
  const host = $('rank-list');
  host.replaceChildren();
  host.scrollTop = 0;
  if (!rows.length) { renderMessage(t('ui.emptyList'), ''); return; }
  host.append(...rows.map(renderRank));
}

function renderStatus() {
  const parts = [];
  if (stale) parts.push(t('ui.savedRanking'));
  parts.push(t('ui.week', { date: dayFormat(doc.week) }));
  if (doc.updatedAt) parts.push(t('ui.updated', { date: stampFormat(doc.updatedAt) }));
  const matched = [...doc.lists.tv, ...doc.lists.film].some(entry => entry.tmdb);
  if (!matched) parts.push(t('ui.metaPending'));
  setStatus(parts.join(' · '), stale || !matched);
}

async function show() {
  const token = ++loadToken;
  doc = null;
  if (!world && !hasRanks(country)) {
    setBusy(false);
    setStatus('', false);
    renderMessage(t('ui.noRankTitle'), t('ui.noRankBody', { country: countryLabel(country).name }));
    return;
  }
  setBusy(true);
  setStatus(t('ui.loading'));
  renderSkeleton();
  try {
    const result = await loadRanks(world ? WORLD : country.code);
    if (token !== loadToken) return;
    doc = result.doc;
    stale = result.stale;
    renderStatus();
    renderRows();
  } catch {
    if (token !== loadToken) return;
    setStatus(t('ui.loadFailed'), true);
    renderMessage(t('ui.loadFailed'), '', true);
  }
  setBusy(false);
}

function showTab(name) {
  tab = name;
  for (const id of ['tv', 'film']) {
    $(`tab-${id}`).setAttribute('aria-selected', String(id === name));
    $(`tab-${id}`).tabIndex = id === name ? 0 : -1;
  }
  if (doc) renderRows();
}

for (const id of ['tv', 'film']) {
  $(`tab-${id}`).onclick = () => showTab(id);
  $(`tab-${id}`).onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const other = id === 'tv' ? 'film' : 'tv';
    showTab(other);
    $(`tab-${other}`).focus();
  };
}

// ---------- Detail popup ----------
function openDetail(entry) {
  const info = entry.tmdb;
  const title = displayTitle(entry);
  const scope = world ? t('ui.worldName') : countryLabel(country).name;
  const poster = posterUrl(info?.posterPath, 'w500');
  const genres = genreNames(info?.genreIds, 4);
  const onNetflix = isOnNetflix(entry, home.code);
  const homeName = countryLabel(home).name;
  const meta = [
    t(entry.type === 'tv' ? 'ui.typeTv' : 'ui.typeFilm'),
    info?.year,
    info?.seasons ? t('detail.seasons', { n: info.seasons }) : null,
    entry.type === 'film' && info?.runtime ? t('detail.runtime', { n: info.runtime }) : null,
    entry.netflix.seasonTitle && entry.netflix.seasonTitle !== entry.netflix.title ? entry.netflix.seasonTitle : null
  ].filter(Boolean);
  const original = info?.originalTitle && info.originalTitle !== title ? t('detail.original', { title: info.originalTitle }) : '';
  const weeks = entry.netflix.weeksInTop10 > 1 ? t('ui.weeksIn', { n: entry.netflix.weeksInTop10 }) : t('ui.weeksNew');
  const ratingChip = info?.rating == null
    ? `<span class="chip">${esc(t('ui.ratingNone'))}</span>`
    : `<span class="chip rating">${icon('star')}<b>${info.rating.toFixed(1)}</b><small>${esc(t('ui.votes', { n: (info.voteCount || 0).toLocaleString(lang) }))}</small></span>`;
  const count = entry.availability.netflixCountries.length;
  const trailer = trailerId(entry);
  $('detail-body').innerHTML = `<div class="detail-hero${poster ? '' : ' no-poster'}">${poster ? `<img class="detail-poster" src="${esc(poster)}" alt="${esc(t('detail.poster', { title }))}">` : icon(entry.type)}</div>`
    + '<div class="detail-content">'
    + `<p class="detail-kicker">${esc(t('detail.rankIn', { rank: entry.rank, scope }))} · ${esc(weeks)}</p>`
    + `<h2 id="detail-title">${esc(title)}</h2>`
    + `<p class="detail-meta">${esc(meta.join(' · '))}</p>`
    + `<div class="detail-chips">${ratingChip}${genres.map(name => `<span class="chip">${esc(name)}</span>`).join('')}</div>`
    + `<div class="detail-service ${onNetflix ? 'ok' : 'no'}">${icon(onNetflix ? 'check' : 'x')}<span>${esc(t(onNetflix ? 'ui.availYesLong' : 'ui.availNoLong', { country: homeName }))}${count ? `<small>${esc(t('ui.availCount', { n: count }))}</small>` : ''}</span></div>`
    + (trailer ? `<button class="trailer-button" id="trailer-open" type="button">${icon('play')}<span>${esc(t('detail.trailer'))}</span></button>` : '')
    + `<h3>${esc(t('detail.synopsis'))}</h3><p class="detail-synopsis">${esc(synopsis(entry) || t('detail.noSynopsis'))}</p>`
    + (original ? `<p class="detail-original">${esc(original)}</p>` : '')
    + `<div class="detail-actions"><a class="pill-button" href="https://www.netflix.com/search?q=${encodeURIComponent(entry.netflix.title)}" target="_blank" rel="noopener noreferrer">${esc(t('detail.netflixSearch'))}</a>`
    + (info ? `<a class="pill-button" href="https://www.themoviedb.org/${info.mediaType === 'tv' ? 'tv' : 'movie'}/${Number(info.id)}" target="_blank" rel="noopener noreferrer">${esc(t('detail.tmdbPage'))}</a>` : '')
    + '</div>'
    + (info ? `<p class="detail-note">${esc(t('detail.tmdbNote'))}</p>` : '')
    + '</div>';
  $('detail-body').querySelector('.detail-poster')?.addEventListener('error', event => {
    const hero = event.target.parentElement;
    hero.classList.add('no-poster');
    hero.innerHTML = icon(entry.type);
  }, { once: true });
  // The player is only created on tap, so opening a title never contacts YouTube.
  if (trailer) {
    $('trailer-open').onclick = event => {
      const frame = document.createElement('div');
      frame.className = 'trailer-frame';
      const player = document.createElement('iframe');
      player.src = `https://www.youtube-nocookie.com/embed/${trailer}?autoplay=1&rel=0&playsinline=1`;
      player.title = t('detail.trailerOf', { title });
      player.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      player.allowFullscreen = true;
      player.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.append(player);
      event.currentTarget.replaceWith(frame);
    };
  }
  const dialog = $('detail-dialog');
  dialog.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
}

// ---------- Options ----------
function renderSettings() {
  const langSelect = $('lang-select');
  langSelect.innerHTML = SUPPORTED.map(code => `<option value="${code}">${LANG_NAMES[code]}</option>`).join('');
  langSelect.value = lang;
  langSelect.onchange = () => {
    setLangPref(langSelect.value);
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.replace(url);
  };

  const select = $('country-select');
  const collator = new Intl.Collator(lang);
  const options = countries.map(c => ({ code: c.code, name: countryLabel(c).name })).sort((a, b) => collator.compare(a.name, b.name));
  select.innerHTML = `<option value="">${esc(t('settings.auto'))}</option>${options.map(o => `<option value="${o.code}">${esc(o.name)}</option>`).join('')}`;
  select.value = savedServiceCountry()?.code ?? '';
  select.onchange = () => {
    const chosen = countryByCode(select.value);
    saveServiceCountry(chosen?.code);
    home = chosen ?? detected.country;
    selectCountry(home);
  };
  const via = t(`settings.via${detected.via[0].toUpperCase()}${detected.via.slice(1)}`);
  $('country-detected').textContent = t('settings.detected', { country: countryLabel(detected.country).name, via });
}

// ---------- Wiring ----------
$('refresh').onclick = () => show();
$('country-prev').onclick = () => cycle(-1);
$('country-next').onclick = () => cycle(1);
$('country-fav').onclick = toggleFavorite;
$('world-button').onclick = () => {
  if (world) selectCountry(country);
  else if (globe) globe.pulse(enterWorld);
  else enterWorld();
};
$('country-open').onclick = () => { countryOptions(); $('country-search').value = ''; $('country-dialog').showModal(); $('country-search').focus(); };
$('country-search').oninput = event => countryOptions(event.target.value);
$('settings-open').onclick = () => $('settings-dialog').showModal();
// Emptying the popup also stops a playing trailer.
$('detail-dialog').addEventListener('close', () => $('detail-body').replaceChildren());
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => button.closest('dialog').close(); });
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
}));
window.addEventListener('online', () => { if (!doc || stale) show(); });

// PayPal opens in another tab and reports nothing back, so thank the user when they return, or on ?thanks=1 if the PayPal link redirects here.
let supportPending = false;
document.querySelectorAll('[data-support]').forEach(link => link.addEventListener('click', () => { supportPending = true; $('support-thanks').hidden = true; }));
document.addEventListener('visibilitychange', () => {
  if (supportPending && document.visibilityState === 'visible') { supportPending = false; $('support-thanks').hidden = false; }
});
{
  const params = new URLSearchParams(location.search);
  if (params.get('thanks') === '1') {
    params.delete('thanks');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
    $('support-thanks').hidden = false;
    setTimeout(() => toast(t('support.thanks')), 3600);
  }
}

// ---------- Intro and splash ----------
const INTRO_KEY = 'orbitshow-intro-seen';
const intro = $('globe-intro');
const introStores = [() => localStorage, () => sessionStorage];
function introSeen() {
  for (const store of introStores) { try { if (store().getItem(INTRO_KEY) === '1') return true; } catch { /* storage blocked */ } }
  return false;
}
function markIntroSeen() {
  for (const store of introStores) { try { store().setItem(INTRO_KEY, '1'); } catch { /* storage blocked */ } }
}
// Looked up on demand: selectCountry() can run before `intro` above is initialised.
function closeIntro() {
  const dialog = $('globe-intro');
  if (dialog.hidden) return;
  dialog.hidden = true;
  markIntroSeen();
}
intro.addEventListener('click', closeIntro);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeIntro(); });
// Marked as seen when it first shows, so a reload or a skipped tap never brings it back.
function showIntro() {
  if (introSeen()) return;
  intro.hidden = false;
  markIntroSeen();
  intro.focus({ preventScroll: true });
}

let splashTimer = 0;
function hideSplash() {
  clearTimeout(splashTimer);
  const splash = $('splash');
  if (!splash || splash.classList.contains('hide')) return;
  let finished = false;
  const done = () => { if (finished) return; finished = true; splash.remove(); showIntro(); };
  splash.classList.add('hide');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else { splash.addEventListener('transitionend', done, { once: true }); setTimeout(done, 700); }
}
// Count from first paint (or the first frame if none yet) so slow cold starts still show the whole fade sequence.
requestAnimationFrame(() => {
  const painted = performance.getEntriesByName('first-paint')[0]?.startTime ?? performance.now();
  splashTimer = setTimeout(hideSplash, Math.max(0, painted + 2400 - performance.now()));
});
// Dismiss on click (after pointerup) so the tap cannot fall through to a control underneath.
$('splash')?.addEventListener('click', hideSplash);

// ---------- Start ----------
applyLocale();
renderSettings();
renderUpdates($('update-list'), lang);
setupPWA();
renderNav();
show();
// Ranking availability per country is only needed for the globe colours and the "no ranking" state.
loadIndex().then(() => {
  globe?.refresh();
  renderSettings();
  if (!world && !hasRanks(country)) show();
});
createGlobe(selectCountry, enterWorld, country).then(g => { globe = g; g.select(country); }).catch(() => { $('globe-loading').textContent = t('ui.globeFailed'); });
