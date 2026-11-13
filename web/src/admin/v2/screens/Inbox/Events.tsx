import type { ThreadEvent } from '../../../components/crm';
import { bakuParts } from '../../../format';

/** Söhbət tarixçəsi sətri (02 #17, #19; 03 §Q9 S5): sistem sətri ortada solğun, daxili qeyd sarımtıl. Müştəriyə görünmür. */
export function EventLine({ e }: { e: ThreadEvent }) {
  const time = bakuParts(e.created_at).time;
  if (e.kind === 'note') {
    return (
      <div className="ibt__note" role="note" aria-label="Daxili qeyd">
        <b>{e.meta?.author ?? 'Siz'} · daxili qeyd</b>
        <span className="ibmsg__t">{e.text}</span>
        <span className="mono">{time}</span>
      </div>
    );
  }
  return <div className={`ibt__sys${e.meta?.code === 'handoff_reason' ? ' ibt__sys--why' : ''}`}>{e.text}<span className="mono">{time}</span></div>;
}

type Timed = { at: string };

/** Mesajlar və tarixçə sətirləri vaxta görə (eyni vaxtda mesaj əvvəl). */
export function mergeTimeline<M>(messages: M[], at: (m: M) => string, events: ThreadEvent[]): ({ t: 'm'; m: M } & Timed | { t: 'e'; e: ThreadEvent } & Timed)[] {
  const rows = [
    ...messages.map((m) => ({ t: 'm' as const, m, at: at(m) })),
    ...events.map((e) => ({ t: 'e' as const, e, at: e.created_at })),
  ];
  return rows.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || (a.t === b.t ? 0 : a.t === 'm' ? -1 : 1));
}
