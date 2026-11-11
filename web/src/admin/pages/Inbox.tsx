import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminShell, Sheet } from '../../shared/ui';
import { AIcon } from '../components/AIcon';
import { AEmpty, Av } from '../components/a3';
import { Err } from '../components/common';
import { AChip, ASeg } from '../components/neon';
import {
  contactName, firstLine, LeadPanel, StageChip, usePoll, whenFull, whenShort,
  type Conv, type ConvOpen, type Draft, type Msg,
} from '../components/crm';
import { useAction, useAuth, useLoad } from '../ctx';
import { go, useDesktop } from '../router';

type Filter = 'all' | 'draft' | 'reply';
const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'Hamısı' }, { value: 'draft', label: 'Qaralama gözləyir' }, { value: 'reply', label: 'Siz cavab verməlisiniz' }];
const SRC: Record<string, string> = { bot: 'bot', panel: 'panel', phone: 'telefon', history: 'telefon' };

export function Inbox({ id }: { id?: number }) {
  const desk = useDesktop();
  const list = useLoad<Conv[]>('/inbox');
  usePoll(list.reload);
  const head = (
    <a className="a-bg a-bg-i" href="#/bot" aria-label="Bot ayarları" title="Bot ayarları"><span aria-hidden="true" style={{ fontSize: 18 }}>⚙︎</span></a>
  );

  if (!desk && id) {
    return <AdminShell active="inbox" title="Yazışmalar" bare full><Chat key={id} id={id} onChanged={list.reload} /></AdminShell>;
  }
  return (
    <AdminShell active="inbox" title="Yazışmalar" sub="WhatsApp müştəriləri və bot" actions={head}>
      <div className={desk ? 'c-split' : undefined}>
        <ConvList list={list.data} err={list.err} sel={id} />
        {desk && (id
          ? <Chat key={id} id={id} onChanged={list.reload} />
          : <div className="c-pick"><AEmpty icon="msg" title="Söhbət seçin" text="Soldakı siyahıdan müştərini açın." /></div>)}
      </div>
    </AdminShell>
  );
}

function ConvList({ list, err, sel }: { list: Conv[] | null; err: string; sel?: number }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list ?? []).filter((c) => {
      if (filter === 'draft' && !c.pending_drafts) return false;
      if (filter === 'reply' && !(c.mode === 'human' && c.last_message?.direction === 'in')) return false;
      return !s || contactName(c.contact).toLowerCase().includes(s) || (c.contact.phone ?? '').includes(s.replace(/^\+/, ''));
    });
  }, [list, filter, q]);
  return (
    <section className="c-list" aria-label="Söhbətlər">
      <div className="c-filters"><ASeg<Filter> pill label="Filtr" options={FILTERS} value={filter} onChange={setFilter} /></div>
      <div className="c-search">
        <AIcon name="search" size={18} />
        <input className="inp" type="search" placeholder="Ad və ya telefon" aria-label="Axtarış" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Err msg={err} />
      {!list && !err && <div className="a-sk" style={{ height: 160, borderRadius: 22 }} aria-busy="true" />}
      {list && !rows.length && <AEmpty icon="msg" title={list.length ? 'Heç nə tapılmadı' : 'Hələ yazışma yoxdur'} text={list.length ? 'Filtri və ya axtarışı dəyişin.' : 'Müştəri WhatsApp-dan yazanda burada görünəcək.'} />}
      {rows.map((c) => {
        const name = contactName(c.contact);
        return (
          <a key={c.id} href={`#/inbox/${c.id}`} className={`c-conv${sel === c.id ? ' on' : ''}`}>
            <Av name={name} />
            <span className="c-cb">
              <span className="c-ct"><b>{name}</b><time>{whenShort(c.last_message_at)}</time></span>
              <span className="c-cm">{c.last_message ? (c.last_message.direction === 'out' ? 'Siz: ' : '') + (firstLine(c.last_message.text) || '…') : 'Mesaj yoxdur'}</span>
              <span className="c-tags">
                <AChip tone={c.mode === 'bot' ? 'cal' : 'cb'}>{c.mode === 'bot' ? 'Bot' : 'Siz'}</AChip>
                {c.pending_drafts > 0 && <AChip tone="beh">Qaralama</AChip>}
                <StageChip stage={c.lead_stage} />
                {c.contact.excluded && <AChip tone="off">Bot yazmır</AChip>}
              </span>
            </span>
            {c.unread > 0 && <span className="c-unread" aria-label={`${c.unread} oxunmamış`}>{c.unread}</span>}
          </a>
        );
      })}
    </section>
  );
}

