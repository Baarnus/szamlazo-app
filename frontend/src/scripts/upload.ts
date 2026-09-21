// frontend/src/scripts/upload.ts
// Fájlfeltöltés, Drag-and-Drop, mobil kamera, vágólap képbeillesztés és előnézeti miniatűrök.
import { state } from './state.js';
import { showToast } from './toast.js';

/**
 * Kliensoldali képtömörítés és skálázás Canvas segítségével:
 * - Mobiltelefonos fotók (4000x3000px, 5-10 MB) esetén a hálózati adatforgalom és a
 *   Gemini API feldolgozási ideje drasztikusan lecsökken (12-14 mp helyett ~4-6 mp).
 * - Maximum méret: 1800px (tökéletes élesség számla OCR-hez és a kisbetűkhöz).
 * - Kimenet: minőségi JPEG (0.85), tiszta fehér háttérrel kitöltve (átlátszó PNG se legyen fekete).
 * - Hibakezelés: ha a fájl nem kép vagy a Canvas nem elérhető, biztonságos fallback a FileReader-re.
 */
export async function fileToBase64(file: File): Promise<string> {
  // Ha nem kép (pl. PDF vagy SVG), fallback sima FileReader-re
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return fallbackFileReader(file);
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const MAX_DIMENSION = 1800;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // Csak akkor méretezzük át, ha a kép meghaladja a megengedett maximális méretet
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          fallbackFileReader(file).then(resolve);
          return;
        }

        // Fehér háttér kitöltése (különösen PNG transzparencia esetén, hogy ne legyen fekete háttér JPEG konverziókor)
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);

        // Kép kirajzolása átméretezve
        ctx.drawImage(img, 0, 0, width, height);

        // 85%-os minőségű JPEG exportálás (kiváló OCR minőség, ~300-500 KB méret több megabájt helyett)
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        URL.revokeObjectURL(objectUrl);
        resolve(dataUrl);
      } catch (err) {
        console.warn("Canvas képtömörítési hiba, fallback az eredetire:", err);
        URL.revokeObjectURL(objectUrl);
        fallbackFileReader(file).then(resolve);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      fallbackFileReader(file).then(resolve);
    };

    img.src = objectUrl;
  });
}

function fallbackFileReader(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function handleNewFiles(files: File[]): void {
  const validFiles = files.filter(
    (f) => f.type.startsWith("image/") || f.type === "application/pdf"
  );
  if (validFiles.length === 0) {
    if (files.length > 0) {
      showToast("Csak képfájlok (JPEG, PNG, WEBP) és PDF dokumentumok tölthetők fel!", "info");
    }
    return;
  }

  if (state.selectedFiles.length >= 10) {
    showToast("Már elérted a maximum 10 számlát!", "info");
    return;
  }

  const remainingSlots = 10 - state.selectedFiles.length;
  if (validFiles.length > remainingSlots) {
    showToast(`Csak ${remainingSlots} db számla fért még be a 10-es limitbe!`, "info");
  }

  const toAdd = validFiles.slice(0, remainingSlots);
  state.selectedFiles = [...state.selectedFiles, ...toAdd];
  renderPreviews();
}

let activeObjectURLs: string[] = [];

export function clearObjectURLs(): void {
  activeObjectURLs.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Figyelmen kívül hagyjuk, ha már felszabadult
    }
  });
  activeObjectURLs = [];
}

