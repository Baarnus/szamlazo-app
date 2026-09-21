// frontend/src/scripts/split-view.ts
// Split View számlaszerkesztő modál: tételek kezelése, élő matematikai kalkuláció, képzoom, mentés és Számlázz.hu kiállítás.
import type { InvoiceData } from '@szamlazo/shared';
import { apiFetch } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { formatCurrency, renderResultsCards, registerOpenEditModal, detectInvoiceDirection, getSourceCategory } from './invoice-cards.js';
import { escapeHtml } from './sanitize.js';

export function switchSplitViewTab(tab: "form" | "preview"): void {
  const splitTabForm = document.getElementById("splitTabForm");
  const splitTabPreview = document.getElementById("splitTabPreview");
  const modalPreviewCol = document.getElementById("modalPreviewCol");
  const modalFormCol = document.getElementById("modalFormCol");

  if (!splitTabForm || !splitTabPreview || !modalPreviewCol || !modalFormCol) return;

  if (tab === "form") {
    splitTabForm.classList.add("btn-primary");
    splitTabForm.classList.remove("btn-ghost");
    splitTabPreview.classList.remove("btn-primary");
    splitTabPreview.classList.add("btn-ghost");

    modalFormCol.classList.remove("hidden");
    modalFormCol.classList.add("flex");
    modalPreviewCol.classList.add("hidden");
    modalPreviewCol.classList.remove("flex");
  } else {
    splitTabPreview.classList.add("btn-primary");
    splitTabPreview.classList.remove("btn-ghost");
    splitTabForm.classList.remove("btn-primary");
    splitTabForm.classList.add("btn-ghost");

    modalPreviewCol.classList.remove("hidden");
    modalPreviewCol.classList.add("flex");
    modalFormCol.classList.add("hidden");
    modalFormCol.classList.remove("flex");
  }
}

export function recalculateModalTotals(): void {
  if (!state.currentEditingData) return;

  const editPenznem = document.getElementById("edit_penznem") as HTMLSelectElement | null;
  const displayNetto = document.getElementById("displayNetto");
  const displayAfa = document.getElementById("displayAfa");
  const displayBrutto = document.getElementById("displayBrutto");
  const modalValidBadge = document.getElementById("modalValidBadge");
  const modalWarningBox = document.getElementById("modalWarningBox");

  const cur = editPenznem?.value || "HUF";
  let sumNetto = 0;
  let sumAfa = 0;
  let sumBrutto = 0;

  (state.currentEditingData.tetelek || []).forEach((t) => {
    sumNetto += Number(t.netto_ar || 0);
    sumAfa += Number(t.afa_ertek || 0);
    sumBrutto += Number(t.brutto_ar || 0);
  });

  state.currentEditingData.vegosszeg_netto = sumNetto;
  state.currentEditingData.vegosszeg_afa = sumAfa;
  state.currentEditingData.vegosszeg_brutto = sumBrutto;
  state.currentEditingData.penznem = cur;

  if (displayNetto) displayNetto.textContent = formatCurrency(sumNetto, cur);
  if (displayAfa) displayAfa.textContent = formatCurrency(sumAfa, cur);
  if (displayBrutto) displayBrutto.textContent = formatCurrency(sumBrutto, cur);

  const mathValid = Math.abs(sumNetto + sumAfa - sumBrutto) <= 1.0;
  if (modalValidBadge) {
    if (mathValid) {
      modalValidBadge.className = "badge badge-success badge-sm sm:badge-md shrink-0 whitespace-nowrap font-semibold";
      modalValidBadge.textContent = "✓ Valid";
      modalWarningBox?.classList.add("hidden");
    } else {
      modalValidBadge.className = "badge badge-warning badge-sm sm:badge-md shrink-0 whitespace-nowrap font-semibold";
      modalValidBadge.textContent = "⚠️ Eltérés";
      modalWarningBox?.classList.remove("hidden");
    }
  }
}

