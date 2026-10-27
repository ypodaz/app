const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function storedToken(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function storeToken(key: string, token: string | null) {
  try { token ? localStorage.setItem(key, token) : localStorage.removeItem(key); } catch { /* gizli rejim */ }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'İnternet bağlantısını yoxlayın.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, typeof data.detail === 'string' ? data.detail : 'Xəta baş verdi.');
  return data as T;
}
