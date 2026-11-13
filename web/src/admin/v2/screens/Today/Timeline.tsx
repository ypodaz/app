import { bakuParts, bakuToday, minutesOf } from '../../../format';
import type { Block, Shoot } from '../../../types';
import { shootStatus } from '../../data/status';
import { DAY_FROM, DAY_TO, shortName } from './helpers';

const SPAN = DAY_TO - DAY_FROM;
const pct = (m: number) => ((Math.min(DAY_TO, Math.max(DAY_FROM, m)) - DAY_FROM) / SPAN) * 100;
const HOURS = [8, 10, 12, 14, 16, 18, 20, 22];

type Seg = { key: string; a: number; b: number; label: string; cls: string; past: boolean; href?: string };

/** Günün zolağı (08–22). Blok rəngləri status mənasını daşıyır; keçmiş blok .75 şəffaf; «indi» xətti. */
export function Timeline({ shoots, blocks, now }: { shoots: Shoot[]; blocks: Block[]; now: number }) {
  const today = bakuToday();
  const toMin = (iso: string) => { const p = bakuParts(iso); return p.date < today ? 0 : p.date > today ? 24 * 60 : minutesOf(p.time); };
  const segs: Seg[] = [
    ...shoots.filter((s) => s.status !== 'cancelled' && s.status !== 'no_show').map((s): Seg => {
      const st = shootStatus(s, now);
      const a = toMin(s.starts_at);
      const cls = st === 'now' ? 'tl__b--now' : st === 'deposit' ? 'tl__b--deposit' : st === 'confirmed' ? 'tl__b--confirmed' : st === 'to_close' ? 'tl__b--close' : 'tl__b--done';
      return { key: `s${s.id}`, a, b: a + s.duration_min, label: `${shortName(s.client_name)}${s.kind === 'studio_rent' ? ' · özü çəkir' : ''}`, cls, past: st !== 'now' && st !== 'deposit' && st !== 'confirmed', href: `#/shoots/${s.id}` };
    }),
    ...blocks.map((b): Seg => ({ key: `b${b.id}`, a: toMin(b.starts_at), b: toMin(b.ends_at), label: 'Bloklanıb', cls: 'tl__b--blocked', past: new Date(b.ends_at).getTime() < now })),
  ];
  const nowMin = (() => { const p = bakuParts(new Date(now).toISOString()); return minutesOf(p.time); })();
  const inDay = nowMin >= DAY_FROM && nowMin <= DAY_TO;
  return (
    <div className="tl">
      <div className="tl__axis mono" aria-hidden="true">
        {HOURS.map((h, i) => <span key={h} style={i === 0 ? { left: 0 } : i === HOURS.length - 1 ? { right: 0 } : { left: `${pct(h * 60)}%`, transform: 'translateX(-50%)' }}>{String(h).padStart(2, '0')}</span>)}
      </div>
      <div className="tl__track" role="list" aria-label="Günün zolağı">
        {segs.filter((s) => s.b > DAY_FROM && s.a < DAY_TO).map((s) => {
          const style = { left: `calc(${pct(s.a)}% + 2px)`, width: `calc(${pct(s.b) - pct(s.a)}% - 4px)` };
          const cls = `tl__b ${s.cls}${s.past ? ' tl__b--past' : ''}`;
          return s.href
            ? <a key={s.key} role="listitem" className={cls} style={style} href={s.href} title={s.label}>{s.label}</a>
            : <div key={s.key} role="listitem" className={cls} style={style} title={s.label}>{s.label}</div>;
        })}
        {inDay && (
          <>
            <div className="tl__now" style={{ left: `${pct(nowMin)}%` }} aria-hidden="true" />
            <span className="tl__nowt mono" style={{ left: `${pct(nowMin)}%` }}>{bakuParts(new Date(now).toISOString()).time}</span>
          </>
        )}
      </div>
    </div>
  );
}
