// frontend/src/scripts/billing.ts
// Stripe fizetési csomagok kezelése, checkout session indítás és session ellenőrzés.
import { apiFetch } from './api.js';
import { checkCurrentSession } from './auth.js';
import { showToast } from './toast.js';

export function initBilling(): void {
  const billingModal = document.getElementById("billingModal") as HTMLDialogElement | null;
  const openBillingBtn = document.getElementById("openBillingBtn");

  openBillingBtn?.addEventListener("click", () => {
    billingModal?.showModal();
  });

  // Stripe csomagvásárlási gombok
  document.querySelectorAll(".buy-credits-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const packageId = btn.getAttribute("data-package-id");
      if (!packageId) return;

      const htmlBtn = btn as HTMLButtonElement;
      const originalText = htmlBtn.textContent;
      htmlBtn.disabled = true;
      htmlBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Átirányítás...';

      try {
        const { ok, data } = await apiFetch<{ success: boolean; url?: string; error?: string }>(
          "/api/billing/create-checkout-session",
          {
            method: "POST",
            body: JSON.stringify({ packageId }),
          }
        );

        if (ok && data.success && data.url) {
          window.location.href = data.url;
        } else {
          showToast(data.error || "Nem sikerült elindítani a fizetést.", "error");
          htmlBtn.disabled = false;
          htmlBtn.textContent = originalText;
        }
      } catch {
        showToast("Hálózati hiba történt.", "error");
        htmlBtn.disabled = false;
        htmlBtn.textContent = originalText;
      }
    });
  });

  // Sikeres fizetés után visszatérés (?session_id=...)
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get("session_id");

  if (sessionId) {
    (async () => {
      try {
        const { ok, data } = await apiFetch<{ success: boolean; creditsAdded?: number; newCredits?: number; error?: string }>(
          "/api/billing/verify-session",
          {
            method: "POST",
            body: JSON.stringify({ sessionId }),
          }
        );

        if (ok && data.success) {
          showToast(`Sikeres fizetés! ${data.creditsAdded || ""} kredit jóváírva a fiókodban.`, "success");
          window.history.replaceState({}, document.title, window.location.pathname);
          checkCurrentSession();
        }
      } catch (err) {
        console.error("Fizetés ellenőrzési hiba:", err);
      }
    })();
  }
}
