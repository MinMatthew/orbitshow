import { $, toast } from './lib.js';
import { t } from './i18n.js';

// A new service worker takes over at once, but this page still runs the old scripts until it reloads.
function announceUpdate() {
  const box = $('toast');
  const button = document.createElement('button');
  button.textContent = t('sw.reload');
  button.onclick = () => location.reload();
  box.replaceChildren(`${t('sw.updateReady')} `, button);
  box.classList.add('visible', 'actionable');
}

export function setupPWA() {
  let prompt = null;
  const standalone = matchMedia('(display-mode: standalone)');
  const update = () => { $('install').hidden = standalone.matches || navigator.standalone === true; };
  update();
  standalone.addEventListener('change', update);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; update(); });
  window.addEventListener('appinstalled', () => { prompt = null; $('install').hidden = true; toast(t('install.done')); });
  $('install').onclick = async () => {
    if (!prompt) { $('install-dialog').showModal(); return; }
    const event = prompt;
    prompt = null;
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === 'accepted') $('install').hidden = true;
  };

  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then(registration => {
      registration.update().catch(() => {});
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && hadController) announceUpdate(); });
      });
    })
    .catch(() => toast(t('pwa.offlineSetupFailed')));
}
