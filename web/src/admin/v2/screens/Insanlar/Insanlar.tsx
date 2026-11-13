import { useMemo, useState } from 'react';
import { useLoad } from '../../../ctx';
import { go, useMedia } from '../../../router';
import type { ClientRow, TagRow } from '../../../types';
import { useShellData } from '../../data/ShellData';
import { PageHeader } from '../../shell/PageHeader';
import { Button, ErrorBox, LoadingRows, Segmented, SegmentedLinks, V2Icon, useAfter, useOnline } from '../../ui';
import { ClientsView } from './ClientsView';
import { LostDialog, NewContactDialog, RemindDialog } from './Dialogs';
import { Board, LeadEmpty, LeadTable } from './LeadViews';
import { PeopleView } from './PeopleView';
import { isConverted, remindDue, useLeads, type Lead } from './data';
import './insanlar.css';

export type InsanTab = 'lead' | 'musteri' | 'hamisi';
type LeadFilter = 'aktiv' | 'xat' | 'itirildi' | 'cevrildi' | 'hamisi';

const match = (l: Lead, q: string) => {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const digits = s.replace(/\D/g, '');
  return `${l.name} ${l.service ?? ''} ${l.notes}`.toLowerCase().includes(s) || (digits.length >= 3 && (l.phone ?? '').includes(digits));
};

function LeadSection({ q, view, onReset }: { q: string; view: 'cedvel' | 'lovhe'; onReset: () => void }) {
  const L = useLeads();
  const online = useOnline();
  const wide = useMedia('(min-width:768px)');
  const showSkeleton = useAfter();
  const [filter, setFilter] = useState<LeadFilter>('aktiv');
  const [lost, setLost] = useState<Lead | null>(null);
  const [rem, setRem] = useState<Lead | null>(null);

  const searched = useMemo(() => L.leads.filter((l) => match(l, q)), [L.leads, q]);
  const counts = useMemo(() => ({
    aktiv: L.leads.filter((l) => !isConverted(l) && l.stage !== 'itirildi').length,
    xat: L.leads.filter((l) => l.remind_at && !isConverted(l)).length,
    itirildi: L.leads.filter((l) => l.stage === 'itirildi').length,
    cevrildi: L.leads.filter(isConverted).length,
    hamisi: L.leads.length,
  }), [L.leads]);
  const rows = useMemo(() => searched.filter((l) => {
    switch (filter) {
      case 'aktiv': return !isConverted(l) && l.stage !== 'itirildi';
      case 'xat': return !!l.remind_at && !isConverted(l);
      case 'itirildi': return l.stage === 'itirildi';
      case 'cevrildi': return isConverted(l);
      default: return true;
    }
  }), [searched, filter]);
  const board = view === 'lovhe' && wide;
  const dueN = L.leads.filter((l) => remindDue(l) && !isConverted(l) && l.stage !== 'itirildi').length;

  const onMove = (l: Lead, to: Lead['stage']) => { if (to === 'itirildi') setLost(l); else void L.move(l, to); };

  return (
    <>
      {dueN > 0 && <p className="ins-banner">🔔 <b className="mono">{dueN}</b> lead-in xatırlatma vaxtı gəlib</p>}
      {L.error && <ErrorBox title="Lead-lər yüklənmədi · internet bağlantısını yoxlayın" detail={L.error} onRetry={L.reload} />}
      {!L.loaded && !L.error && (showSkeleton ? <LoadingRows rows={6} /> : null)}
      {L.loaded && (
        <>
          {!board && (
            <div className="ins-filters">
              <Segmented label="Lead süzgəci" value={filter} onChange={setFilter} options={[
                { value: 'aktiv', label: 'Aktiv', count: counts.aktiv }, { value: 'xat', label: '🔔 Xatırlatma', count: counts.xat },
                { value: 'itirildi', label: 'İtirildi', count: counts.itirildi }, { value: 'cevrildi', label: 'Çəkilişə çevrildi', count: counts.cevrildi }, { value: 'hamisi', label: 'Hamısı', count: counts.hamisi },
              ]} />
            </div>
          )}
          {board ? (
            L.leads.length === 0 ? <LeadEmpty filtered={false} onReset={onReset} /> : (
              <>
                <p className="ins-legend">4 mərhələ · kartı sürüşdürüb mərhələni dəyişin · İtirildi-yə keçirəndə səbəb soruşulur · 🔔 xatırlatması olan lead gözləyir, itirilmiş sayılmır</p>
                <Board leads={searched} online={online} onMove={onMove} />
              </>
            )
          ) : (
            <>
              <div className="ins-count">{rows.length} lead</div>
              {rows.length === 0 ? <LeadEmpty filtered={L.leads.length > 0} onReset={() => { setFilter('hamisi'); onReset(); }} /> : (
                <LeadTable leads={rows} online={online} onRemind={setRem} onLost={setLost} />
              )}
            </>
          )}
        </>
      )}
      <LostDialog lead={lost} onClose={() => setLost(null)} onConfirm={async (reason, text) => { if (lost && await L.move(lost, 'itirildi', { reason, text })) setLost(null); }} />
      <RemindDialog lead={rem} onClose={() => setRem(null)} onSave={(at, note) => L.remind(rem!, at, note)} />
    </>
  );
}

