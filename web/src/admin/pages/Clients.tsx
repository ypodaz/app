import { useState, type CSSProperties } from 'react';
import { AdminShell, Sheet, formatHours, formatMoney } from '../../shared/ui';
import { AIcon } from '../components/AIcon';
import { Av, AEmpty } from '../components/a3';
import { PageHead } from '../components/neon';
import { Err } from '../components/common';
import { ClientCard } from '../components/ClientCard';
import { NewClientForm } from '../components/ClientPicker';
import { useLoad } from '../ctx';
import type { TagRow } from '../types';
import { appLine, bakuParts, bakuToday, dateShort } from '../format';
import { go, useDesktop, useWide } from '../router';
import type { ClientRow } from '../types';

const lastShoot = (c: ClientRow) => {
  if (!c.last_shoot_at) return '—';
  const d = bakuParts(c.last_shoot_at).date;
  return d === bakuToday() ? 'Bu gün' : dateShort(d);
};
// «6,5 / 10 saat»: qalan / ümumi (ikisi də tam saat addımındadırsa), əks halda yalnız qalan.
const pkgLine = (c: ClientRow) => {
  if (!c.package) return '';
  const { minutes_left: l, minutes_total: t } = c.package;
  const left = formatHours(l);
  return t && left.endsWith(' saat') ? `${left.slice(0, -5)} / ${formatHours(t)}` : left;
};
const st = (i: number) => ({ '--i': i } as CSSProperties);

// Teq çipləri (siyahıda qısa).
function Tags({ c }: { c: ClientRow }) {
  if (!c.tags?.length) return null;
  return <span className="a3-tags">{c.tags.map((t) => <span key={t.id} className="a3-tag">{t.name}</span>)}</span>;
}

// App vəziyyəti: nöqtə (yaşıl = qoşulub) + mətn.
const AppLine = ({ c }: { c: ClientRow }) => <span className="a3-app"><i className={c.activated ? 'on' : ''} aria-hidden="true" /><span>{appLine(c)}</span></span>;

// B6a/B6-desk: müştərilər. id verilibsə: mobil tam ekran kart, desktopda sağ panel.
export function Clients({ id }: { id?: number }) {
  const desktop = useDesktop();
  const wide = useWide();
  const { data, err, reload } = useLoad<ClientRow[]>('/clients');
  const [q, setQ] = useState('');
  const [add, setAdd] = useState(false);
  const [tag, setTag] = useState(0);
  const tags = useLoad<TagRow[]>('/tags').data ?? [];
  const list = (data ?? []).filter((c) => (c.full_name + ' ' + c.phone).toLowerCase().includes(q.trim().toLowerCase()) && (!tag || c.tags?.some((t) => t.id === tag)));
  const filtered = !!q.trim() || !!tag;

  if (id && !desktop) {
    return <AdminShell active="clients" title="Müştəri" bare full><PageHead back="clients" title="Müştəri" label="Müştərilər" /><ClientCard id={id} onChanged={reload} /></AdminShell>;
  }
  return (
    <AdminShell
      active="clients"
      title="Müştərilər"
      sub={wide ? 'Müştəri bazası, paketlər və keşbek' : undefined}
      actions={<button type="button" className="a-bp" onClick={() => setAdd(true)}><AIcon name="plus" size={18} /> Yeni müştəri</button>}
      detail={id ? <ClientCard id={id} onChanged={reload} /> : undefined}
    >
      <label className="a3-search a-rise" style={st(1)}>
        <AIcon name="search" size={18} />
        <input type="search" placeholder="Ad və ya telefon üzrə axtar" aria-label="Müştəri axtar" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button type="button" className="a3-x" aria-label="Təmizlə" onClick={() => setQ('')}><AIcon name="x" size={16} /></button>}
      </label>
      {tags.length > 0 && (
        <div className="a3-chips a-rise" style={st(2)} role="group" aria-label="Teq süzgəci">
          <button type="button" className={`a3-chip${!tag ? ' on' : ''}`} aria-pressed={!tag} onClick={() => setTag(0)}><span>Hamısı · {data?.length ?? 0}</span></button>
          {tags.map((t) => <button key={t.id} type="button" className={`a3-chip${tag === t.id ? ' on' : ''}`} aria-pressed={tag === t.id} onClick={() => setTag(tag === t.id ? 0 : t.id)}><span>{t.name} · {t.count}</span></button>)}
        </div>
      )}
      <Err msg={err} />
      <span className="a3-count">{filtered && data ? `${list.length} / ${data.length}` : list.length} müştəri</span>
      {desktop ? (
        <div className="a-g a3-tw a-rise" style={st(3)}>
          <table className="a3-tbl">
            <thead><tr><th>Ad</th><th>Paket</th><th>Keşbek</th><th>Son çəkiliş</th></tr></thead>
            <tbody>
              {list.map((c, i) => (
                <tr key={c.id} className={`a3-fade${c.id === id ? ' on' : ''}`} style={st(i)} aria-selected={c.id === id}>
                  <td>
                    <a className="a3-who" href={`#/clients/${c.id}`}>
                      <Av name={c.full_name} />
                      <span className="a3-wm"><b>{c.full_name}</b><span>{c.phone || 'telefon yoxdur'}</span><AppLine c={c} /><Tags c={c} /></span>
                    </a>
                  </td>
                  <td>{c.package ? pkgLine(c) : <span className="a3-dim">—</span>}</td>
                  <td className="a3-kb">{formatMoney(c.cashback_balance)}</td>
                  <td className="a3-dim2">{lastShoot(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !list.length && (
            <AEmpty icon="search" title="Müştəri tapılmadı." text={q.trim() ? `«${q.trim()}» üzrə nəticə yoxdur. Başqa ad və ya telefon nömrəsi yoxlayın.` : 'Bu süzgəcə uyğun müştəri yoxdur.'}
              action={<button type="button" className="a-bg" onClick={() => { setQ(''); setTag(0); }}>Axtarışı təmizlə</button>} />
          )}
        </div>
      ) : (
        <>
          <ul className="a3-list">
            {list.map((c, i) => (
              <li key={c.id} className="a3-fade" style={st(i)}>
                <a href={`#/clients/${c.id}`}>
                  <Av name={c.full_name} />
                  <span className="a3-wm">
                    <b>{c.full_name}</b>
                    <span>{c.phone || 'telefon yoxdur'}</span>
                    <AppLine c={c} />
                    <Tags c={c} />
                    <span className="a3-meta">{c.package ? `Paket · ${pkgLine(c)}` : 'Paket yoxdur'} · keşbek {formatMoney(c.cashback_balance)} · son çəkiliş {lastShoot(c).toLowerCase()}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {data && !list.length && (
            <AEmpty icon="search" title="Müştəri tapılmadı." text={q.trim() ? `«${q.trim()}» üzrə nəticə yoxdur. Başqa ad və ya telefon nömrəsi yoxlayın.` : 'Bu süzgəcə uyğun müştəri yoxdur.'}
              action={<button type="button" className="a-bg" onClick={() => { setQ(''); setTag(0); }}>Axtarışı təmizlə</button>} />
          )}
        </>
      )}
      <Sheet open={add} onClose={() => setAdd(false)} title="Yeni müştəri">
        <NewClientForm onCreated={(c) => { setAdd(false); reload(); go(`clients/${c.id}`); }} />
      </Sheet>
    </AdminShell>
  );
}
