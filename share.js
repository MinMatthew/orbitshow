import { $ } from './lib.js';
import { t } from './i18n.js';

export function setupShare(url) {
  const dialog = $('share-dialog');
  $('share-qr').alt = t('share.alt');
  $('share-app').addEventListener('click', async () => {
    const status = $('share-status');
    status.textContent = '';
    dialog.showModal();
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = t('share.copied');
    } catch {
      status.textContent = t('share.copyFailed', { url });
    }
  });
  dialog.addEventListener('click', () => {
    if (dialog.open) dialog.close();
  });
}
