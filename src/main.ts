import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

console.log('[BOOT] Starting Angular bootstrap...');
bootstrapApplication(App, appConfig)
  .then(() => console.log('[BOOT] Bootstrap complete! ✅'))
  .catch((err) => {
    console.error('[BOOT] Bootstrap FAILED ❌:', err);
    document.body.innerHTML = `<div style="padding:20px;color:red;font-size:14px;"><strong>Bootstrap Error:</strong><pre>${err?.message || err}</pre></div>`;
  });
