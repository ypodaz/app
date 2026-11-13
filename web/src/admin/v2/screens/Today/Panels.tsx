import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { formatMoney2 } from '../../../../shared/ui';
import { contactName, firstLine, stageName, type ConvOpen } from '../../../components/crm';
import { errMsg, useAuth } from '../../../ctx';
import { bakuParts } from '../../../format';
import { go } from '../../../router';
import { maskPhone, ddmmTime } from '../../data/time';
import type { QueueItem } from '../../data/queue';
import { useShellData } from '../../data/ShellData';
import { Avatar, Button, ErrorBox, LoadingRows, StatusChip, useOnline } from '../../ui';
import { shootStatus } from '../../data/status';
import { mx, shootLabel } from './helpers';

export type PrimaryRef = MutableRefObject<(() => void) | null>;

function useConvOpen(id: number, refreshKey: unknown) {
  const { call } = useAuth();
  const [data, setData] = useState<ConvOpen | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    setErr('');
    call<ConvOpen>(`/inbox/${id}`).then((d) => live && setData(d)).catch((e) => live && setErr(errMsg(e)));
    return () => { live = false; };
  }, [id, refreshKey, call]);
  return { data: data?.id === id ? data : null, err };
}

/** Söhbət işi: ötürmə səbəbi, son 3 mesaj, AI qaralaması, Göndər. (01 «Sağ panel» #14–#23) */
export function ChatPanel({ item, primaryRef, compact }: { item: QueueItem; primaryRef: PrimaryRef; compact?: boolean }) {
  const conv = item.conv!;
  const { data, err } = useConvOpen(conv.id, conv.last_message_at);
  const sd = useShellData();
  const { call } = useAuth();
  const online = useOnline();
  const draft = data ? [...data.drafts].filter((d) => d.status === 'pending').pop() : undefined;
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(draft?.text ?? ''), [draft?.id, draft?.text]);

  const windowClosed = !!data && !data.window_open;
  const canSend = !!draft && !!text.trim() && online && !windowClosed;
  const send = () => {
    if (!draft || !canSend) return;
    const t = text.trim();
    // Müştəriyə mesaj gedən əməl: 5 s gecikmə, «Geri al» (99 G2). Göndəriləndən sonra söhbəti yenə bot aparır (backend: turns.draft_approved).
    sd.sendLater(item.key, 'Göndərildi · söhbəti yenə bot aparır', () => call(`/drafts/${draft.id}/send`, { method: 'POST', body: t !== draft.text.trim() ? { text: t } : undefined }));
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => { primaryRef.current = () => sendRef.current(); return () => { primaryRef.current = null; }; }, [primaryRef, item.key]);

  const reason = (data ? [...data.drafts].reverse().find((d) => d.model_output?.handoff_reason) : undefined)?.model_output?.handoff_reason;
  const msgs = data ? data.messages.filter((m) => m.text || m.media_url).slice(-3) : [];
  const lastMsg = conv.last_message?.text ? firstLine(conv.last_message.text) : '';
  const phone = maskPhone(conv.contact.phone);

  const body = (
    <>
      {err && <ErrorBox title="Söhbət yüklənmədi" detail={err} />}
      {reason && <div className="pn__reason"><b>Bot niyə ötürdü:</b> {reason}</div>}
      {/* TODO [API] ötürmə səbəbi kodu (03 §3.6) siyahı cavabında yoxdur; yalnız qaralamanın model_output.handoff_reason sahəsi var, standart mətnə çevrilmir. */}
      {!compact && (
        data ? (
          <div className="pn__msgs">
            {msgs.map((m, i) => (
              <p key={m.id} className={`pn__msg${m.direction === 'out' ? ' pn__msg--out' : ''}${m.source === 'bot' ? ' pn__msg--bot' : ''}`}>
                {m.direction === 'out' && <span className="pn__who">{m.source === 'bot' ? 'Bot' : 'Siz'}</span>}
                {m.text || `[${m.type}]`}{i === msgs.length - 1 && <> <span className="mono pn__t">{bakuParts(m.created_at).time}</span></>}
              </p>
            ))}
          </div>
        ) : !err ? <LoadingRows rows={2} /> : null
      )}
      {compact && lastMsg && <p className="pn__quote">«{lastMsg}»</p>}
      {draft ? (
        <div className="pn__draft">
          <span className="pn__draft-l">AI qaralaması · redaktə edə bilərsiniz</span>
          {/* M1: «Komandaya ötürülüb» qaralamasında taymer yoxdur. */}
          <textarea ref={area} className="pn__draft-t" value={text} rows={compact ? 3 : 4} aria-label="Qaralama mətni" onChange={(e) => setText(e.target.value)} />
          {item.conv?.mode === 'wait' && <span className="pn__draft-s">Siz baxana qədər gözləyir</span>}
          {/* TODO [API] «Siz yazdınız» qaralamasının taymeri (N dəq sonra bot özü göndərəcək, «Özü göndərməsin»): draft_out auto_at qaytarmır. */}
        </div>
      ) : data ? <p className="pn__none">Qaralama yoxdur. Cavabı «Tam söhbət»də yaza bilərsiniz.</p> : null}
      {windowClosed && <div className="pn__reason">24 saat keçib · yalnız şablonla yazmaq olar</div>}
      {/* TODO [API] «Şablon seç» (M17), «Yenidən yaz», «Göndər və sabah 15:00-ı saxla»: uyğun endpoint yoxdur — düymələr gizlədilib. */}
      <div className="pn__acts">
        <Button variant="primary" size="md" kbd="↵" disabled={!canSend} onClick={send} block={compact}>Göndər</Button>
        {compact && <Button size="md" disabled={!draft} onClick={() => area.current?.focus()}>Redaktə</Button>}
        {!compact && <a className="btn btn--secondary btn--md" href={`#/inbox/${conv.id}`}>Tam söhbət</a>}
        <Button variant="text" size="md" className={compact ? 'btn--icon' : 'pn__later'} aria-label="Sonraya saxla" title="Sonraya saxla (3 saat)" onClick={() => { sd.snooze(item.key); }}>
          {compact ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg> : 'Sonraya saxla'}
        </Button>
      </div>
    </>
  );
  if (compact) return <div className="pn pn--compact">{body}</div>;
  return (
    <div className="pn">
      <div className="pn__head">
        <Avatar name={item.name} tone="brand" large />
        <div className="row__main"><h2 className="pn__h2">{contactName(conv.contact)}</h2>
          <div className="row__meta" style={{ whiteSpace: 'normal' }}>WhatsApp{phone && <> · <span className="mono">{phone}</span></>}{conv.lead_stage && <> · lead: {stageName(conv.lead_stage)}</>}</div></div>
        <a className="pn__link" href={`#/inbox/${conv.id}`}>Tam söhbət</a>
      </div>
      {body}
    </div>
  );
}

