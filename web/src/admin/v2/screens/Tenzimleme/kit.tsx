import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../../../ctx';
import { initials } from '../../../format';
import type { ClientRow } from '../../../types';
import { Avatar, Dialog, Field, EmptyState, ErrorBox, LoadingRows, TextInput, V2Icon } from '../../ui';

/** «2026-11-10» → «10.11.2026» */
export const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
export const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
/** 390 dəq → «6,5». */
export const hrs = (min: number) => String(Math.round((min / 60) * 2) / 2).replace('.', ',');
export const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** useLoad nəticəsi üçün yüklənir / xəta / məzmun. Xəta olanda köhnə məlumat göstərilir. */
export function Gate<T>({ q, title, rows = 4, children }: { q: { data: T | null; err: string; reload: () => void }; title: string; rows?: number; children: (d: T) => ReactNode }) {
  if (q.data) return <>{q.err && <ErrorBox title={title} detail={q.err} onRetry={q.reload} />}{children(q.data)}</>;
  if (q.err) return <ErrorBox title={title} detail={q.err} onRetry={q.reload} />;
  return <LoadingRows rows={rows} />;
}

/** Müştəri axtarışı (ad, telefon, şirkət). Dialoqda və sahə daxilində işlənir. */
export function useClients(enabled: boolean) {
  const { call } = useAuth();
  const [list, setList] = useState<ClientRow[] | null>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || list) return;
    let live = true;
    call<ClientRow[]>('/clients').then((l) => live && setList(l)).catch(() => live && setErr('Müştərilər yüklənmədi · internet bağlantısını yoxlayın'));
    return () => { live = false; };
  }, [enabled, list, call, tick]);
  return { list, err, retry: () => { setErr(''); setTick((t) => t + 1); } };
}

export function filterClients(list: ClientRow[] | null, q: string, exclude: number[] = []): ClientRow[] {
  if (!list) return [];
  const s = q.trim().toLowerCase();
  const digits = s.replace(/\D/g, '');
  return list.filter((c) => !exclude.includes(c.id) && (!s || c.full_name.toLowerCase().includes(s) || (c.workplace ?? '').toLowerCase().includes(s)
    || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)))).slice(0, 30);
}

export function ClientResults({ list, err, retry, q, exclude, onPick }: { list: ClientRow[] | null; err: string; retry: () => void; q: string; exclude?: number[]; onPick: (c: ClientRow) => void }) {
  const hits = useMemo(() => filterClients(list, q, exclude), [list, q, exclude]);
  if (err) return <ErrorBox title="Müştərilər yüklənmədi" detail={err} onRetry={retry} />;
  if (!list) return <LoadingRows rows={3} />;
  if (!hits.length) return <EmptyState title={q.trim() ? `«${q.trim()}» tapılmadı` : 'Müştəri yoxdur'} reason="Axtarış ad, telefon və iş yerində aparılır." />;
  return (
    <div className="tz-pickres">
      {hits.map((c) => (
        <button key={c.id} type="button" onClick={() => onPick(c)}>
          <span className="av">{initials(c.full_name)}</span>
          <span className="row__main"><span className="row__title" style={{ display: 'block' }}>{c.full_name}</span>{c.workplace && <span className="row__meta" style={{ display: 'block' }}>{c.workplace}</span>}</span>
        </button>
      ))}
    </div>
  );
}

/** Müştəri seçimi dialoqu (üzv əlavə et, kampaniya alıcısı). */
export function ClientPickDialog({ open, onClose, onPick, exclude, title }: { open: boolean; onClose: () => void; onPick: (c: ClientRow) => void; exclude?: number[]; title: string }) {
  const { list, err, retry } = useClients(open);
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, telefon, şirkət" aria-label="Müştəri axtar" autoFocus />
      <ClientResults list={list} err={err} retry={retry} q={q} exclude={exclude} onPick={(c) => { onPick(c); onClose(); }} />
    </Dialog>
  );
}

/** Seçilmiş çip (× ilə çıxarılır). */
export function Chosen({ name, onRemove }: { name: string; onRemove: () => void }) {
  return <span className="tz-chosen">{name}<button type="button" aria-label={`${name} çıxar`} onClick={onRemove}><V2Icon name="x" size={12} /></button></span>;
}

export const Who = ({ name, tone }: { name: string; tone?: 'brand' }) => <span className="tz-who"><Avatar name={name} tone={tone} /><b>{name}</b></span>;

/** Etiketli sahə, uşağı hazır komponentdir (Segmented, çiplər): id lazım deyil. */
export const Fld = ({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) => <Field label={label} hint={hint} error={error}>{() => children}</Field>;
