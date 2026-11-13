import { useEffect, useRef, useState } from 'react';
import { useLoad } from '../../../ctx';
import { addDays, bakuParts, bakuToday, dateLong, dateShort, dayNum, dayShort, minutesOf, range, timeRange, weekStart } from '../../../format';
import { go, useMedia } from '../../../router';
import type { Block, Shoot } from '../../../types';
import { useShellData } from '../../data/ShellData';
import { shootStatus } from '../../data/status';
import { minToHhmm } from '../../data/time';
import { Avatar, Button, Dialog, EmptyState, ErrorBox, LoadingRows, Segmented, StatusChip, useOnline, useToast, V2Icon } from '../../ui';
import { shortName, shootLabel } from '../Today/helpers';
import { DepositDialog } from '../Today/DepositDialog';
import { BlockDialog } from './Dialogs';
import { CekHead } from './Head';
import { ShootPanel, type PanelDialog } from './ShootPanel';
import { DAY_MAX, DAY_MIN, EV, Ic, SRC_LABEL, freeCopyText, freeOfDay, monthName, needsMe, nextStep, personName, rangeTxt, refresh, srcOf, visibleInCalendar, waitingSort, weekRangeText } from './bits';

const PX = 44;
const HOURS = Array.from({ length: (DAY_MAX - DAY_MIN) / 60 + 1 }, (_, i) => 8 + i);
type View = 'gun' | 'hefte' | 'ay';
const VIEW_LABEL: Record<View, string> = { gun: 'Gün', hefte: 'Həftə', ay: 'Ay' };

const daysOf = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));
const shootsOn = (shoots: Shoot[], date: string) => shoots.filter((s) => visibleInCalendar(s) && bakuParts(s.starts_at).date === date);
const blocksOnDay = (blocks: Block[], date: string) => blocks.filter((b) => bakuParts(b.starts_at).date === date || bakuParts(b.ends_at).date === date);
const hh = (iso: string) => bakuParts(iso).time;
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

type Cell = { date: string; min: number; x: number; y: number };

