// frontend/src/scripts/worksheets.ts
// MesterMunkalap PWA modul: terepi munkalapok kezelése, érintőképernyős aláírás,
// előtte/utána fotók kezelése, partner autocomplete és 1-kattintásos Számlázz.hu kiállítás.

import { apiFetch, getAuthToken } from './api.js';
import { escapeHtml } from './sanitize.js';
import { showToast } from './toast.js';
import type { Worksheet, WorksheetItem, WorksheetStatus } from '@szamlazo/shared';
import type { PartnerSuggestionItem } from './partner-suggest.js';

interface WorksheetsState {
  items: Worksheet[];
  activeWorksheet: Worksheet | null;
  currentFilter: 'all' | WorksheetStatus;
  searchQuery: string;
  hasDrawnSignature: boolean;
  pendingBeforePhotos: string[];
  pendingAfterPhotos: string[];
}

const wsState: WorksheetsState = {
  items: [],
  activeWorksheet: null,
  currentFilter: 'all',
  searchQuery: '',
  hasDrawnSignature: false,
  pendingBeforePhotos: [],
  pendingAfterPhotos: [],
};

// ==========================================
// 1. Munkalapok Betöltése és Statisztikák
// ==========================================
export async function loadWorksheets(): Promise<void> {
  const token = getAuthToken();
  if (!token) return;

  try {
    let url = '/api/worksheets';
    const params = new URLSearchParams();
    if (wsState.currentFilter !== 'all') {
      params.set('status', wsState.currentFilter);
    }
    if (wsState.searchQuery.trim()) {
      params.set('q', wsState.searchQuery.trim());
    }
    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    const { ok, data } = await apiFetch<{ success: boolean; worksheets?: Worksheet[]; error?: string }>(url);

    if (ok && data.success && Array.isArray(data.worksheets)) {
      wsState.items = data.worksheets;
      updateWorksheetStats(data.worksheets);
      renderWorksheetCards(data.worksheets);
    }
  } catch (err) {
    console.error('Hiba a munkalapok betöltésekor:', err);
  }
}

function updateWorksheetStats(worksheets: Worksheet[]): void {
  const total = worksheets.length;
  const draft = worksheets.filter((w) => w.status === 'draft').length;
  const signed = worksheets.filter((w) => w.status === 'signed').length;
  const invoiced = worksheets.filter((w) => w.status === 'invoiced').length;

  const totalEl = document.getElementById('wsStatTotal');
  const draftEl = document.getElementById('wsStatDraft');
  const signedEl = document.getElementById('wsStatSigned');
  const invoicedEl = document.getElementById('wsStatInvoiced');

  if (totalEl) totalEl.textContent = String(total);
  if (draftEl) draftEl.textContent = String(draft);
  if (signedEl) signedEl.textContent = String(signed);
  if (invoicedEl) invoicedEl.textContent = String(invoiced);
}

