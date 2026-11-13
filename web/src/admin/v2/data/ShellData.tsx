import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Conv } from '../../components/crm';
import { DATA_CHANGED, errMsg, useAuth } from '../../ctx';
import { addDays, bakuToday, range } from '../../format';
import type { Block, Dashboard, Shoot } from '../../types';
import { useToast } from '../ui';
import { buildQueue, chatWaiting, type QueueItem } from './queue';

const POLL_MS = 60_000;
const RETRY_MS = 30_000;
const SNOOZE_KEY = 'ypod.v2.snooze';
const SNOOZE_MS = 3 * 3_600_000; // 99 G13
const UNDO_MS = 5000; // 99 G2

export type TodayRaw = { dash: Dashboard; shoots: Shoot[]; blocks: Block[]; convs: Conv[]; botEnabled: boolean | null };

type Ctx = {
  /** Dəqiqədə bir yenilənən vaxt (ms). */
  now: number;
  raw: TodayRaw | null;
  /** Son sorğu xətası (köhnə məlumat saxlanılır). */
  error: string;
  lastOk: number | null;
  items: QueueItem[];
  leaving: ReadonlySet<string>;
  queueCount: number;
  inboxCount: number;
  leadCount: number | null;
  /** Cari ayın xalis kassası (qəpik). */
  revenue: number | null;
  reload: () => void;
  /** Əməl uğurlu olanda: sətir 300 ms-də yox olur. */
  dismiss: (key: string) => void;
  restore: (key: string) => void;
  /** «Sonraya saxla»: 3 saat gizlənir (yalnız bu brauzerdə). */
  snooze: (key: string) => void;
  /** Müştəriyə gedən əməl: 5 s gecikmə, «Geri al» ləğv edir (99 G2). Xəta olsa sətir qayıdır. */
  sendLater: (key: string, doneMsg: string, fn: () => Promise<unknown>) => void;
};

const C = createContext<Ctx>(null as never);
export const useShellData = () => useContext(C);

function readSnooze(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}'); } catch { return {}; }
}

export function ShellDataProvider({ children }: { children: ReactNode }) {
  const { call } = useAuth();
  const toast = useToast();
  const [raw, setRaw] = useState<TodayRaw | null>(null);
  const [error, setError] = useState('');
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [leadCount, setLeadCount] = useState<number | null>(null);
  const [revenue, setRevenue] = useState<number | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [snoozed, setSnoozed] = useState<Record<string, number>>(readSnooze);
  const timers = useRef(new Set<number>());

  const fetchMain = useCallback(async () => {
    const today = bakuToday();
    try {
      const [dash, shoots, blocks, convs, bot] = await Promise.all([
        call<Dashboard>('/dashboard'),
        call<Shoot[]>(`/shoots?${range(addDays(today, -45), addDays(today, 3))}`),
        call<Block[]>(`/blocks?${range(today, addDays(today, 1))}`),
        call<Conv[]>('/inbox'),
        call<{ bot_enabled: boolean }>('/bot/settings').catch(() => null),
      ]);
      setRaw({ dash, shoots, blocks, convs, botEnabled: bot ? bot.bot_enabled : null });
      setError(''); setLastOk(Date.now());
    } catch (e) { setError(errMsg(e)); }
  }, [call]);

  const fetchSide = useCallback(async () => {
    // İkinci dərəcəli: nav altlığı və lead sayı. Alınmasa gizlədilir, xəta göstərilmir.
    call<{ stage: string }[]>('/leads').then((l) => setLeadCount(l.filter((x) => !['geldi', 'itirildi', 'tesdiq'].includes(x.stage)).length)).catch(() => {});
    const d = bakuToday();
    call<{ cash: { net: number } }>(`/report?month=${d.slice(0, 7)}`).then((r) => setRevenue(r.cash.net)).catch(() => {});
  }, [call]);

  // Əsas yükləmə + sorğu: xəta olanda 30 s-dən bir, normalda 60 s-dən bir; gizli tabda dayanır.
  const reload = useCallback(() => { void fetchMain(); }, [fetchMain]);
  useEffect(() => { void fetchMain(); void fetchSide(); }, [fetchMain, fetchSide]);
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) void fetchMain(); }, error ? RETRY_MS : POLL_MS);
    const s = window.setInterval(() => { if (!document.hidden) void fetchSide(); }, 5 * 60_000);
    const on = () => { void fetchMain(); };
    window.addEventListener(DATA_CHANGED, on);
    window.addEventListener('online', on);
    return () => { window.clearInterval(t); window.clearInterval(s); window.removeEventListener(DATA_CHANGED, on); window.removeEventListener('online', on); };
  }, [fetchMain, fetchSide, error]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => { const ts = timers.current; return () => ts.forEach((t) => window.clearTimeout(t)); }, []);

  const dismiss = useCallback((key: string) => {
    setLeaving((s) => new Set(s).add(key));
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      setLeaving((s) => { const n = new Set(s); n.delete(key); return n; });
      setHidden((s) => new Set(s).add(key));
    }, 300);
    timers.current.add(t);
  }, []);
  const restore = useCallback((key: string) => {
    setLeaving((s) => { const n = new Set(s); n.delete(key); return n; });
    setHidden((s) => { const n = new Set(s); n.delete(key); return n; });
  }, []);
  const snooze = useCallback((key: string) => {
    const next = { ...readSnooze(), [key]: Date.now() + SNOOZE_MS };
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); } catch { /* gizli rejim */ }
    setSnoozed(next);
  }, []);
  const sendLater = useCallback((key: string, doneMsg: string, fn: () => Promise<unknown>) => {
    dismiss(key);
    const t = window.setTimeout(async () => {
      timers.current.delete(t);
      try { await fn(); void fetchMain(); }
      catch (e) { restore(key); toast.show(`Alınmadı: ${errMsg(e)}`, { error: true, retry: () => sendLater(key, doneMsg, fn) }); }
    }, UNDO_MS);
    timers.current.add(t);
    toast.show(doneMsg, { undo: () => { window.clearTimeout(t); timers.current.delete(t); restore(key); } });
  }, [dismiss, restore, fetchMain, toast]);

  const botOn = raw?.botEnabled !== false;
  const all = useMemo(() => (raw ? buildQueue({ convs: raw.convs, depositShoots: raw.dash.deposit_pending, shoots: raw.shoots, botOn, now }) : []), [raw, botOn, now]);
  // Server artıq sətri qaytarmırsa gizlənmiş açar silinir (söhbət sonra yenə cavab gözləsə sətir qayıtsın).
  useEffect(() => {
    if (!raw) return;
    const keys = new Set(all.map((i) => i.key));
    setHidden((h) => { const n = new Set([...h].filter((k) => keys.has(k))); return n.size === h.size ? h : n; });
  }, [raw, all]);
  const items = useMemo(() => all.filter((i) => !hidden.has(i.key) && !((snoozed[i.key] ?? 0) > now)), [all, hidden, snoozed, now]);
  const queueCount = useMemo(() => items.filter((i) => !leaving.has(i.key)).length, [items, leaving]);
  const inboxCount = useMemo(() => (raw ? raw.convs.filter((c) => chatWaiting(c, botOn, true)).length : 0), [raw, botOn]);

  const value = useMemo<Ctx>(() => ({ now, raw, error, lastOk, items, leaving, queueCount, inboxCount, leadCount, revenue, reload, dismiss, restore, snooze, sendLater }),
    [now, raw, error, lastOk, items, leaving, queueCount, inboxCount, leadCount, revenue, reload, dismiss, restore, snooze, sendLater]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
