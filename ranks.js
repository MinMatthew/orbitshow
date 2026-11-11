import { getJSON, readStore } from './lib.js';
import { rankStatus } from './data.js';
import { lang } from './i18n.js';

export const WORLD = 'world';
// `base` is the folder of that service's static files.
export const SERVICES = {
  netflix: { name: 'Netflix', base: './ranks' },
  disney: { name: 'Disney+', base: './ranks/disney' }
};
export const posterUrl = (path, size = 'w185') => (typeof path === 'string' && /^\/[\w.-]+$/.test(path) ? `https://image.tmdb.org/t/p/${size}${path}` : '');

const indexKey = service => `orbitshow-rank-index-v2-${service}`;
const docKey = (service, scope) => `orbitshow-ranks-v2-${service}-${scope}`;
const remember = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota or private mode: the service worker cache still covers offline */ } };

function checkDoc(doc, service) {
  if (doc?.schema !== 1 || doc.service !== service || !Array.isArray(doc.lists?.tv) || !Array.isArray(doc.lists?.film)) throw new Error('Unexpected ranking format');
  return doc;
}

// Which countries have a ranking for this service; failures fall back to the last saved index and never block the app.
export async function loadIndex(service) {
  let index;
  try {
    index = await getJSON(`${SERVICES[service].base}/index.json`, 8000);
    remember(indexKey(service), index);
  } catch {
    index = readStore(indexKey(service), null);
  }
  for (const code of Object.keys(rankStatus)) delete rankStatus[code];
  Object.assign(rankStatus, index?.countries ?? {});
  return index;
}

// `scope` is a lowercase country code or WORLD. `stale` means the network failed and a saved copy is shown.
export async function loadRanks(service, scope) {
  try {
    const doc = checkDoc(await getJSON(`${SERVICES[service].base}/${scope}.json`, 9000), service);
    remember(docKey(service, scope), doc);
    // The service worker may answer from its cache while offline, so the browser's own state decides the label.
    return { doc, stale: !navigator.onLine };
  } catch (error) {
    const saved = readStore(docKey(service, scope), null);
    if (saved) return { doc: checkDoc(saved, service), stale: true };
    throw error;
  }
}

// Title in the UI language: TMDb translation, else the original title when the work was made in that language, else English.
export function displayTitle(entry) {
  const info = entry.tmdb;
  if (!info) return entry.listing.title;
  return info.titles?.[lang] || (info.originalLanguage === lang && info.originalTitle) || info.title || entry.listing.title;
}
export const synopsis = entry => entry.tmdb?.overview?.[lang] || entry.tmdb?.overview?.en || '';
export const isAvailable = (entry, code) => entry.availability.countries.includes(code);

// UI language first, then English, then any language; ids that are not plain YouTube ids are dropped.
export function trailerId(entry) {
  const all = entry.tmdb?.trailers ?? {};
  const id = all[lang] || all.en || Object.values(all)[0] || '';
  return /^[\w-]{11}$/.test(id) ? id : '';
}
