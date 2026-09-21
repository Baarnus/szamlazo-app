// frontend/src/scripts/invoice-cards.ts
// Számlakártyák dinamikus megjelenítése, pénznem formázás és törlés megerősítés.
import type { SingleInvoiceResult, InvoiceData } from '@szamlazo/shared';
import { apiFetch } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { escapeHtml } from './sanitize.js';

let _openEditModalFn: ((index: number) => void) | null = null;

export function registerOpenEditModal(fn: (index: number) => void): void {
  _openEditModalFn = fn;
}

export function formatCurrency(
  amount: number,
  currency: string = "HUF"
): string {
  try {
    const cleanCurrency = (currency || "HUF").toUpperCase().trim();
    const isHUF = cleanCurrency === "HUF";

    return new Intl.NumberFormat("hu-HU", {
      style: "currency",
      currency: cleanCurrency,
      maximumFractionDigits: isHUF ? 0 : 2,
      minimumFractionDigits: isHUF ? 0 : 2,
    }).format(amount || 0);
  } catch {
    return `${Number(amount || 0).toLocaleString("hu-HU")} ${escapeHtml(currency)}`;
  }
}

export type InvoiceDirection = 'incoming' | 'outgoing';

/**
 * Számla irányának (költség / kimenő bevétel) intelligens detektálása
 */
export function detectInvoiceDirection(data: InvoiceData, source?: string): InvoiceDirection {
  const anyData = data as any;
  if (anyData.direction === 'incoming' || anyData.tipus === 'incoming') return 'incoming';
  if (anyData.direction === 'outgoing' || anyData.tipus === 'outgoing') return 'outgoing';

  // 1. Saját cégadatokkal való összevetés (ha be van állítva a profilban)
  const userCompany = (state.userCompanyName || "").trim().toLowerCase();
  const userTax = (state.userCompanyTaxNumber || "").trim().replace(/\D/g, "");

  const sellerName = (data.kiallito_neve || "").trim().toLowerCase();
  const sellerTax = (data.kiallito_adoszam || "").trim().replace(/\D/g, "");
  const buyerName = (data.vevo_neve || "").trim().toLowerCase();
  const buyerTax = (data.vevo_adoszam || "").trim().replace(/\D/g, "");

  if (userTax && userTax.length >= 8) {
    const userTaxPrefix = userTax.slice(0, 8);
    if (sellerTax && sellerTax.startsWith(userTaxPrefix)) return 'outgoing';
    if (buyerTax && buyerTax.startsWith(userTaxPrefix)) return 'incoming';
  }

  if (userCompany && userCompany.length >= 3) {
    if (sellerName.includes(userCompany) || userCompany.includes(sellerName)) return 'outgoing';
    if (buyerName.includes(userCompany) || userCompany.includes(buyerName)) return 'incoming';
  }

  // 2. Forrás alapján: szöveges prompt és diktálás esetén alapértelmezetten kimenő értékesítési számla
  if (source && (source.startsWith("Szöveges prompt:") || source.startsWith("Hangüzenet (diktálás):"))) {
    return 'outgoing';
  }

  // 3. Ismert költség partnerek (benzinkút, irodaszer, felhő, rezsi)
  const knownExpenseKeywords = [
    "mol", "omv", "shell", "orlen", "lukoil", "auchan", "spar", "tesco", "lidl", "aldi", "penny",
    "mediamarkt", "praktiker", "obi", "bauhaus", "telekom", "yettel", "vodafone", "mvm", "díjbeszedő",
    "google", "microsoft", "adobe", "github", "aws", "hetzner", "digitalocean", "openai", "uber", "bolt"
  ];

  if (knownExpenseKeywords.some((kw) => sellerName.includes(kw))) {
    return 'incoming';
  }

  // 4. Kép vagy PDF feltöltése esetén: alapesetben bejövő költségszámlaként kezeljük
  return 'incoming';
}

/**
 * Forrás kategóriájának kinyerése (pl. "Hangüzenet", "AI-message", vagy a feltöltött fájlnév)
 * A teljes prompt szöveg elrejtésre kerül, és csak kategóriaként jelenik meg.
 */
export function getSourceCategory(source?: string): string {
  if (!source) return "Bizonylat";
  if (source.startsWith("Hangüzenet (diktálás):") || source.startsWith("Hangüzenet")) {
    return "Hangüzenet";
  }
  if (source.startsWith("Szöveges prompt:") || source.startsWith("Szöveges parancs") || source.startsWith("Szövegalapú") || source.startsWith("AI-message")) {
    return "Szövegalapú";
  }
  // Ha fájlnév vagy URL (pl. feltöltött kép vagy pdf)
  const filename = source.split("/").pop()?.split("?")[0] || source;
  return filename;
}