// ==========================================
// 2. Munkalapkártyák Renderelése
// ==========================================
function renderWorksheetCards(worksheets: Worksheet[]): void {
  const grid = document.getElementById('worksheetCardsGrid');
  const emptyState = document.getElementById('worksheetEmptyState');
  if (!grid) return;

  grid.innerHTML = '';

  if (worksheets.length === 0) {
    emptyState?.classList.remove('hidden');
    return;
  }

  emptyState?.classList.add('hidden');

  for (const ws of worksheets) {
    const card = document.createElement('div');
    card.className =
      'card bg-base-100 shadow-md hover:shadow-lg transition-all duration-200 border border-base-200 rounded-2xl overflow-hidden flex flex-col justify-between';

    // Státusz badge
    let statusBadge = '<span class="badge badge-warning text-xs font-semibold">Piszkozat</span>';
    if (ws.status === 'signed') {
      statusBadge = '<span class="badge badge-success text-xs font-semibold">✓ Aláírva</span>';
    } else if (ws.status === 'invoiced') {
      statusBadge = '<span class="badge badge-info text-xs font-semibold">🧾 Leszámlázva</span>';
    }

    // Összeg kiszámítása
    const totalAmount = (ws.items || []).reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0);
    const formattedTotal = new Intl.NumberFormat('hu-HU').format(totalAmount);

    // Dátum
    const createdAtStr = ws.createdAt
      ? new Date(ws.createdAt).toLocaleDateString('hu-HU', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';

    // Fotók száma
    const beforeCount = ws.beforePhotos?.length || 0;
    const afterCount = ws.afterPhotos?.length || 0;
    const totalPhotos = beforeCount + afterCount;

    card.innerHTML = `
      <div class="card-body p-4 space-y-3">
        <!-- Fejléc: Munkalap szám és státusz -->
        <div class="flex justify-between items-start gap-2">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-mono font-bold text-xs bg-base-200 text-base-content/80 px-2 py-0.5 rounded-lg border border-base-300">
                ${escapeHtml(ws.worksheetNumber || 'ML-ÚJ')}
              </span>
              ${statusBadge}
            </div>
            <h3 class="font-bold text-base text-base-content mt-1 line-clamp-1">
              ${escapeHtml(ws.clientName || 'Névtelen megrendelő')}
            </h3>
          </div>
          <div class="text-right">
            <span class="text-sm font-extrabold text-success font-mono whitespace-nowrap">${formattedTotal} Ft</span>
            <div class="text-[10px] text-base-content/50">${createdAtStr}</div>
          </div>
        </div>

        <!-- Cím és Készülék infó -->
        <div class="text-xs space-y-1 text-base-content/70 bg-base-200/40 p-2.5 rounded-xl border border-base-300">
          ${
            ws.clientAddress || ws.clientCity
              ? `<div class="flex items-center gap-1.5 truncate">
                   <span class="shrink-0">📍</span>
                   <span class="truncate">${escapeHtml([ws.clientZip, ws.clientCity, ws.clientAddress].filter(Boolean).join(' '))}</span>
                 </div>`
              : ''
          }
          ${
            ws.deviceType
              ? `<div class="flex items-center gap-1.5 truncate font-medium text-base-content/90">
                   <span class="shrink-0">🔧</span>
                   <span class="truncate">${escapeHtml(ws.deviceType)}</span>
                 </div>`
              : ''
          }
          ${
            ws.description
              ? `<div class="flex items-start gap-1.5 text-base-content/60 text-[11px] line-clamp-2">
                   <span class="shrink-0">📝</span>
                   <span>${escapeHtml(ws.description)}</span>
                 </div>`
              : ''
          }
        </div>

        <!-- Csatolmányok sávja (Fotók és Aláírás jelzés) -->
        <div class="flex items-center justify-between text-xs text-base-content/60 pt-1">
          <div class="flex items-center gap-3">
            <span class="flex items-center gap-1 text-[11px]" title="${totalPhotos} fotó csatolva">
              <span>📸</span>
              <span>${totalPhotos} fotó</span>
            </span>
            ${
              ws.signatureUrl
                ? '<span class="flex items-center gap-1 text-[11px] text-success font-medium"><span>✍️</span> Aláírva</span>'
                : '<span class="flex items-center gap-1 text-[11px] text-warning font-medium"><span>⚠️</span> Nincs aláírva</span>'
            }
          </div>
          <span class="text-[11px] text-base-content/50">${(ws.items || []).length} tétel</span>
        </div>
      </div>

      <!-- Kártya alsó gombok -->
      <div class="card-actions bg-base-200/50 p-2.5 border-t border-base-200 flex justify-between items-center gap-2">
        <button
          type="button"
          class="btn btn-ghost btn-xs text-error hover:bg-error/10 ws-delete-btn"
          data-id="${escapeHtml(ws.id || '')}"
          title="Munkalap törlése"
        >
          🗑️ Törlés
        </button>

        <div class="flex items-center gap-1.5">
          ${
            ws.status !== 'invoiced'
              ? `<button
                   type="button"
                   class="btn btn-secondary btn-xs font-semibold text-white ws-invoice-btn"
                   data-id="${escapeHtml(ws.id || '')}"
                   title="Számlázz.hu átadás"
                 >
                   🧾 Számlázás
                 </button>`
              : ''
          }
          <button
            type="button"
            class="btn btn-primary btn-xs font-semibold ws-open-btn"
            data-id="${escapeHtml(ws.id || '')}"
          >
            ✏️ Megnyitás
          </button>
        </div>
      </div>
    `;

    // Eseménykezelők a kártyán
    card.querySelector('.ws-open-btn')?.addEventListener('click', () => {
      openWorksheetModal(ws);
    });

    card.querySelector('.ws-invoice-btn')?.addEventListener('click', () => {
      openWorksheetModal(ws);
      // Fókusz a számlázó dobozra
      const bridgeBox = document.getElementById('wsInvoiceBridgeBox');
      bridgeBox?.scrollIntoView({ behavior: 'smooth' });
    });

    card.querySelector('.ws-delete-btn')?.addEventListener('click', () => {
      if (ws.id) {
        confirmDeleteWorksheet(ws.id, ws.worksheetNumber || 'munkalap');
      }
    });

    grid.appendChild(card);
  }
}

