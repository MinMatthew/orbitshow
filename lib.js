import { t } from './i18n.js';

export const $ = id => document.getElementById(id);

const paths = {
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="#0a0a0a"/><circle cx="15" cy="17" r="3" fill="#0a0a0a"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 15v5h14v-5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M3 6h.1M3 12h.1M3 18h.1"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  star: '<path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9Z" fill="currentColor" stroke="none"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  share: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-4M9 14l6 4"/>',
  close: '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13" stroke-width="3.6"/>'
};
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.globe}</svg>`;

export const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
export function writeStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast(t('ui.storageUnavailable')); return false; } }

let toastTimer;
export function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.remove('actionable');
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4000);
}

// `no-cache` revalidates with the server's ETag, so a new weekly ranking is never hidden by the HTTP cache.
export async function getJSON(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

export async function shareText(text, url) {
  try {
    if (navigator.share) { await navigator.share({ title: 'Orbitshow', text, url }); return; }
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    toast(t('ui.textCopied'));
  } catch (error) {
    if (error.name !== 'AbortError') toast(t('ui.copyManually'));
  }
}
