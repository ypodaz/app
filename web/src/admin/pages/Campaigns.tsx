import { useState } from 'react';
import { AdminShell, Card, Segmented, Sheet } from '../../shared/ui';
import { Err } from '../components/common';
import { useLoad } from '../ctx';
import { bakuParts, dateShort } from '../format';
import type { Campaign, CampaignDetail, CampaignKind } from '../types';
import { Automations } from './Automations';
import { CampaignCompose } from './CampaignCompose';

type TabKey = 'new' | 'hist' | 'auto';
const TABS: { value: TabKey; label: string }[] = [{ value: 'new', label: 'Yeni' }, { value: 'hist', label: 'Tarixçə' }, { value: 'auto', label: 'Avtomatik' }];
const KIND: Record<CampaignKind, string> = { manual: 'Əl ilə', winback: 'Geri qaytarma', cashback: 'Keşbek xatırlatma', birthday: 'Ad günü', review: 'Rəy sorğusu' };
const when = (iso: string) => `${dateShort(bakuParts(iso).date)}, ${bakuParts(iso).time}`;

// Kampaniyalar: tərtib, tarixçə, avtomatik bildirişlər.
export function Campaigns({ tab: first = 'new' }: { tab?: TabKey }) {
  const [tab, setTab] = useState<TabKey>(first);
  const hist = useLoad<Campaign[]>('/campaigns');
  return (
    <AdminShell active="campaigns" title="Kampaniyalar" hrefFor={(t) => `#/${t}`}>
      <Segmented<TabKey> label="Bölmə" options={TABS} value={tab} onChange={(t) => { setTab(t); if (t === 'hist') hist.reload(); }} />
      {tab === 'new' && <CampaignCompose onSent={() => { hist.reload(); }} onHistory={() => setTab('hist')} />}
      {tab === 'hist' && <History list={hist.data} err={hist.err} />}
      {tab === 'auto' && <Automations />}
    </AdminShell>
  );
}

function History({ list, err }: { list: Campaign[] | null; err: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <Err msg={err} />
      {!list && !err && <div className="sk" style={{ height: 120, borderRadius: 24 }} aria-busy="true" />}
      {list && !list.length && <p className="t13 muted">Hələ kampaniya göndərilməyib.</p>}
      {list && list.length > 0 && (
        <Card>
          <div className="list">
            {list.map((c) => (
              <button key={c.id} type="button" className="li ax-li-btn" onClick={() => setOpen(c.id)}>
                <span className="col grow" style={{ gap: 4 }}>
                  <span className="row wrap" style={{ gap: 6 }}>
                    <span className="t15 w8" style={{ overflowWrap: 'anywhere' }}>{c.title}</span>
                    {c.kind !== 'manual' && <span className="tag tag-own">Avtomatik · {KIND[c.kind]}</span>}
                  </span>
                  <span className="t12 muted">{when(c.created_at)}</span>
                  <span className="t12 soft">{c.recipients} alıcı · {c.opened} açdı · 14 gündə {c.booked_14d} yazıldı</span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}
      <Detail id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Detail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: c, err } = useLoad<CampaignDetail>(id ? `/campaigns/${id}` : null);
  const ok = c && c.id === id;
  return (
    <Sheet open={id !== null} onClose={onClose} title={ok ? c.title : 'Kampaniya'}>
      <Err msg={err} />
      {!ok && !err && <div className="sk" style={{ height: 120, borderRadius: 24 }} aria-busy="true" />}
      {ok && (
        <>
          <p className="t14 lh" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{c.body}</p>
          {c.url && <a className="t13" href={c.url} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>{c.url}</a>}
          <span className="t12 muted">{when(c.created_at)}{c.created_by ? ` · ${c.created_by}` : ''} · {c.kind === 'manual' ? 'əl ilə' : `avtomatik (${KIND[c.kind]})`}</span>
          <div className="g3">
            <div className="col" style={{ gap: 2 }}><span className="num-s">{c.recipients}</span><span className="t12 soft">Alıcı</span></div>
            <div className="col" style={{ gap: 2 }}><span className="num-s">{c.opened}</span><span className="t12 soft">Açdı</span></div>
            <div className="col" style={{ gap: 2 }}><span className="num-s">{c.booked_14d}</span><span className="t12 soft">14 gündə yazıldı</span></div>
          </div>
          <span className="lbl">Alıcılar</span>
          <div className="list ax-pick">
            {c.list.map((r) => (
              <a key={r.id} className="li" href={`#/clients/${r.id}`}>
                <span className="t14 w7 grow">{r.full_name}</span>
                <span className={`t12 ${r.opened_at ? 'neon' : 'muted'}`}>{r.opened_at ? `açıb · ${when(r.opened_at)}` : 'açmayıb'}</span>
              </a>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
