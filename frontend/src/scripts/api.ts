// frontend/src/scripts/api.ts
// Központi API kliens: API_BASE, token kezelés és egységes fetch wrapper.

export const API_BASE =
  import.meta.env.PUBLIC_API_URL || "http://localhost:3000";

const TOKEN_KEY = "szamla_ai_token";

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export interface ApiOptions extends RequestInit {
  requiresAuth?: boolean;
}

export async function apiFetch<T = any>(
  path: string,
  options: ApiOptions = {}
): Promise<{ ok: boolean; status: number; data: T }> {
  const { requiresAuth = true, headers = {}, ...rest } = options;

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };

  if (requiresAuth) {
    const token = getAuthToken();
    if (token) {
      requestHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  try {
    const res = await fetch(url, {
      ...rest,
      headers: requestHeaders,
    });

    const isJson = res.headers.get("content-type")?.includes("application/json");
    const data = isJson ? await res.json() : await res.text();

    return {
      ok: res.ok,
      status: res.status,
      data: data as T,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      data: { error: err.message || "Hálózati hiba történt." } as T,
    };
  }
}
