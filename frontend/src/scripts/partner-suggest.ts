// frontend/src/scripts/partner-suggest.ts
// Okos partnernév és címtár autocomplete debouncinggal a szöveges prompt és a Split View szerkesztőhöz.
import { apiFetch, getAuthToken } from './api.js';
import { state } from './state.js';
import { escapeHtml } from './sanitize.js';
import { showToast } from './toast.js';

export interface PartnerSuggestionItem {
  name: string;
  taxNumber?: string | null;
  country?: string | null;
  zip?: string | null;
  city?: string | null;
  address?: string | null;
  email?: string | null;
}

/**
 * Szöveges prompt mező partnernév autocomplete (szóközzel elválasztott utolsó szóra)
 */
function initPromptPartnerSuggestions(): void {
  const partnerSuggestionsEl = document.getElementById("partnerSuggestions") as HTMLDivElement | null;
  const partnerListEl = document.getElementById("partnerList") as HTMLUListElement | null;
  const textPromptInputEl = document.getElementById("textPromptInput") as HTMLTextAreaElement | null;

  if (!partnerSuggestionsEl || !partnerListEl || !textPromptInputEl) return;

  const suggestions: HTMLDivElement = partnerSuggestionsEl;
  const list: HTMLUListElement = partnerListEl;
  const input: HTMLTextAreaElement = textPromptInputEl;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function closeDropdown() {
    suggestions.classList.add("hidden");
    list.innerHTML = "";
  }

  async function fetchPartnerSuggestions(query: string) {
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

      list.innerHTML = "";
      for (const p of rawPartners) {
        const name = typeof p === "string" ? p : p.name;
        const li = document.createElement("li");
        const safeName = escapeHtml(name);
        const safeQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const highlighted = safeName.replace(
          new RegExp(`(${safeQuery})`, "gi"),
          '<mark class="bg-primary/20 text-primary rounded px-0.5">$1</mark>'
        );
        li.innerHTML = `<a class="text-sm py-1 px-2 rounded hover:bg-base-200 cursor-pointer partner-item">${highlighted}</a>`;

        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const val = input.value;
          const lastSpace = val.lastIndexOf(" ");
          const prefix = lastSpace >= 0 ? val.substring(0, lastSpace + 1) : "";
          input.value = prefix + name;
          input.focus();
          closeDropdown();
        });

        list.appendChild(li);
      }

      suggestions.classList.remove("hidden");
    } catch {
      // Csendben elnyeljük — az autocomplete kényelmi funkció
    }
  }

  input.addEventListener("input", () => {
    if (debounceTimer) clearTimeout(debounceTimer);

    const val = input.value;
    const lastWord = val.split(/\s+/).pop() || "";

    if (lastWord.length < 2) {
      closeDropdown();
      return;
    }

    debounceTimer = setTimeout(() => {
      fetchPartnerSuggestions(lastWord);
    }, 250);
  });

  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (!suggestions.contains(target) && !input.contains(target)) {
      closeDropdown();
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdown();
  });
}

/**
 * Split View szerkesztő modal Vevő Neve mező okos címtár autocomplete
 * Kiválasztáskor automatikusan kitölti az adószámot, irányítószámot, várost, utcát és emailt.
 */
