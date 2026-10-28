import { Fragment, useState, type ReactNode } from 'react';
import { AdminShell, Button, Icon } from '../../shared/ui';
import { BlockSheet } from '../components/BlockSheet';
import { Err, ShootRow, serviceName } from '../components/common';
import { useLoad } from '../ctx';
import { addDays, bakuNow, toIso, bakuParts, bakuToday, dateLong, dateShort, dayNum, dayShort, minutesOf, range, timeRange, weekStart } from '../format';
import { go, useDesktop } from '../router';
import type { Block, Shoot } from '../types';
import { depositPending } from '../components/common';

const H0 = 8, H1 = 22, PX = 44; // iş saatları 08:00–22:00, saatda 44px
const HOURS = Array.from({ length: H1 - H0 + 1 }, (_, i) => H0 + i);
const p2 = (n: number) => String(n).padStart(2, '0');

/** Blokun həmin Bakı gününə düşən hissəsi: [başlanğıc, son] dəqiqə (gün başından), yoxsa null. */
function blockSpan(b: Block, date: string): [number, number] | null {
  const day = Date.parse(toIso(date, '00:00'));
  const from = Math.max(Date.parse(b.starts_at), day), to = Math.min(Date.parse(b.ends_at), day + 86400_000);
  return to > from ? [(from - day) / 60_000, (to - day) / 60_000] : null;
}

function Column({ date, shoots, blocks, onBlock }: { date: string; shoots: Shoot[]; blocks: Block[]; onBlock: (b: Block) => void }) {
  const now = bakuNow();
  const nowTop = date === now.date ? ((minutesOf(now.time) - H0 * 60) / 60) * PX : -1;
  function onEmpty(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('a,button')) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const m = H0 * 60 + Math.floor(((y / PX) * 60) / 30) * 30;
    go(`shoots/new?date=${date}&time=${p2(Math.floor(m / 60))}:${p2(m % 60)}`);
  }
  return (
    <div className="ax-col" style={{ height: (H1 - H0) * PX }} onClick={onEmpty} role="presentation" aria-label={`${dateShort(date)} boş vaxt`}>
      {blocks.map((b) => {
        const sp = blockSpan(b, date);
        if (!sp) return null;
        const top = Math.min(Math.max(0, ((sp[0] - H0 * 60) / 60) * PX), (H1 - H0) * PX);
        const bottom = Math.min(Math.max(0, ((sp[1] - H0 * 60) / 60) * PX), (H1 - H0) * PX);
        return bottom > top ? <button key={b.id} type="button" className="ax-block" style={{ top, height: bottom - top }} onClick={() => onBlock(b)}><span className="t12 w8">{b.reason || 'Bloklanıb'}</span></button> : null;
      })}
      {shoots.filter((s) => s.status === 'confirmed' || s.status === 'completed').map((s) => {
        const top = Math.max(0, ((minutesOf(bakuParts(s.starts_at).time) - H0 * 60) / 60) * PX);
        const H = (H1 - H0) * PX;
        const pre = (s.prep_min / 60) * PX, post = (s.wrap_min / 60) * PX, evH = Math.max(24, (s.duration_min / 60) * PX - 2);
        const cls = s.status === 'completed' ? 'ax-ev-done' : depositPending(s) ? 'ax-ev-beh' : 'ax-ev-ok';
        const preTop = Math.max(0, top - pre), postTop = top + evH + 2;
        return (
          <Fragment key={s.id}>
            {pre > 0 && top > preTop && <div className="ax-pad" aria-hidden="true" title={`Hazırlıq ${s.prep_min} dəq`} style={{ top: preTop, height: top - preTop }} />}
            {post > 0 && postTop < H && <div className="ax-pad" aria-hidden="true" title={`Yığışdırma ${s.wrap_min} dəq`} style={{ top: postTop, height: Math.min(post, H - postTop) }} />}
            <a href={`#/shoots/${s.id}`} className={`ax-ev ${cls}`} style={{ top, height: evH }}>
              <span className="t13 w8">{s.client_name}</span>
              <span className="t12">{timeRange(s.starts_at, s.duration_min)} · {serviceName(s)}</span>
            </a>
          </Fragment>
        );
      })}
      {nowTop >= 0 && nowTop <= (H1 - H0) * PX && <div className="ax-now" style={{ top: nowTop }} aria-label={`İndiki vaxt ${now.time}`} />}
    </div>
  );
}

const HourLabels = () => (
  <div className="ax-hours" style={{ height: (H1 - H0) * PX }}>
    {HOURS.map((h) => <span key={h} style={{ top: (h - H0) * PX - 8 }}>{p2(h)}:00</span>)}
  </div>
);