// ==========================================
// 3. Munkalap Törlése
// ==========================================
async function confirmDeleteWorksheet(id: string, name: string): Promise<void> {
  const confirmed = window.confirm(`Biztosan törölni szeretnéd a(z) "${name}" munkalapot? A művelet nem visszavonható.`);
  if (!confirmed) return;

  try {
    const { ok, data } = await apiFetch<{ success: boolean; error?: string }>(`/api/worksheets/${id}`, {
      method: 'DELETE',
    });

    if (ok && data.success) {
      showToast('✓ Munkalap sikeresen törölve.', 'success');
      await loadWorksheets();
    } else {
      showToast(data.error || 'A munkalap törlése sikertelen.', 'error');
    }
  } catch (err: any) {
    showToast(err.message || 'Hálózati hiba történt.', 'error');
  }
}

// ==========================================
// 4. Modál Kezelés és Adatok Feltöltése
// ==========================================
export function openWorksheetModal(ws?: Worksheet | null): void {
  const modal = document.getElementById('worksheetModal') as HTMLDialogElement | null;
  if (!modal) return;

  wsState.activeWorksheet = ws || null;
  wsState.hasDrawnSignature = false;
  wsState.pendingBeforePhotos = ws?.beforePhotos ? [...ws.beforePhotos] : [];
  wsState.pendingAfterPhotos = ws?.afterPhotos ? [...ws.afterPhotos] : [];

  // Fejléc beállítása
  const titleEl = document.getElementById('wsModalTitle');
  const badgeEl = document.getElementById('wsModalStatusBadge');
  if (titleEl) {
    titleEl.textContent = ws?.worksheetNumber ? `Munkalap: ${ws.worksheetNumber}` : 'Új Munkalap';
  }
  if (badgeEl) {
    if (ws?.status === 'signed') {
      badgeEl.className = 'badge badge-success text-xs';
      badgeEl.textContent = 'Aláírva';
    } else if (ws?.status === 'invoiced') {
      badgeEl.className = 'badge badge-info text-xs';
      badgeEl.textContent = 'Leszámlázva';
    } else {
      badgeEl.className = 'badge badge-warning text-xs';
      badgeEl.textContent = 'Piszkozat';
    }
  }

  // Mezők kitöltése
  setInputValue('wsClientName', ws?.clientName || '');
  setInputValue('wsClientTaxNumber', ws?.clientTaxNumber || '');
  setInputValue('wsClientZip', ws?.clientZip || '');
  setInputValue('wsClientCity', ws?.clientCity || '');
  setInputValue('wsClientAddress', ws?.clientAddress || '');
  setInputValue('wsClientPhone', ws?.clientPhone || '');
  setInputValue('wsClientEmail', ws?.clientEmail || '');
  setInputValue('wsDeviceType', ws?.deviceType || '');
  setInputValue('wsDescription', ws?.description || '');

  // Tételek táblázat
  renderItemsTable(ws?.items || []);

  // Fotók galéria
  renderPhotosGallery('before', wsState.pendingBeforePhotos);
  renderPhotosGallery('after', wsState.pendingAfterPhotos);

  // Aláírás canvas inicializálás
  initSignatureCanvas(ws?.signatureUrl);

  // Számlázz.hu átadás doboz állapot
  const liabilityCheckbox = document.getElementById('wsLegalLiabilityCheckbox') as HTMLInputElement | null;
  const issueBtn = document.getElementById('wsIssueInvoiceBtn') as HTMLButtonElement | null;
  if (liabilityCheckbox) liabilityCheckbox.checked = false;
  if (issueBtn) {
    issueBtn.disabled = true;
    issueBtn.textContent = ws?.status === 'invoiced' ? '✓ Már átadva (Újraküldés)' : '🧾 Átadás a Számlázz.hu-nak';
  }

  modal.showModal();
}

function setInputValue(id: string, value: string): void {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (el) el.value = value;
}

function getInputValue(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  return el ? el.value.trim() : '';
}

