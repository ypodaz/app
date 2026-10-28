import { Icon, Pill, type IconName } from '../shared/ui';
import { XIcon } from './core';
import { dayNum, dur, endTimeOf, monShort, serviceLabel, statusKey, timeOf, weekday, type Shoot } from './util';

const WD_SHORT = (iso: string) => weekday(iso).slice(0, 3).toUpperCase();

/** Siyahı bileti (T1/T2). */
export function TicketCard({ s, showWho }: { s: Shoot; showWho?: boolean }) {
  const st = statusKey(s);
  const dim = st === 'cancelled' || st === 'noshow';
  const mat = s.mine && s.materials.length ? { text: 'Material hazırdır', ok: true } : s.mine && s.status === 'completed' && s.production === 'editing' ? { text: 'Montajda', ok: false } : null;
  return (
    <div className={`tcard${dim ? ' dim' : ''}`}>
      <a className="tk" href={`#/shoots/${s.id}`}>
        <span className="tk-date"><small>{WD_SHORT(s.starts_at)}</small><b>{dayNum(s.starts_at)}</b><small>{monShort(s.starts_at)}</small></span>
        <span className="tk-body">
          <span className="tk-row">
            <span><span className="tk-time">{timeOf(s.starts_at)}</span> <span className="tk-dur">· {dur(s.duration_min)}</span></span>
            <Pill status={st} />
          </span>
          <span className="tk-svc">{serviceLabel(s)}</span>
          {showWho && <span className="tk-meta"><span className={`tag${s.mine ? ' tag-own' : ''}`}>{s.mine ? 'Sizin' : s.who}</span></span>}
          {s.payment_line && s.status === 'confirmed' && <span className="pay"><Icon name="wallet" size={14} />{s.payment_line}</span>}
          {mat && <span className={`mat${mat.ok ? ' mat-ok' : ''}`}><Icon name="media" size={14} />{mat.text}</span>}
        </span>
      </a>
    </div>
  );
}

export function Chips({ s }: { s: Shoot }) {
  const list: { icon: IconName | 'mic'; text: string }[] = [
    { icon: 'mic', text: s.kind !== 'shoot' ? serviceLabel(s) : s.tag === 'podcast' ? 'Podcast' : serviceLabel(s).replace('Çəkiliş · ', '') },
    { icon: 'pin', text: s.location === 'studio' ? 'Studiyada' : 'Sizin məkanda' },
    ...(s.kind !== 'studio_rent' ? [{ icon: 'camera' as const, text: `${s.cameras} kamera` }] : []),
    ...(s.editing ? [{ icon: 'scissors' as const, text: 'Montaj' }] : []),
  ];
  return (
    <span className="wrap row" style={{ gap: 6 }}>
      {list.map((c) => (
        <span key={c.text} className="chipi">{c.icon === 'mic' ? <XIcon name="mic" size={14} /> : <Icon name={c.icon} size={14} />}{c.text}</span>
      ))}
    </span>
  );
}

export const timeRange = (s: Shoot) => `${timeOf(s.starts_at)}–${endTimeOf(s.starts_at, s.duration_min)} · ${dur(s.duration_min)}`;
