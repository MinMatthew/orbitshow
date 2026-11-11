import { UI } from './ui-strings.js';

const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// UI language order: `?lang=xx` (testing) > the language chosen in Options > the first device language we translate.
// It is independent of the Netflix country, which is chosen separately (data.js).
export const SUPPORTED = ['en', 'ko', 'ja', 'zh', 'es', 'fr', 'de'];
export const LANG_NAMES = { en: 'English', ko: '한국어', ja: '日本語', zh: '简体中文', es: 'Español', fr: 'Français', de: 'Deutsch' };
const LANG_KEY = 'orbitshow-lang';
const tags = navigator.languages?.length ? [...navigator.languages] : [navigator.language || 'en'];
const primary = tag => String(tag || '').toLowerCase().split('-')[0];
const forced = new URLSearchParams(location.search).get('lang');

export function setLangPref(value) {
  if (!SUPPORTED.includes(value)) return;
  try { localStorage.setItem(LANG_KEY, value); } catch { /* Storage unavailable: the choice cannot be kept. */ }
}
let pref = null;
try { const saved = localStorage.getItem(LANG_KEY); if (SUPPORTED.includes(saved)) pref = saved; } catch { /* storage unavailable */ }
const systemLang = tags.map(primary).find(code => SUPPORTED.includes(code)) ?? 'en';
export const lang = SUPPORTED.includes(forced) ? forced : (pref ?? systemLang);

const LINKS = {
  tmdb: 'https://www.themoviedb.org',
  top10: 'https://www.netflix.com/tudum/top10'
};

const strings = { ...UI.en, ...UI[lang] };

export const t = (key, vars = {}) => (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');

// Translation text is trusted but still escaped; [[link|label]], **bold** and `code` are the only markup.
const rich = text => escapeHTML(text)
  .replace(/\[\[(\w+)\|([^\]]+)\]\]/g, (_, key, label) => (LINKS[key] ? `<a href="${LINKS[key]}" target="_blank" rel="noopener noreferrer">${label}</a>` : label))
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');

export function applyLocale() {
  document.documentElement.lang = lang;
  document.title = `Orbitshow — ${t('ui.tagline')}`;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = rich(t(el.dataset.i18n)); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
}

// Country names use the chosen language, or else the first device language even without a UI translation for it.
const nameTag = (SUPPORTED.includes(forced) && forced) || pref || tags[0] || 'en';
const nameLang = primary(nameTag) || 'en';
let regionNames = null;
try { regionNames = new Intl.DisplayNames([nameTag], { type: 'region' }); } catch { /* unsupported locale */ }

// Name follows the chosen language; the small English line is dropped when that language is English.
export function countryLabel(country) {
  const english = country.en || country.name;
  let name = '';
  if (country.code) {
    try { name = regionNames?.of(country.code.toUpperCase()) || ''; } catch { /* unknown region */ }
    if (!name || name.toUpperCase() === country.code.toUpperCase()) name = nameLang === 'ko' ? country.name : english;
  } else {
    name = english;
  }
  const sub = nameLang === 'en' || name.toUpperCase() === english.toUpperCase() ? '' : english.toUpperCase();
  return { name, sub };
}
