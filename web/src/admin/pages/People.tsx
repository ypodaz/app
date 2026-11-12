import { useEffect, useState, type CSSProperties } from 'react';
import { AdminShell, Sheet } from '../../shared/ui';
import { AIcon } from '../components/AIcon';
import { Av, AEmpty } from '../components/a3';
import { Err } from '../components/common';
import { useLoad } from '../ctx';
import { dateShort, bakuParts } from '../format';
import type { Person, PeopleList } from '../types';

const OUTCOMES: [string, string][] = [['', 'Hamısı'], ['client', 'Müştəri'], ['lead', 'Lead'], ['lost', 'İtirildi'], ['unknown', 'Naməlum']];
const SOURCES: [string, string][] = [['', 'Hamısı'], ['ig', 'IG'], ['wa', 'WA'], ['app', 'App']];
const outcomeLabel = (o: string) => OUTCOMES.find(([k]) => k === o)?.[1] ?? o;
const PAGE = 50;
const st = (i: number) => ({ '--i': i } as CSSProperties);
const day = (iso: string | null) => (iso ? dateShort(bakuParts(iso).date) : '—');

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return value ? <p className="c-mut"><b>{label}:</b> {value}</p> : null;
}

function Detail({ p }: { p: Person }) {
  return (
    <div className="a-rise">
      <h2>{p.display_name || 'Adsız'}</h2>
      <Row label="Nəticə" value={outcomeLabel(p.outcome)} />
      <Row label="Telefon" value={p.phone && `+${p.phone}`} />
      <Row label="Instagram" value={p.ig_username && `@${p.ig_username}`} />
      <Row label="Peşə" value={p.profession} />
      <Row label="İş yeri" value={p.workplace} />
      <Row label="Niyə çəkiliş istəyir" value={p.reason} />
      <Row label="Xidmət" value={p.service} />
      <Row label="İstək" value={p.need} />
      <Row label="Xülasə" value={p.summary} />
      <Row label="Mesajlardakı nömrələr" value={p.phones_found.map((x) => `+${x}`).join(', ')} />
      <Row label="Mənbə" value={p.sources.join(', ').toUpperCase()} />
      <Row label="Mesaj sayı" value={p.msg_count} />
      <Row label="İlk əlaqə" value={p.first_contact_at && day(p.first_contact_at)} />
      <Row label="Son əlaqə" value={p.last_contact_at && day(p.last_contact_at)} />
      <div className="a-acts">
        {p.wa_link && <a className="a-bp" href={p.wa_link} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
        {p.ig_link && <a className="a-bg" href={p.ig_link} target="_blank" rel="noreferrer">📷 Instagram</a>}
        {p.client_id && <a className="a-bg" href={`#/clients/${p.client_id}`}>Müştəri kartı</a>}
      </div>
    </div>
  );
}

// Müştəri bazası: IG, WhatsApp və app-dan birləşdirilmiş şəxslər (scripts/build_people.py).
export function People() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [outcome, setOutcome] = useState('');
  const [source, setSource] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Person | null>(null);
  useEffect(() => { const t = window.setTimeout(() => setDq(q.trim()), 300); return () => window.clearTimeout(t); }, [q]);
  useEffect(() => setLimit(PAGE), [dq, outcome, source]);
  const params = new URLSearchParams({ limit: String(limit) });
  if (dq) params.set('q', dq);
  if (outcome) params.set('outcome', outcome);
  if (source) params.set('source', source);
  const { data, err } = useLoad<PeopleList>(`/people?${params}`);
  const items = data?.items ?? [];

  const chips = (opts: [string, string][], cur: string, set: (v: string) => void, label: string) => (
    <div className="a3-chips" role="group" aria-label={label}>
      {opts.map(([k, l]) => <button key={k} type="button" className={`a3-chip${cur === k ? ' on' : ''}`} aria-pressed={cur === k} onClick={() => set(k)}><span>{l}</span></button>)}
    </div>
  );
  return (
    <AdminShell active="people" title="Müştəri bazası" sub="Instagram, WhatsApp və app-dan birləşdirilmiş şəxslər">
      <label className="a3-search a-rise" style={st(1)}>
        <AIcon name="search" size={18} />
        <input type="search" placeholder="Ad, telefon, peşə, xidmət üzrə axtar" aria-label="Axtar" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {chips(OUTCOMES, outcome, setOutcome, 'Nəticə süzgəci')}
      {chips(SOURCES, source, setSource, 'Mənbə süzgəci')}
      <Err msg={err} />
      <span className="a3-count">{data ? `${items.length} / ${data.total}` : '…'} şəxs</span>
      <ul className="a3-list">
        {items.map((p, i) => (
          <li key={p.id} className="a3-fade" style={st(i)}>
            <a href={`#/people`} onClick={(e) => { e.preventDefault(); setOpen(p); }}>
              <Av name={p.display_name || '?'} />
              <span className="a3-wm">
                <b>{p.display_name || 'Adsız'}</b>
                <span>{[p.phone && `+${p.phone}`, p.ig_username && `@${p.ig_username}`].filter(Boolean).join(' · ') || 'əlaqə yoxdur'}</span>
                <span className="a3-meta">{[outcomeLabel(p.outcome), p.service, p.profession].filter(Boolean).join(' · ')} · son əlaqə {day(p.last_contact_at)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {data && !items.length && <AEmpty icon="search" title="Şəxs tapılmadı." text="Axtarışı və ya süzgəcləri dəyişin." />}
      {data && items.length < data.total && <button type="button" className="a-bg" onClick={() => setLimit(limit + PAGE)}>Daha çox</button>}
      <Sheet open={!!open} onClose={() => setOpen(null)} title="Şəxs kartı">{open && <Detail p={open} />}</Sheet>
    </AdminShell>
  );
}