export function renderEditItems(): void {
  const editItemsTbody = document.getElementById("editItemsTbody");
  const editPenznem = document.getElementById("edit_penznem") as HTMLSelectElement | null;

  if (!editItemsTbody || !state.currentEditingData) return;

  editItemsTbody.innerHTML = "";
  const cur = editPenznem?.value || "HUF";

  (state.currentEditingData.tetelek || []).forEach((t, i) => {
    const tr = document.createElement("tr");
    tr.className = "flex flex-col sm:table-row border border-base-200 rounded-xl p-3 sm:p-0 mb-3 sm:mb-0 bg-base-100 sm:bg-transparent shadow-sm sm:shadow-none hover:bg-base-200/50";
    const safeMegnevezes = escapeHtml(t.megnevezes || "");
    const safeUnit = escapeHtml(t.mennyisegi_egyseg || "db");
    tr.innerHTML = `
      <td class="sm:table-cell p-0 sm:p-2 mb-2 sm:mb-0">
        <div class="flex justify-between items-center sm:hidden mb-1">
          <span class="text-xs font-bold text-primary">#${i + 1}. tétel</span>
          <button type="button" class="btn btn-ghost btn-xs text-error remove-item-btn" data-index="${i}">✕ Törlés</button>
        </div>
        <input type="text" class="input input-sm sm:input-xs input-bordered w-full item-name" data-index="${i}" value="${safeMegnevezes}" placeholder="Tétel leírása" />
      </td>
      <td class="sm:table-cell p-0 sm:p-2">
        <div class="sm:hidden text-[10px] text-base-content/60 font-semibold mb-0.5">Mennyiség</div>
        <input type="number" step="any" class="input input-sm sm:input-xs input-bordered w-full text-right item-qty" data-index="${i}" value="${Number(t.mennyiseg || 1)}" />
      </td>
      <td class="sm:table-cell p-0 sm:p-2">
        <div class="sm:hidden text-[10px] text-base-content/60 font-semibold mb-0.5">Egység</div>
        <input type="text" class="input input-sm sm:input-xs input-bordered w-full text-center item-unit-label" data-index="${i}" value="${safeUnit}" placeholder="db" />
      </td>
      <td class="sm:table-cell p-0 sm:p-2">
        <div class="sm:hidden text-[10px] text-base-content/60 font-semibold mb-0.5">Egységár</div>
        <input type="number" step="any" class="input input-sm sm:input-xs input-bordered w-full text-right item-unit" data-index="${i}" value="${Number(t.egysegar || 0)}" />
      </td>
      <td class="sm:table-cell p-0 sm:p-2">
        <div class="sm:hidden text-[10px] text-base-content/60 font-semibold mb-0.5">Áfa %</div>
        <input type="text" class="input input-sm sm:input-xs input-bordered w-full text-right item-vat-rate" data-index="${i}" value="${t.afa_szazalek ?? 27}" />
      </td>
      <td class="sm:table-cell p-1 sm:p-2 text-left sm:text-right font-medium text-xs">
        <span class="sm:hidden block text-[10px] text-base-content/60 font-semibold">Nettó</span>
        <span class="item-net-display font-mono">${formatCurrency(t.netto_ar, cur)}</span>
      </td>
      <td class="sm:table-cell p-1 sm:p-2 text-left sm:text-right text-xs text-base-content/70">
        <span class="sm:hidden block text-[10px] text-base-content/60 font-semibold">Áfa érték</span>
        <span class="item-vat-display font-mono">${formatCurrency(t.afa_ertek || 0, cur)}</span>
      </td>
      <td class="sm:table-cell p-1 sm:p-2 text-left sm:text-right font-bold text-xs">
        <span class="sm:hidden block text-[10px] text-base-content/60 font-semibold">Bruttó</span>
        <span class="item-gross-display text-primary sm:text-inherit font-mono">${formatCurrency(t.brutto_ar, cur)}</span>
      </td>
      <td class="hidden sm:table-cell text-center p-0 sm:p-2">
        <button type="button" class="btn btn-ghost btn-xs text-error btn-circle remove-item-btn" data-index="${i}" title="Tétel törlése">&times;</button>
      </td>
    `;
    editItemsTbody.appendChild(tr);
  });

  // Dinamikus újraszámolás gépeléskor
  editItemsTbody.querySelectorAll(".item-qty, .item-unit, .item-vat-rate").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number((e.target as HTMLElement).getAttribute("data-index"));
      const row = (e.target as HTMLElement).closest("tr");
      if (!row || !state.currentEditingData || !state.currentEditingData.tetelek[idx]) return;

      const qty = parseFloat((row.querySelector(".item-qty") as HTMLInputElement).value) || 0;
      const unit = parseFloat((row.querySelector(".item-unit") as HTMLInputElement).value) || 0;
      const rawVat = (row.querySelector(".item-vat-rate") as HTMLInputElement).value.trim();
      const numVat = parseFloat(rawVat);
      const isNumericVat = !isNaN(numVat);
      const vatRate = isNumericVat ? numVat : 0;

      const net = qty * unit;
      const vat = net * (vatRate / 100);
      const gross = net + vat;

      state.currentEditingData.tetelek[idx]!.mennyiseg = qty;
      state.currentEditingData.tetelek[idx]!.egysegar = unit;
      state.currentEditingData.tetelek[idx]!.afa_szazalek = isNumericVat ? vatRate : rawVat;
      state.currentEditingData.tetelek[idx]!.netto_ar = net;
      state.currentEditingData.tetelek[idx]!.afa_ertek = vat;
      state.currentEditingData.tetelek[idx]!.brutto_ar = gross;

      const selectedCur = editPenznem?.value || "HUF";
      (row.querySelector(".item-net-display") as HTMLElement).textContent = formatCurrency(net, selectedCur);
      (row.querySelector(".item-vat-display") as HTMLElement).textContent = formatCurrency(vat, selectedCur);
      (row.querySelector(".item-gross-display") as HTMLElement).textContent = formatCurrency(gross, selectedCur);

      recalculateModalTotals();
    });
  });

  editItemsTbody.querySelectorAll(".item-name").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number((e.target as HTMLElement).getAttribute("data-index"));
      if (state.currentEditingData && state.currentEditingData.tetelek[idx]) {
        state.currentEditingData.tetelek[idx]!.megnevezes = (e.target as HTMLInputElement).value;
      }
    });
  });

  editItemsTbody.querySelectorAll(".item-unit-label").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number((e.target as HTMLElement).getAttribute("data-index"));
      if (state.currentEditingData && state.currentEditingData.tetelek[idx]) {
        state.currentEditingData.tetelek[idx]!.mennyisegi_egyseg = (e.target as HTMLInputElement).value;
      }
    });
  });

  editItemsTbody.querySelectorAll(".remove-item-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number((e.target as HTMLElement).getAttribute("data-index"));
      if (state.currentEditingData) {
        state.currentEditingData.tetelek.splice(idx, 1);
        renderEditItems();
        recalculateModalTotals();
      }
    });
  });
}