function Chat({ id, onChanged }: { id: number; onChanged: () => void }) {
  const desk = useDesktop();
  const { call } = useAuth();
  const conv = useLoad<ConvOpen>(`/inbox/${id}`);
  usePoll(conv.reload);
  const data = conv.data?.id === id ? conv.data : null;
  const act = useAction();
  const [text, setText] = useState('');
  const [quick, setQuick] = useState(false);
  const [sheet, setSheet] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const n = data?.messages.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [n, data?.drafts.length]);
  const refresh = () => { conv.reload(); onChanged(); };

  async function send() {
    const t = text.trim();
    if (!t) return;
    const r = await act.run(() => call(`/inbox/${id}/send`, { method: 'POST', body: { text: t } }));
    if (r) { setText(''); refresh(); }
  }
  async function setMode(mode: 'bot' | 'human') {
    if (!data || data.mode === mode) return;
    const r = await act.run(() => call(`/inbox/${id}/mode`, { method: 'POST', body: { mode } }));
    if (r) refresh();
  }

  if (!data) {
    return (
      <section className="c-chat">
        {!desk && <header className="c-ch"><button type="button" className="a-bg a-bg-i" aria-label="Geri" onClick={() => go('inbox')}><AIcon name="chevl" size={20} /></button></header>}
        <Err msg={conv.err} />
        {!conv.err && <div className="a-sk" style={{ height: 200, borderRadius: 22 }} aria-busy="true" />}
      </section>
    );
  }
  const name = contactName(data.contact);
  const pending = data.drafts.filter((d) => d.status === 'pending');
  return (
    <div className={desk ? 'c-chatw' : undefined}>
      <section className="c-chat" aria-label="Söhbət">
        <header className="c-ch">
          {!desk && <button type="button" className="a-bg a-bg-i" aria-label="Geri" onClick={() => go('inbox')}><AIcon name="chevl" size={20} /></button>}
          <div className="c-chn"><b>{name}</b><span>{data.contact.phone ? `+${data.contact.phone}` : ''}</span></div>
          {!desk && <button type="button" className="a-bg a-bg-i" aria-label="Lead" onClick={() => setSheet(true)}><AIcon name="user" size={18} /></button>}
          <a className="a-bg a-bg-i" href="#/bot" aria-label="Bot ayarları"><span aria-hidden="true">⚙︎</span></a>
        </header>
        <div className="c-mode">
          <ASeg<'bot' | 'human'> pill label="Rejim" options={[{ value: 'bot', label: 'Bot cavab versin' }, { value: 'human', label: 'Mən cavab verirəm' }]} value={data.mode} onChange={setMode} disabled={act.busy} />
        </div>
        {!data.window_open && <div className="c-warn" role="status">24 saat keçib, müştəri yazmayınca mesaj getməyəcək.</div>}
        <div className="c-msgs">
          {data.messages.map((m) => <Bubble key={m.id} m={m} />)}
          {pending.map((d) => <DraftCard key={d.id} d={d} onDone={refresh} />)}
          <div ref={end} />
        </div>
        {quick && <QuickPicker onPick={(t) => { setText(t); setQuick(false); }} />}
        <Err msg={act.err} />
        <form className="c-comp" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <button type="button" className={`a-bg a-bg-i${quick ? ' c-on' : ''}`} aria-label="Hazır cavablar" title="Hazır cavablar" aria-expanded={quick} onClick={() => setQuick((v) => !v)}><AIcon name="spark" size={18} /></button>
          <textarea className="inp c-ta" rows={2} placeholder={data.window_open ? 'Mesaj yazın…' : 'Pəncərə bağlıdır'} aria-label="Mesaj" value={text} disabled={!data.window_open}
            onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="a-bp" disabled={act.busy || !text.trim() || !data.window_open}>Göndər</button>
        </form>
      </section>
      {desk && <aside className="c-side" aria-label="Lead"><LeadPanel conv={data} onChanged={refresh} /></aside>}
      {!desk && (
        <Sheet open={sheet} onClose={() => setSheet(false)} title="Lead">
          <LeadPanel conv={data} onChanged={refresh} />
        </Sheet>
      )}
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const out = m.direction === 'out';
  const voice = m.type === 'audio' || m.type === 'voice';
  return (
    <div className={`c-b ${out ? 'out' : 'in'}${m.status === 'failed' ? ' fail' : ''}`}>
      {voice && <span aria-hidden="true">🎤 </span>}
      {m.type === 'image' && m.media_url && <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="c-img"><img src={m.media_url} alt="Şəkil" loading="lazy" /></a>}
      <span className="c-bt">{m.text || (m.type !== 'text' && !m.media_url ? `[${m.type}]` : '')}</span>
      <small>{out && SRC[m.source] ? `${SRC[m.source]} · ` : ''}{whenFull(m.created_at)}{m.status === 'failed' ? ` · getmədi${m.error ? `: ${m.error}` : ''}` : ''}</small>
    </div>
  );
}

