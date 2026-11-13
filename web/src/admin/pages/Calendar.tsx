import { Fragment, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { AdminShell } from '../../shared/ui';
import { AIcon } from '../components/AIcon';
import { BlockSheet } from '../components/BlockSheet';
import { Err, TAG, depositPending } from '../components/common';
import { ShootChip } from '../components/neon';
import { useLoad } from '../ctx';
import { addDays, bakuNow, toIso, bakuParts, bakuToday, dateLong, dateShort, dayNum, dayShort, minutesOf, range, timeRange, weekStart } from '../format';
import { go, useWide } from '../router';
import type { Block, Shoot } from '../types';

const H0 = 8, H1 = 22, PX = 44; // iş saatları 08:00–22:00, saatda 44px
const HOURS = Array.from({ length: H1 - H0 + 1 }, (_, i) => H0 + i);
const p2 = (n: number) => String(n).padStart(2, '0');

/** Blokun həmin Bakı gününə düşən hissəsi: [başlanğıc, son] dəqiqə (gün başından), yoxsa null. */
function blockSpan(b: Block, date: string): [number, number] | null {
  const day = Date.parse(toIso(date, '00:00'));
  const from = Math.max(Date.parse(b.starts_at), day), to = Math.min(Date.parse(b.ends_at), day + 86400_000);
  return to > from ? [(from - day) / 60_000, (to - day) / 60_000] : null;
}

/** "Rəşad Məlikov" → "Rəşad M." (həftə şəbəkəsində dar sütun). */
const shortName = (n: string | null) => {
  const w = (n ?? '').trim().split(/\s+/);
  return w.length > 1 ? `${w[0]} ${w[w.length - 1][0].toUpperCase()}.` : w[0] ?? '';
};
/** Çəkilişin növü: "Podcast" / "Reels" / "Studiya icarəsi". */
const tagName = (s: Shoot) => (s.kind === 'reels_pack' ? 'Reels' : s.kind === 'single_reel' ? 'Tək Reels' : s.kind === 'studio_rent' ? 'Studiya icarəsi' : TAG[s.tag]);
const place = (s: Shoot) => (s.location === 'studio' ? 'Studiyada' : 'Məkanda');
/** ISO həftə nömrəsi. */
function isoWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - first.getTime()) / 86400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
const statusCls = (s: Shoot) => (s.status === 'completed' ? 'cb' : s.status === 'cancelled' ? 'off' : depositPending(s) ? 'beh' : 'cal');
const dotColor: Record<string, string> = { cb: '#5BE3A6', cal: '#4FB3FF', beh: '#FF8A5B', off: '#86848E' };
type Item = { at: string; b?: Block; s?: Shoot };
const shown = (s: Shoot) => s.status !== 'no_show';

function Column({ date, shoots, blocks, onBlock, full, selectedId }: { date: string; shoots: Shoot[]; blocks: Block[]; onBlock: (b: Block) => void; full: boolean; selectedId?: number }) {
  const now = bakuNow();
  const isToday = date === now.date;
  const nowTop = isToday ? ((minutesOf(now.time) - H0 * 60) / 60) * PX : -1;
  const [ghost, setGhost] = useState<{ top: number; label: string } | null>(null);
  const H = (H1 - H0) * PX;
  const slot = (e: MouseEvent<HTMLDivElement>) => {
    const y = e.clientY - (e.currentTarget.firstElementChild as HTMLElement).getBoundingClientRect().top;
    const m = Math.min(H1 * 60 - 30, Math.max(H0 * 60, H0 * 60 + Math.floor(((y / PX) * 60) / 30) * 30));
    return m;
  };
  function onEmpty(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('a,button')) return;
    const m = slot(e);
    go(`shoots/new?date=${date}&time=${p2(Math.floor(m / 60))}:${p2(m % 60)}`);
  }
  function onMove(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('a,button')) { setGhost(null); return; }
    const m = slot(e);
    setGhost({ top: ((m - H0 * 60) / 60) * PX, label: `+ ${p2(Math.floor(m / 60))}:${p2(m % 60)}` });
  }
  const list = shoots.filter(shown);
  // «Hazırlıq N dəq» yazısı: bu günün ən yaxın gələn çəkilişində
  const next = isToday ? list.find((s) => s.status === 'confirmed' && s.prep_min > 0 && bakuParts(s.starts_at).time >= now.time) : undefined;
  return (
    <div className={`a-day${isToday ? ' tod' : ''}`} onClick={onEmpty} onMouseMove={onMove} onMouseLeave={() => setGhost(null)} role="group" aria-label={`${dateShort(date)} boş vaxt`}>
      <div className="a-in">
        {blocks.map((b) => {
          const sp = blockSpan(b, date);
          if (!sp) return null;
          const top = Math.min(Math.max(0, ((sp[0] - H0 * 60) / 60) * PX), H);
          const bottom = Math.min(Math.max(0, ((sp[1] - H0 * 60) / 60) * PX), H);
          return bottom > top ? (
            <button key={b.id} type="button" className="a-lock" style={{ top, height: bottom - top }} onClick={() => onBlock(b)} aria-label={`Bloklanmış vaxt: ${b.reason || 'Bloklanıb'}`}>
              <b><AIcon name="lock" size={12} />{b.reason || 'Bloklanıb'}</b><span>{timeRange(b.starts_at, (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000)}</span>
            </button>
          ) : null;
        })}
        {list.map((s) => {
          const top = Math.max(0, ((minutesOf(bakuParts(s.starts_at).time) - H0 * 60) / 60) * PX);
          const pre = (s.prep_min / 60) * PX, post = (s.wrap_min / 60) * PX, evH = Math.max(24, (s.duration_min / 60) * PX);
          const preTop = Math.max(0, top - pre), postTop = top + evH;
          const cls = statusCls(s);
          const tr = timeRange(s.starts_at, s.duration_min);
          return (
            <Fragment key={s.id}>
              {pre > 0 && top > preTop && <div className="a-prep" aria-hidden="true" title={`Hazırlıq ${s.prep_min} dəq`} style={{ top: preTop, height: top - preTop }}>{next?.id === s.id && top - preTop >= 11 ? `Hazırlıq ${s.prep_min} dəq` : null}</div>}
              {post > 0 && postTop < H && <div className="a-prep" aria-hidden="true" title={`Yığışdırma ${s.wrap_min} dəq`} style={{ top: postTop, height: Math.min(post, H - postTop) }} />}
              <a href={`#/shoots/${s.id}`} className={`a-blk a-blk-${cls}${s.id === selectedId ? ' sel' : ''}`} style={{ top, height: evH }} aria-label={`${s.client_name}, ${tr}, ${tagName(s)}`}>
                {full ? <><b>{s.client_name}</b><span>{tr} · {tagName(s)}</span></> : <><b>{shortName(s.client_name)}</b><span>{tr}</span>{evH >= 60 && <span>{tagName(s)}</span>}</>}
              </a>
            </Fragment>
          );
        })}
        {ghost && <div className="a-ghost" aria-hidden="true" style={{ top: ghost.top }}>{ghost.label}</div>}
        {nowTop >= 0 && nowTop <= H && <div className="a-now" style={{ top: nowTop }} aria-label={`İndiki vaxt ${now.time}`}><span>indi</span></div>}
      </div>
    </div>
  );
}