export function initSplitViewPartnerSuggestions(): void {
  const suggestionsEl = document.getElementById("splitPartnerSuggestions") as HTMLDivElement | null;
  const listEl = document.getElementById("splitPartnerList") as HTMLUListElement | null;
  const vevoNeveInput = document.getElementById("edit_vevo_neve") as HTMLInputElement | null;

  if (!suggestionsEl || !listEl || !vevoNeveInput) return;

  const suggestions: HTMLDivElement = suggestionsEl;
  const list: HTMLUListElement = listEl;
  const input: HTMLInputElement = vevoNeveInput;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function closeDropdown() {
    suggestions.classList.add("hidden");
    list.innerHTML = "";
  }

  async function fetchSuggestions(query: string) {
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

      list.innerHTML = "";
      for (const p of rawPartners) {
        const item: PartnerSuggestionItem = typeof p === "string" ? { name: p } : p;
        const li = document.createElement("li");

        const safeName = escapeHtml(item.name);
        const safeQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const highlightedName = safeName.replace(
          new RegExp(`(${safeQuery})`, "gi"),
          '<mark class="bg-primary/20 text-primary font-bold rounded px-0.5">$1</mark>'
        );

        const detailsParts: string[] = [];
        if (item.taxNumber) detailsParts.push(`Adószám: ${item.taxNumber}`);
        const addressParts = [item.zip, item.city, item.address].filter(Boolean);
        if (addressParts.length > 0) detailsParts.push(addressParts.join(" "));

        const detailsHtml = detailsParts.length > 0
          ? `<span class="text-[11px] text-base-content/60 truncate max-w-full">${escapeHtml(detailsParts.join(" • "))}</span>`
          : "";

        li.innerHTML = `
          <a class="flex flex-col items-start gap-0.5 py-1.5 px-3 rounded-lg hover:bg-base-200 cursor-pointer w-full text-left transition-colors">
            <span class="font-bold text-xs text-base-content leading-tight">${highlightedName}</span>
            ${detailsHtml}
          </a>
        `;

        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectPartner(item);
          closeDropdown();
        });

        list.appendChild(li);
      }

      suggestions.classList.remove("hidden");
    } catch {
      // Csendben elnyeljük
    }
  }

  function selectPartner(partner: PartnerSuggestionItem) {
    input.value = partner.name;

    const editVevoAdoszam = document.getElementById("edit_vevo_adoszam") as HTMLInputElement | null;
    const editVevoOrszag = document.getElementById("edit_vevo_orszag") as HTMLInputElement | null;
    const editVevoIranyitoszam = document.getElementById("edit_vevo_iranyitoszam") as HTMLInputElement | null;
    const editVevoTelepules = document.getElementById("edit_vevo_telepules") as HTMLInputElement | null;
    const editVevoCim = document.getElementById("edit_vevo_cim") as HTMLInputElement | null;
    const editVevoEmail = document.getElementById("edit_vevo_email") as HTMLInputElement | null;

    if (partner.taxNumber && editVevoAdoszam) {
      editVevoAdoszam.value = partner.taxNumber;
      editVevoAdoszam.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (partner.country && editVevoOrszag) {
      editVevoOrszag.value = partner.country;
      editVevoOrszag.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (partner.zip && editVevoIranyitoszam) {
      editVevoIranyitoszam.value = partner.zip;
      editVevoIranyitoszam.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (partner.city && editVevoTelepules) {
      editVevoTelepules.value = partner.city;
      editVevoTelepules.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (partner.address && editVevoCim) {
      editVevoCim.value = partner.address;
      editVevoCim.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (partner.email && editVevoEmail) {
      editVevoEmail.value = partner.email;
      editVevoEmail.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Belső állapotszinkronizálás a Split View-ban
    if (state.currentEditingData) {
      state.currentEditingData.vevo_neve = partner.name;
      if (partner.taxNumber) state.currentEditingData.vevo_adoszam = partner.taxNumber;
      if (partner.country) state.currentEditingData.vevo_orszag = partner.country;
      if (partner.zip) state.currentEditingData.vevo_iranyitoszam = partner.zip;
      if (partner.city) state.currentEditingData.vevo_telepules = partner.city;
      if (partner.address) state.currentEditingData.vevo_cim = partner.address;
      if (partner.email) state.currentEditingData.vevo_email = partner.email;
    }

    // Esemény kiváltása az input mezőkön, hogy a change listenerek is lefussanak
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();

    showToast(`✓ "${partner.name}" adatai automatikusan kitöltve a címtárból!`, "success");
  }

  input.addEventListener("input", () => {
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

  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (!suggestions.contains(target) && !input.contains(target)) {
      closeDropdown();
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdown();
  });
}

export function initPartnerSuggestions(): void {
  initPromptPartnerSuggestions();
  initSplitViewPartnerSuggestions();
}