// ==========================================
// 5. Dinamikus Tételek Táblázat Kezelése
// ==========================================
function renderItemsTable(items: WorksheetItem[]): void {
  const tbody = document.getElementById('wsItemsTbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  const list = items.length > 0 ? items : [{ name: '', quantity: 1, unit: 'db', unitPrice: 0, totalPrice: 0 }];

  for (const item of list) {
    addItemRow(item);
  }

  recalculateWorksheetTotals();
}

function addItemRow(item?: Partial<WorksheetItem>): void {
  const tbody = document.getElementById('wsItemsTbody');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.className = 'hover:bg-base-200/40 transition-colors';

  const name = item?.name || '';
  const qty = item?.quantity ?? 1;
  const unit = item?.unit || 'db';
  const unitPrice = item?.unitPrice ?? 0;
  const totalPrice = item?.totalPrice ?? qty * unitPrice;

  tr.innerHTML = `
    <td>
      <input
        type="text"
        class="input input-xs input-bordered w-full item-name-input"
        placeholder="pl. Karbantartási munkadíj / Klímagáz R32"
        value="${escapeHtml(name)}"
        required
      />
    </td>
    <td>
      <input
        type="number"
        step="any"
        min="0.01"
        class="input input-xs input-bordered w-16 text-right item-qty-input font-mono"
        value="${qty}"
      />
    </td>
    <td>
      <input
        type="text"
        class="input input-xs input-bordered w-14 item-unit-input"
        placeholder="db"
        value="${escapeHtml(unit)}"
      />
    </td>
    <td>
      <input
        type="number"
        step="1"
        class="input input-xs input-bordered w-24 text-right item-price-input font-mono"
        placeholder="0"
        value="${unitPrice}"
      />
    </td>
    <td class="text-right font-mono font-bold text-xs item-total-cell whitespace-nowrap">
      ${new Intl.NumberFormat('hu-HU').format(totalPrice)} Ft
    </td>
    <td class="text-center">
      <button type="button" class="btn btn-ghost btn-xs text-error item-remove-btn p-1" title="Tétel törlése">
        ✕
      </button>
    </td>
  `;

  // Számítási események
  const qtyInput = tr.querySelector('.item-qty-input') as HTMLInputElement | null;
  const priceInput = tr.querySelector('.item-price-input') as HTMLInputElement | null;
  const totalCell = tr.querySelector('.item-total-cell') as HTMLElement | null;

  function updateRowTotal(): void {
    const q = parseFloat(qtyInput?.value || '0') || 0;
    const p = parseFloat(priceInput?.value || '0') || 0;
    const tot = Math.round(q * p);
    if (totalCell) {
      totalCell.textContent = `${new Intl.NumberFormat('hu-HU').format(tot)} Ft`;
    }
    recalculateWorksheetTotals();
  }

  qtyInput?.addEventListener('input', updateRowTotal);
  priceInput?.addEventListener('input', updateRowTotal);

  // Törlés gomb
  tr.querySelector('.item-remove-btn')?.addEventListener('click', () => {
    tr.remove();
    recalculateWorksheetTotals();
  });

  tbody.appendChild(tr);
}

function recalculateWorksheetTotals(): void {
  const tbody = document.getElementById('wsItemsTbody');
  const totalAmountEl = document.getElementById('wsTotalAmount');
  if (!tbody || !totalAmountEl) return;

  let grandTotal = 0;
  const rows = tbody.querySelectorAll('tr');

  rows.forEach((tr) => {
    const qtyInput = tr.querySelector('.item-qty-input') as HTMLInputElement | null;
    const priceInput = tr.querySelector('.item-price-input') as HTMLInputElement | null;
    const q = parseFloat(qtyInput?.value || '0') || 0;
    const p = parseFloat(priceInput?.value || '0') || 0;
    grandTotal += Math.round(q * p);
  });

  totalAmountEl.textContent = `${new Intl.NumberFormat('hu-HU').format(grandTotal)} Ft`;
}

function collectItemsFromTable(): WorksheetItem[] {
  const tbody = document.getElementById('wsItemsTbody');
  if (!tbody) return [];

  const items: WorksheetItem[] = [];
  const rows = tbody.querySelectorAll('tr');

  rows.forEach((tr) => {
    const nameInput = tr.querySelector('.item-name-input') as HTMLInputElement | null;
    const qtyInput = tr.querySelector('.item-qty-input') as HTMLInputElement | null;
    const unitInput = tr.querySelector('.item-unit-input') as HTMLInputElement | null;
    const priceInput = tr.querySelector('.item-price-input') as HTMLInputElement | null;

    const name = nameInput?.value.trim() || '';
    if (!name) return; // Üres sort kihagyunk

    const quantity = parseFloat(qtyInput?.value || '1') || 1;
    const unit = unitInput?.value.trim() || 'db';
    const unitPrice = parseFloat(priceInput?.value || '0') || 0;
    const totalPrice = Math.round(quantity * unitPrice);

    items.push({
      name,
      quantity,
      unit,
      unitPrice,
      totalPrice,
    });
  });

  return items;
}

// ==========================================
// 6. Érintőképernyős Aláírás Canvas (HTML5 PointerEvents)
// ==========================================
let canvasCtx: CanvasRenderingContext2D | null = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;

function initSignatureCanvas(existingUrl?: string | null): void {
  const canvas = document.getElementById('wsSignatureCanvas') as HTMLCanvasElement | null;
  const placeholder = document.getElementById('wsSignaturePlaceholder');
  const signedAtNotice = document.getElementById('wsSignedAtNotice');
  const signedAtText = document.getElementById('wsSignedAtText');

  if (!canvas) return;

  canvasCtx = canvas.getContext('2d');
  if (!canvasCtx) return;

  // Retina / HiDPI méretezés a kristálytiszta vonalakért
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = (rect.width || 700) * dpr;
  canvas.height = (rect.height || 160) * dpr;
  canvasCtx.scale(dpr, dpr);

  // Vonal stílus
  canvasCtx.lineWidth = 2.5;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';
  canvasCtx.strokeStyle = '#0f172a'; // Mélykék / sötét tinta

  // Korábbi aláírás betöltése, ha van
  if (existingUrl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvasCtx?.clearRect(0, 0, canvas.width, canvas.height);
      canvasCtx?.drawImage(img, 0, 0, rect.width || 700, rect.height || 160);
      placeholder?.classList.add('hidden');
      wsState.hasDrawnSignature = true;
    };
    img.src = existingUrl;

    if (signedAtNotice && signedAtText && wsState.activeWorksheet?.signedAt) {
      signedAtText.textContent = new Date(wsState.activeWorksheet.signedAt).toLocaleString('hu-HU');
      signedAtNotice.classList.remove('hidden');
    }
  } else {
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    placeholder?.classList.remove('hidden');
    signedAtNotice?.classList.add('hidden');
    wsState.hasDrawnSignature = false;
  }
}