/** İnsanlar (20) + Lövhə (21). Route: /insanlar?tab=lead|musteri|hamisi&gorunus=cedvel|lovhe (köhnə /leads, /clients, /people da buraya gəlir). */
export function Insanlar({ tab, view }: { tab: InsanTab; view: 'cedvel' | 'lovhe' }) {
  const clients = useLoad<ClientRow[]>('/clients');
  const tags = useLoad<TagRow[]>('/tags');
  const [q, setQ] = useState('');
  const [add, setAdd] = useState(false);
  const online = useOnline();
  const showSkeleton = useAfter();
  const rows = clients.data ?? [];
  const cq = q.trim().toLowerCase();
  const cdigits = cq.replace(/\D/g, '');
  const cList = rows.filter((c) => !cq || c.full_name.toLowerCase().includes(cq) || (cdigits.length >= 3 && c.phone.replace(/\D/g, '').includes(cdigits)));
  const { leadCount } = useShellData();

  const tabs = [
    { value: 'lead', label: 'Lead', href: '#/insanlar?tab=lead', count: leadCount ?? undefined },
    { value: 'musteri', label: 'Müştəri', href: '#/insanlar?tab=musteri', count: clients.data ? rows.length : undefined },
    { value: 'hamisi', label: 'Hamısı', href: '#/insanlar?tab=hamisi' },
  ];
  // TODO [API] «Addım gözləyən» və «Dostlar və şəxsi» tabları: insan üçün server tərəfində hesablanmış «növbəti addım» və dost/şəxsi bayrağı endpoint-i yoxdur (20-insanlar.md).
  const placeholder = tab === 'hamisi' ? 'Ad, telefon, peşə, xidmət üzrə axtar' : 'Ad və ya telefon üzrə axtar';

  return (
    <>
      <PageHeader title="İnsanlar" sub={tab === 'musteri' && clients.data ? <><b className="mono">{rows.length}</b> müştəri</> : 'Kim hansı mərhələdədir və kim gözləyir'} newShoot={false} search={false}
        actions={<Button size="lg" variant="primary" icon={<V2Icon name="plus" />} disabled={!online} onClick={() => setAdd(true)}>Yeni kontakt</Button>} />
      <div className="ins-toolbar">
        <SegmentedLinks label="İnsanlar" value={tab} options={tabs} />
        {tab === 'lead' && (
          <span className="ins-view">
            <SegmentedLinks label="Görünüş" value={view} options={[
              { value: 'cedvel', label: 'Cədvəl', href: '#/insanlar?tab=lead&gorunus=cedvel' }, { value: 'lovhe', label: 'Lövhə', href: '#/insanlar?tab=lead&gorunus=lovhe' },
            ]} />
          </span>
        )}
        <label className="ins-search">
          <V2Icon name="search" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Siyahıda axtar" />
          {q && <button type="button" className="ins-search__x" aria-label="Təmizlə" onClick={() => setQ('')}><V2Icon name="x" /></button>}
        </label>
      </div>
      <section className="ins-body" aria-label="İnsanlar siyahısı">
        {tab === 'lead' && <LeadSection q={q} view={view} onReset={() => setQ('')} />}
        {tab === 'musteri' && (
          <>
            {clients.err && <ErrorBox title="Müştərilər yüklənmədi · internet bağlantısını yoxlayın" detail={clients.err} onRetry={clients.reload} />}
            {!clients.data && !clients.err && (showSkeleton ? <LoadingRows rows={6} /> : null)}
            {clients.data && (
              <ClientsView rows={cList} tags={tags.data ?? []} q={q} filtered={!!cq} onReset={() => setQ('')} />
            )}
          </>
        )}
        {tab === 'hamisi' && <PeopleView q={q} onReset={() => setQ('')} />}
      </section>
      <NewContactDialog open={add} initialName={/\d{3}/.test(q) ? '' : q.trim()} initialPhone={/\d{3}/.test(q) ? q.trim() : ''} onClose={() => setAdd(false)} onCreated={(c) => { setAdd(false); clients.reload(); go(`insanlar/${c.id}`); }} />
    </>
  );
}

/** Route köməkçisi: ?tab=lead|musteri|hamisi (bilinməyən / «gozleyen» / «dost» → lead), ?gorunus=cedvel|lovhe. */
export function InsanlarRoute({ query, tab }: { query: URLSearchParams; tab?: InsanTab }) {
  const t = tab ?? (query.get('tab') === 'musteri' ? 'musteri' : query.get('tab') === 'hamisi' ? 'hamisi' : 'lead');
  return <Insanlar tab={t} view={query.get('gorunus') === 'lovhe' ? 'lovhe' : 'cedvel'} />;
}
