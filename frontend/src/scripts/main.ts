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
import { initWorksheets, loadWorksheets } from './worksheets.js';

function initAppModeSwitcher(): void {
  const modeTabWorksheets = document.getElementById('modeTabWorksheets');
  const modeTabInvoices = document.getElementById('modeTabInvoices');
  const worksheetSection = document.getElementById('worksheetSection');
  const appDashboardView = document.getElementById('appDashboardView');

  modeTabWorksheets?.addEventListener('click', () => {
    modeTabWorksheets.classList.remove('btn-ghost');
    modeTabWorksheets.classList.add('btn-primary');
    modeTabInvoices?.classList.remove('btn-primary');
    modeTabInvoices?.classList.add('btn-ghost');

    worksheetSection?.classList.remove('hidden');
    appDashboardView?.classList.add('hidden');
    loadWorksheets();
  });

  modeTabInvoices?.addEventListener('click', () => {
    modeTabInvoices.classList.remove('btn-ghost');
    modeTabInvoices.classList.add('btn-primary');
    modeTabWorksheets?.classList.remove('btn-primary');
    modeTabWorksheets?.classList.add('btn-ghost');

    worksheetSection?.classList.add('hidden');
    appDashboardView?.classList.remove('hidden');
    loadInvoicesFromDatabase();
  });
}

function handleSessionLoaded(): void {
  loadInvoicesFromDatabase();
  loadWorksheets();
}

function bootstrap(): void {
  // 1. Alapvető modulok inicializálása
  initAuth(handleSessionLoaded);
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
  initWorksheets();
  initAppModeSwitcher();

  // 2. Munkamenet és meglévő adatok betöltése
  checkCurrentSession(handleSessionLoaded);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
