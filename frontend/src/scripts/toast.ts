// frontend/src/scripts/toast.ts
// Toast értesítések megjelenítése DaisyUI alert komponenssel.

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export function showToast(
  message: string,
  type: "success" | "error" | "info" = "success"
): void {
  const container = document.getElementById("toastContainer");
  const alertBox = document.getElementById("toastAlert");
  const msgSpan = document.getElementById("toastMessage");

  if (!container || !alertBox || !msgSpan) return;

  alertBox.className = `alert alert-${type} shadow-xl text-xs font-semibold py-2.5 px-4 flex items-center gap-2`;
  msgSpan.textContent = message;
  container.classList.remove("hidden");

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    container.classList.add("hidden");
  }, 4000);
}
