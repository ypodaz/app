import { useMemo, useState } from 'react';
import { formatHours, formatMoney } from '../../../../shared/ui';
import { appLine, bakuParts, bakuToday, dateShort } from '../../../format';
import type { ClientRow, TagRow } from '../../../types';
import { Avatar, Button, EmptyState, Segmented } from '../../ui';
import { phoneShown } from './data';

const PAGE = 60;
const MIN_USE = 7000; // 70 AZN (00 §5.2)
type Sub = 'all' | 'cb' | 'pkg';

const lastShoot = (c: ClientRow) => {
  if (!c.last_shoot_at) return '—';
  const d = bakuParts(c.last_shoot_at).date;
  return d === bakuToday() ? 'Bu gün' : dateShort(d);
};
function Pkg({ c }: { c: ClientRow }) {
  if (!c.package) return <span className="ins-dim">—</span>;
  const { minutes_left: l, minutes_total: t } = c.package;
  return (
    <span className="ins-pkg"><span className="mono">{formatHours(l).replace(' saat', '')} / {formatHours(t)}</span>
      <i className="ins-bar" aria-hidden="true"><b style={{ width: `${t ? Math.max(0, Math.min(100, (l / t) * 100)) : 0}%` }} /></i></span>
  );
}

/** Müştəri cədvəli (20 «Müştəri»). Mənbə: GET /clients. */
export function ClientsView({ rows, tags, q, filtered, onReset }: { rows: ClientRow[]; tags: TagRow[]; q: string; filtered: boolean; onReset: () => void }) {
  const [sub, setSub] = useState<Sub>('all');
  const [tag, setTag] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const counts = useMemo(() => ({ all: rows.length, cb: rows.filter((c) => c.cashback_balance >= MIN_USE).length, pkg: rows.filter((c) => c.package).length }), [rows]);
  const list = rows.filter((c) => (sub === 'all' || (sub === 'cb' ? c.cashback_balance >= MIN_USE : !!c.package)) && (!tag || c.tags?.some((t) => t.id === tag)));
  const shown = list.slice(0, limit);
  // TODO [API] «Korporativ» alt süzgəci, «Çəkiliş» sayı, kontekst sətri və «Növbəti addım» sütunu /clients cavabında yoxdur (20-insanlar.md «Müştəri» #2–#5).
  return (
    <>
      <div className="ins-filters">
        <Segmented label="Müştəri süzgəci" value={sub} onChange={(v) => { setSub(v); setLimit(PAGE); }}
          options={[{ value: 'all', label: 'Hamısı', count: counts.all }, { value: 'cb', label: 'Keşbek ≥70 AZN', count: counts.cb }, { value: 'pkg', label: 'Paketli', count: counts.pkg }]} />
        {tags.length > 0 && (
          <div className="ins-chips" role="group" aria-label="Teq süzgəci">
            {tags.map((t) => <button key={t.id} type="button" className="ins-fchip" aria-pressed={tag === t.id} onClick={() => { setTag(tag === t.id ? 0 : t.id); setLimit(PAGE); }}>{t.name}<span className="mono">{t.count}</span></button>)}
          </div>
        )}
      </div>
      <div className="ins-count">{shown.length < list.length ? `${shown.length} / ${list.length}` : list.length} müştəri{q.trim() && ` · «${q.trim()}»`}</div>
      {list.length === 0 ? (
        <EmptyState title={filtered || sub !== 'all' || tag ? 'Bu süzgəcə uyğun müştəri yoxdur' : 'Hələ müştəri yoxdur'} reason={q.trim() ? `«${q.trim()}» üzrə nəticə yoxdur. Axtarış ad və telefonda aparılır.` : undefined}
          action={(filtered || sub !== 'all' || tag) ? <Button size="sm" onClick={() => { setSub('all'); setTag(0); onReset(); }}>Süzgəci təmizlə</Button> : undefined} />
      ) : (
        <div className="ins-tbl" role="table" aria-label="Müştərilər">
          <div className="ins-tr ins-tr--h ins-tr--cli" role="row">
            <span role="columnheader">İnsan</span><span role="columnheader">Paket</span><span role="columnheader" className="ins-r">Keşbek</span><span role="columnheader" className="ins-r">Son çəkiliş</span>
          </div>
          {shown.map((c) => (
            <div key={c.id} className="ins-tr ins-tr--cli" role="row">
              <span className="ins-who" role="cell">
                <Avatar name={c.full_name} />
                <span className="ins-who__t">
                  <a className="ins-name" href={`#/insanlar/${c.id}`}>{c.full_name}</a>
                  <span className="ins-sub"><span className="mono">{phoneShown(c.phone) || 'telefon yoxdur'}</span> · <span className="ins-app"><i className={c.activated ? 'on' : ''} aria-hidden="true" />{appLine(c).replace('App: ', '')}</span></span>
                  {!!c.tags?.length && <span className="ins-tags">{c.tags.map((t) => <span key={t.id} className="chip chip--neutral">{t.name}</span>)}</span>}
                </span>
              </span>
              <span role="cell"><Pkg c={c} /></span>
              <span role="cell" className="ins-r mono">{c.cashback_balance > 0 ? formatMoney(c.cashback_balance) : <span className="ins-dim">—</span>}{c.cashback_balance >= MIN_USE && <em className="ins-ok"> hazırdır</em>}</span>
              <span role="cell" className="ins-r ins-dim2 mono">{lastShoot(c)}</span>
            </div>
          ))}
        </div>
      )}
      {shown.length < list.length && <div className="ins-more"><Button onClick={() => setLimit(limit + PAGE)}>Daha çox göstər</Button></div>}
    </>
  );
}
