import { useState } from 'react';
import { AdminShell, Button, Card, Icon, Sheet, formatHours, formatMoney } from '../../shared/ui';
import { Avatar, BackLink, Err } from '../components/common';
import { ClientCard } from '../components/ClientCard';
import { NewClientForm } from '../components/ClientPicker';
import { useLoad } from '../ctx';
import type { TagRow } from '../types';
import { appLine, bakuParts, bakuToday, dateShort } from '../format';
import { go, useDesktop } from '../router';
import type { ClientRow } from '../types';

const lastShoot = (c: ClientRow) => {
  if (!c.last_shoot_at) return '—';
  const d = bakuParts(c.last_shoot_at).date;
  return d === bakuToday() ? 'Bu gün' : dateShort(d);
};
const pkgLine = (c: ClientRow) => c.package ? `${c.package.title} · ${formatHours(c.package.minutes_left)}` : '';

// İxtisas + teq çipləri (siyahıda qısa).
function ProfLine({ c }: { c: ClientRow }) {
  if (!c.profession && !c.tags?.length) return null;
  return (
    <span className="chips" style={{ gap: 4, marginTop: 4 }}>
      {c.profession && <span className="t12 w7" style={{ color: '#f5d0fe' }}>{c.profession}</span>}
      {c.tags?.map((t) => <span key={t.id} className="tag">{t.name}</span>)}
    </span>
  );
}

// B6a/B6-desk: müştərilər. id verilibsə: mobil tam ekran kart, desktopda sağ panel.
export function Clients({ id }: { id?: number }) {
  const desktop = useDesktop();
  const { data, err, reload } = useLoad<ClientRow[]>('/clients');
  const [q, setQ] = useState('');
  const [add, setAdd] = useState(false);
  const [tag, setTag] = useState(0);
  const tags = useLoad<TagRow[]>('/tags').data ?? [];
  const list = (data ?? []).filter((c) => (c.full_name + ' ' + c.phone).toLowerCase().includes(q.trim().toLowerCase()) && (!tag || c.tags?.some((t) => t.id === tag)));

  if (id && !desktop) {
    return <AdminShell active="clients" title="Müştəri"><BackLink to="clients" label="Müştərilər" /><ClientCard id={id} onChanged={reload} /></AdminShell>;
  }
  return (
    <AdminShell
      active="clients"
      title="Müştərilər"
      actions={<Button variant="cream" small auto onClick={() => setAdd(true)}><Icon name="plus" size={18} /> Yeni müştəri</Button>}
      detail={id ? <ClientCard id={id} onChanged={reload} /> : undefined}
    >
      <label className="inp"><Icon name="users" size={18} /><input type="search" className="ax-bare" placeholder="Ad və ya telefon üzrə axtar" aria-label="Müştəri axtar" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {tags.length > 0 && (
        <div className="chips" role="group" aria-label="Teq süzgəci">
          <button type="button" className={`chip${!tag ? ' chip-on' : ''}`} aria-pressed={!tag} onClick={() => setTag(0)}>Hamısı</button>
          {tags.map((t) => <button key={t.id} type="button" className={`chip${tag === t.id ? ' chip-on' : ''}`} aria-pressed={tag === t.id} onClick={() => setTag(tag === t.id ? 0 : t.id)}>{t.name} · {t.count}</button>)}
        </div>
      )}
      <Err msg={err} />
      <span className="lbl">{list.length} müştəri</span>
      <Card>
        {desktop ? (
          <table className="tbl">
            <thead><tr><th>Ad</th><th>Paket</th><th>Keşbek</th><th>Son çəkiliş</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={c.id === id ? 'on' : undefined} aria-selected={c.id === id}>
                  <td><a href={`#/clients/${c.id}`} style={{ color: 'inherit', textDecoration: 'none', display: 'block', minHeight: 44 }}><span className="w8">{c.full_name}</span><br /><span className="t12 muted">{c.phone || 'telefon yoxdur'}{!c.activated && ' · qoşulmayıb'}</span><br /><span className="t12 soft">{appLine(c)}</span><ProfLine c={c} /></a></td>
                  <td>{c.package ? <span className="tag">{pkgLine(c)}</span> : <span className="muted">—</span>}</td>
                  <td className="w7">{formatMoney(c.cashback_balance)}</td>
                  <td className="w7">{lastShoot(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="list">
            {list.map((c) => (
              <a key={c.id} className="li" href={`#/clients/${c.id}`}>
                <Avatar name={c.full_name} />
                <span className="col grow" style={{ gap: 2 }}>
                  <span className="t15 w8">{c.full_name}</span>
                  <span className="t12 muted">{c.phone || 'telefon yoxdur'}</span>
                  <span className="t12 soft">{appLine(c)}</span>
                  <ProfLine c={c} />
                  <span className="t12 soft">{[pkgLine(c), c.cashback_balance > 0 && `keşbek ${formatMoney(c.cashback_balance)}`, c.last_shoot_at && `son çəkiliş ${lastShoot(c).toLowerCase()}`].filter(Boolean).join(' · ') || 'Hələ çəkiliş yoxdur'}</span>
                </span>
                {!c.activated && <span className="tag">qoşulmayıb</span>}
              </a>
            ))}
          </div>
        )}
        {data && !list.length && <p className="t13 muted">Müştəri tapılmadı.</p>}
      </Card>
      <Sheet open={add} onClose={() => setAdd(false)} title="Yeni müştəri">
        <NewClientForm onCreated={(c) => { setAdd(false); reload(); go(`clients/${c.id}`); }} />
      </Sheet>
    </AdminShell>
  );
}