/** Çəkilişlər › Təqvim (10): Gün / Həftə / Ay + yan panel. Route: /cekilisler/teqvim?gorunus=&tarix=&secili= */
export function Teqvim({ query, initial, onInitialDone }: { query: URLSearchParams; initial?: PanelDialog; onInitialDone?: () => void }) {
  const { now } = useShellData();
  const mobile = useMedia('(max-width:767px)');
  const wideSide = useMedia('(min-width:1100px)');
  const online = useOnline();
  const toast = useToast();
  const today = bakuToday();
  const qv = query.get('gorunus');
  const view: View = mobile ? 'gun' : qv === 'gun' || qv === 'ay' ? qv : 'hefte';
  const date = query.get('tarix') || today;
  const selectedId = Number(query.get('secili')) || null;
  const wk = weekStart(date);
  const monthFirst = `${date.slice(0, 7)}-01`;
  const from = view === 'ay' ? weekStart(monthFirst) : wk;
  const n = view === 'ay' ? 42 : 7;
  const shootsQ = useLoad<Shoot[]>(`/shoots?${range(from, addDays(from, n))}`);
  const blocksQ = useLoad<Block[]>(`/blocks?${range(from, addDays(from, n))}`);
  const shoots = shootsQ.data ?? [];
  const blocks = blocksQ.data ?? [];
  const [cell, setCell] = useState<Cell | null>(null);
  const [blk, setBlk] = useState<{ date: string; time: string; block: Block | null } | null>(null);
  const [dep, setDep] = useState<Shoot | null>(null);

  const nav = (p: Record<string, string | null>) => {
    const q = new URLSearchParams(query);
    for (const [k, v] of Object.entries(p)) { if (v === null) q.delete(k); else q.set(k, v); }
    go(`cekilisler/teqvim?${q.toString()}`);
  };
  const select = (id: number | null) => nav({ secili: id ? String(id) : null });

  // Klaviatura: ← → aralıq, T bu gün (10 #3–#5)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey) return;
      if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1); else if (e.key.toLowerCase() === 't') nav({ tarix: today });
      else if (e.key === 'Escape') setCell(null);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const inRange = (list: Shoot[]) => list.filter((s) => visibleInCalendar(s) && (view === 'ay' ? bakuParts(s.starts_at).date.slice(0, 7) === date.slice(0, 7) : view === 'gun' && !mobile ? bakuParts(s.starts_at).date === date : bakuParts(s.starts_at).date >= wk && bakuParts(s.starts_at).date <= addDays(wk, 6)));
  const visible = inRange(shoots);
  const waiting = waitingSort(visible.filter((s) => needsMe(s, now)), now);
  const syncN = shoots.filter((s) => srcOf(s) === 'apple').length;

  function step(dir: number) {
    if (view === 'ay') { const [y, m] = date.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + dir, 1)); nav({ tarix: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`, secili: null }); }
    else nav({ tarix: addDays(date, dir * (view === 'hefte' ? 7 : 1)), secili: null });
  }
  function changeView(v: View) {
    // Tarix saxlanır: Ay → Həftə seçilmiş günün həftəsi; Həftə → Ay həftənin ayı
    nav({ gorunus: v, tarix: v === 'gun' && date.slice(0, 7) !== today.slice(0, 7) && wk <= today && today <= addDays(wk, 6) ? today : date, secili: null });
  }

  async function copyFree() {
    const dates = (view === 'ay' ? daysOf(monthFirst, 31).filter((d) => d.slice(0, 7) === date.slice(0, 7)) : view === 'gun' ? [date] : daysOf(wk, 7)).filter((d) => d >= today);
    const text = freeCopyText(dates, shoots, blocks);
    if (!text) { toast.show('Bu aralıqda boş vaxt yoxdur'); return; }
    try { await navigator.clipboard.writeText(text); toast.show('Boş vaxtlar kopyalandı'); }
    catch { toast.show('Kopyalanmadı · mətni əl ilə seçin', { error: true }); window.prompt('Boş vaxtlar', text); }
  }

  const title = view === 'ay' ? `${monthName(date)[0].toUpperCase() + monthName(date).slice(1)} ${date.slice(0, 4)}` : view === 'gun' ? dateLong(date) : weekRangeText(wk);
  const sub = <>{mobile ? dateLong(date) + ' · ' : view === 'ay' ? title + ' · ' : weekRangeText(wk) + ' · '}<b className="mono">{(mobile ? shootsOn(shoots, date) : visible).length}</b> çəkiliş{waiting.length > 0 && <> · <b className="mono">{waiting.length}</b>-ü sizdən iş gözləyir</>}</>;

  const tools = (
    <>
      {!mobile && <Segmented label="Görünüş" value={view} onChange={changeView} options={(['gun', 'hefte', 'ay'] as View[]).map((v) => ({ value: v, label: VIEW_LABEL[v] }))} />}
      <div className="ck-nav">
        <Button size="sm" variant="text" aria-label={view === 'ay' ? 'Əvvəlki ay' : view === 'hefte' ? 'Əvvəlki həftə' : 'Əvvəlki gün'} onClick={() => step(-1)}><V2Icon name="back" /></Button>
        <span className="ck-nav__t">{title}</span>
        <Button size="sm" variant="text" aria-label={view === 'ay' ? 'Növbəti ay' : view === 'hefte' ? 'Növbəti həftə' : 'Növbəti gün'} onClick={() => step(1)}><V2Icon name="chev" /></Button>
      </div>
      <Button size="sm" onClick={() => nav({ tarix: today, secili: null })}>Bu gün</Button>
      <Button size="sm" icon={<Ic name="copy" />} onClick={copyFree}>{mobile ? <span className="sr-only">Boş vaxtları kopyala</span> : 'Boş vaxtları kopyala'}</Button>
      <Button size="sm" icon={<Ic name="lock" />} disabled={!online} onClick={() => setBlk({ date: view === 'ay' || view === 'gun' ? date : today, time: '10:00', block: null })}>{mobile ? <span className="sr-only">Vaxtı blokla</span> : 'Vaxtı blokla'}</Button>
    </>
  );

  const loading = !shootsQ.data && !shootsQ.err;
  const panelBody = selectedId
    ? <div className="ck-side"><div className="ck-side__bar"><Button size="sm" variant="text" icon={<V2Icon name="back" />} onClick={() => select(null)}>{view === 'ay' ? 'Gün cədvəli' : 'Gözləyənlər'}</Button></div><ShootPanel id={selectedId} now={now} initial={initial} onInitialDone={onInitialDone} /></div>
    : view === 'ay' ? <DayPanel date={date} shoots={shoots} blocks={blocks} now={now} onSelect={select} onBlock={(b) => setBlk({ date: bakuParts(b.starts_at).date, time: bakuParts(b.starts_at).time, block: b })} onDayView={() => nav({ gorunus: 'gun', secili: null })} />
    : <WaitingPanel list={waiting} now={now} onSelect={select} week={view === 'hefte'} />;

  return (
    <>
      <CekHead tab="teqvim" sub={sub} tools={tools} sync={syncN} />
      {shootsQ.err ? <ErrorBox title="Təqvim yüklənmədi" detail={shootsQ.err} onRetry={shootsQ.reload} />
        : mobile ? (
          loading ? <LoadingRows rows={5} /> : (
            <DayList date={date} today={today} wk={wk} shoots={shoots} blocks={blocks} now={now} onDay={(d) => nav({ tarix: d, secili: null })} onSelect={select}
              onFree={(m) => setBlk({ date, time: minToHhmm(m), block: null })} onBlock={(b) => setBlk({ date, time: hh(b.starts_at), block: b })} onDeposit={setDep} />
          )
        ) : (
          <div className="ck-cal">
            <section className="ck-cal__main" aria-label="Təqvim">
              {loading ? <LoadingRows rows={6} /> : view === 'ay' ? (
                <MonthGrid first={from} month={date.slice(0, 7)} date={date} today={today} shoots={shoots} blocks={blocks} onPick={(d) => nav({ tarix: d, secili: null })} onOpenDay={(d) => nav({ gorunus: 'gun', tarix: d, secili: null })} />
              ) : (
                <TimeGrid days={view === 'gun' ? [date] : daysOf(wk, 7)} today={today} shoots={shoots} blocks={blocks} now={now} selectedId={selectedId} full={view === 'gun'}
                  onSelect={select} onBlock={(b) => setBlk({ date: bakuParts(b.starts_at).date, time: bakuParts(b.starts_at).time, block: b })}
                  onCell={(c) => setCell(c)} onDay={(d) => nav({ gorunus: 'gun', tarix: d, secili: null })} />
              )}
              {!loading && !visible.length && <EmptyState title={view === 'ay' ? 'Bu ay çəkiliş yoxdur' : view === 'gun' ? 'Boş gün' : 'Bu həftə çəkiliş yoxdur'} reason={view === 'gun' ? 'bu gün 08:00–22:00 arası heç bir çəkiliş planlanmayıb' : 'bütün iş saatları boşdur'} action={<Button size="sm" onClick={copyFree}>Boş vaxtları kopyala</Button>} />}
              <Legend />
            </section>
            {wideSide && <aside className="ck-cal__side">{panelBody}</aside>}
          </div>
        )}
      {cell && <CellMenu cell={cell} onClose={() => setCell(null)} onNew={() => { setCell(null); go(`cekilisler/yeni?tarix=${cell.date}&saat=${minToHhmm(cell.min)}`); }} onBlock={() => { setBlk({ date: cell.date, time: minToHhmm(cell.min), block: null }); setCell(null); }} />}
      {(mobile || !wideSide) && selectedId !== null && (
        <Dialog open onClose={() => select(null)} title="Çəkiliş təfərrüatı"><ShootPanel id={selectedId} now={now} initial={initial} onInitialDone={onInitialDone} /></Dialog>
      )}
      <BlockDialog open={!!blk} date={blk?.date ?? date} time={blk?.time ?? '10:00'} block={blk?.block ?? null} shoots={shoots} onClose={() => setBlk(null)} />
      <DepositDialog shoot={dep} onClose={() => setDep(null)} onDone={(amount, s) => { toast.show(`Beh qeyd edildi · ${personName(s)} · Təsdiqləndi`); refresh(); }} />
    </>
  );
}

function Legend() {
  return (
    <ul className="ck-legend" aria-label="Nişanların izahı">
      {[['done', 'Tamamlandı'], ['conf', 'Təsdiqləndi'], ['now', 'İndi çəkilir'], ['dep', 'Beh gözlənilir'], ['edit', 'Montajda'], ['close', 'Bağlanmalı']].map(([c, l]) => <li key={c}><i className={`ck-dot ck-dot--${c}`} />{l}</li>)}
      <li><i className="ck-dot ck-dot--blk" />Bloklanıb</li>
      <li><i className="ck-dot ck-dot--arx" />{SRC_LABEL.arxiv}</li>
    </ul>
  );
}

// ---- Həftə / Gün şəbəkəsi ----
function TimeGrid({ days, today, shoots, blocks, now, selectedId, full, onSelect, onBlock, onCell, onDay }: {
  days: string[]; today: string; shoots: Shoot[]; blocks: Block[]; now: number; selectedId: number | null; full: boolean;
  onSelect: (id: number) => void; onBlock: (b: Block) => void; onCell: (c: Cell) => void; onDay: (d: string) => void;
}) {
  const nowP = bakuParts(new Date(now).toISOString());
  const H = (DAY_MAX - DAY_MIN) / 60 * PX;
  const y = (min: number) => ((min - DAY_MIN) / 60) * PX;
  return (
    <div className="ck-grid" style={{ ['--n' as string]: days.length }}>
      <div className="ck-grid__head">
        <span />
        {days.map((d) => (
          <button key={d} type="button" className={`ck-grid__d${d === today ? ' is-today' : ''}`} onClick={() => onDay(d)} aria-label={dateLong(d)}>
            <span>{dayShort(d)}</span><b className="mono">{dayNum(d)}</b>
          </button>
        ))}
      </div>
      <div className="ck-grid__body" style={{ height: H }}>
        <div className="ck-grid__hours" aria-hidden="true">{HOURS.map((h) => <span key={h} className="mono" style={{ top: (h - 8) * PX }}>{String(h).padStart(2, '0')}</span>)}</div>
        {days.map((d) => {
          const list = shootsOn(shoots, d);
          return (
            <div key={d} className="ck-col" role="group" aria-label={`${dateShort(d)} boş vaxt`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                const r = e.currentTarget.getBoundingClientRect();
                const min = Math.min(DAY_MAX - 30, Math.max(DAY_MIN, DAY_MIN + Math.floor((((e.clientY - r.top) / PX) * 60) / 30) * 30));
                onCell({ date: d, min, x: e.clientX, y: e.clientY });
              }}>
              {blocksOnDay(blocks, d).map((b) => {
                const a = Math.max(DAY_MIN, minutesOf(hh(b.starts_at))), z = Math.min(DAY_MAX, bakuParts(b.ends_at).date > d ? DAY_MAX : minutesOf(hh(b.ends_at)));
                if (bakuParts(b.starts_at).date < d) return null;
                return z > a ? (
                  <button key={b.id} type="button" className="ck-ev ck-ev--blk" style={{ top: y(a), height: y(z) - y(a) }} onClick={() => onBlock(b)} aria-label={`Bloklanmış vaxt: ${b.reason || 'Bloklanıb'}`}>
                    <b><Ic name="lock" size={12} /> {b.reason || 'Bloklanıb'}</b><span className="mono">{hh(b.starts_at)}–{hh(b.ends_at)}</span>
                  </button>
                ) : null;
              })}
              {list.map((s) => {
                const st = shootStatus(s, now);
                const a = minutesOf(hh(s.starts_at));
                const top = Math.max(0, y(a)), height = Math.max(24, Math.min(H - top, (s.duration_min / 60) * PX));
                const src = srcOf(s);
                const tr = timeRange(s.starts_at, s.duration_min);
                const tagTxt = src === 'arxiv' ? 'Arxiv' : src === 'own' ? 'Öz layihə' : st === 'deposit' ? 'beh' : st === 'to_close' ? 'bağla' : '';
                return (
                  <button key={s.id} type="button" className={`ck-ev ck-ev--${src === 'arxiv' ? 'arx' : src === 'own' ? 'own' : EV[st]}${s.id === selectedId ? ' is-sel' : ''}`} style={{ top, height }}
                    onClick={() => onSelect(s.id)} aria-pressed={s.id === selectedId} aria-label={`${personName(s)}, ${tr}, ${shootLabel(s)}`}>
                    <b>{full ? personName(s) : shortName(s.client_name)}{tagTxt && <em> {tagTxt}</em>}</b>
                    <span className="mono">{full ? `${tr} · ${shootLabel(s)}` : tr}</span>
                  </button>
                );
              })}
              {d === nowP.date && minutesOf(nowP.time) >= DAY_MIN && minutesOf(nowP.time) <= DAY_MAX && (
                <div className="ck-now" style={{ top: y(minutesOf(nowP.time)) }} aria-label={`İndiki vaxt ${nowP.time}`}><span className="mono">{nowP.time}</span></div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CellMenu({ cell, onClose, onNew, onBlock }: { cell: Cell; onClose: () => void; onNew: () => void; onBlock: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const t = window.setTimeout(() => document.addEventListener('mousedown', away), 0);
    return () => { window.clearTimeout(t); document.removeEventListener('mousedown', away); };
  }, [onClose]);
  const left = Math.min(cell.x, window.innerWidth - 190), top = Math.min(cell.y, window.innerHeight - 100);
  return (
    <div ref={ref} className="ck-menu" role="menu" style={{ left, top }}>
      <span className="ck-menu__h mono">{dateShort(cell.date)} · {minToHhmm(cell.min)}</span>
      <button type="button" role="menuitem" onClick={onNew}>Yeni çəkiliş</button>
      <button type="button" role="menuitem" onClick={onBlock}>Vaxtı blokla</button>
    </div>
  );
}

// ---- Ay şəbəkəsi ----
function MonthGrid({ first, month, date, today, shoots, blocks, onPick, onOpenDay }: { first: string; month: string; date: string; today: string; shoots: Shoot[]; blocks: Block[]; onPick: (d: string) => void; onOpenDay: (d: string) => void }) {
  const days = daysOf(first, 42);
  return (
    <div className="ck-month" role="grid" aria-label="Ay təqvimi">
      {['B.e', 'Ç.a', 'Çər', 'C.a', 'Cüm', 'Şən', 'Baz'].map((w) => <span key={w} className="ck-month__w">{w}</span>)}
      {days.map((d) => {
        const list = shootsOn(shoots, d);
        const bl = blocksOnDay(blocks, d).length;
        return (
          <button key={d} type="button" role="gridcell" className={`ck-month__c${d.slice(0, 7) !== month ? ' is-out' : ''}${d === today ? ' is-today' : ''}${d === date ? ' is-sel' : ''}`}
            aria-selected={d === date} aria-label={`${dateLong(d)}, ${list.length} çəkiliş`} onClick={() => onPick(d)} onDoubleClick={() => onOpenDay(d)}>
            <b className="mono">{Number(dayNum(d))}</b>
            {list.length > 0 && <span className="ck-month__n">{list.length} çəkiliş</span>}
            {bl > 0 && <span className="ck-month__blk">Bloklanıb</span>}
            <span className="ck-month__dots">{list.slice(0, 6).map((s) => <i key={s.id} className={`ck-dot ck-dot--${srcOf(s) === 'arxiv' ? 'arx' : EV[shootStatus(s, Date.now())]}`} />)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---- Yan panellər ----
function WaitingPanel({ list, now, onSelect, week }: { list: Shoot[]; now: number; onSelect: (id: number) => void; week: boolean }) {
  return (
    <div className="ck-panel">
      <h2 className="ck-panel__h">Sizdən iş gözləyən <span className="mono">{list.length}</span></h2>
      {list.length === 0 ? <EmptyState title={`${week ? 'Bu həftə' : 'Bu gün'} sizdən iş gözləyən çəkiliş yoxdur`} reason="Behlər alınıb, bitmiş çəkilişlər bağlanıb." /> : (
        <div className="ck-list">
          {list.map((s) => {
            const nx = nextStep(s, now);
            return (
              <button key={s.id} type="button" className="ck-list__r" onClick={() => onSelect(s.id)}>
                <Avatar name={personName(s)} tone={shootStatus(s, now) === 'deposit' ? 'deposit' : 'cancel'} />
                <span className="ck-list__m"><b>{personName(s)}</b><span className={nx.tone ? `ck-tone-${nx.tone}` : ''}>{nx.text}{nx.ctx ? ` · ${nx.ctx}` : ''}</span></span>
                <span className="mono ck-sub">{bakuParts(s.starts_at).date.slice(8)}.{bakuParts(s.starts_at).date.slice(5, 7)}</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="ck-sub">Çəkiliş seçin: blok və ya sətrə toxunun.</p>
    </div>
  );
}

function DayPanel({ date, shoots, blocks, now, onSelect, onBlock, onDayView }: { date: string; shoots: Shoot[]; blocks: Block[]; now: number; onSelect: (id: number) => void; onBlock: (b: Block) => void; onDayView: () => void }) {
  const list = shootsOn(shoots, date).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const bl = blocksOnDay(blocks, date);
  const free = freeOfDay(date, list, bl, now);
  const need = list.filter((s) => needsMe(s, now)).length;
  return (
    <div className="ck-panel">
      <h2 className="ck-panel__h">{dateLong(date)}</h2>
      <p className="ck-sub"><b className="mono">{list.length}</b> çəkiliş{need > 0 && <> · {need} sizdən iş gözləyir</>}</p>
      <div className="ck-list">
        {list.map((s) => (
          <button key={s.id} type="button" className="ck-list__r" onClick={() => onSelect(s.id)}>
            <span className="mono ck-list__t">{hh(s.starts_at)}</span>
            <span className="ck-list__m"><b>{personName(s)}</b><span>{shootLabel(s)}</span></span>
            {srcOf(s) === 'arxiv' ? <span className="chip chip--neutral">Arxiv</span> : <StatusChip status={shootStatus(s, now)} />}
          </button>
        ))}
        {bl.map((b) => <button key={b.id} type="button" className="ck-list__r ck-list__r--blk" onClick={() => onBlock(b)}><span className="mono ck-list__t">{hh(b.starts_at)}</span><span className="ck-list__m"><b>Bloklanıb</b><span>{b.reason || '—'}</span></span></button>)}
        {free.length > 0 && <p className="ck-free"><span>Boş</span> <span className="mono">{rangeTxt(free)}</span></p>}
        {!list.length && !bl.length && <EmptyState title="Bu gün çəkiliş yoxdur" reason="08:00–22:00 arası boşdur." />}
      </div>
      <div className="ck-acts"><Button size="sm" onClick={onDayView}>Gün görünüşü</Button></div>
      <p className="ck-sub">Ləğv 24 saatdan az qalanda beh qaytarılmır.</p>
    </div>
  );
}

// ---- Mobil gün (10 Mobil fərqi) ----
function DayList({ date, today, wk, shoots, blocks, now, onDay, onSelect, onFree, onBlock, onDeposit }: {
  date: string; today: string; wk: string; shoots: Shoot[]; blocks: Block[]; now: number; onDay: (d: string) => void; onSelect: (id: number) => void;
  onFree: (min: number) => void; onBlock: (b: Block) => void; onDeposit: (s: Shoot) => void;
}) {
  const list = shootsOn(shoots, date);
  const bl = blocksOnDay(blocks, date);
  const free = freeOfDay(date, list, bl, now);
  type Row = { at: number; kind: 'shoot'; s: Shoot } | { at: number; kind: 'block'; b: Block } | { at: number; kind: 'free'; a: number; z: number };
  const rows: Row[] = [
    ...list.map((s): Row => ({ at: minutesOf(hh(s.starts_at)), kind: 'shoot', s })),
    ...bl.map((b): Row => ({ at: minutesOf(hh(b.starts_at)), kind: 'block', b })),
    ...free.map(([a, z]): Row => ({ at: a, kind: 'free', a, z })),
  ].sort((x, y) => x.at - y.at);
  return (
    <div className="ck-day">
      <div className="ck-strip" role="tablist" aria-label="Həftənin günləri">
        {daysOf(wk, 7).map((d) => (
          <button key={d} type="button" role="tab" aria-selected={d === date} className={`ck-strip__d${d === today ? ' is-today' : ''}`} onClick={() => onDay(d)} aria-label={dateLong(d)}>
            <span>{dayShort(d)}</span><b className="mono">{dayNum(d)}</b>
            <i>{shootsOn(shoots, d).slice(0, 3).map((s) => <em key={s.id} className={`ck-dot ck-dot--${EV[shootStatus(s, now)]}`} />)}</i>
          </button>
        ))}
      </div>
      {!rows.length && <EmptyState title="Boş gün" reason="08:00–22:00 arası heç bir çəkiliş planlanmayıb." />}
      {rows.map((r, i) => r.kind === 'free' ? (
        <button key={`f${i}`} type="button" className="ck-free-row" onClick={() => onFree(r.a)}><span className="mono">{minToHhmm(r.a)}–{minToHhmm(r.z)}</span> boş · {Math.floor((r.z - r.a) / 60) ? `${Math.floor((r.z - r.a) / 60)} s ` : ''}{(r.z - r.a) % 60 ? `${(r.z - r.a) % 60} dəq` : ''}</button>
      ) : r.kind === 'block' ? (
        <button key={`b${r.b.id}`} type="button" className="ck-mcard ck-mcard--blk" onClick={() => onBlock(r.b)}><Ic name="lock" /><span><b>Bloklanıb · {r.b.reason || '—'}</b><span className="mono ck-sub">{hh(r.b.starts_at)}–{hh(r.b.ends_at)}</span></span></button>
      ) : (
        <div key={r.s.id} className="ck-mcard">
          <button type="button" className="ck-mcard__hit" onClick={() => onSelect(r.s.id)}>
            <span className="mono ck-mcard__t">{hh(r.s.starts_at)}</span>
            <span className="ck-mcard__m"><b>{personName(r.s)}</b><span className="ck-sub">{shootLabel(r.s)} · <span className="mono">{timeRange(r.s.starts_at, r.s.duration_min)}</span></span>
              {srcOf(r.s) !== 'app' && <span className="ck-sub">{SRC_LABEL[srcOf(r.s) as 'apple']}</span>}</span>
            {srcOf(r.s) === 'arxiv' ? <span className="chip chip--neutral">Arxiv</span> : <StatusChip status={shootStatus(r.s, now)} />}
          </button>
          {shootStatus(r.s, now) === 'deposit' && srcOf(r.s) !== 'arxiv' && <Button size="sm" onClick={() => onDeposit(r.s)}>Beh alındı</Button>}
        </div>
      ))}
    </div>
  );
}