export function renderPreviews(): void {
  const previewContainer = document.getElementById("previewContainer");
  const previewGrid = document.getElementById("previewGrid");
  const fileCountBadge = document.getElementById("fileCountBadge");

  // Előző Object URL-ek azonnali felszabadítása a memóriaszivárgás megelőzésére
  clearObjectURLs();

  if (!previewContainer || !previewGrid || !fileCountBadge) return;

  previewGrid.innerHTML = "";
  if (state.selectedFiles.length === 0) {
    previewContainer.classList.add("hidden");
    return;
  }

  previewContainer.classList.remove("hidden");
  fileCountBadge.textContent = `Kiválasztva: ${state.selectedFiles.length}/10 számla`;

  state.selectedFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className =
      "relative group rounded-lg overflow-hidden border border-base-200 bg-base-300 aspect-video flex items-center justify-center";

    const objectUrl = URL.createObjectURL(file);
    activeObjectURLs.push(objectUrl);

    if (file.type === "application/pdf") {
      const pdfPreview = document.createElement("div");
      pdfPreview.className = "w-full h-full flex flex-col items-center justify-center bg-red-950/20 text-error p-2 gap-1 select-none";
      pdfPreview.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        <span class="text-[10px] font-bold text-red-400 uppercase tracking-wider">PDF Számla</span>
      `;
      item.appendChild(pdfPreview);
    } else {
      const img = document.createElement("img");
      img.src = objectUrl;
      img.className = "w-full h-full object-cover";
      item.appendChild(img);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.innerHTML = "&times;";
    removeBtn.className =
      "absolute top-1 right-1 btn btn-circle btn-xs btn-error opacity-80 group-hover:opacity-100 shadow";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.selectedFiles.splice(index, 1);
      renderPreviews();
    });

    const nameTag = document.createElement("span");
    nameTag.className =
      "absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-white px-1 py-0.5 truncate text-center";
    nameTag.textContent = file.name;

    item.appendChild(removeBtn);
    item.appendChild(nameTag);
    previewGrid.appendChild(item);
  });
}

export function initUpload(): void {
  const tabUpload = document.getElementById("tabUpload");
  const tabUrl = document.getElementById("tabUrl");
  const tabTextPrompt = document.getElementById("tabTextPrompt");
  const panelUpload = document.getElementById("panelUpload");
  const panelUrl = document.getElementById("panelUrl");
  const panelTextPrompt = document.getElementById("panelTextPrompt");

  const cameraBtn = document.getElementById("cameraBtn");
  const cameraInput = document.getElementById("cameraInput") as HTMLInputElement | null;
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput") as HTMLInputElement | null;
  const clearFilesBtn = document.getElementById("clearFilesBtn");

  // Módváltó fülek
  tabUpload?.addEventListener("click", () => {
    state.currentMode = "upload";
    tabUpload.classList.add("tab-active");
    tabUrl?.classList.remove("tab-active");
    tabTextPrompt?.classList.remove("tab-active");
    panelUpload?.classList.remove("hidden");
    panelUrl?.classList.add("hidden");
    panelTextPrompt?.classList.add("hidden");
  });

  tabUrl?.addEventListener("click", () => {
    state.currentMode = "url";
    tabUrl.classList.add("tab-active");
    tabUpload?.classList.remove("tab-active");
    tabTextPrompt?.classList.remove("tab-active");
    panelUrl?.classList.remove("hidden");
    panelUpload?.classList.add("hidden");
    panelTextPrompt?.classList.add("hidden");
  });

  tabTextPrompt?.addEventListener("click", () => {
    state.currentMode = "text";
    tabTextPrompt.classList.add("tab-active");
    tabUpload?.classList.remove("tab-active");
    tabUrl?.classList.remove("tab-active");
    panelTextPrompt?.classList.remove("hidden");
    panelUpload?.classList.add("hidden");
    panelUrl?.classList.add("hidden");
  });

  // Kamera gomb & bemenet
  cameraBtn?.addEventListener("click", () => {
    cameraInput?.click();
  });

  cameraInput?.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      handleNewFiles(Array.from(target.files));
      target.value = "";
    }
  });

  // Drag and drop & Fájlböngésző
  dropZone?.addEventListener("click", () => {
    fileInput?.click();
  });

  dropZone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-primary", "bg-base-200");
  });

  dropZone?.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-primary", "bg-base-200");
  });

  dropZone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-primary", "bg-base-200");
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleNewFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput?.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      handleNewFiles(Array.from(target.files));
      target.value = "";
    }
  });

  clearFilesBtn?.addEventListener("click", () => {
    state.selectedFiles = [];
    renderPreviews();
  });

  // Vágólap (Ctrl+V) kép beillesztés támogatása
  window.addEventListener("paste", (e: ClipboardEvent) => {
    if (state.currentMode !== "upload") return;
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.type.indexOf("image") !== -1) {
        const blob = item.getAsFile();
        if (blob) files.push(blob);
      }
    }

    if (files.length > 0) {
      handleNewFiles(files);
      showToast(`${files.length} db kép beillesztve a vágólapról!`, "info");
    }
  });
}