function setupSignatureDrawingListeners(): void {
  const canvas = document.getElementById('wsSignatureCanvas') as HTMLCanvasElement | null;
  const placeholder = document.getElementById('wsSignaturePlaceholder');
  const clearBtn = document.getElementById('wsClearSignatureBtn');

  if (!canvas) return;

  function getCanvasCoords(e: PointerEvent): { x: number; y: number } {
    const rect = canvas!.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    isDrawing = true;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = getCanvasCoords(e);
    lastX = x;
    lastY = y;
    placeholder?.classList.add('hidden');
    wsState.hasDrawnSignature = true;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isDrawing || !canvasCtx) return;
    const { x, y } = getCanvasCoords(e);

    canvasCtx.beginPath();
    canvasCtx.moveTo(lastX, lastY);
    canvasCtx.lineTo(x, y);
    canvasCtx.stroke();

    lastX = x;
    lastY = y;
  });

  const stopDrawing = (e: PointerEvent) => {
    if (isDrawing) {
      isDrawing = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignoráljuk, ha már felengedve
      }
    }
  };

  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointercancel', stopDrawing);

  // Újraírás / törlés gomb
  clearBtn?.addEventListener('click', () => {
    if (canvasCtx && canvas) {
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      placeholder?.classList.remove('hidden');
      wsState.hasDrawnSignature = false;
      const signedAtNotice = document.getElementById('wsSignedAtNotice');
      signedAtNotice?.classList.add('hidden');
    }
  });
}

// ==========================================
// 7. Fotók Feltöltése és Galéria Megjelenítése
// ==========================================
function renderPhotosGallery(field: 'before' | 'after', photoUrls: string[]): void {
  const container = document.getElementById(field === 'before' ? 'wsBeforePhotosGallery' : 'wsAfterPhotosGallery');
  if (!container) return;

  container.innerHTML = '';

  if (photoUrls.length === 0) {
    container.innerHTML = `<span class="text-[11px] text-base-content/40 italic p-1">Nincs feltöltött ${field === 'before' ? 'előtte' : 'utána'} fotó</span>`;
    return;
  }

  for (let idx = 0; idx < photoUrls.length; idx++) {
    const url = photoUrls[idx];
    const thumb = document.createElement('div');
    thumb.className = 'relative group w-16 h-16 rounded-lg overflow-hidden border border-base-300 bg-base-200 shrink-0';

    thumb.innerHTML = `
      <img src="${escapeHtml(url)}" alt="Fotó" class="w-full h-full object-cover cursor-pointer" />
      <button
        type="button"
        class="absolute top-0 right-0 bg-red-600/80 hover:bg-red-600 text-white rounded-bl-lg w-5 h-5 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
        title="Fotó törlése"
      >
        ✕
      </button>
    `;

    // Nagyítás új fülön kattintásra
    thumb.querySelector('img')?.addEventListener('click', () => {
      window.open(url, '_blank');
    });

    // Törlés gomb
    thumb.querySelector('button')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (field === 'before') {
        wsState.pendingBeforePhotos.splice(idx, 1);
        renderPhotosGallery('before', wsState.pendingBeforePhotos);
      } else {
        wsState.pendingAfterPhotos.splice(idx, 1);
        renderPhotosGallery('after', wsState.pendingAfterPhotos);
      }
    });

    container.appendChild(thumb);
  }
}