// B3: təqvim (gün / həftə)
export function Calendar({ query, detail }: { query: URLSearchParams; detail?: ReactNode }) {
  const desktop = useDesktop();
  const today = bakuToday();
  const view = query.get('v') === 'day' || query.get('v') === 'week' ? query.get('v')! : desktop ? 'week' : 'day';
  const d = query.get('d') || today;
  const start = view === 'week' ? weekStart(d) : d;
  const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => addDays(start, i));
  const { data, err } = useLoad<Shoot[]>(`/shoots?${range(start, addDays(start, days.length))}`);
  const blocks = useLoad<Block[]>(`/blocks?${range(start, addDays(start, days.length))}`);
  const [sheet, setSheet] = useState(false);
  const [picked, setPicked] = useState<Block | null>(null);
  const blocksOn = (date: string) => (blocks.data ?? []).filter((b) => blockSpan(b, date));
  const nav = (nd: string, v = view) => go(`calendar?d=${nd}&v=${v}`);
  const step = view === 'week' ? 7 : 1;
  const on = (date: string) => (data ?? []).filter((s) => bakuParts(s.starts_at).date === date);
  const title = view === 'week' ? `${dateShort(days[0])} – ${dateShort(days[6])}` : dateLong(d);
  const addHref = `#/shoots/new?date=${view === 'day' ? d : today}`;

  return (
    <AdminShell active="calendar" title="Təqvim" detail={detail} actions={<><Button variant="out" small auto aria-label="Vaxtı blokla" onClick={() => { setPicked(null); setSheet(true); }}><Icon name="lock" size={18} /><span className="rs-txt"> Vaxtı blokla</span></Button><a className="btn btn-primary btn-sm btn-auto" href={addHref}><Icon name="plus" size={18} strokeWidth={2.4} /><span>Çəkiliş<span className="rs-txt-lg"> əlavə et</span></span></a></>}>
      <div className="segw" role="group" aria-label="Görünüş" style={{ maxWidth: 240 }}>
        {(['day', 'week'] as const).map((v) => <button key={v} type="button" className={`seg${view === v ? ' seg-on' : ''}`} aria-pressed={view === v} onClick={() => nav(view === 'week' && v === 'day' ? (today >= days[0] && today <= days[6] ? today : days[0]) : d, v)}>{v === 'day' ? 'Gün' : 'Həftə'}</button>)}
      </div>
      <div className="row sb">
        <button type="button" className="iconbtn" aria-label="Əvvəlki" onClick={() => nav(addDays(d, -step))}><span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevron" /></span></button>
        <span className="col" style={{ alignItems: 'center', gap: 4 }}>
          <span className="t16 w8">{title}</span>
          {(view === 'week' ? !(today >= days[0] && today <= days[6]) : d !== today) && <Button variant="ghost" small onClick={() => nav(today)}>Bu gün</Button>}
        </span>
        <button type="button" className="iconbtn" aria-label="Növbəti" onClick={() => nav(addDays(d, step))}><Icon name="chevron" /></button>
      </div>
      <Err msg={err} />
      {view === 'week' && !desktop ? (
        <div className="col" style={{ gap: 14 }}>
          {days.map((date) => (
            <div key={date} className="card">
              <a className="h3" href={`#/calendar?d=${date}&v=day`} style={{ color: 'inherit', textDecoration: 'none' }}>{dateLong(date)}{date === today && ' · bu gün'}</a>
              <div className="list">{on(date).filter((s) => s.status !== 'cancelled' && s.status !== 'no_show').map((s) => <ShootRow key={s.id} s={s} />)}</div>
              {blocksOn(date).map((b) => <button key={b.id} type="button" className="ax-block ax-block-row" onClick={() => { setPicked(b); setSheet(true); }}><span className="t12 w8">{b.reason || 'Bloklanıb'} · {timeRange(b.starts_at, (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000)}</span></button>)}
              {!on(date).length && !blocksOn(date).length && <span className="t12 muted">Çəkiliş yoxdur.</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="ax-cal" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
          {view === 'week' && <div />}
          {view === 'week' && days.map((date) => (
            <a key={date} href={`#/calendar?d=${date}&v=day`} className={`ax-dh${date === today ? ' ax-dh-today' : ''}`}><span className="t12 w7">{dayShort(date)}</span><b>{dayNum(date)}</b></a>
          ))}
          <HourLabels />
          {days.map((date) => <Column key={date} date={date} shoots={on(date)} blocks={blocksOn(date)} onBlock={(b) => { setPicked(b); setSheet(true); }} />)}
        </div>
      )}
      <BlockSheet open={sheet} date={view === 'day' ? d : today} block={picked} onClose={() => setSheet(false)} onDone={blocks.reload} />
      <p className="hint">Boş sahəyə toxunun: həmin tarix və saatla “Çəkiliş əlavə et” açılır.</p>
    </AdminShell>
  );
}