/** Çəkiliş işləri (Beh al / Bağla / Montaj): qısa məlumat + sətirdəki eyni əməl (01 «Rəşaddan başqa iş növləri» — ən sadə variant). */
export function ShootPanel({ item, primaryRef, onDeposit, onDeliver }: { item: QueueItem; primaryRef: PrimaryRef; onDeposit: () => void; onDeliver: () => void }) {
  const s = item.shoot!;
  const { now } = useShellData();
  const online = useOnline();
  const st = shootStatus(s, now);
  const act = item.kind === 'deposit'
    ? { label: 'Beh alındı', run: onDeposit }
    : item.kind === 'close'
      ? { label: 'Çəkilişi bağla', run: () => go(`shoots/${s.id}/close`) }
      : s.materials.length > 0
        ? { label: 'Təhvil ver', run: onDeliver }
        : { label: 'Drive linki əlavə et', run: () => go('cekilisler/montaj') };
  useEffect(() => { primaryRef.current = act.run; return () => { primaryRef.current = null; }; }); // hər render: ən son closure
  return (
    <div className="pn">
      <div className="pn__head">
        <Avatar name={item.name} tone={item.avatar} large />
        <div className="row__main"><h2 className="pn__h2">{item.name}</h2><div className="row__meta">{shootLabel(s)}</div></div>
        <StatusChip status={st} />
      </div>
      <dl className="pn__facts">
        <div><dt>Vaxt</dt><dd className="mono">{ddmmTime(s.starts_at)}</dd></div>
        <div><dt>Müddət</dt><dd className="mono">{Math.floor(s.duration_min / 60) ? `${Math.floor(s.duration_min / 60)} saat` : ''}{s.duration_min % 60 ? ` ${s.duration_min % 60} dəq` : ''}</dd></div>
        <div><dt>Məbləğ</dt><dd className="mono">{formatMoney2(s.total)}</dd></div>
        {s.deposit_expected > 0 && <div><dt>Beh</dt><dd className="mono">{s.deposit_received_at ? `alınıb · ${formatMoney2(s.deposit_amount)}` : `gözlənilir · ${formatMoney2(s.deposit_expected)}`}</dd></div>}
        {item.kind === 'delivery' && <div><dt>Drive linki</dt><dd>{s.materials.length ? s.materials.map((m) => m.title).join(', ') : 'yoxdur'}</dd></div>}
        {item.kind === 'delivery' && s.delivery_on && <div><dt>Təhvil</dt><dd className="mono">{s.delivery_on.slice(8, 10)}.{s.delivery_on.slice(5, 7)}</dd></div>}
      </dl>
      <p className="pn__none">{mx(item.meta)}</p>
      {/* TODO [API] «Xatırlat» (beh xatırlatması), «Linki göndər» (WhatsApp ilə Drive linki), «Geri al» (behi və bağlamanı qaytarmaq): endpoint yoxdur. */}
      <div className="pn__acts">
        <Button variant="primary" size="md" kbd="↵" disabled={!online} onClick={act.run}>{act.label}</Button>
        <a className="btn btn--secondary btn--md" href={`#/shoots/${s.id}`}>Çəkilişi aç</a>
      </div>
    </div>
  );
}
