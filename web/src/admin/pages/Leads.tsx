import { useMemo, useState } from 'react';
import { AdminShell } from '../../shared/ui';
import { AEmpty } from '../components/a3';
import { Err } from '../components/common';
import { STAGES, serviceLabel, whenShort, type Lead, type Stage } from '../components/crm';
import { useAction, useAuth, useLoad } from '../ctx';
import { bakuParts, bakuToday, weekStart } from '../format';
import { go, useDesktop } from '../router';

const CONVERTED: Stage[] = ['tesdiq', 'geldi'];

export function Leads() {
  const desk = useDesktop();
  const { call } = useAuth();
  const list = useLoad<Lead[]>('/leads');
  const act = useAction();
  const [tab, setTab] = useState<Stage>('yeni');
  const leads = list.data ?? [];

  const stats = useMemo(() => {
    const ws = weekStart(bakuToday());
    const week = leads.filter((l) => bakuParts(l.created_at).date >= ws).length;
    const won = leads.filter((l) => CONVERTED.includes(l.stage)).length;
    return { week, pct: leads.length ? Math.round((won / leads.length) * 100) : 0 };
  }, [leads]);

  async function move(l: Lead, stage: Stage) {
    const r = await act.run(() => call(`/leads/${l.id}`, { method: 'PATCH', body: { stage } }));
    if (r) list.reload();
  }
  const card = (l: Lead) => (
    <article key={l.id} className="c-lc">
      <button type="button" className="c-lcm" disabled={!l.conversation_id} onClick={() => l.conversation_id && go(`inbox/${l.conversation_id}`)}>
        <b>{l.name || (l.phone ? `+${l.phone}` : 'Naməlum')}</b>
        <span>{[serviceLabel(l.service), l.preferred_date].filter(Boolean).join(' · ') || 'Xidmət bəlli deyil'}</span>
        <em>Son aktivlik: {whenShort(l.updated_at)}</em>
      </button>
      <select className="inp c-lcs" aria-label="Mərhələ" value={l.stage} disabled={act.busy} onChange={(e) => move(l, e.target.value as Stage)}>
        {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </article>
  );
  const col = (s: { key: Stage; label: string }) => {
    const items = leads.filter((l) => l.stage === s.key);
    return { ...s, items };
  };

  return (
    <AdminShell active="leads" title="Leadlər" sub="WhatsApp-dan gələn potensial müştərilər">
      <div className="c-stats">
        <div className="c-stat"><b>{stats.week}</b><span>bu həftə yeni lead</span></div>
        <div className="c-stat"><b>{stats.pct}%</b><span>təsdiqə çevrilib</span></div>
      </div>
      <Err msg={list.err || act.err} />
      {!list.data && !list.err && <div className="a-sk" style={{ height: 160, borderRadius: 22 }} aria-busy="true" />}
      {list.data && !leads.length && <AEmpty icon="users" title="Hələ lead yoxdur" text="Bot müştərinin sorğusunu görəndə lead burada görünəcək." />}
      {list.data && leads.length > 0 && (desk ? (
        <div className="c-kan">
          {STAGES.map(col).map((c) => (
            <section key={c.key} className={`c-kc${c.key === 'itirildi' ? ' lost' : ''}`} aria-label={c.label}>
              <h2>{c.label}<span>{c.items.length}</span></h2>
              {c.items.map(card)}
              {!c.items.length && <p className="c-mut">Boşdur</p>}
            </section>
          ))}
        </div>
      ) : (
        <>
          <div className="c-tabs" role="tablist" aria-label="Mərhələ">
            {STAGES.map(col).map((c) => (
              <button key={c.key} type="button" role="tab" aria-selected={tab === c.key} className={tab === c.key ? 'on' : ''} onClick={() => setTab(c.key)}>{c.label}<span>{c.items.length}</span></button>
            ))}
          </div>
          <div className="c-kl">
            {col(STAGES.find((s) => s.key === tab)!).items.map(card)}
            {!leads.some((l) => l.stage === tab) && <p className="c-mut">Bu mərhələdə lead yoxdur.</p>}
          </div>
        </>
      ))}
    </AdminShell>
  );
}
