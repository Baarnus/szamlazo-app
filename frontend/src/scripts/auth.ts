import { apiFetch, getAuthToken, setAuthToken } from './api.js';
import { state, type UserState } from './state.js';
import { showToast } from './toast.js';
import { renderResultsCards } from './invoice-cards.js';
import { clearObjectURLs, renderPreviews } from './upload.js';
import { loadCompanySettings } from './settings.js';

export function updateUserUI(user: UserState | null): void {
  const guestLandingView = document.getElementById("guestLandingView");
  const appDashboardView = document.getElementById("appDashboardView");
  const guestNavAction = document.getElementById("guestNavAction");
  const userProfileBar = document.getElementById("userProfileBar");
  const userCreditsDisplay = document.getElementById("userCreditsDisplay");

  state.currentUser = user;

  if (user) {
    guestLandingView?.classList.add("hidden");
    appDashboardView?.classList.remove("hidden");
    guestNavAction?.classList.add("hidden");
    userProfileBar?.classList.remove("hidden");
    userProfileBar?.classList.add("flex");

    if (userCreditsDisplay) {
      userCreditsDisplay.textContent = String(user.credits);
    }
  } else {
    guestLandingView?.classList.remove("hidden");
    appDashboardView?.classList.add("hidden");
    guestNavAction?.classList.remove("hidden");
    userProfileBar?.classList.add("hidden");
    userProfileBar?.classList.remove("flex");
  }
}

export function setAuthModalMode(mode: "login" | "register" | "reset"): void {
  state.authMode = mode;

  const authModalTitle = document.getElementById("authModalTitle") as HTMLHeadingElement | null;
  const authTabLogin = document.getElementById("authTabLogin") as HTMLAnchorElement | null;
  const authTabRegister = document.getElementById("authTabRegister") as HTMLAnchorElement | null;
  const authSubmitBtn = document.getElementById("authSubmitBtn") as HTMLButtonElement | null;
  const authEmail = document.getElementById("authEmail") as HTMLInputElement | null;
  const authPassword = document.getElementById("authPassword") as HTMLInputElement | null;
  const forgotPasswordContainer = document.getElementById("forgotPasswordContainer");
  const emailDiv = authEmail?.parentElement;

  if (!authModalTitle || !authSubmitBtn || !authEmail || !authPassword) return;

  if (mode === "login") {
    authModalTitle.textContent = "Bejelentkezés";
    authTabLogin?.classList.add("tab-active");
    authTabRegister?.classList.remove("tab-active");
    authSubmitBtn.textContent = "Bejelentkezés";
    forgotPasswordContainer?.classList.remove("hidden");
    emailDiv?.classList.remove("hidden");
    authEmail.required = true;
    authPassword.placeholder = "••••••••";
  } else if (mode === "register") {
    authModalTitle.textContent = "Regisztráció";
    authTabRegister?.classList.add("tab-active");
    authTabLogin?.classList.remove("tab-active");
    authSubmitBtn.textContent = "Ingyenes Regisztráció (15 kredit)";
    forgotPasswordContainer?.classList.add("hidden");
    emailDiv?.classList.remove("hidden");
    authEmail.required = true;
    authPassword.placeholder = "••••••••";
  } else if (mode === "reset") {
    authModalTitle.textContent = "Új jelszó beállítása";
    if (authTabLogin) authTabLogin.style.display = "none";
    if (authTabRegister) authTabRegister.style.display = "none";
    authSubmitBtn.textContent = "Jelszó mentése";
    forgotPasswordContainer?.classList.add("hidden");
    emailDiv?.classList.add("hidden");
    authEmail.required = false;
    authPassword.placeholder = "Új jelszó (min. 6 karakter)";
  }
}

export async function checkCurrentSession(onSessionActive?: () => void): Promise<void> {
  const token = getAuthToken();
  if (!token) {
    updateUserUI(null);
    return;
  }

  const { ok, data } = await apiFetch<{ success: boolean; user?: UserState; error?: string }>("/api/auth/me");

  if (ok && data.success && data.user) {
    updateUserUI(data.user);
    loadCompanySettings();
    if (onSessionActive) onSessionActive();
  } else {
    setAuthToken(null);
    updateUserUI(null);
  }
}

