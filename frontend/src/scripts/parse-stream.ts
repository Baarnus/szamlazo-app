// frontend/src/scripts/parse-stream.ts
// Számlafeldolgozás vezérlése: SSE batch stream, szöveges prompt AI, progress bar és élő napló.
import type { ImageInputItem, SingleInvoiceResult } from '@szamlazo/shared';
import { API_BASE, apiFetch, getAuthToken } from './api.js';
import { checkCurrentSession, setAuthModalMode } from './auth.js';
import { renderResultsCards, getSourceCategory } from './invoice-cards.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { fileToBase64 } from './upload.js';
import { escapeHtml } from './sanitize.js';

export async function loadInvoicesFromDatabase(): Promise<void> {
  const token = getAuthToken();
  if (!token) return;

  try {
    const { ok, data } = await apiFetch<{
      success: boolean;
      invoices?: Array<{
        id: string;
        source?: string;
        imageUrl?: string;
        isValid: boolean;
        data: any;
      }>;
    }>("/api/invoices");

    if (ok && data.success && data.invoices) {
      state.lastProcessedResults = data.invoices.map((inv, idx) => ({
        index: idx,
        dbId: inv.id,
        source: inv.source || "Mentett számla",
        ...(inv.imageUrl ? { imageUrl: inv.imageUrl } : {}),
        success: true,
        isValid: inv.isValid,
        errors: [],
        data: inv.data,
      }));

      state.inputItemsCache = data.invoices.map((inv) => ({
        type: "url",
        data: inv.imageUrl || "",
      }));

      renderResultsCards();
    }
  } catch (err) {
    console.error("Nem sikerült betölteni a számlákat az adatbázisból:", err);
  }
}