export function openEditModal(index: number): void {
  const editModal = document.getElementById("editModal") as HTMLDialogElement | null;
  const modalTitle = document.getElementById("modalTitle");
  const modalImage = document.getElementById("modalImage") as HTMLImageElement | null;
  const modalPdfViewer = document.getElementById("modalPdfViewer") as HTMLIFrameElement | null;
  const modalImageLabel = document.getElementById("modalImageLabel");
  const modalImageLink = document.getElementById("modalImageLink") as HTMLAnchorElement | null;
  const modalTextPrompt = document.getElementById("modalTextPrompt");
  const splitTabPreviewLabel = document.getElementById("splitTabPreviewLabel");
  const quickViewDocLabel = document.getElementById("quickViewDocLabel");

  const editKiallitoNeve = document.getElementById("edit_kiallito_neve") as HTMLInputElement | null;
  const editKiallitoAdoszam = document.getElementById("edit_kiallito_adoszam") as HTMLInputElement | null;
  const editSzamlaszam = document.getElementById("edit_szamlaszam") as HTMLInputElement | null;
  const editKeltDatum = document.getElementById("edit_kelt_datum") as HTMLInputElement | null;
  const editTeljesitesDatum = document.getElementById("edit_teljesites_datum") as HTMLInputElement | null;
  const editFizetesiHatarido = document.getElementById("edit_fizetesi_hatarido") as HTMLInputElement | null;
  const editFizetesiMod = document.getElementById("edit_fizetesi_mod") as HTMLSelectElement | null;
  const editPenznem = document.getElementById("edit_penznem") as HTMLSelectElement | null;
  const editMegjegyzes = document.getElementById("edit_megjegyzes") as HTMLInputElement | null;

  const editVevoNeve = document.getElementById("edit_vevo_neve") as HTMLInputElement | null;
  const editVevoAdoszam = document.getElementById("edit_vevo_adoszam") as HTMLInputElement | null;
  const editVevoEmail = document.getElementById("edit_vevo_email") as HTMLInputElement | null;
  const editVevoOrszag = document.getElementById("edit_vevo_orszag") as HTMLInputElement | null;
  const editVevoIranyitoszam = document.getElementById("edit_vevo_iranyitoszam") as HTMLInputElement | null;
  const editVevoTelepules = document.getElementById("edit_vevo_telepules") as HTMLInputElement | null;
  const editVevoCim = document.getElementById("edit_vevo_cim") as HTMLInputElement | null;

  const legalLiabilityCheckbox = document.getElementById("legalLiabilityCheckbox") as HTMLInputElement | null;
  const issueSzamlazzHuBtn = document.getElementById("issueSzamlazzHuBtn") as HTMLButtonElement | null;

  const item = state.lastProcessedResults[index];
  if (!item || !item.success) return;

  state.activeEditIndex = index;
  state.currentEditingData = JSON.parse(JSON.stringify(item.data)) as InvoiceData;

  if (legalLiabilityCheckbox) legalLiabilityCheckbox.checked = false;
  if (issueSzamlazzHuBtn) issueSzamlazzHuBtn.disabled = true;

  const partnerOrCategory = item.data?.vevo_neve || item.data?.kiallito_neve || getSourceCategory(item.source);
  if (modalTitle) modalTitle.textContent = `${partnerOrCategory} ellenőrzése`;

  const cacheIndex = typeof item.index === "number" ? item.index : index;
  const inputCacheItem = state.inputItemsCache[cacheIndex] || state.inputItemsCache[index];
  const itemImageUrl = item.imageUrl;
  const hasImage = Boolean(
    (inputCacheItem?.data && inputCacheItem.data.length > 0) || itemImageUrl
  );

  const isPromptBased =
    (item.source && item.source.startsWith("Szöveges prompt:")) ||
    (item.source && item.source.startsWith("Hangüzenet (diktálás):")) ||
    !hasImage;

  if (isPromptBased) {
    if (modalImage) modalImage.classList.add("hidden");
    if (modalPdfViewer) {
      modalPdfViewer.classList.add("hidden");
      modalPdfViewer.src = "";
    }
    if (modalImageLink) modalImageLink.classList.add("hidden");
    if (modalTextPrompt) {
      modalTextPrompt.classList.remove("hidden");
      const promptText = item.source.replace(/^Hangüzenet \(diktálás\):\s*|^Szöveges prompt:\s*/, "");
      const isVoice = item.source.startsWith("Hangüzenet");
      modalTextPrompt.innerHTML = `
        <div class="flex items-center gap-2 mb-2 text-primary font-bold">
          <span>${isVoice ? "🎙️ Diktált utasítás:" : "📝 Szöveges utasítás:"}</span>
        </div>
        <p class="text-xs sm:text-sm italic text-base-content/80 leading-relaxed font-mono whitespace-pre-wrap bg-base-200/50 p-2.5 rounded-lg border border-base-300">
          ${escapeHtml(promptText)}
        </p>
      `;
    }
    if (modalImageLabel) modalImageLabel.textContent = "AI Számla Utasítás";
    if (splitTabPreviewLabel) splitTabPreviewLabel.textContent = "Utasítás";
    if (quickViewDocLabel) quickViewDocLabel.textContent = "Utasítás megtekintése";
  } else {
    if (modalTextPrompt) modalTextPrompt.classList.add("hidden");
    let imgSrc = "";
    if (inputCacheItem?.type === "base64" && inputCacheItem.data) {
      let raw = inputCacheItem.data.trim();
      // Kiszűrjük az esetleges többszörös data URL fejléceket (pl. data:image/png;base64,data:image/png;base64,...)
      while (raw.startsWith("data:") && raw.includes("base64,")) {
        const afterHeader = raw.substring(raw.indexOf("base64,") + 7);
        if (afterHeader.startsWith("data:")) {
          raw = afterHeader;
        } else {
          break;
        }
      }
      imgSrc = raw.startsWith("data:") ? raw : `data:${inputCacheItem.mimeType || "image/jpeg"};base64,${raw}`;
    } else if (inputCacheItem?.type === "url" && inputCacheItem.data) {
      imgSrc = inputCacheItem.data;
    } else if (itemImageUrl) {
      imgSrc = itemImageUrl;
    }

    const isPdf = Boolean(
      inputCacheItem?.mimeType === "application/pdf" ||
      imgSrc.startsWith("data:application/pdf") ||
      (imgSrc && /\.pdf($|[?#])/i.test(imgSrc))
    );

    if (isPdf) {
      if (modalImage) modalImage.classList.add("hidden");
      if (modalPdfViewer) {
        modalPdfViewer.classList.remove("hidden");
        modalPdfViewer.src = imgSrc;
      }
      if (modalImageLabel) modalImageLabel.textContent = "Eredeti PDF számla";
      if (splitTabPreviewLabel) splitTabPreviewLabel.textContent = "PDF Számla";
    } else {
      if (modalPdfViewer) {
        modalPdfViewer.classList.add("hidden");
        modalPdfViewer.src = "";
      }
      if (modalImage) {
        modalImage.classList.remove("hidden");
        modalImage.src = imgSrc;
      }
      if (modalImageLabel) modalImageLabel.textContent = "Eredeti számlakép";
      if (splitTabPreviewLabel) splitTabPreviewLabel.textContent = "Bizonylat";
    }

    if (modalImageLink) {
      if (imgSrc) {
        modalImageLink.classList.remove("hidden");
        modalImageLink.href = imgSrc;
      } else {
        modalImageLink.classList.add("hidden");
      }
    }
    if (quickViewDocLabel) quickViewDocLabel.textContent = "Bizonylat megtekintése";
  }

  // Mezők kitöltése
  if (editKiallitoNeve) editKiallitoNeve.value = state.currentEditingData.kiallito_neve || "";
  if (editKiallitoAdoszam) editKiallitoAdoszam.value = state.currentEditingData.kiallito_adoszam || "";
  if (editSzamlaszam) editSzamlaszam.value = state.currentEditingData.szamlaszam || "";
  if (editKeltDatum) editKeltDatum.value = state.currentEditingData.kelt_datum || "";
  if (editTeljesitesDatum) editTeljesitesDatum.value = state.currentEditingData.teljesites_datum || state.currentEditingData.kelt_datum || "";
  if (editFizetesiHatarido) editFizetesiHatarido.value = state.currentEditingData.fizetesi_hatarido || "";
  if (editFizetesiMod) editFizetesiMod.value = state.currentEditingData.fizetesi_mod || "Átutalás";
  if (editPenznem) editPenznem.value = (state.currentEditingData.penznem || "HUF").toUpperCase();
  if (editMegjegyzes) editMegjegyzes.value = state.currentEditingData.megjegyzes || "";

  if (editVevoNeve) editVevoNeve.value = state.currentEditingData.vevo_neve || "";
  if (editVevoAdoszam) editVevoAdoszam.value = state.currentEditingData.vevo_adoszam || "";
  if (editVevoEmail) editVevoEmail.value = state.currentEditingData.vevo_email || "";
  if (editVevoOrszag) editVevoOrszag.value = state.currentEditingData.vevo_orszag || "Magyarország";
  if (editVevoIranyitoszam) editVevoIranyitoszam.value = state.currentEditingData.vevo_iranyitoszam || "";
  if (editVevoTelepules) editVevoTelepules.value = state.currentEditingData.vevo_telepules || "";
  if (editVevoCim) editVevoCim.value = state.currentEditingData.vevo_cim || "";

  const editInvoiceDirection = document.getElementById("edit_invoice_direction") as HTMLSelectElement | null;
  const incomingInvoiceNotice = document.getElementById("incomingInvoiceNotice");
  const legalLiabilityContainer = document.getElementById("legalLiabilityContainer");
  const saveChangesBtn = document.getElementById("saveChangesBtn") as HTMLButtonElement | null;

  const anyEditingData = state.currentEditingData as any;
  const initialDir = anyEditingData.direction || anyEditingData.tipus || detectInvoiceDirection(state.currentEditingData, item.source);
  anyEditingData.direction = initialDir;
  anyEditingData.tipus = initialDir;

  if (editInvoiceDirection) {
    editInvoiceDirection.value = initialDir;
  }

  if (initialDir === 'incoming') {
    incomingInvoiceNotice?.classList.remove("hidden");
    legalLiabilityContainer?.classList.add("hidden");
    issueSzamlazzHuBtn?.classList.add("hidden");
    if (saveChangesBtn) saveChangesBtn.textContent = "Könyvelésre jóváhagyva & Mentés";
  } else {
    incomingInvoiceNotice?.classList.add("hidden");
    legalLiabilityContainer?.classList.remove("hidden");
    issueSzamlazzHuBtn?.classList.remove("hidden");
    if (saveChangesBtn) saveChangesBtn.textContent = "Mentés";
  }

  renderEditItems();
  recalculateModalTotals();

  switchSplitViewTab("form");
  editModal?.showModal();
}

export function initSplitView(): void {
  registerOpenEditModal(openEditModal);

  const editModal = document.getElementById("editModal") as HTMLDialogElement | null;
  const splitTabForm = document.getElementById("splitTabForm");
  const splitTabPreview = document.getElementById("splitTabPreview");
  const quickViewDocBtn = document.getElementById("quickViewDocBtn");
  const backToFormBtn = document.getElementById("backToFormBtn");

  const addItemBtn = document.getElementById("addItemBtn");
  const editPenznem = document.getElementById("edit_penznem") as HTMLSelectElement | null;
  const editFizetesiMod = document.getElementById("edit_fizetesi_mod") as HTMLSelectElement | null;
  const editKiallitoNeve = document.getElementById("edit_kiallito_neve") as HTMLInputElement | null;
  const editKiallitoAdoszam = document.getElementById("edit_kiallito_adoszam") as HTMLInputElement | null;
  const editSzamlaszam = document.getElementById("edit_szamlaszam") as HTMLInputElement | null;
  const editKeltDatum = document.getElementById("edit_kelt_datum") as HTMLInputElement | null;
  const editTeljesitesDatum = document.getElementById("edit_teljesites_datum") as HTMLInputElement | null;
  const editFizetesiHatarido = document.getElementById("edit_fizetesi_hatarido") as HTMLInputElement | null;
  const editMegjegyzes = document.getElementById("edit_megjegyzes") as HTMLInputElement | null;

  const editVevoNeve = document.getElementById("edit_vevo_neve") as HTMLInputElement | null;
  const editVevoAdoszam = document.getElementById("edit_vevo_adoszam") as HTMLInputElement | null;
  const editVevoEmail = document.getElementById("edit_vevo_email") as HTMLInputElement | null;
  const editVevoOrszag = document.getElementById("edit_vevo_orszag") as HTMLInputElement | null;
  const editVevoIranyitoszam = document.getElementById("edit_vevo_iranyitoszam") as HTMLInputElement | null;
  const editVevoTelepules = document.getElementById("edit_vevo_telepules") as HTMLInputElement | null;
  const editVevoCim = document.getElementById("edit_vevo_cim") as HTMLInputElement | null;

  const legalLiabilityCheckbox = document.getElementById("legalLiabilityCheckbox") as HTMLInputElement | null;
  const issueSzamlazzHuBtn = document.getElementById("issueSzamlazzHuBtn") as HTMLButtonElement | null;
  const saveChangesBtn = document.getElementById("saveChangesBtn") as HTMLButtonElement | null;
  const cancelModalBtn = document.getElementById("cancelModalBtn");

  splitTabForm?.addEventListener("click", () => switchSplitViewTab("form"));
  splitTabPreview?.addEventListener("click", () => switchSplitViewTab("preview"));
  quickViewDocBtn?.addEventListener("click", () => switchSplitViewTab("preview"));
  backToFormBtn?.addEventListener("click", () => switchSplitViewTab("form"));

  cancelModalBtn?.addEventListener("click", () => editModal?.close());

  legalLiabilityCheckbox?.addEventListener("change", () => {
    if (issueSzamlazzHuBtn && legalLiabilityCheckbox) {
      issueSzamlazzHuBtn.disabled = !legalLiabilityCheckbox.checked;
    }
  });

  editPenznem?.addEventListener("change", () => {
    if (state.currentEditingData) {
      renderEditItems();
      recalculateModalTotals();
    }
  });

  editFizetesiMod?.addEventListener("change", () => {
    if (state.currentEditingData && editFizetesiMod) {
      state.currentEditingData.fizetesi_mod = editFizetesiMod.value;
    }
  });

  addItemBtn?.addEventListener("click", () => {
    if (!state.currentEditingData) return;
    state.currentEditingData.tetelek = state.currentEditingData.tetelek || [];
    state.currentEditingData.tetelek.push({
      megnevezes: "Új tétel",
      mennyiseg: 1,
      mennyisegi_egyseg: "db",
      egysegar: 0,
      afa_szazalek: 27,
      netto_ar: 0,
      afa_ertek: 0,
      brutto_ar: 0,
    });
    renderEditItems();
    recalculateModalTotals();
  });

  // Fejléc és vevő inputok szinkronizálása
  [
    { el: editKiallitoNeve, key: "kiallito_neve" as const },
    { el: editKiallitoAdoszam, key: "kiallito_adoszam" as const },
    { el: editSzamlaszam, key: "szamlaszam" as const },
    { el: editKeltDatum, key: "kelt_datum" as const },
    { el: editTeljesitesDatum, key: "teljesites_datum" as const },
    { el: editFizetesiHatarido, key: "fizetesi_hatarido" as const },
    { el: editMegjegyzes, key: "megjegyzes" as const },
    { el: editVevoNeve, key: "vevo_neve" as const },
    { el: editVevoAdoszam, key: "vevo_adoszam" as const },
    { el: editVevoEmail, key: "vevo_email" as const },
    { el: editVevoOrszag, key: "vevo_orszag" as const },
    { el: editVevoIranyitoszam, key: "vevo_iranyitoszam" as const },
    { el: editVevoTelepules, key: "vevo_telepules" as const },
    { el: editVevoCim, key: "vevo_cim" as const },
  ].forEach(({ el, key }) => {
    el?.addEventListener("input", () => {
      if (state.currentEditingData) {
        state.currentEditingData[key] = el.value.trim() || null;
      }
    });
  });

  const editInvoiceDirection = document.getElementById("edit_invoice_direction") as HTMLSelectElement | null;
  const incomingInvoiceNotice = document.getElementById("incomingInvoiceNotice");
  const legalLiabilityContainer = document.getElementById("legalLiabilityContainer");

  editInvoiceDirection?.addEventListener("change", () => {
    const dir = editInvoiceDirection.value;
    if (state.currentEditingData) {
      (state.currentEditingData as any).direction = dir;
      (state.currentEditingData as any).tipus = dir;
    }
    if (dir === 'incoming') {
      incomingInvoiceNotice?.classList.remove("hidden");
      legalLiabilityContainer?.classList.add("hidden");
      issueSzamlazzHuBtn?.classList.add("hidden");
      if (saveChangesBtn) saveChangesBtn.textContent = "Könyvelésre jóváhagyva & Mentés";
    } else {
      incomingInvoiceNotice?.classList.add("hidden");
      legalLiabilityContainer?.classList.remove("hidden");
      issueSzamlazzHuBtn?.classList.remove("hidden");
      if (saveChangesBtn) saveChangesBtn.textContent = "Mentés";
    }
  });

  // Mentés gomb
  saveChangesBtn?.addEventListener("click", async () => {
    if (state.activeEditIndex < 0 || !state.currentEditingData) return;

    const activeItem = state.lastProcessedResults[state.activeEditIndex];
    if (!activeItem || !activeItem.success) return;

    const currentDir = editInvoiceDirection?.value || 'incoming';
    (state.currentEditingData as any).direction = currentDir;
    (state.currentEditingData as any).tipus = currentDir;

    if (saveChangesBtn) {
      saveChangesBtn.disabled = true;
      saveChangesBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Mentés...';
    }

    try {
      if (activeItem.dbId) {
        const { ok, data } = await apiFetch<{ success: boolean; error?: string }>(
          `/api/invoices/${activeItem.dbId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              data: state.currentEditingData,
              isValid: Math.abs(
                Number(state.currentEditingData.vegosszeg_netto || 0) +
                Number(state.currentEditingData.vegosszeg_afa || 0) -
                Number(state.currentEditingData.vegosszeg_brutto || 0)
              ) <= 1.0,
            }),
          }
        );

        if (!ok || !data.success) {
          throw new Error(data.error || "Hiba történt a számla mentésekor.");
        }
      }

      activeItem.data = state.currentEditingData;
      activeItem.isValid = Math.abs(
        Number(state.currentEditingData.vegosszeg_netto || 0) +
        Number(state.currentEditingData.vegosszeg_afa || 0) -
        Number(state.currentEditingData.vegosszeg_brutto || 0)
      ) <= 1.0;

      renderResultsCards();
      showToast(
        currentDir === 'incoming'
          ? "Költségszámla jóváhagyva és elmentve a könyveléshez!"
          : "Számla módosításai sikeresen elmentve!",
        "success"
      );
      editModal?.close();
    } catch (err: any) {
      showToast(err.message || "Hálózati hiba a mentés során.", "error");
    } finally {
      if (saveChangesBtn) {
        saveChangesBtn.disabled = false;
        saveChangesBtn.textContent = (editInvoiceDirection?.value === 'incoming')
          ? "Könyvelésre jóváhagyva & Mentés"
          : "Mentés";
      }
    }
  });

  // Számlázz.hu kiállítás
  issueSzamlazzHuBtn?.addEventListener("click", async () => {
    if (state.activeEditIndex < 0 || !state.currentEditingData) return;
    const activeItem = state.lastProcessedResults[state.activeEditIndex];
    if (!activeItem || !activeItem.success || !activeItem.dbId) {
      showToast("Csak mentett számla állítható ki!", "error");
      return;
    }

    // Előzetes kliensoldali validáció a vevő kötelező adataira
    const missing: string[] = [];
    if (!state.currentEditingData.vevo_neve?.trim()) missing.push("Vevő neve");
    if (!state.currentEditingData.vevo_iranyitoszam?.trim()) missing.push("Irányítószám");
    if (!state.currentEditingData.vevo_telepules?.trim()) missing.push("Település");
    if (!state.currentEditingData.vevo_cim?.trim()) missing.push("Cím (utca, házszám)");

    if (missing.length > 0) {
      showToast(`A kiállításhoz a Számlázz.hu és az Áfa tv. szerint kötelező kitölteni a vevő adatait! Hiányzik: ${missing.join(", ")}`, "error");
      return;
    }

    if (issueSzamlazzHuBtn) {
      issueSzamlazzHuBtn.disabled = true;
      issueSzamlazzHuBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Kiállítás...';
    }

    try {
      const { ok, data } = await apiFetch<{
        success: boolean;
        invoiceNumber?: string;
        pdfBase64?: string | null;
        error?: string;
      }>(`/api/szamlazz/issue/${activeItem.dbId}`, {
        method: "POST",
        body: JSON.stringify({ data: state.currentEditingData }),
      });

      if (ok && data.success) {
        showToast(`Számla sikeresen kiállítva! Szám: ${data.invoiceNumber || ""}`, "success");
        if (data.pdfBase64) {
          const blob = new Blob(
            [Uint8Array.from(atob(data.pdfBase64), (c) => c.charCodeAt(0))],
            { type: "application/pdf" }
          );
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `szamla_${data.invoiceNumber || "szamlazz"}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        }
        editModal?.close();
      } else {
        showToast(data.error || "Nem sikerült kiállítani a számlát.", "error");
      }
    } catch {
      showToast("Hálózati hiba a kiállítás során.", "error");
    } finally {
      if (issueSzamlazzHuBtn) {
        issueSzamlazzHuBtn.disabled = false;
        issueSzamlazzHuBtn.textContent = "🧾 E-számla Kiállítása";
      }
    }
  });
}
