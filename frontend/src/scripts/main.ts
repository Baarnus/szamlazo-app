// frontend/src/scripts/main.ts
// Fő kliensoldali belépési pont: inicializálja az összes frontend modult.
import { initAuth, checkCurrentSession } from './auth.js';
import { initBilling } from './billing.js';
import { initCookieConsent } from './cookie-consent.js';
import { initExport } from './export.js';
import { initDeleteConfirmModal } from './invoice-cards.js';
import { initProcessStream, loadInvoicesFromDatabase } from './parse-stream.js';
import { initPartnerSuggestions } from './partner-suggest.js';
import { initSettings } from './settings.js';
import { initSplitView } from './split-view.js';
import { initUpload } from './upload.js';
import { initVoice } from './voice.js';

function bootstrap(): void {
  // 1. Alapvető modulok inicializálása
  initAuth(loadInvoicesFromDatabase);
  initSettings();
  initBilling();
  initUpload();
  initVoice();
  initPartnerSuggestions();
  initDeleteConfirmModal();
  initSplitView();
  initProcessStream();
  initExport();
  initCookieConsent();

  // 2. Munkamenet és meglévő számlák betöltése
  checkCurrentSession(loadInvoicesFromDatabase);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
