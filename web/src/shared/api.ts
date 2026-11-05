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

const TIMEOUT_MS = 15_000;
const NET_MSG = 'İnternet bağlantısını yoxlayın.';

/** FastAPI xətası: detail sətir ola bilər, ya da 422-də [{msg}] siyahısı. */
function detailOf(data: unknown): string {
  const d = (data as { detail?: unknown } | null)?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    const m = (d[0] as { msg?: unknown } | undefined)?.msg;
    if (typeof m === 'string' && m) return m;
  }
  return 'Xəta baş verdi.';
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null; timeout?: number } = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout ?? TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctl.signal,
    });
  } catch {
    clearTimeout(timer);
    throw new ApiError(0, NET_MSG); // şəbəkə xətası və ya vaxt aşımı (default 15 san)
  }
  let data: unknown;
  try { data = await res.json(); } catch { data = {}; }
  clearTimeout(timer);
  if (ctl.signal.aborted) throw new ApiError(0, NET_MSG); // gövdə oxunarkən vaxt aşımı
  if (!res.ok) throw new ApiError(res.status, detailOf(data));
  return data as T;
}