export function createCardElement(
  item: SingleInvoiceResult,
  index: number
): HTMLElement {
  const card = document.createElement("div");
  card.id = `card-item-${index}`;
  card.className =
    "card bg-base-100 shadow-xl border border-base-200 hover:border-primary/40 transition-all duration-300";

  const safeSource = escapeHtml(item.source);
  const sourceCategory = getSourceCategory(item.source);
  const safeSourceCategory = escapeHtml(sourceCategory);

  if (!item.success) {
    const safeErrors = item.errors.map((e) => escapeHtml(e)).join(", ");
    card.innerHTML = `
      <div class="card-body">
        <div class="flex justify-between items-center">
          <h3 class="font-bold text-error">Hiba: ${safeSourceCategory}</h3>
          <span class="badge badge-error">Sikertelen</span>
        </div>
        <p class="text-xs text-base-content/70 mt-2">${safeErrors}</p>
      </div>
    `;
    return card;
  }

  const d = item.data;
  const currency = d.penznem || "HUF";

  const rows = (d.tetelek || [])
    .map((t) => {
      const numAfa = Number(t.afa_szazalek);
      const afaRate = !isNaN(numAfa) ? numAfa : 0;
      const netto = Number(t.netto_ar || 0);
      const brutto = Number(t.brutto_ar || (netto + Math.round((netto * afaRate) / 100)));
      const afaErtek =
        t.afa_ertek !== undefined && t.afa_ertek !== null
          ? t.afa_ertek
          : Math.max(0, brutto - netto);

      const afaLabel = typeof t.afa_szazalek === 'string' && isNaN(Number(t.afa_szazalek)) ? t.afa_szazalek : `${Number(t.afa_szazalek ?? 27)}%`;

      return `
        <tr>
          <td class="font-medium">${escapeHtml(t.megnevezes || "-")}</td>
          <td class="text-right">${Number(t.mennyiseg || 0)}</td>
          <td class="text-right">${formatCurrency(t.egysegar, currency)}</td>
          <td class="text-right"><span class="badge badge-ghost badge-sm">${escapeHtml(afaLabel)}</span></td>
          <td class="text-right">${formatCurrency(netto, currency)}</td>
          <td class="text-right text-base-content/70">${formatCurrency(afaErtek, currency)}</td>
          <td class="text-right font-semibold">${formatCurrency(brutto, currency)}</td>
        </tr>
      `;
    })
    .join("");

  const errorAlert = !item.isValid
    ? `
      <div class="alert alert-warning text-xs p-2 rounded-lg mt-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-4 w-4" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        <span><b>Figyelmeztetés:</b> ${item.errors.map((e) => escapeHtml(e)).join(" | ")}</span>
      </div>
    `
    : "";

  const direction = detectInvoiceDirection(d, item.source);
  const directionBadge = direction === 'incoming'
    ? `<span class="badge badge-warning badge-xs gap-1 font-semibold shrink-0 whitespace-nowrap shadow-sm" title="Bejövő költségszámla a könyveléshez">📥 Költségszámla</span>`
    : `<span class="badge badge-info badge-xs gap-1 font-semibold shrink-0 whitespace-nowrap shadow-sm" title="Kimenő értékesítési számla">📤 Kimenő számla</span>`;

  // Kimenő számlánál a vevő a kulcspartner, bejövőnél a kiállító
  const displayPartner = direction === 'outgoing'
    ? (d.vevo_neve || d.kiallito_neve || "Kimenő számla")
    : (d.kiallito_neve || "Ismeretlen kiállító");
  const safePartner = escapeHtml(displayPartner);

  const safeOrszag = d.kiallito_orszag ? escapeHtml(d.kiallito_orszag) : "";
  const safeSzamlaszam = escapeHtml(d.szamlaszam || "-");
  const safeAdoszam = escapeHtml(d.kiallito_adoszam || d.vevo_adoszam || "-");
  const safeVevo = escapeHtml(d.vevo_neve || "-");
  const safeKelt = escapeHtml(d.kelt_datum || "-");

  card.innerHTML = `
    <div class="card-body space-y-4 p-4 md:p-6">
      <div class="flex flex-wrap justify-between items-center border-b border-base-200 pb-3 gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="font-bold text-lg text-primary">
              ${safePartner}
              ${safeOrszag ? `<span class="badge badge-sm badge-outline ml-1 shrink-0 whitespace-nowrap">${safeOrszag}</span>` : ""}
            </h3>
            ${directionBadge}
            ${item.source && item.source.startsWith("Hangüzenet")
              ? `<span class="badge badge-secondary badge-xs gap-1 font-medium shrink-0 whitespace-nowrap" title="${safeSource}">🎙️ Diktált számla</span>`
              : (item.source && (item.source.startsWith("Szöveges prompt:") || item.source.startsWith("Szövegalapú") || item.source.startsWith("AI-message"))
                ? `<span class="badge badge-primary badge-xs gap-1 font-medium shrink-0 whitespace-nowrap" title="${safeSource}">📝 Szövegalapú</span>`
                : "")}
          </div>
          <p class="text-xs text-base-content/60 truncate" title="${safeSource}">Forrás: ${safeSourceCategory}</p>
        </div>
        <div class="flex items-center gap-2">
          ${item.isValid
            ? '<span class="badge badge-success gap-1 text-xs py-2 font-semibold shrink-0">✓ Valid</span>'
            : '<span class="badge badge-warning gap-1 text-xs py-2 font-semibold shrink-0">⚠️ Ellenőrizendő</span>'}
          <button class="btn btn-outline btn-xs md:btn-sm btn-primary edit-invoice-btn gap-1 font-medium" data-index="${index}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            Megnyitás & Módosítás
          </button>
          ${item.dbId ? `
            <button class="btn btn-ghost btn-xs btn-circle text-error delete-invoice-btn" data-dbid="${escapeHtml(item.dbId)}" data-index="${index}" title="Számla törlése">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          ` : ""}
        </div>
      </div>

      ${errorAlert}

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs bg-base-200/50 p-3 rounded-xl border border-base-300">
        <div><span class="text-base-content/60">Számlaszám:</span> <p class="font-semibold">${safeSzamlaszam}</p></div>
        <div><span class="text-base-content/60">Adószám:</span> <p class="font-semibold">${safeAdoszam}</p></div>
        <div><span class="text-base-content/60">Vevő:</span> <p class="font-semibold">${safeVevo}</p></div>
        <div><span class="text-base-content/60">Kelt:</span> <p class="font-semibold">${safeKelt}</p></div>
      </div>

      <div class="overflow-x-auto">
        <table class="table table-xs w-full">
          <thead>
            <tr>
              <th>Megnevezés</th>
              <th class="text-right">Menny.</th>
              <th class="text-right">Egységár</th>
              <th class="text-right">Áfa %</th>
              <th class="text-right">Nettó</th>
              <th class="text-right">Áfa érték</th>
              <th class="text-right">Bruttó</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="flex justify-end gap-6 text-sm border-t border-base-200 pt-3">
        <div><span class="text-base-content/60">Nettó:</span> <span class="font-bold">${formatCurrency(d.vegosszeg_netto, currency)}</span></div>
        <div><span class="text-base-content/60">Áfa:</span> <span class="font-bold">${formatCurrency(d.vegosszeg_afa, currency)}</span></div>
        <div><span class="text-base-content/60">Bruttó:</span> <span class="font-bold text-primary text-base">${formatCurrency(d.vegosszeg_brutto, currency)}</span></div>
      </div>
    </div>
  `;

  card.querySelector(".edit-invoice-btn")?.addEventListener("click", () => {
    if (_openEditModalFn) _openEditModalFn(index);
  });

  card.querySelector(".delete-invoice-btn")?.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    state.invoiceToDeleteDbId = btn.getAttribute("data-dbid");
    state.invoiceToDeleteIndex = Number(btn.getAttribute("data-index"));

    const deleteModal = document.getElementById("deleteInvoiceConfirmModal") as HTMLDialogElement | null;
    deleteModal?.showModal();
  });

  return card;
}

