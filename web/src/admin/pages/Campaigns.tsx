import { useEffect, useState } from 'react';
import { AdminShell } from '../../shared/ui';
import { AIcon } from '../components/AIcon';
import { stag } from '../components/a3';
import { ASeg } from '../components/neon';
import { Err } from '../components/common';
import { useLoad } from '../ctx';
import { bakuParts, dateShort } from '../format';
import type { Campaign, CampaignDetail, CampaignKind } from '../types';
import { Automations } from './Automations';
import { CampaignCompose } from './CampaignCompose';

type TabKey = 'new' | 'hist' | 'auto';
const TABS: { value: TabKey; label: string }[] = [{ value: 'new', label: 'Yeni' }, { value: 'hist', label: 'Tarixçə' }, { value: 'auto', label: 'Avtomatik' }];
const SUB: Record<TabKey, string | undefined> = { new: 'Müştərilərə app bildirişi və təklif göndərin', hist: 'Göndərilmiş kampaniyalar və nəticələri', auto: undefined };
const KIND: Record<CampaignKind, string> = { manual: 'Əl ilə', winback: 'Geri qaytarma', cashback: 'Keşbek xatırlatma', birthday: 'Ad günü', review: 'Rəy sorğusu' };
const when = (iso: string) => `${dateShort(bakuParts(iso).date)}, ${bakuParts(iso).time}`;
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

// Kampaniyalar: tərtib, tarixçə, avtomatik bildirişlər.
export function Campaigns({ tab: first = 'new' }: { tab?: TabKey }) {
  const [tab, setTab] = useState<TabKey>(first);
  const hist = useLoad<Campaign[]>('/campaigns');
  return (
    <AdminShell
      active="campaigns"
      title="Kampaniyalar"
      sub={SUB[tab]}
      hrefFor={(t) => `#/${t}`}
      actions={<ASeg<TabKey> label="Bölmə" pill className="a3-tabs" options={TABS} value={tab} onChange={(t) => { setTab(t); if (t === 'hist') hist.reload(); }} />}
    >
      {tab === 'new' && <CampaignCompose onSent={() => { hist.reload(); }} onHistory={() => setTab('hist')} />}
      {tab === 'hist' && <History list={hist.data} err={hist.err} onNew={() => setTab('new')} />}
      {tab === 'auto' && <Automations />}
    </AdminShell>
  );
}

function History({ list, err, onNew }: { list: Campaign[] | null; err: string; onNew: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <Err msg={err} />
      {!list && !err && <div className="a-sk" style={{ height: 120, borderRadius: 22 }} aria-busy="true" />}
      {list && !list.length && (
        <div className="a3-empty">
          <span className="a3-empty-i a3-empty-acc"><AIcon name="mega" size={20} /></span>
          <h2>Hələ kampaniya göndərilməyib.</h2>
          <button type="button" className="a-bp" onClick={onNew}>Yeni kampaniya</button>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="a3-hist">
          {list.map((c, i) => {
            const p = pct(c.opened, c.recipients);
            return (
              <button key={c.id} type="button" className={`a-g a3-hc a-rise${open === c.id ? ' on' : ''}`} style={stag(i)} onClick={() => setOpen(c.id)}>
                <span className="a3-hct">
                  <b>{c.title}</b>
                  <span className="a3-hk">{c.kind === 'manual' ? 'Əl ilə' : `Avtomatik · ${KIND[c.kind]}`}</span>
                </span>
                <span className="a3-hw">{when(c.created_at)}</span>
                <span className="a3-hs">{c.recipients} alıcı · {c.opened} açdı · 14 gündə {c.booked_14d} yazıldı</span>
                <span className="a3-hb"><span className="a3-prog"><span style={{ width: `${p}%`, animationDelay: `${i * 40}ms` }} /></span><em>{p}% açdı</em></span>
              </button>
            );
          })}
        </div>
      )}
      <Detail id={open} onClose={() => setOpen(null)} />
    </>
  );
}

// Detal: telefonda tam ekran səhifə, planşet/kompüterdə sağ panel (kök marşrut dəyişmir).
function Detail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: c, err } = useLoad<CampaignDetail>(id ? `/campaigns/${id}` : null);
  const ok = c && c.id === id;
  useEffect(() => {
    if (id === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, onClose]);
  if (id === null) return null;
  return (
    <>
      <div className="a3-cscrim" onClick={onClose} aria-hidden="true" />
      <aside className="a3-cdet" aria-label="Kampaniya detalı">
        <div className="a3-cdh">
          <button type="button" className="a-bg a-bg-i a3-cdb" aria-label="Geri" onClick={onClose}><AIcon name="chevl" size={20} /></button>
          <h2><span className="a3-hm1">Kampaniya</span><span className="a3-hd1">{ok ? c.title : 'Kampaniya'}</span></h2>
          <button type="button" className="a-bg a-bg-i a3-cdx" aria-label="Paneli bağla" onClick={onClose}><AIcon name="x" size={18} /></button>
        </div>
        <Err msg={err} />
        {!ok && !err && <div className="a-sk" style={{ height: 120, borderRadius: 22 }} aria-busy="true" />}
        {ok && (
          <div className="a3-cdc" key={c.id}>
            <h3 className="a3-cdt">{c.title}</h3>
            <p className="a3-cdp">{c.body}</p>
            {c.url && <a className="a3-cdl" href={c.url} target="_blank" rel="noopener noreferrer">{c.url.replace(/^https?:\/\//, '')} <AIcon name="ext" size={14} /></a>}
            <span className="a3-cdm">{when(c.created_at)}{c.created_by ? ` · ${c.created_by}` : ''} · {c.kind === 'manual' ? 'Əl ilə' : `Avtomatik · ${KIND[c.kind]}`}</span>
            <div className="a3-tiles">
              <div className="a3-tile" style={stag(0)}><b>{c.recipients}</b><span>Alıcı</span></div>
              <div className="a3-tile acc" style={stag(1)}><b>{c.opened}</b><span>Açdı</span></div>
              <div className="a3-tile" style={stag(2)}><b>{c.booked_14d}</b><span>14 gündə yazıldı</span></div>
            </div>
            <h3 className="a3-cdh3">Alıcılar</h3>
            <div className="a3-rcp">
              {c.list.map((r) => (
                <a key={r.id} className="a3-rc" href={`#/clients/${r.id}`}>
                  <span>{r.full_name}</span>
                  <em className={r.opened_at ? 'on' : ''}>{r.opened_at ? `açıb · ${when(r.opened_at)}` : 'açmayıb'}</em>
                </a>
              ))}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
