import { useMemo, useState } from 'react';
import { Button, EmptyState, Icon, Segmented } from '../shared/ui';
import { BookButtons, ErrorState, Loading, OfflineBadge, Screen, useApi, XIcon } from './core';
import { TicketCard } from './shoots';
import { WD_HEAD, dateLong, dayKey, isFuture, monthTitle, todayKey, type Shoot } from './util';
import type { HomeData } from './home';

const pad = (n: number) => String(n).padStart(2, '0');

export function Calendar() {
  const q = useApi<Shoot[]>('/me/shoots', 'ypod.shoots');
  const home = useApi<HomeData>('/me/home', 'ypod.home');
  const t = todayKey();
  const [ty, tm] = t.split('-').map(Number);
  const [ym, setYm] = useState({ y: ty, m: tm - 1 });
  const [sel, setSel] = useState(t);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [when, setWhen] = useState<'future' | 'past'>('future');

  const all = q.data ?? [];
  const isPkg = !!home.data?.package || all.some((s) => s.package_id != null && !s.mine);
  const list = useMemo(() => (isPkg && scope === 'mine' ? all.filter((s) => s.mine) : all), [all, isPkg, scope]);
  const byDay = useMemo(() => {
    const m = new Map<string, Shoot[]>();
    for (const s of list) { const k = dayKey(s.starts_at); m.set(k, [...(m.get(k) ?? []), s]); }
    return m;
  }, [list]);

  // Həftə Bazar ertəsindən başlayır
  const first = new Date(Date.UTC(ym.y, ym.m, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const cells: { key: string; n: number; other: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(Date.UTC(ym.y, ym.m, 1 - lead + i));
    const key = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    if (i >= lead + days && i % 7 === 0) break;
    cells.push({ key, n: dt.getUTCDate(), other: dt.getUTCMonth() !== ym.m });
  }
  const shift = (d: number) => { const dt = new Date(Date.UTC(ym.y, ym.m + d, 1)); setYm({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() }); };

  const selList = (byDay.get(sel) ?? []).slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const future = list.filter(isFuture).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = list.filter((s) => !isFuture(s)).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const shown = when === 'future' ? future : past;
  const selTitle = sel === t ? 'Bu gün' : dateLong(`${sel}T00:00:00+04:00`);

  return (
    <Screen tab="calendar">
      <h1 className="h1">Təqvim</h1>
      {q.offline && q.data && <OfflineBadge />}
      {!q.data ? (q.loading ? <Loading /> : <ErrorState q={q} />) : all.length === 0 ? (
        <>
          <EmptyState icon="calendar" title="Təqviminiz hələ boşdur" text="Çəkilişə yazılmaq üçün bizə WhatsApp-da yazın və ya zəng edin. Gün və saatı birlikdə seçək." />
          <BookButtons />
        </>
      ) : (
        <>
          {isPkg && (
            <>
              <span className="t13 muted">{home.data?.package?.title} · saat paketi</span>
              <Segmented label="Çəkilişlər" value={scope} onChange={setScope} options={[{ value: 'mine', label: 'Mənim' }, { value: 'all', label: 'Bütün paket' }]} />
            </>
          )}
          <div className="card" style={{ gap: 8 }}>
            <div className="cal-head">
              <button type="button" className="iconbtn" aria-label="Əvvəlki ay" onClick={() => shift(-1)}><XIcon name="back" size={22} /></button>
              <span className="h3" aria-live="polite">{monthTitle(ym.y, ym.m)}</span>
              <button type="button" className="iconbtn" aria-label="Növbəti ay" onClick={() => shift(1)}><Icon name="chevron" size={22} /></button>
            </div>
            <div className="cal-wd" aria-hidden="true">{WD_HEAD.map((w) => <span key={w}>{w}</span>)}</div>
            <div className="cal-g">
              {cells.map((c) => {
                const ss = byDay.get(c.key);
                const dot = ss ? (ss.some(isFuture) ? 'dot-f' : 'dot-p') : '';
                return (
                  <button key={c.key} type="button" aria-label={`${c.n}${ss ? `, ${ss.length} çəkiliş` : ''}`} aria-pressed={c.key === sel}
                    className={`cd${c.other ? ' cd-other' : ''}${c.key === t ? ' cd-today' : ''}${c.key === sel ? ' cd-sel' : ''}`}
                    onClick={() => { setSel(c.key); if (c.other) { const [y, m] = c.key.split('-').map(Number); setYm({ y, m: m - 1 }); } }}>
                    {c.n}<span className={`dot ${dot}`} />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="row sb"><span className="h3">{selTitle}</span><span className="t13 muted">{selList.length ? `${selList.length} çəkiliş` : ''}</span></div>
          {selList.length ? selList.map((s) => <TicketCard key={s.id} s={s} showWho={isPkg} />) : <p className="t14 muted">Bu gün çəkiliş yoxdur</p>}

          <hr className="hr" />
          <Segmented label="Siyahı" value={when} onChange={setWhen} options={[{ value: 'future', label: `Gələcək${future.length ? ` · ${future.length}` : ''}` }, { value: 'past', label: 'Keçmiş' }]} />
          {shown.length ? shown.map((s) => <TicketCard key={s.id} s={s} showWho={isPkg} />) : <p className="t14 muted">{when === 'future' ? 'Gələcək çəkiliş yoxdur.' : 'Keçmiş çəkiliş yoxdur.'}</p>}
          <Button variant="ghost" small onClick={() => { setSel(t); setYm({ y: ty, m: tm - 1 }); }}>Bu günə qayıt</Button>
        </>
      )}
    </Screen>
  );
}