const HourLabels = () => (
  <div className="a-hours" aria-hidden="true">
    {HOURS.map((h) => <span key={h} className="a-hl" style={{ top: (h - H0) * PX + 2 }}>{p2(h)}:00</span>)}
  </div>
);

// B3: təqvim (gün / həftə)
export function Calendar({ query, detail, selectedId }: { query: URLSearchParams; detail?: ReactNode; selectedId?: number }) {
  const wide = useWide();
  const today = bakuToday();
  const view = query.get('v') === 'day' || query.get('v') === 'week' ? query.get('v')! : wide ? 'week' : 'day';
  const d = query.get('d') || today;
  const wk = weekStart(d);
  const start = view === 'week' ? wk : d;
  const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => addDays(start, i));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
  // gün görünüşündə də bütün həftə yüklənir: gün zolağındakı nöqtələr üçün
  const { data, err } = useLoad<Shoot[]>(`/shoots?${range(wk, addDays(wk, 7))}`);
  const blocks = useLoad<Block[]>(`/blocks?${range(wk, addDays(wk, 7))}`);
  const [sheet, setSheet] = useState(false);
  const [picked, setPicked] = useState<Block | null>(null);
  const blocksOn = (date: string) => (blocks.data ?? []).filter((b) => blockSpan(b, date));
  const nav = (nd: string, v = view) => go(`calendar?d=${nd}&v=${v}`);
  const step = view === 'week' ? 7 : 1;
  const on = (date: string) => (data ?? []).filter((s) => bakuParts(s.starts_at).date === date);
  const thisWeek = today >= wk && today <= weekDays[6];
  const rangeTxt = `${dateShort(wk)} – ${dateShort(weekDays[6])}`;
  const addHref = `#/shoots/new?date=${view === 'day' ? d : today}`;
  const openBlock = (b: Block | null) => { setPicked(b); setSheet(true); };

  return (
    <AdminShell active="calendar" title="Təqvim" detail={detail} detailClose={detail ? `#/calendar?d=${d}&v=${view}` : undefined}
      actions={<>
        <button type="button" className="a-bg a-bl" aria-label="Vaxtı blokla" onClick={() => openBlock(null)}><AIcon name="lock" size={18} /><span className="rs-txt">Vaxtı blokla</span></button>
        <a className="a-bp" href={addHref}><AIcon name="plus" size={18} /><span>Çəkiliş<span className="rs-txt-lg"> əlavə et</span></span></a>
      </>}>
      <div className="a-rise">
        <div className="a-cbar">
          <div className={`a-seg${view === 'week' ? ' w' : ''}`} role="group" aria-label="Görünüş">
            <span className="a-seg-i" aria-hidden="true" />
            {(['day', 'week'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => nav(view === 'week' && v === 'day' ? (thisWeek ? today : days[0]) : d, v)}>{v === 'day' ? 'Gün' : 'Həftə'}</button>)}
          </div>
          <button type="button" className="a-bg a-bg-i a-prev" aria-label={view === 'week' ? 'Əvvəlki həftə' : 'Əvvəlki gün'} onClick={() => nav(addDays(d, -step))}><AIcon name="chevl" /></button>
          <span className={`a-ttl${view === 'day' ? ' a-ttl-d' : ''}`}>{view === 'day' && <span className="wd">{dateLong(d)}</span>}<span className={view === 'day' ? 'rg' : ''}>{rangeTxt}</span></span>
          <button type="button" className="a-bg a-bg-i a-next" aria-label={view === 'week' ? 'Növbəti həftə' : 'Növbəti gün'} onClick={() => nav(addDays(d, step))}><AIcon name="chev" /></button>
          <span className="a-cside">{view === 'day' ? `${rangeTxt} · ` : ''}Həftə {isoWeek(wk)}</span>
          {(view === 'week' ? !thisWeek : d !== today) && <button type="button" className="a-bg a-today" onClick={() => nav(today)}>Bu gün</button>}
        </div>
        <Err msg={err} />
        {view === 'day' && (
          <div className="a-sday" role="tablist" aria-label="Həftənin günləri">
            {weekDays.map((date) => (
              <a key={date} href={`#/calendar?d=${date}&v=day`} role="tab" aria-selected={date === d} aria-label={`${dateLong(date)}${date === today ? ', bu gün' : ''}`} className={`a-d${date === d ? ' sel' : ''}${date === today ? ' tod' : ''}`}>
                <span className="w">{dayShort(date)}</span><span className="n">{dayNum(date)}</span>
                <span className="dots">{on(date).filter(shown).map((s) => <i key={s.id} style={{ background: dotColor[statusCls(s)] }} />)}</span>
              </a>
            ))}
          </div>
        )}
        {view === 'week' && !wide ? (
          <div className="a-wl" key={`l-${start}`}>
            {days.map((date) => {
              const items = on(date).filter(shown), bl = blocksOn(date);
              return (
                <section key={date} className="a-ws" aria-label={dateLong(date)}>
                  <h2 className={`a-wh${date === today ? ' tod' : ''}`}>{dateLong(date)}{date === today && <> · <span>bu gün</span></>}</h2>
                  {[...bl.map((b): Item => ({ at: b.starts_at, b })), ...items.map((s): Item => ({ at: s.starts_at, s }))].sort((x, y) => x.at.localeCompare(y.at)).map((it) => 'b' in it && it.b ? (
                    <button key={`b${it.b.id}`} type="button" className="a-r a-r-lock" onClick={() => openBlock(it.b!)}>
                      <div className="a-r-t">{bakuParts(it.b.starts_at).time}<span>{bakuParts(it.b.ends_at).time}</span></div>
                      <div className="a-r-m"><b><AIcon name="lock" size={14} />{it.b.reason || 'Bloklanıb'}</b><div>Bloklanmış vaxt</div></div>
                    </button>
                  ) : it.s ? (
                    <a key={it.s.id} href={`#/shoots/${it.s.id}`} className={`a-r${it.s.status === 'cancelled' ? ' a-r-off' : ''}`}>
                      <div className="a-r-t">{bakuParts(it.s.starts_at).time}<span>{timeRange(it.s.starts_at, it.s.duration_min).slice(6)}</span></div>
                      <div className="a-r-m"><b>{it.s.client_name}</b><div>{tagName(it.s)}{it.s.kind === 'studio_rent' ? '' : ` · ${place(it.s)}`}<ShootChip s={it.s} withAmount /></div></div>
                    </a>
                  ) : null)}
                  {!items.length && !bl.length && <div className="a-r-none">Çəkiliş yoxdur.</div>}
                </section>
              );
            })}
          </div>
        ) : (
          <section className="a-grid" key={`${view}-${start}`} aria-label={view === 'week' ? 'Həftəlik vaxt şəbəkəsi' : dateLong(d)}>
            <div className={`a-gi${view === 'week' ? ' a-wk' : ''}`} style={{ '--n': days.length } as CSSProperties}>
              {view === 'week' && <div />}
              {view === 'week' && days.map((date) => (
                <a key={date} href={`#/calendar?d=${date}&v=day`} className={`a-wkh${date === today ? ' tod' : ''}`} aria-label={`${dateLong(date)}${date === today ? ', bu gün' : ''}`}><span className="w">{dayShort(date)}</span><span className="n">{dayNum(date)}</span></a>
              ))}
              <HourLabels />
              {days.map((date) => <Column key={date} date={date} shoots={on(date)} blocks={blocksOn(date)} onBlock={openBlock} full={view === 'day'} selectedId={selectedId} />)}
            </div>
          </section>
        )}
        <BlockSheet open={sheet} date={view === 'day' ? d : today} block={picked} onClose={() => setSheet(false)} onDone={blocks.reload} />
        <p className="a-hint">Boş sahəyə toxunun: həmin tarix və saatla «Çəkiliş əlavə et» açılır.</p>
      </div>
    </AdminShell>
  );
}