async function handlePhotoFileSelected(field: 'before' | 'after', file: File): Promise<void> {
  if (!file) return;

  // Méret és típus ellenőrzés (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    showToast('A fénykép mérete nem haladhatja meg a 10 MB-ot.', 'error');
    return;
  }

  showToast('Fénykép feldolgozása...', 'info');

  const reader = new FileReader();
  reader.onload = async () => {
    const base64Data = reader.result as string;

    // Ha van már mentett munkalap id, feltöltjük azonnal MinIO-ba
    if (wsState.activeWorksheet?.id) {
      try {
        const { ok, data } = await apiFetch<{ success: boolean; s3Key?: string; url?: string; error?: string }>(
          `/api/worksheets/${wsState.activeWorksheet.id}/upload-asset`,
          {
            method: 'POST',
            body: JSON.stringify({
              base64Data,
              type: 'photo',
              field,
            }),
          }
        );

        if (ok && data.success && data.url) {
          if (field === 'before') {
            wsState.pendingBeforePhotos.push(data.url);
            renderPhotosGallery('before', wsState.pendingBeforePhotos);
          } else {
            wsState.pendingAfterPhotos.push(data.url);
            renderPhotosGallery('after', wsState.pendingAfterPhotos);
          }
          showToast('✓ Fénykép sikeresen feltöltve a helyi felhőbe!', 'success');
        } else {
          showToast(data.error || 'Fénykép feltöltése sikertelen.', 'error');
        }
      } catch (err: any) {
        showToast(err.message || 'Feltöltési hiba.', 'error');
      }
    } else {
      // Új munkalap esetén helyi adatként tároljuk mentésig
      if (field === 'before') {
        wsState.pendingBeforePhotos.push(base64Data);
        renderPhotosGallery('before', wsState.pendingBeforePhotos);
      } else {
        wsState.pendingAfterPhotos.push(base64Data);
        renderPhotosGallery('after', wsState.pendingAfterPhotos);
      }
      showToast('✓ Fénykép csatolva a munkalaphoz.', 'success');
    }
  };

  reader.readAsDataURL(file);
}

