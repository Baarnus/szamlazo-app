// frontend/src/scripts/voice.ts
// Valós idejű magyar hangdiktálás Web Speech API-val.
// Támogatja a folyamatos felvételt (continuous), a nyomvatartást (push-to-talk),
// a manuális leállítást és az 5 másodperces csend-alapú intelligens leállítást.
import { state } from './state.js';
import { showToast } from './toast.js';

export function initVoice(): void {
  const voiceBtn = document.getElementById("voiceBtn") as HTMLButtonElement | null;
  const voiceStatus = document.getElementById("voiceStatus") as HTMLDivElement | null;
  const voiceStatusText = document.getElementById("voiceStatusText") as HTMLSpanElement | null;
  const voiceNotSupported = document.getElementById("voiceNotSupported") as HTMLDivElement | null;
  const textPromptInputEl = document.getElementById("textPromptInput") as HTMLTextAreaElement | null;

  const SpeechRecognitionAPI =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  if (!SpeechRecognitionAPI) {
    voiceBtn?.classList.add("hidden");
    voiceNotSupported?.classList.remove("hidden");
    voiceNotSupported?.classList.add("flex");
    return;
  }

  if (!voiceBtn || !textPromptInputEl) return;

  const input: HTMLTextAreaElement = textPromptInputEl;
  const btn: HTMLButtonElement = voiceBtn;

  let recognition: any = null;
  let isListening = false;
  let shouldBeListening = false;
  let isHolding = false;
  let pressStartTime = 0;
  let silenceTimeout: ReturnType<typeof setTimeout> | null = null;

  let initialText = "";
  let persistedFinalTranscript = "";
  let currentSessionFinal = "";
  let currentSessionInterim = "";

  function resetSilenceTimer() {
    if (silenceTimeout) {
      clearTimeout(silenceTimeout);
      silenceTimeout = null;
    }

    // Ha a felhasználó fizikailag nyomva tartja a gombot, csend esetén se álljon le!
    if (!shouldBeListening || isHolding) {
      return;
    }

    // 5 másodperc várakozási idő a beszéd és a csend között
    silenceTimeout = setTimeout(() => {
      if (shouldBeListening && !isHolding) {
        stopListening();
      }
    }, 5000);
  }

  function updateStatusUI(text?: string) {
    if (!voiceStatus || !voiceStatusText) return;
    if (text) {
      voiceStatusText.textContent = text;
    } else if (isHolding) {
      voiceStatusText.textContent = "Figyelek… (Engedd el a gombot a befejezéshez)";
    } else {
      voiceStatusText.textContent = "Figyelek… (5 mp csend után automatikusan leáll, vagy kattints újra)";
    }
  }

  function startListening() {
    if (isListening) return;

    shouldBeListening = true;
    initialText = input.value.trim();
    persistedFinalTranscript = "";
    currentSessionFinal = "";
    currentSessionInterim = "";

    try {
      recognition = new SpeechRecognitionAPI();
      recognition.lang = "hu-HU";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        isListening = true;
        btn.classList.add("btn-error", "text-white");
        btn.classList.remove("btn-ghost", "text-primary");
        voiceStatus?.classList.remove("hidden");
        voiceStatus?.classList.add("flex");
        updateStatusUI();
      };

      recognition.onresult = (event: any) => {
        currentSessionFinal = "";
        currentSessionInterim = "";

        for (let i = 0; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            currentSessionFinal += t + " ";
          } else {
            currentSessionInterim += t;
          }
        }

        const allFinal = (persistedFinalTranscript + " " + currentSessionFinal).trim();
        const combined = [initialText, allFinal, currentSessionInterim].filter(Boolean).join(" ");
        input.value = combined;
        input.scrollTop = input.scrollHeight;

        if (currentSessionInterim) {
          updateStatusUI(`„${currentSessionInterim}”`);
        } else {
          updateStatusUI();
        }

        // Minden elhangzott szó újraindítja az 5 mp-es csend időzítőt
        resetSilenceTimer();
      };

      recognition.onspeechstart = () => {
        resetSilenceTimer();
      };

      recognition.onsoundstart = () => {
        resetSilenceTimer();
      };

      recognition.onerror = (event: any) => {
        // Csend vagy megszakítás esetén ne dobjunk hibaüzenetet, ha még aktívan diktál
        if (event.error === 'no-speech' || event.error === 'aborted') {
          return;
        }

        const msgs: Record<string, string> = {
          "not-allowed": "Mikrofon-hozzáférés megtagadva. Engedélyezd a böngészőben!",
          "audio-capture": "Nem található mikrofon az eszközön.",
          "network": "Hálózati hiba az átírás során.",
        };
        showToast(msgs[event.error] || `Hangfelismerési hiba: ${event.error}`, "error");
        stopListening();
      };

      recognition.onend = () => {
        // Ha a böngésző váratlanul leállította, de mi még beszélni szeretnénk
        // (mert nyomva tartja a gombot VAGY még nem járt le az 5 mp csend)
        if (shouldBeListening && (isHolding || silenceTimeout)) {
          try {
            persistedFinalTranscript = (persistedFinalTranscript + " " + currentSessionFinal).trim();
            currentSessionFinal = "";
            currentSessionInterim = "";
            recognition.start();
            return;
          } catch {
            // Újraindítási hiba esetén leállunk
          }
        }

        finalizeListening();
      };

      recognition.start();
    } catch (err: any) {
      console.error("Nem sikerült elindítani a mikrofont:", err);
      finalizeListening();
    }
  }

  function stopListening() {
    shouldBeListening = false;
    isHolding = false;
    if (silenceTimeout) {
      clearTimeout(silenceTimeout);
      silenceTimeout = null;
    }
    if (recognition && isListening) {
      try {
        recognition.stop();
      } catch {}
    } else {
      finalizeListening();
    }
  }

  function finalizeListening() {
    isListening = false;
    shouldBeListening = false;
    isHolding = false;
    if (silenceTimeout) {
      clearTimeout(silenceTimeout);
      silenceTimeout = null;
    }

    btn.classList.remove("btn-error", "text-white");
    btn.classList.add("btn-ghost", "text-primary");
    voiceStatus?.classList.add("hidden");
    voiceStatus?.classList.remove("flex");
    if (voiceStatusText) voiceStatusText.textContent = "Figyelek…";

    const totalSpoken = (persistedFinalTranscript + " " + currentSessionFinal).trim();
    if (totalSpoken) {
      state.wasLastPromptVoice = true;
      const finalText = [initialText, totalSpoken].filter(Boolean).join(" ");
      input.value = finalText;
      input.focus();
      input.scrollTop = input.scrollHeight;
      showToast("🎙️ Hangüzenet sikeresen rögzítve szövegként!", "info");
    }
  }

  // Pointer eseménykezelők: Támogatja a nyomvatartást (Hold-to-talk) ÉS a kattintásos toggle módot is!
  let pointerActionHandled = false;

  btn.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointerActionHandled = false;
    pressStartTime = Date.now();

    if (isListening) {
      // Ha már aktív a felvétel, az újabb kattintás leállítja
      pointerActionHandled = true;
      stopListening();
      return;
    }

    isHolding = true;
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {}

    startListening();
  });

  btn.addEventListener("pointerup", (e: PointerEvent) => {
    if (pointerActionHandled) return;
    const pressDuration = Date.now() - pressStartTime;
    isHolding = false;

    try {
      btn.releasePointerCapture(e.pointerId);
    } catch {}

    if (pressDuration > 400) {
      // Hosszú nyomvatartás (>400ms): elengedéskor azonnal leáll
      stopListening();
    } else {
      // Rövid kattintás (toggle mód): bekapcsolva marad, és indul az 5 mp csend-időzítő
      updateStatusUI();
      resetSilenceTimer();
    }
  });

  btn.addEventListener("pointercancel", () => {
    if (isHolding) {
      isHolding = false;
      stopListening();
    }
  });

  // Billentyűzet támogatás (Space vagy Enter fókuszált gombon)
  btn.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (isListening) {
        stopListening();
      } else {
        startListening();
        resetSilenceTimer();
      }
    }
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
  });
}
