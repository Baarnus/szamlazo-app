// frontend/src/scripts/settings.ts
// Számlázz.hu és NAV beállítások lekérése, mentése és GDPR fióktörlés.
import { apiFetch, setAuthToken } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';

export function initSettings(): void {
  const settingsModal = document.getElementById("settingsModal") as HTMLDialogElement | null;
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const settingsForm = document.getElementById("settingsForm") as HTMLFormElement | null;
  const settingsSubmitBtn = document.getElementById("settingsSubmitBtn") as HTMLButtonElement | null;
  const settingsErrorAlert = document.getElementById("settingsErrorAlert");

  // Input mezők (mind az új set_*, mind a legacy azonosítókat támogatva)
  const szamlazzApiKeyInput = (document.getElementById("set_szamlazz_hu_api_key") ||
    document.getElementById("szamlazzApiKeyInput")) as HTMLInputElement | null;
  const navTechnicalUserInput = (document.getElementById("set_nav_technical_user") ||
    document.getElementById("navTechnicalUserInput")) as HTMLInputElement | null;
  const navTechnicalPasswordInput = (document.getElementById("set_nav_technical_password") ||
    document.getElementById("navTechnicalPasswordInput")) as HTMLInputElement | null;
  const navSignKeyInput = (document.getElementById("set_nav_sign_key") ||
    document.getElementById("navSignKeyInput")) as HTMLInputElement | null;
  const navExchangeKeyInput = (document.getElementById("set_nav_exchange_key") ||
    document.getElementById("navExchangeKeyInput")) as HTMLInputElement | null;
  const companyNameInput = document.getElementById("set_company_name") as HTMLInputElement | null;
  const companyTaxNumberInput = document.getElementById("set_company_tax_number") as HTMLInputElement | null;

  // Fióktörlés (GDPR) elemek
  const deleteAccountBtn = document.getElementById("deleteAccountBtn");
  const deleteAccountConfirmModal = document.getElementById("deleteAccountConfirmModal") as HTMLDialogElement | null;
  const confirmDeleteAccountBtn = document.getElementById("confirmDeleteAccountBtn") as HTMLButtonElement | null;

  // Beállítások betöltése a modál megnyitásakor
  openSettingsBtn?.addEventListener("click", async () => {
    if (settingsErrorAlert) settingsErrorAlert.classList.add("hidden");
    settingsModal?.showModal();

    const { ok, data } = await apiFetch<{
      success: boolean;
      settings?: {
        hasSzamlazzHuApiKey?: boolean;
        szamlazzHuApiKey?: string | null;
        navTechnicalUser?: string | null;
        hasNavTechnicalPassword?: boolean;
        hasNavSignKey?: boolean;
        navSignKey?: string | null;
        hasNavExchangeKey?: boolean;
        navExchangeKey?: string | null;
        companyName?: string | null;
        companyTaxNumber?: string | null;
      };
    }>("/api/settings");

    if (ok && data.success && data.settings) {
      const s = data.settings;
      if (szamlazzApiKeyInput) szamlazzApiKeyInput.value = s.szamlazzHuApiKey || "";
      if (navTechnicalUserInput) navTechnicalUserInput.value = s.navTechnicalUser || "";
      if (navTechnicalPasswordInput) {
        navTechnicalPasswordInput.value = s.hasNavTechnicalPassword ? "••••••••" : "";
        navTechnicalPasswordInput.placeholder = s.hasNavTechnicalPassword ? "•••••••• (Beállítva - üresen hagyva nem változik)" : "Technikai jelszó";
      }
      if (navSignKeyInput) navSignKeyInput.value = s.navSignKey || "";
      if (navExchangeKeyInput) navExchangeKeyInput.value = s.navExchangeKey || "";
      if (companyNameInput) companyNameInput.value = s.companyName || "";
      if (companyTaxNumberInput) companyTaxNumberInput.value = s.companyTaxNumber || "";

      state.userCompanyName = s.companyName || null;
      state.userCompanyTaxNumber = s.companyTaxNumber || null;
    }
  });

  // Beállítások mentése
  settingsForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (settingsSubmitBtn) {
      settingsSubmitBtn.disabled = true;
      settingsSubmitBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Mentés...';
    }
    if (settingsErrorAlert) settingsErrorAlert.classList.add("hidden");

    try {
      const { ok, data } = await apiFetch<{ success: boolean; error?: string }>("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          szamlazzHuApiKey: szamlazzApiKeyInput?.value.trim() || null,
          navTechnicalUser: navTechnicalUserInput?.value.trim() || null,
          navTechnicalPassword: navTechnicalPasswordInput?.value.trim() || null,
          navSignKey: navSignKeyInput?.value.trim() || null,
          navExchangeKey: navExchangeKeyInput?.value.trim() || null,
          companyName: companyNameInput?.value.trim() || null,
          companyTaxNumber: companyTaxNumberInput?.value.trim() || null,
        }),
      });

      if (ok && data.success) {
        state.userCompanyName = companyNameInput?.value.trim() || null;
        state.userCompanyTaxNumber = companyTaxNumberInput?.value.trim() || null;
        showToast("Beállítások sikeresen mentve!", "success");
        settingsModal?.close();
      } else {
        const msg = data.error || "Hiba történt a beállítások mentésekor.";
        if (settingsErrorAlert) {
          settingsErrorAlert.textContent = msg;
          settingsErrorAlert.classList.remove("hidden");
        }
        showToast(msg, "error");
      }
    } catch {
      showToast("Hálózati hiba történt a mentés során.", "error");
    } finally {
      if (settingsSubmitBtn) {
        settingsSubmitBtn.disabled = false;
        settingsSubmitBtn.textContent = "Mentés";
      }
    }
  });

  // Fiók törlése (GDPR) megerősítő ablak
  deleteAccountBtn?.addEventListener("click", () => {
    deleteAccountConfirmModal?.showModal();
  });

  confirmDeleteAccountBtn?.addEventListener("click", async () => {
    if (confirmDeleteAccountBtn) {
      confirmDeleteAccountBtn.disabled = true;
      confirmDeleteAccountBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Törlés folyamatban...';
    }

    try {
      const { ok, data } = await apiFetch<{ success: boolean; error?: string }>("/api/settings/account", {
        method: "DELETE"
      });

      if (ok && data.success) {
        setAuthToken(null);
        showToast("A fiókod és összes adatod véglegesen törölve lett.", "info");
        deleteAccountConfirmModal?.close();
        settingsModal?.close();
        setTimeout(() => {
          window.location.href = "/";
        }, 1500);
      } else {
        showToast(data.error || "Hiba a fiók törlése során.", "error");
      }
    } catch {
      showToast("Hálózati hiba történt a törlés során.", "error");
    } finally {
      if (confirmDeleteAccountBtn) {
        confirmDeleteAccountBtn.disabled = false;
        confirmDeleteAccountBtn.textContent = "Igen, törlöm a fiókom";
      }
    }
  });
}

/**
 * Cégbeállítások betöltése a háttérben a számlák helyes költség/bevétel osztályozásához
 */
export async function loadCompanySettings(): Promise<void> {
  try {
    const { ok, data } = await apiFetch<{
      success: boolean;
      settings?: {
        companyName?: string | null;
        companyTaxNumber?: string | null;
      };
    }>("/api/settings");

    if (ok && data.success && data.settings) {
      state.userCompanyName = data.settings.companyName || null;
      state.userCompanyTaxNumber = data.settings.companyTaxNumber || null;
    }
  } catch {
    // Csendes fallback
  }
}

