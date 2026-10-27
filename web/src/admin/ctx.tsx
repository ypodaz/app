import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../shared/api';

type Opts = { method?: string; body?: unknown };
export type Call = <T>(path: string, opts?: Opts) => Promise<T>;
const Ctx = createContext<{ call: Call; signOut: () => void }>(null as never);

export const AuthProvider = Ctx.Provider;
export const useAuth = () => useContext(Ctx);

/** Admin API çağırışı; 401 olarsa girişə qaytarır. */
export function makeCall(token: string, signOut: () => void): Call {
  return async (path, opts = {}) => {
    try { return await api(`/admin${path}`, { ...opts, token }); }
    catch (e) { if (e instanceof ApiError && e.status === 401) signOut(); throw e; }
  };
}

export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Xəta baş verdi.');

/** GET yükləyici. path=null → yükləmir. Yenidən yükləmək üçün reload(). */
export function useLoad<T>(path: string | null) {
  const { call } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    if (last.current !== path) { setData(null); last.current = path; }
    setErr('');
    call<T>(path).then((d) => live && setData(d)).catch((e) => live && setErr(errMsg(e)));
    return () => { live = false; };
  }, [path, tick, call]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, err, reload };
}

/** İşləyən əməliyyat: busy + xəta mesajı. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setErr('');
    try { return await fn(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return { busy, err, setErr, run };
}
