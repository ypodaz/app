import { useMemo, useState, type CSSProperties } from 'react';
import { NIcon } from '../shared/ui';
import { ErrorState, Loading, NEmpty, OfflineBadge, Screen, useApi } from './core';
import { NSeg, TicketCard } from './shoots';
import { BOOK_TEXT, PHONE_HREF, dayKey, dayLabel, isFuture, monthTitle, todayKey, waLink, type Shoot } from './util';
import type { HomeData } from './home';

const pad = (n: number) => String(n).padStart(2, '0');
const WD_HEAD = ['B.e', 'Ç.a', 'Ç', 'C.a', 'C', 'Ş', 'B'];
const rise = (i: number) => ({ '--i': i }) as CSSProperties;

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
  const pkgTitle = home.data?.package?.title;
  const empty = !!q.data && all.length === 0;

  const head = (
    <header className="ncal-head rise">
      <h1 className="n-h1">Təqvim</h1>
      {isPkg && pkgTitle && <div className="n-meta">{pkgTitle} · saat paketi</div>}
    </header>
  );
  const nav = (
    <div className="ncal-nav">
      <button type="button" className="rbtn" aria-label="Əvvəlki ay" onClick={() => shift(-1)}><NIcon name="left" /></button>
      <h2 className="n-h2" aria-live="polite">{monthTitle(ym.y, ym.m)}</h2>
      <button type="button" className="rbtn" aria-label="Növbəti ay" onClick={() => shift(1)}><NIcon name="chev" /></button>
    </div>
  );
  const wd = <div className="ncal-wd" aria-hidden="true">{WD_HEAD.map((w) => <span key={w}>{w}</span>)}</div>;
  const aria = (c: { key: string; n: number }, ss?: Shoot[]) => `${c.n}${ss ? `, ${ss.length} çəkiliş` : ''}${c.key === t ? ', bu gün' : ''}`;

  if (!q.data) return <Screen tab="calendar">{head}{q.loading ? <Loading /> : <ErrorState q={q} />}</Screen>;

  if (empty) {
    return (
      <Screen tab="calendar">
        {head}
        {q.offline && <OfflineBadge />}
        <section aria-label="Ay təqvimi" className="g ncal rise" style={rise(1)}>
          {nav}{wd}
          <div className="ncal-g" key={`${ym.y}-${ym.m}`}>
            {cells.map((c) => <div key={c.key} aria-label={aria(c)} className={`ncd${c.other ? ' ncd-o' : ''}${c.key === t ? ' ncd-t' : ''}`}>{c.n}</div>)}
          </div>
        </section>
        <NEmpty fill icon="cal" tone="cal" title="Təqviminiz hələ boşdur" text="Çəkilişə yazılmaq üçün bizə WhatsApp-da yazın və ya zəng edin. Gün və saatı birlikdə seçək.">
          <a className="nb nb-p nb-auto" href={waLink(BOOK_TEXT)} target="_blank" rel="noopener"><NIcon name="msg" size={18} />WhatsApp-da yaz</a>
          <a className="nb nb-s nb-auto" href={PHONE_HREF}><NIcon name="phone" size={18} />Zəng et</a>
        </NEmpty>
      </Screen>
    );
  }

  return (
    <Screen tab="calendar">
      {head}
      {q.offline && <OfflineBadge />}
      <section aria-label="Ay təqvimi" className="g ncal rise" style={rise(1)}>
        {nav}{wd}
        <div className="ncal-g" key={`${ym.y}-${ym.m}`}>
          {cells.map((c) => {
            const ss = byDay.get(c.key);
            const dot = ss ? (ss.some(isFuture) ? 'ncd-f' : 'ncd-p') : '';
            return (
              <button key={c.key} type="button" aria-label={aria(c, ss)} aria-pressed={c.key === sel}
                className={`ncd${c.other ? ' ncd-o' : ''}${c.key === t ? ' ncd-t' : ''}${c.key === sel ? ' ncd-s' : ''}`}
                onClick={() => { setSel(c.key); if (c.other) { const [y, m] = c.key.split('-').map(Number); setYm({ y, m: m - 1 }); } }}>
                {c.n}{dot && <i className={dot} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </section>

      <div className="ncal-day rise" style={rise(2)}>
        <h2 className="n-h2">{dayLabel(`${sel}T00:00:00+04:00`)}</h2>
        <span className="n-meta">{selList.length ? `${selList.length} çəkiliş` : 'Çəkiliş yoxdur'}</span>
      </div>
      {selList.length
        ? selList.map((s, k) => <TicketCard key={s.id} s={s} showWho={isPkg} i={3 + k} />)
        : <div className="ncal-none n-body c2">Bu gün çəkiliş yoxdur</div>}

      <div className="rise ncal-seg" style={rise(3)}>
        {isPkg
          ? <NSeg label="Çəkilişlər" value={scope} onChange={setScope} options={[{ value: 'mine', label: 'Mənim' }, { value: 'all', label: 'Bütün paket' }]} />
          : <NSeg label="Çəkilişlər" value={when} onChange={setWhen} options={[{ value: 'future', label: `Gələcək${future.length ? ` · ${future.length}` : ''}` }, { value: 'past', label: 'Keçmiş' }]} />}
      </div>

      {isPkg ? (
        <>
          {future.length > 0 && <div className="ncal-sec">Gələcək · {future.length}</div>}
          {future.map((s, k) => <TicketCard key={s.id} s={s} showWho i={4 + k} />)}
          {past.length > 0 && <div className="ncal-sec" style={{ marginTop: 4 }}>Keçmiş</div>}
          {past.map((s, k) => <TicketCard key={s.id} s={s} showWho i={4 + k} />)}
        </>
      ) : shown.length
        ? shown.map((s, k) => <TicketCard key={s.id} s={s} i={4 + k} />)
        : <div className="ncal-none n-body c2">{when === 'future' ? 'Gələcək çəkiliş yoxdur.' : 'Keçmiş çəkiliş yoxdur.'}</div>}

      <div className="ncal-back"><button type="button" onClick={() => { setSel(t); setYm({ y: ty, m: tm - 1 }); }}>Bu günə qayıt</button></div>
    </Screen>
  );
}
