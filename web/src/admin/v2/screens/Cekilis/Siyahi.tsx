import { useMemo, useState } from 'react';
import { useLoad } from '../../../ctx';
import { addDays, bakuParts, bakuToday, dateShort, range, timeRange } from '../../../format';
import { go } from '../../../router';
import type { Shoot } from '../../../types';
import { useShellData } from '../../data/ShellData';
import { shootStatus } from '../../data/status';
import { Button, EmptyState, ErrorBox, LoadingRows, Segmented, StatusChip, TextInput } from '../../ui';
import { CekHead } from './Head';
import { SRC_LABEL, money, personName, srcOf, svcText } from './bits';

type F = 'all' | 'soon' | 'deposit' | 'to_close' | 'editing' | 'done' | 'cancelled';
const FILTERS: { value: F; label: string }[] = [
  { value: 'all', label: 'Hamısı' }, { value: 'soon', label: 'Gələcək' }, { value: 'deposit', label: 'Beh gözləyir' },
  { value: 'to_close', label: 'Bağlanmalı' }, { value: 'editing', label: 'Montajda' }, { value: 'done', label: 'Tamamlandı' }, { value: 'cancelled', label: 'Ləğv' },
];
const PAGE = 40;

/** Çəkilişlər › Siyahı (12): axtarış + status süzgəci, cədvəl (desktop) / kartlar (mobil). */
export function Siyahi() {
  const { now } = useShellData();
  const today = bakuToday();
  const q = useLoad<Shoot[]>(`/shoots?${range(addDays(today, -120), addDays(today, 60))}`);
  const [f, setF] = useState<F>('all');
  const [text, setText] = useState('');
  const [lim, setLim] = useState(PAGE);

  const list = useMemo(() => {
    const t = text.trim().toLowerCase();
    // TODO [API] telefona görə axtarış: Shoot-da telefon sahəsi yoxdur, yalnız ada görə axtarılır.
    return (q.data ?? [])
      .filter((s) => (t ? (s.client_name ?? '').toLowerCase().includes(t) : true))
      .filter((s) => {
        const st = shootStatus(s, now);
        if (f === 'all') return true;
        if (f === 'soon') return new Date(s.starts_at).getTime() > now && st !== 'cancelled';
        if (f === 'done') return st === 'done' || st === 'delivered';
        return st === f;
      })
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  }, [q.data, f, text, now]);

  const open = (s: Shoot) => go(`cekilisler/teqvim?tarix=${bakuParts(s.starts_at).date}&gorunus=gun&secili=${s.id}`);
  const loading = !q.data && !q.err;

  return (
    <>
      <CekHead tab="siyahi" sub={q.data ? <><b className="mono">{list.length}</b> çəkiliş</> : undefined} />
      <div className="ck-filters">
        <TextInput type="search" aria-label="Müştəri adına görə axtar" placeholder="Müştəri adı" value={text} onChange={(e) => { setText(e.target.value); setLim(PAGE); }} />
        <Segmented<F> label="Status süzgəci" value={f} onChange={(v) => { setF(v); setLim(PAGE); }} options={FILTERS} />
      </div>
      {q.err ? <ErrorBox title="Siyahı yüklənmədi" detail={q.err} onRetry={q.reload} />
        : loading ? <LoadingRows rows={8} />
        : !list.length ? <EmptyState title="Çəkiliş tapılmadı" reason={text || f !== 'all' ? 'Süzgəci dəyişin və ya axtarışı təmizləyin.' : 'Son 4 ay və gələn 2 ay üçün çəkiliş yoxdur.'} action={text || f !== 'all' ? <Button size="sm" onClick={() => { setText(''); setF('all'); }}>Süzgəci təmizlə</Button> : undefined} />
        : (
          <>
            <ul className="ck-rows" aria-label="Çəkilişlər">
              {list.slice(0, lim).map((s) => {
                const p = bakuParts(s.starts_at);
                const src = srcOf(s);
                return (
                  <li key={s.id}>
                    <button type="button" className="ck-row" onClick={() => open(s)}>
                      <span className="ck-row__d mono">{dateShort(p.date)}<small>{timeRange(s.starts_at, s.duration_min)}</small></span>
                      <span className="ck-row__m"><b>{personName(s)}</b><span className="ck-sub">{svcText(s)}{src !== 'app' ? ` · ${SRC_LABEL[src]}` : ''}</span></span>
                      <span className="ck-row__s">{src === 'arxiv' ? <span className="chip chip--neutral">Arxiv</span> : <StatusChip status={shootStatus(s, now)} />}</span>
                      <span className="ck-row__p mono">{money(s.total)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {list.length > lim && <div className="ck-more"><Button onClick={() => setLim(lim + PAGE)}>Daha çox göstər ({list.length - lim})</Button></div>}
          </>
        )}
    </>
  );
}