// ==========================================
// 8. Munkalap Mentése (Létrehozás / Módosítás)
// ==========================================
async function saveWorksheet(): Promise<Worksheet | null> {
  const clientName = getInputValue('wsClientName');
  if (!clientName) {
    showToast('Kérjük, add meg a megrendelő (ügyfél) nevét!', 'error');
    document.getElementById('wsClientName')?.focus();
    return null;
  }

  const description = getInputValue('wsDescription');
  if (!description) {
    showToast('Kérjük, add meg az elvégzett munka rövid összefoglalását!', 'error');
    document.getElementById('wsDescription')?.focus();
    return null;
  }

  const items = collectItemsFromTable();
  if (items.length === 0) {
    showToast('Kérjük, rögzíts legalább egy munkadíj vagy anyag tételt!', 'error');
    return null;
  }

  const saveBtn = document.getElementById('wsSaveDraftBtn') as HTMLButtonElement | null;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés folyamatban...';
  }

  try {
    const payload: Partial<Worksheet> = {
      clientName,
      clientTaxNumber: getInputValue('wsClientTaxNumber') || null,
      clientZip: getInputValue('wsClientZip') || null,
      clientCity: getInputValue('wsClientCity') || null,
      clientAddress: getInputValue('wsClientAddress') || null,
      clientPhone: getInputValue('wsClientPhone') || null,
      clientEmail: getInputValue('wsClientEmail') || null,
      deviceType: getInputValue('wsDeviceType') || null,
      description,
      items,
      beforePhotos: wsState.pendingBeforePhotos,
      afterPhotos: wsState.pendingAfterPhotos,
    };

    let resultWs: Worksheet | null = null;

    if (wsState.activeWorksheet?.id) {
      // Frissítés
      const { ok, data } = await apiFetch<{ success: boolean; worksheet?: Worksheet; error?: string }>(
        `/api/worksheets/${wsState.activeWorksheet.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }
      );

      if (!ok || !data.success || !data.worksheet) {
        showToast(data.error || 'A munkalap mentése sikertelen.', 'error');
        return null;
      }
      resultWs = data.worksheet;
    } else {
      // Új létrehozása
      const { ok, data } = await apiFetch<{ success: boolean; worksheet?: Worksheet; error?: string }>(
        '/api/worksheets',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );

      if (!ok || !data.success || !data.worksheet) {
        showToast(data.error || 'Az új munkalap létrehozása sikertelen.', 'error');
        return null;
      }
      resultWs = data.worksheet;
    }

    // Ha rajzoltak aláírást a canvasra, feltöltjük MinIO-ba
    const canvas = document.getElementById('wsSignatureCanvas') as HTMLCanvasElement | null;
    if (canvas && wsState.hasDrawnSignature && resultWs?.id) {
      const base64Data = canvas.toDataURL('image/png');
      const { ok: sigOk } = await apiFetch<{ success: boolean }>(`/api/worksheets/${resultWs.id}/upload-asset`, {
        method: 'POST',
        body: JSON.stringify({
          base64Data,
          type: 'signature',
        }),
      });

      if (sigOk) {
        resultWs.status = 'signed';
      }
    }

    wsState.activeWorksheet = resultWs;
    showToast(`✓ Munkalap (${resultWs.worksheetNumber}) sikeresen elmentve!`, 'success');
    await loadWorksheets();
    return resultWs;
  } catch (err: any) {
    showToast(err.message || 'Hálózati hiba történt a mentés során.', 'error');
    return null;
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Mentés';
    }
  }
}

// ==========================================
// 9. Számlázz.hu 1-Kattintásos Híd Művelet
// ==========================================
async function issueInvoiceFromWorksheet(): Promise<void> {
  const liabilityCheckbox = document.getElementById('wsLegalLiabilityCheckbox') as HTMLInputElement | null;
  if (!liabilityCheckbox?.checked) {
    showToast('A számla kiállításához kérjük, fogadd el az átadás jóváhagyását!', 'error');
    liabilityCheckbox?.focus();
    return;
  }

  // Először elmentjük az aktuális módosításokat
  const savedWs = await saveWorksheet();
  if (!savedWs || !savedWs.id) return;

  const issueBtn = document.getElementById('wsIssueInvoiceBtn') as HTMLButtonElement | null;
  if (issueBtn) {
    issueBtn.disabled = true;
    issueBtn.textContent = 'Számla generálása...';
  }

  try {
    const { ok, data } = await apiFetch<{ success: boolean; invoiceId?: string; worksheet?: Worksheet; error?: string }>(
      `/api/worksheets/${savedWs.id}/to-invoice`,
      {
        method: 'POST',
      }
    );

    if (ok && data.success) {
      showToast('🎉 Munkalap sikeresen átadva a számlázónak! A számla elkészült.', 'success');
      const modal = document.getElementById('worksheetModal') as HTMLDialogElement | null;
      modal?.close();
      await loadWorksheets();

      // Automatikus átváltás a számlák nézetre, ha elérhető
      const modeTabInvoices = document.getElementById('modeTabInvoices');
      modeTabInvoices?.click();
    } else {
      showToast(data.error || 'A számla kiállítása sikertelen.', 'error');
    }
  } catch (err: any) {
    showToast(err.message || 'Hiba történt a számla kiállításakor.', 'error');
  } finally {
    if (issueBtn) {
      issueBtn.disabled = false;
      issueBtn.textContent = '🧾 Átadás a Számlázz.hu-nak';
    }
  }
}

// ==========================================
// 10. Partner Autocomplete a Munkalap Modálban
// ==========================================
function initWorksheetPartnerSuggestions(): void {
  const suggestions = document.getElementById('wsPartnerSuggestions');
  const list = document.getElementById('wsPartnerList');
  const input = document.getElementById('wsClientName') as HTMLInputElement | null;

  if (!suggestions || !list || !input) return;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function closeDropdown(): void {
    suggestions?.classList.add('hidden');
    if (list) list.innerHTML = '';
  }

  async function fetchSuggestions(query: string): Promise<void> {
    const token = getAuthToken();
    if (!token || query.length < 2) {
      closeDropdown();
      return;
    }

    try {
      const { ok, data } = await apiFetch<{ success: boolean; partners?: Array<string | PartnerSuggestionItem> }>(
        `/api/partners/suggest?q=${encodeURIComponent(query)}`
      );

      if (!ok || !data.success) return;
      const rawPartners = data.partners || [];

      if (rawPartners.length === 0) {
        closeDropdown();
        return;
      }

      list!.innerHTML = '';
      for (const p of rawPartners) {
        const item: PartnerSuggestionItem = typeof p === 'string' ? { name: p } : p;
        const li = document.createElement('li');

        const safeName = escapeHtml(item.name);
        const safeQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const highlightedName = safeName.replace(
          new RegExp(`(${safeQuery})`, 'gi'),
          '<mark class="bg-primary/20 text-primary font-bold rounded px-0.5">$1</mark>'
        );

        const detailsParts: string[] = [];
        if (item.taxNumber) detailsParts.push(`Adószám: ${item.taxNumber}`);
        const addressParts = [item.zip, item.city, item.address].filter(Boolean);
        if (addressParts.length > 0) detailsParts.push(addressParts.join(' '));

        const detailsHtml =
          detailsParts.length > 0
            ? `<span class="text-[11px] text-base-content/60 truncate max-w-full">${escapeHtml(detailsParts.join(' • '))}</span>`
            : '';

        li.innerHTML = `
          <a class="flex flex-col items-start gap-0.5 py-1.5 px-3 rounded-lg hover:bg-base-200 cursor-pointer w-full text-left transition-colors">
            <span class="font-bold text-xs text-base-content leading-tight">${highlightedName}</span>
            ${detailsHtml}
          </a>
        `;

        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectPartner(item);
          closeDropdown();
        });

        list!.appendChild(li);
      }

      suggestions?.classList.remove('hidden');
    } catch {
      // Autocomplete csendes hiba
    }
  }

  function selectPartner(partner: PartnerSuggestionItem): void {
    input!.value = partner.name;

    if (partner.taxNumber) setInputValue('wsClientTaxNumber', partner.taxNumber);
    if (partner.zip) setInputValue('wsClientZip', partner.zip);
    if (partner.city) setInputValue('wsClientCity', partner.city);
    if (partner.address) setInputValue('wsClientAddress', partner.address);
    if (partner.email) setInputValue('wsClientEmail', partner.email);

    input!.focus();
    showToast(`✓ "${partner.name}" adatai automatikusan beillesztve!`, 'success');
  }

  input.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    const val = input.value.trim();
    if (val.length < 2) {
      closeDropdown();
      return;
    }
    debounceTimer = setTimeout(() => {
      fetchSuggestions(val);
    }, 250);
  });

  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    if (!suggestions.contains(target) && !input.contains(target)) {
      closeDropdown();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown();
  });
}

// ==========================================
// 11. Modul Inicializálása
// ==========================================
export function initWorksheets(): void {
  // Új munkalap gomb
  const openNewBtn = document.getElementById('openNewWorksheetBtn');
  openNewBtn?.addEventListener('click', () => {
    openWorksheetModal(null);
  });

  // Modál bezáró gombok
  const closeWsModalBtn = document.getElementById('closeWsModalBtn');
  const wsCancelBtn = document.getElementById('wsCancelBtn');
  const modal = document.getElementById('worksheetModal') as HTMLDialogElement | null;

  closeWsModalBtn?.addEventListener('click', () => modal?.close());
  wsCancelBtn?.addEventListener('click', () => modal?.close());

  // Tétel hozzáadása gomb
  const addItemBtn = document.getElementById('wsAddItemRowBtn');
  addItemBtn?.addEventListener('click', () => {
    addItemRow();
  });

  // Mentés gomb
  const saveBtn = document.getElementById('wsSaveDraftBtn');
  saveBtn?.addEventListener('click', async () => {
    await saveWorksheet();
  });

  // Számlázz.hu kiállítás gomb
  const issueBtn = document.getElementById('wsIssueInvoiceBtn');
  issueBtn?.addEventListener('click', async () => {
    await issueInvoiceFromWorksheet();
  });

  // Jogi felelősségvállalás checkbox
  const liabilityCheckbox = document.getElementById('wsLegalLiabilityCheckbox') as HTMLInputElement | null;
  liabilityCheckbox?.addEventListener('change', () => {
    const btn = document.getElementById('wsIssueInvoiceBtn') as HTMLButtonElement | null;
    if (btn) btn.disabled = !liabilityCheckbox.checked;
  });

  // Fotó inputok (Előtte / Utána)
  const beforePhotoInput = document.getElementById('wsBeforePhotoInput') as HTMLInputElement | null;
  const afterPhotoInput = document.getElementById('wsAfterPhotoInput') as HTMLInputElement | null;

  beforePhotoInput?.addEventListener('change', () => {
    if (beforePhotoInput.files && beforePhotoInput.files[0]) {
      handlePhotoFileSelected('before', beforePhotoInput.files[0]);
      beforePhotoInput.value = '';
    }
  });

  afterPhotoInput?.addEventListener('change', () => {
    if (afterPhotoInput.files && afterPhotoInput.files[0]) {
      handlePhotoFileSelected('after', afterPhotoInput.files[0]);
      afterPhotoInput.value = '';
    }
  });

  // Aláírás canvas eseménykezelők
  setupSignatureDrawingListeners();

  // Partner autocomplete
  initWorksheetPartnerSuggestions();

  // Státusz szűrő gombok
  const filterBtns = document.querySelectorAll('.ws-filter-btn');
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('btn-active'));
      btn.classList.add('btn-active');
      const status = btn.getAttribute('data-status') as 'all' | WorksheetStatus;
      wsState.currentFilter = status || 'all';
      loadWorksheets();
    });
  });

  // Kereső mező debounced kereséssel
  const searchInput = document.getElementById('wsSearchInput') as HTMLInputElement | null;
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  searchInput?.addEventListener('input', () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      wsState.searchQuery = searchInput.value;
      loadWorksheets();
    }, 300);
  });
}