export function initAuth(onSessionActive?: () => void): void {
  const authModal = document.getElementById("authModal") as HTMLDialogElement | null;
  const openAuthModalBtn = document.getElementById("openAuthModalBtn");
  const authTabLogin = document.getElementById("authTabLogin");
  const authTabRegister = document.getElementById("authTabRegister");
  const authForm = document.getElementById("authForm") as HTMLFormElement | null;
  const authEmail = document.getElementById("authEmail") as HTMLInputElement | null;
  const authPassword = document.getElementById("authPassword") as HTMLInputElement | null;
  const authSubmitBtn = document.getElementById("authSubmitBtn") as HTMLButtonElement | null;
  const authErrorAlert = document.getElementById("authErrorAlert");
  const logoutBtn = document.getElementById("logoutBtn");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");

  // URL paraméterek ellenőrzése (?resetToken=...)
  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = urlParams.get("resetToken");
  if (resetToken && authModal) {
    setAuthModalMode("reset");
    authModal.showModal();
  }

  openAuthModalBtn?.addEventListener("click", () => {
    setAuthModalMode("login");
    authModal?.showModal();
  });

  authTabLogin?.addEventListener("click", () => setAuthModalMode("login"));
  authTabRegister?.addEventListener("click", () => setAuthModalMode("register"));

  // Landing CTA gombok eseményei
  document.querySelectorAll(".hero-register-cta").forEach((btn) => {
    btn.addEventListener("click", () => {
      setAuthModalMode("register");
      authModal?.showModal();
    });
  });

  // Elfelejtett jelszó
  forgotPasswordLink?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!authEmail?.value) {
      if (authErrorAlert) {
        authErrorAlert.textContent = "Kérjük, add meg az e-mail címedet a jelszó visszaállításához!";
        authErrorAlert.classList.remove("hidden");
      }
      return;
    }

    authErrorAlert?.classList.add("hidden");
    const originalText = authSubmitBtn?.textContent;
    if (authSubmitBtn) {
      authSubmitBtn.textContent = "Folyamatban...";
      authSubmitBtn.disabled = true;
    }

    try {
      const { ok, data } = await apiFetch<{ success: boolean; error?: string }>("/api/auth/forgot-password", {
        method: "POST",
        requiresAuth: false,
        body: JSON.stringify({ email: authEmail.value }),
      });

      if (ok && data.success) {
        showToast("Jelszó visszaállító link elküldve az e-mail címedre (Nézd meg a Spam mappát is!).", "success");
        authModal?.close();
      } else {
        if (authErrorAlert) {
          authErrorAlert.textContent = data.error || "Hiba történt a kiküldés során.";
          authErrorAlert.classList.remove("hidden");
        }
      }
    } catch {
      if (authErrorAlert) {
        authErrorAlert.textContent = "Hálózati hiba történt.";
        authErrorAlert.classList.remove("hidden");
      }
    } finally {
      if (authSubmitBtn) {
        authSubmitBtn.textContent = originalText || "Bejelentkezés";
        authSubmitBtn.disabled = false;
      }
    }
  });

  // Auth űrlap beküldése
  authForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    authErrorAlert?.classList.add("hidden");

    if (authSubmitBtn) {
      authSubmitBtn.disabled = true;
      authSubmitBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Feldolgozás...';
    }

    try {
      if (state.authMode === "reset") {
        const { ok, data } = await apiFetch<{ success: boolean; error?: string }>("/api/auth/reset-password", {
          method: "POST",
          requiresAuth: false,
          body: JSON.stringify({
            token: resetToken,
            newPassword: authPassword?.value,
          }),
        });

        if (ok && data.success) {
          showToast("Jelszó sikeresen megváltoztatva! Kérjük, jelentkezz be.", "success");
          window.history.replaceState({}, document.title, window.location.pathname);
          setAuthModalMode("login");
        } else {
          if (authErrorAlert) {
            authErrorAlert.textContent = data.error || "Hiba történt a jelszó módosításakor.";
            authErrorAlert.classList.remove("hidden");
          }
        }
        return;
      }

      const endpoint = state.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const { ok, data } = await apiFetch<{ success: boolean; token?: string; user?: UserState; error?: string }>(endpoint, {
        method: "POST",
        requiresAuth: false,
        body: JSON.stringify({
          email: authEmail?.value,
          password: authPassword?.value,
        }),
      });

      if (ok && data.success && data.token && data.user) {
        setAuthToken(data.token);
        updateUserUI(data.user);
        loadCompanySettings();
        authModal?.close();
        showToast(
          state.authMode === "login"
            ? `Üdv újra, ${data.user.email}!`
            : "Sikeres regisztráció! 15 ingyenes kreditet jóváírtunk a fiókodban.",
          "success"
        );
        if (onSessionActive) onSessionActive();
      } else {
        if (authErrorAlert) {
          authErrorAlert.textContent = data.error || "Hiba történt a hitelesítés során.";
          authErrorAlert.classList.remove("hidden");
        }
      }
    } catch {
      if (authErrorAlert) {
        authErrorAlert.textContent = "Hálózati hiba történt.";
        authErrorAlert.classList.remove("hidden");
      }
    } finally {
      if (authSubmitBtn) {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent =
          state.authMode === "login"
            ? "Bejelentkezés"
            : state.authMode === "register"
              ? "Regisztráció"
              : "Jelszó visszaállítása";
      }
    }
  });

  // Kijelentkezés — teljes állapot- és DOM-ürítés a munkamenet biztonságáért
  logoutBtn?.addEventListener("click", () => {
    setAuthToken(null);
    state.lastProcessedResults = [];
    state.inputItemsCache = [];
    state.selectedFiles = [];
    state.activeEditIndex = -1;
    state.currentEditingData = null;
    state.invoiceToDeleteDbId = null;
    state.invoiceToDeleteIndex = null;
    state.wasLastPromptVoice = false;
    state.userCompanyName = null;
    state.userCompanyTaxNumber = null;

    clearObjectURLs();
    renderResultsCards();
    renderPreviews();

    // Folyamatjelző és napló tárolók elrejtése és tisztítása
    const statusAlert = document.getElementById("statusAlert");
    const logBoxContainer = document.getElementById("logBoxContainer");
    const activityLog = document.getElementById("activityLog");
    statusAlert?.classList.add("hidden");
    logBoxContainer?.classList.add("hidden");
    if (activityLog) activityLog.innerHTML = "";

    updateUserUI(null);
    showToast("Sikeresen kijelentkeztél.", "info");
  });
}