function DraftCard({ d, onDone }: { d: Draft; onDone: () => void }) {
  const { call } = useAuth();
  const act = useAction();
  const [text, setText] = useState(d.text);
  useEffect(() => setText(d.text), [d.id, d.text]);
  const handoff = d.model_output?.handoff;
  async function send() {
    const r = await act.run(() => call(`/drafts/${d.id}/send`, { method: 'POST', body: text.trim() && text.trim() !== d.text ? { text: text.trim() } : undefined }));
    if (r) onDone();
  }
  async function reject() {
    const r = await act.run(() => call(`/drafts/${d.id}/reject`, { method: 'POST' }));
    if (r) onDone();
  }
  return (
    <div className="c-draft">
      <div className="c-dh"><AChip tone="beh">Botun qaralaması</AChip></div>
      {(handoff || d.reason) && (
        <p className="c-dr">{handoff ? `Bot söhbəti sizə ötürmək istəyir${d.model_output?.handoff_reason ? ` (${d.model_output.handoff_reason})` : ''}. ` : ''}{d.reason ? `Səbəb: ${d.reason}` : ''}</p>
      )}
      <textarea className="inp c-ta" rows={4} aria-label="Qaralama mətni" value={text} onChange={(e) => setText(e.target.value)} />
      <Err msg={act.err} />
      <div className="c-btns">
        <button type="button" className="btn btn-out btn-sm" disabled={act.busy} onClick={reject}>Rədd et</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={act.busy || !text.trim()} onClick={send}>Göndər</button>
      </div>
    </div>
  );
}

function QuickPicker({ onPick }: { onPick: (t: string) => void }) {
  const q = useLoad<{ id: number; title: string; text: string }[]>('/quick-replies');
  return (
    <div className="c-quick" role="listbox" aria-label="Hazır cavablar">
      <Err msg={q.err} />
      {!q.data && !q.err && <span className="c-mut">Yüklənir…</span>}
      {q.data && !q.data.length && <span className="c-mut">Hazır cavab yoxdur. «Bot ayarları»ndan əlavə edin.</span>}
      {q.data?.map((r) => (
        <button key={r.id} type="button" role="option" aria-selected="false" className="c-qi" onClick={() => onPick(r.text)}><b>{r.title}</b><span>{firstLine(r.text)}</span></button>
      ))}
    </div>
  );
}