export function renderResultsCards(): void {
  const resultsWrapper = document.getElementById("resultsWrapper");
  const invoicesToolbar = document.getElementById("invoicesToolbar");
  const invoicesCountBadge = document.getElementById("invoicesCountBadge");
  const invoicesCountSubtitle = document.getElementById("invoicesCountSubtitle");

  if (!resultsWrapper) return;

  resultsWrapper.innerHTML = "";
  state.lastProcessedResults.forEach((item, index) => {
    resultsWrapper.appendChild(createCardElement(item, index));
  });

  const totalCount = state.lastProcessedResults.length;
  if (totalCount > 0) {
    invoicesToolbar?.classList.remove("hidden");
    if (invoicesCountBadge) {
      invoicesCountBadge.textContent = `${totalCount} db`;
    }
    if (invoicesCountSubtitle) {
      invoicesCountSubtitle.textContent = `${totalCount} db számla megtekintése, szerkesztése és könyvelői exportja`;
    }
  } else {
    invoicesToolbar?.classList.add("hidden");
  }
}

export function initDeleteConfirmModal(): void {
  const deleteModal = document.getElementById("deleteInvoiceConfirmModal") as HTMLDialogElement | null;
  const confirmBtn = document.getElementById("confirmDeleteInvoiceBtn") as HTMLButtonElement | null;

  confirmBtn?.addEventListener("click", async () => {
    if (!state.invoiceToDeleteDbId || state.invoiceToDeleteIndex === null) return;

    confirmBtn.disabled = true;
    const originalHtml = confirmBtn.innerHTML;
    confirmBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';

    try {
      const { ok, data } = await apiFetch<{ success: boolean; error?: string }>(
        `/api/invoices/${state.invoiceToDeleteDbId}`,
        { method: "DELETE" }
      );

      if (ok && data.success) {
        showToast("Számla sikeresen törölve.", "success");
        state.lastProcessedResults.splice(state.invoiceToDeleteIndex, 1);
        renderResultsCards();
        deleteModal?.close();
      } else {
        showToast(data.error || "Hiba történt a törlés során.", "error");
      }
    } catch {
      showToast("Hálózati hiba a törléskor.", "error");
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = originalHtml;
      state.invoiceToDeleteDbId = null;
      state.invoiceToDeleteIndex = null;
    }
  });
}
