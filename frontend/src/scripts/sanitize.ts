// frontend/src/scripts/sanitize.ts
// HTML karakterek biztonságos escape-elése XSS védelemhez.

/**
 * Szöveges érték biztonságos HTML escape-elése.
 * Semlegesíti a kártékony script/tag injektálásokat (<, >, &, ", ').
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
