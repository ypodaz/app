import { useEffect, useState } from 'react';
import { useLoad } from '../../../ctx';
import { bakuParts, dateShort } from '../../../format';
import { go } from '../../../router';
import type { PeopleList, Person } from '../../../types';
import { Avatar, Button, Dialog, EmptyState, ErrorBox, LoadingRows } from '../../ui';

const OUTCOMES: [string, string][] = [['', 'Hamısı'], ['client', 'Müştəri'], ['lead', 'Lead'], ['lost', 'İtirildi'], ['unknown', 'Naməlum']];
const SOURCES: [string, string][] = [['', 'Hamısı'], ['ig', 'IG'], ['wa', 'WA'], ['app', 'App']];
const outcomeLabel = (o: string) => OUTCOMES.find(([k]) => k === o)?.[1] ?? o;
const PAGE = 50;
const day = (iso: string | null) => (iso ? dateShort(bakuParts(iso).date) : '—');

function Info({ label, value }: { label: string; value?: string | number | null }) {
  return value ? <div className="ins-kv"><span>{label}</span><span>{value}</span></div> : null;
}

/** Hamısı: IG, WhatsApp və app-dan birləşdirilmiş şəxslər (GET /people, scripts/build_people.py). */
export function PeopleView({ q, onReset }: { q: string; onReset: () => void }) {
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
    <div className="ins-chips" role="group" aria-label={label}>
      <span className="ins-chips__l">{label}</span>
      {opts.map(([k, l]) => <button key={k} type="button" className="ins-fchip" aria-pressed={cur === k} onClick={() => set(k)}>{l}</button>)}
    </div>
  );
  const pick = (p: Person) => (p.client_id ? go(`insanlar/${p.client_id}`) : setOpen(p));
  return (
    <>
      <div className="ins-filters ins-filters--col">{chips(OUTCOMES, outcome, setOutcome, 'Nəticə')}{chips(SOURCES, source, setSource, 'Mənbə')}</div>
      {/* TODO [API] Etiket / Kanal / Son əlaqə süzgəcləri, çoxlu seçim, «Bot söhbəti» çipi və «Bazadan çıxar» /people üçün endpoint-i yoxdur (20-insanlar.md «Hamısı»). */}
      <div className="ins-count">{data ? `${items.length} / ${data.total}` : '…'} kontakt · son əlaqəyə görə</div>
      {err && <ErrorBox title="İnsanlar yüklənmədi · internet bağlantısını yoxlayın" detail={err} />}
      {!data && !err && <LoadingRows rows={6} />}
      {data && items.length === 0 && <EmptyState title={dq ? `«${dq}» tapılmadı` : 'Kontakt tapılmadı'} reason="Axtarış ad, telefon, Instagram, peşə və xidmətdə aparılır." action={<Button size="sm" onClick={() => { setOutcome(''); setSource(''); onReset(); }}>Süzgəci təmizlə</Button>} />}
      {items.length > 0 && (
        <ul className="ins-plist">
          {items.map((p) => (
            <li key={p.id}>
              <button type="button" className="ins-prow" onClick={() => pick(p)}>
                <Avatar name={p.display_name || '?'} />
                <span className="ins-who__t">
                  <span className="ins-name">{p.display_name || 'Adsız'}</span>
                  <span className="ins-sub">{[p.phone && `+${p.phone}`, p.ig_username && `@${p.ig_username}`].filter(Boolean).join(' · ') || 'əlaqə yoxdur'}</span>
                  <span className="ins-sub">{[outcomeLabel(p.outcome), p.service, p.profession].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="mono ins-dim2 ins-pdate">{day(p.last_contact_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && items.length < data.total && <div className="ins-more"><Button onClick={() => setLimit(limit + PAGE)}>Daha çox yüklə</Button></div>}
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.display_name || 'Adsız'} subtitle={open && outcomeLabel(open.outcome)}
        footer={open && <>
          {open.wa_link && <a className="btn btn--secondary btn--md" href={open.wa_link} target="_blank" rel="noreferrer">WhatsApp</a>}
          {open.ig_link && <a className="btn btn--secondary btn--md" href={open.ig_link} target="_blank" rel="noreferrer">Instagram</a>}
          <Button onClick={() => setOpen(null)}>Bağla</Button>
        </>}>
        {open && (
          <div className="ins-kvs">
            <Info label="Telefon" value={open.phone && `+${open.phone}`} /><Info label="Instagram" value={open.ig_username && `@${open.ig_username}`} />
            <Info label="Peşə" value={open.profession} /><Info label="İş yeri" value={open.workplace} /><Info label="Niyə çəkiliş istəyir" value={open.reason} />
            <Info label="Xidmət" value={open.service} /><Info label="İstək" value={open.need} /><Info label="Xülasə" value={open.summary} />
            <Info label="Mesajlardakı nömrələr" value={open.phones_found.map((x) => `+${x}`).join(', ')} />
            <Info label="Mənbə" value={open.sources.join(', ').toUpperCase()} /><Info label="Mesaj sayı" value={open.msg_count} />
            <Info label="İlk əlaqə" value={open.first_contact_at && day(open.first_contact_at)} /><Info label="Son əlaqə" value={open.last_contact_at && day(open.last_contact_at)} />
          </div>
        )}
      </Dialog>
    </>
  );
}
