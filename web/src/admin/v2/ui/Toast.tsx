import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastOpts = {
  /** «Geri al» düyməsi (5 s). Verilməsə 4 s. */
  undo?: () => void;
  /** Xəta toast-u: «Alınmadı: <səbəb>» + retry. */
  error?: boolean;
  retry?: () => void;
};
type T = { id: number; msg: string } & ToastOpts;
type Api = { show: (msg: string, opts?: ToastOpts) => void; hide: () => void };

const Ctx = createContext<Api>({ show: () => {}, hide: () => {} });
export const useToast = () => useContext(Ctx);

/** Bir anda bir toast (00 §8). Geri alınan əməllərdə 5 s, qalanında 4 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<T | null>(null);
  const timer = useRef<number>();
  const seq = useRef(0);
  const hide = useCallback(() => { window.clearTimeout(timer.current); setT(null); }, []);
  const show = useCallback((msg: string, opts: ToastOpts = {}) => {
    window.clearTimeout(timer.current);
    const id = ++seq.current;
    setT({ id, msg, ...opts });
    timer.current = window.setTimeout(() => setT((cur) => (cur?.id === id ? null : cur)), opts.undo || opts.retry ? 5000 : 4000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const api = useMemo(() => ({ show, hide }), [show, hide]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="v2 v2-toasts" aria-live="polite" role="status">
        {t && (
          <div key={t.id} className={`toast${t.error ? ' toast--error' : ''}`}>
            <span>{t.msg}</span>
            {t.undo && <button type="button" className="toast__act" onClick={() => { t.undo?.(); hide(); }}>Geri al</button>}
            {t.retry && <button type="button" className="toast__act" onClick={() => { t.retry?.(); hide(); }}>Yenidən cəhd et</button>}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
