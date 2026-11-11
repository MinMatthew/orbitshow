import { getJSON, readStore } from './lib.js';
import { rankStatus } from './data.js';
import { lang } from './i18n.js';

export const WORLD = 'world';
export const posterUrl = (path, size = 'w185') => (typeof path === 'string' && /^\/[\w.-]+$/.test(path) ? `https://image.tmdb.org/t/p/${size}${path}` : '');

const INDEX_KEY = 'orbitshow-rank-index';
const docKey = scope => `orbitshow-ranks-${scope}`;
const remember = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota or private mode: the service worker cache still covers offline */ } };

function checkDoc(doc) {
  if (doc?.schema !== 1 || !Array.isArray(doc.lists?.tv) || !Array.isArray(doc.lists?.film)) throw new Error('Unexpected ranking format');
  return doc;
}

// Which countries have a ranking; failures fall back to the last saved index and never block the app.
export async function loadIndex() {
  try {
    const index = await getJSON('./ranks/index.json', 8000);
    Object.assign(rankStatus, index.countries);
    remember(INDEX_KEY, index);
    return index;
  } catch {
    const saved = readStore(INDEX_KEY, null);
    Object.assign(rankStatus, saved?.countries ?? {});
    return saved;
  }
}

// `scope` is a lowercase country code or WORLD. `stale` means the network failed and a saved copy is shown.
export async function loadRanks(scope) {
  try {
    const doc = checkDoc(await getJSON(`./ranks/${scope}.json`, 9000));
    remember(docKey(scope), doc);
    // The service worker may answer from its cache while offline, so the browser's own state decides the label.
    return { doc, stale: !navigator.onLine };
  } catch (error) {
    const saved = readStore(docKey(scope), null);
    if (saved) return { doc: checkDoc(saved), stale: true };
    throw error;
  }
}

// Title in the UI language: TMDb translation, else the original title when the work was made in that language, else English.
export function displayTitle(entry) {
  const info = entry.tmdb;
  if (!info) return entry.netflix.title;
  return info.titles?.[lang] || (info.originalLanguage === lang && info.originalTitle) || info.title || entry.netflix.title;
}
export const synopsis = entry => entry.tmdb?.overview?.[lang] || entry.tmdb?.overview?.en || '';
export const isOnNetflix = (entry, code) => entry.availability.netflixCountries.includes(code);

// UI language first, then English, then any language; ids that are not plain YouTube ids are dropped.
export function trailerId(entry) {
  const all = entry.tmdb?.trailers ?? {};
  const id = all[lang] || all.en || Object.values(all)[0] || '';
  return /^[\w-]{11}$/.test(id) ? id : '';
}