export function initProcessStream(): void {
  const processBtn = document.getElementById("processBtn") as HTMLButtonElement | null;
  const statusAlert = document.getElementById("statusAlert");
  const statusMessage = document.getElementById("statusMessage");
  const progressBar = document.getElementById("progressBar") as HTMLProgressElement | null;
  const progressPercent = document.getElementById("progressPercent");
  const logBoxContainer = document.getElementById("logBoxContainer");
  const activityLog = document.getElementById("activityLog");
  const logSpeedInfo = document.getElementById("logSpeedInfo");
  const userCreditsDisplay = document.getElementById("userCreditsDisplay");

  const urlInput = document.getElementById("urlInput") as HTMLTextAreaElement | null;
  const textPromptInput = document.getElementById("textPromptInput") as HTMLTextAreaElement | null;
  const authModal = document.getElementById("authModal") as HTMLDialogElement | null;

  processBtn?.addEventListener("click", async () => {
    const authToken = getAuthToken();
    if (!authToken) {
      setAuthModalMode("login");
      authModal?.showModal();
      return;
    }

    const items: ImageInputItem[] = [];

    if (state.currentMode === "upload") {
      if (state.selectedFiles.length === 0) {
        showToast("Válassz ki vagy fotózz be legalább egy képet!", "info");
        return;
      }

      const convertedItems = await Promise.all(
        state.selectedFiles.map(async (file) => {
          const base64 = await fileToBase64(file);
          const mimeMatch = base64.match(/^data:([^;]+);base64,/);
          const mimeType = mimeMatch ? mimeMatch[1] : (file.type || "image/jpeg");
          return { type: "base64" as const, data: base64, mimeType };
        })
      );
      items.push(...convertedItems);
    } else if (state.currentMode === "url") {
      const urls = (urlInput?.value || "")
        .split("\n")
        .map((u) => u.trim())
        .filter((u) => u.length > 0);

      if (urls.length === 0) {
        showToast("Adj meg legalább egy kép URL-t!", "info");
        return;
      }
      if (urls.length > 10) {
        showToast("Egyszerre maximum 10 URL-t adhatsz meg!", "info");
        return;
      }

      for (const u of urls) {
        items.push({ type: "url", data: u });
      }
    } else if (state.currentMode === "text") {
      const textPrompt = textPromptInput?.value.trim();
      if (!textPrompt) {
        showToast("Írd be a szöveges utasítást!", "info");
        return;
      }

      if (processBtn) {
        processBtn.disabled = true;
        processBtn.innerHTML = '<span class="loading loading-spinner"></span> AI Feldolgozás...';
      }

      try {
        const { ok, data } = await apiFetch<{
          success: boolean;
          results?: any[];
          result?: any;
          error?: string;
        }>("/api/invoices/parse-text", {
          method: "POST",
          body: JSON.stringify({
            textPrompt,
            isVoicePrompt: state.wasLastPromptVoice,
          }),
        });

        if (!ok || !data.success) {
          throw new Error(data.error || "Hiba a feldolgozás során");
        }

        state.wasLastPromptVoice = false;

        const newResults = data.results || (data.result ? [data.result] : []);
        state.lastProcessedResults = [...newResults, ...state.lastProcessedResults];

        const newMocks: ImageInputItem[] = newResults.map(() => ({ type: "url", data: "" }));
        state.inputItemsCache = [...newMocks, ...state.inputItemsCache];

        checkCurrentSession();
        renderResultsCards();
        showToast("Sikeres szöveg-értelmezés!", "success");
        if (textPromptInput) textPromptInput.value = "";
      } catch (err: any) {
        showToast(err.message, "error");
      } finally {
        if (processBtn) {
          processBtn.disabled = false;
          processBtn.textContent = "Feldolgozás Indítása";
        }
      }
      return;
    }

    state.inputItemsCache = items;

    if (activityLog) activityLog.innerHTML = "";
    logBoxContainer?.classList.remove("hidden");
    if (logSpeedInfo) logSpeedInfo.textContent = "";

    if (processBtn) {
      processBtn.disabled = true;
      processBtn.innerHTML = '<span class="loading loading-spinner"></span> Feldolgozás...';
    }

    if (statusAlert) {
      statusAlert.className = "alert alert-info shadow-lg flex flex-col md:flex-row justify-between items-center gap-4";
    }
    if (statusMessage) statusMessage.textContent = `Feldolgozás elindítva (0 / ${items.length})...`;
    if (progressBar) {
      progressBar.classList.remove("hidden");
      progressBar.value = 0;
      progressBar.max = items.length;
    }
    if (progressPercent) progressPercent.textContent = "0%";
    try {
      const response = await fetch(`${API_BASE}/api/parse-batch-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ items }),
      });

      if (!response.ok || !response.body) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || "Hiba történt a streaming indításakor.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let totalCount = items.length;
      let completedCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const chunk of lines) {
          if (!chunk.trim()) continue;

          const eventMatch = chunk.match(/^event:\s*(.+)$/m);
          const dataMatch = chunk.match(/^data:\s*(.+)$/m);

          const eventType = eventMatch ? eventMatch[1]?.trim() : "message";
          const rawData = dataMatch ? dataMatch[1]?.trim() : "";

          if (eventType === "start" && rawData) {
            const parsed = JSON.parse(rawData);
            totalCount = parsed.total || items.length;
            if (progressBar) progressBar.max = totalCount;
            const updatedCredits = parsed.remainingCredits ?? parsed.currentCredits;
            if (updatedCredits !== undefined && userCreditsDisplay) {
              userCreditsDisplay.textContent = String(updatedCredits);
            }
          } else if (eventType === "invoice-parsed" && rawData) {
            const invoiceResult = JSON.parse(rawData) as SingleInvoiceResult & { finishedOrder?: number; durationSeconds?: string };
            state.lastProcessedResults.unshift(invoiceResult);

            renderResultsCards();

            completedCount++;
            if (progressBar) progressBar.value = completedCount;
            const percent = Math.round((completedCount / totalCount) * 100);
            if (progressPercent) progressPercent.textContent = `${percent}%`;
            if (statusMessage) {
              statusMessage.textContent = `Feldolgozás alatt: ${completedCount} / ${totalCount} számla kész...`;
            }

            if (activityLog) {
              const logRow = document.createElement("div");
              const isOk = invoiceResult.success;
              const partner = invoiceResult.success
                ? (invoiceResult.data.vevo_neve || invoiceResult.data.kiallito_neve || getSourceCategory(invoiceResult.source))
                : getSourceCategory(invoiceResult.source);
              const orderNum = invoiceResult.finishedOrder || completedCount;
              const time = invoiceResult.durationSeconds ? `${invoiceResult.durationSeconds}s` : "";

              logRow.className = `flex justify-between items-center py-0.5 border-b border-base-content/5 last:border-0 ${isOk ? "text-success" : "text-error"}`;
              const safePartner = escapeHtml(partner);
              logRow.innerHTML = `
                <span><b>#${orderNum}.</b> ${isOk ? "✓" : "✕"} ${safePartner}</span>
                <span class="text-[10px] text-base-content/50">${escapeHtml(time)}</span>
              `;
              activityLog.appendChild(logRow);
              activityLog.scrollTop = activityLog.scrollHeight;
            }
          } else if (eventType === "done") {
            const doneData = rawData ? JSON.parse(rawData) : {};
            if (statusAlert) {
              statusAlert.className = "alert alert-success shadow-lg flex flex-col md:flex-row justify-between items-center gap-4";
            }
            if (statusMessage) {
              statusMessage.textContent = `Mind a(z) ${completedCount} számla feldolgozva és elmentve!`;
            }
            if (doneData.totalDuration && logSpeedInfo) {
              logSpeedInfo.textContent = `Összidő: ${doneData.totalDuration} mp`;
            }
            const finalCredits = doneData.remainingCredits ?? doneData.currentCredits;
            if (finalCredits !== undefined && userCreditsDisplay) {
              userCreditsDisplay.textContent = String(finalCredits);
            }
            progressBar?.classList.add("hidden");
            if (progressPercent) progressPercent.textContent = "";
          }
        }
      }
    } catch (err: any) {
      if (statusAlert) statusAlert.className = "alert alert-error shadow-lg flex";
      if (statusMessage) statusMessage.textContent = err.message || "Hálózati hiba.";
      progressBar?.classList.add("hidden");
      if (progressPercent) progressPercent.textContent = "";
    } finally {
      if (processBtn) {
        processBtn.disabled = false;
        processBtn.textContent = "Feldolgozás Indítása";
      }
    }
  });
}
