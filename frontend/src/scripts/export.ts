// frontend/src/scripts/export.ts
// Könyvelőbarát CSV és RLB-60 formátumú exportok letöltésének vezérlése időszaki dátumszűréssel.
import { API_BASE, getAuthToken } from './api.js';
import { setAuthModalMode } from './auth.js';
import { showToast } from './toast.js';

export async function triggerBackendCsvDownload(fromDate?: string, toDate?: string): Promise<void> {
  const authToken = getAuthToken();
  if (!authToken) {
    const authModal = document.getElementById("authModal") as HTMLDialogElement | null;
    setAuthModalMode("login");
    authModal?.showModal();
    return;
  }

  const exportCsvBtn = document.getElementById("exportCsvBtn") as HTMLButtonElement | null;
  if (exportCsvBtn) {
    exportCsvBtn.disabled = true;
    exportCsvBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Letöltés...';
  }

  try {
    const queryParams = new URLSearchParams();
    if (fromDate) queryParams.set("from", fromDate);
    if (toDate) queryParams.set("to", toDate);
    const queryString = queryParams.toString() ? `?${queryParams.toString()}` : "";

    const res = await fetch(`${API_BASE}/api/invoices/export/csv${queryString}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "A CSV exportálása sikertelen.");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const filterSuffix = fromDate || toDate ? `_${fromDate || 'kezdet'}_${toDate || 'ma'}` : '';
    a.download = `szamlak_export_${new Date().toISOString().slice(0, 10)}${filterSuffix}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast("CSV exportálás sikeresen elkészült és letöltve!", "success");
  } catch (err: any) {
    showToast(`Hiba a letöltés során: ${err.message}`, "error");
  } finally {
    if (exportCsvBtn) {
      exportCsvBtn.disabled = false;
      exportCsvBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
        </svg>
        CSV Exportálása
      `;
    }
  }
}

export async function triggerBackendRlbDownload(fromDate?: string, toDate?: string): Promise<void> {
  const authToken = getAuthToken();
  if (!authToken) {
    const authModal = document.getElementById("authModal") as HTMLDialogElement | null;
    setAuthModalMode("login");
    authModal?.showModal();
    return;
  }

  const exportRlbBtn = document.getElementById("exportRlbBtn") as HTMLButtonElement | null;
  if (exportRlbBtn) {
    exportRlbBtn.disabled = true;
    exportRlbBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Letöltés...';
  }

  try {
    const queryParams = new URLSearchParams();
    if (fromDate) queryParams.set("from", fromDate);
    if (toDate) queryParams.set("to", toDate);
    const queryString = queryParams.toString() ? `?${queryParams.toString()}` : "";

    const res = await fetch(`${API_BASE}/api/invoices/export/rlb${queryString}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Az RLB exportálása sikertelen.");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const filterSuffix = fromDate || toDate ? `_${fromDate || 'kezdet'}_${toDate || 'ma'}` : '';
    a.download = `rlb60_export_${new Date().toISOString().slice(0, 10)}${filterSuffix}.rlb`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast("RLB-60 formátumú könyvelői export sikeresen letöltve!", "success");
  } catch (err: any) {
    showToast(`Hiba a letöltés során: ${err.message}`, "error");
  } finally {
    if (exportRlbBtn) {
      exportRlbBtn.disabled = false;
      exportRlbBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path>
        </svg>
        RLB-60 Könyvelő Export
      `;
    }
  }
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function initExport(): void {
  const exportCsvBtn = document.getElementById("exportCsvBtn");
  const exportRlbBtn = document.getElementById("exportRlbBtn");
  const exportFromDate = document.getElementById("exportFromDate") as HTMLInputElement | null;
  const exportToDate = document.getElementById("exportToDate") as HTMLInputElement | null;
  const presetButtons = document.querySelectorAll<HTMLButtonElement>(".export-preset-btn");

  function setActivePresetBtn(targetPreset: string | null) {
    presetButtons.forEach((btn) => {
      const isTarget = btn.getAttribute("data-preset") === targetPreset;
      if (isTarget) {
        btn.classList.add("text-primary", "border", "border-primary/20", "bg-primary/10");
      } else {
        btn.classList.remove("text-primary", "border", "border-primary/20", "bg-primary/10");
      }
    });
  }

  function applyDatePreset(preset: string) {
    if (!exportFromDate || !exportToDate) return;
    const now = new Date();

    if (preset === "all") {
      exportFromDate.value = "";
      exportToDate.value = "";
      setActivePresetBtn("all");
    } else if (preset === "this_month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      exportFromDate.value = formatDate(firstDay);
      exportToDate.value = formatDate(lastDay);
      setActivePresetBtn("this_month");
    } else if (preset === "last_month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      exportFromDate.value = formatDate(firstDay);
      exportToDate.value = formatDate(lastDay);
      setActivePresetBtn("last_month");
    } else if (preset === "this_year") {
      const firstDay = new Date(now.getFullYear(), 0, 1);
      const lastDay = new Date(now.getFullYear(), 11, 31);
      exportFromDate.value = formatDate(firstDay);
      exportToDate.value = formatDate(lastDay);
      setActivePresetBtn("this_year");
    }
  }

  presetButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.getAttribute("data-preset");
      if (preset) applyDatePreset(preset);
    });
  });

  exportFromDate?.addEventListener("change", () => setActivePresetBtn(null));
  exportToDate?.addEventListener("change", () => setActivePresetBtn(null));

  function getActiveDateRange(): { from?: string; to?: string } {
    const from = exportFromDate?.value.trim() || undefined;
    const to = exportToDate?.value.trim() || undefined;
    return { from, to };
  }

  exportCsvBtn?.addEventListener("click", () => {
    const { from, to } = getActiveDateRange();
    triggerBackendCsvDownload(from, to);
  });

  exportRlbBtn?.addEventListener("click", () => {
    const { from, to } = getActiveDateRange();
    triggerBackendRlbDownload(from, to);
  });
}
