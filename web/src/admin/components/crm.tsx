// CRM ortaq parçaları: tiplər, mərhələlər, vaxt mətni, avtomatik yenilənmə, lead paneli.
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../shared/api';
import { Toggle, Err, Field } from './common';
import { AChip } from './neon';
import { useAction, useAuth, useLoad } from '../ctx';
import { addDays, bakuParts, bakuToday, dateShort, toIso } from '../format';

export type Msg = {
  id: number; direction: 'in' | 'out'; source: 'customer' | 'bot' | 'phone' | 'panel' | 'history'; type: string;
  text: string; media_url: string | null; status: string | null; created_at: string; error: string | null;
};
export type Draft = {
  id: number; conversation_id: number; text: string; status: 'pending' | 'sent' | 'rejected' | 'edited';
  reason: string | null; model_output: { handoff?: boolean; handoff_reason?: string | null } | null; created_at: string;
};
export type Stage = 'yeni' | 'maraqlanir' | 'tarix' | 'beh' | 'tesdiq' | 'geldi' | 'itirildi';
export type Lead = {
  id: number; contact_id: number; conversation_id: number | null; name: string; phone: string; service: string | null;
  preferred_date: string | null; people: number | null; cameras: number | null; editing: boolean | null; source: string;
  stage: Stage; notes: string; shoot_id: number | null; created_at: string; updated_at: string;
  lost_reason: LostReason | null; lost_text: string | null; remind_at: string | null; remind_note: string | null;
};
export type LostReason = 'qiymet' | 'vaxt' | 'cavab_yox' | 'basqa_yer' | 'diger';
export const LOST_REASONS: { key: LostReason; label: string }[] = [
  { key: 'qiymet', label: 'Qiymət' }, { key: 'vaxt', label: 'Vaxt uyğun deyil' }, { key: 'cavab_yox', label: 'Cavab vermədi' },
  { key: 'basqa_yer', label: 'Başqa yer seçdi' }, { key: 'diger', label: 'Digər' },
];
export const lostLabel = (l: Lead) => {
  const name = LOST_REASONS.find((r) => r.key === l.lost_reason)?.label;
  return name ? (l.lost_reason === 'diger' && l.lost_text ? `${name}: ${l.lost_text}` : name) : '';
};
/** «🔔 dd.MM» (Bakı) və ya boş. */
export const remindShort = (l: Lead) => {
  if (!l.remind_at) return '';
  const [, m, d] = bakuParts(l.remind_at).date.split('-');
  return `🔔 ${d}.${m}`;
};

/** İtirildi üçün səbəb seçimi (sahibkar seçir; səbəbsiz server 422 verir). */
export function LostPicker({ busy, onConfirm, onCancel }: { busy?: boolean; onConfirm: (reason: LostReason, text: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState<LostReason | ''>('');
  const [text, setText] = useState('');
  return (
    <div className="c-lost">
      <select className="inp" aria-label="İtirilmə səbəbi" value={reason} onChange={(e) => setReason(e.target.value as LostReason | '')}>
        <option value="">Səbəb seçin</option>
        {LOST_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
      </select>
      {reason === 'diger' && <input className="inp" aria-label="Səbəb (istəyə görə)" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="Qısa izah (istəyə görə)" />}
      <button type="button" className="btn btn-primary btn-sm" disabled={!reason || busy} onClick={() => reason && onConfirm(reason, text.trim())}>Təsdiq</button>
      <button type="button" className="btn btn-out btn-sm" disabled={busy} onClick={onCancel}>Ləğv</button>
    </div>
  );
}
export type ConvMode = 'bot' | 'human' | 'owner' | 'wait'; // owner: sahibkar yazıb; wait: komandaya ötürülüb (server/crm/turns.py)
export type Contact = { id: number; name: string | null; phone: string | null; excluded: boolean };
export type Conv = {
  id: number; contact: Contact; last_message: Msg | null; unread: number; mode: ConvMode;
  pending_drafts: number; lead_stage: Stage | null; last_message_at: string | null; window_expires_at: string | null;
};
export type ConvOpen = {
  id: number; mode: ConvMode; unread: number; contact: Contact & { bot_muted_until: string | null };
  messages: Msg[]; drafts: Draft[]; lead: Lead | null; window_expires_at: string | null; window_open: boolean;
};

export const STAGES: { key: Stage; label: string }[] = [
  { key: 'yeni', label: 'Yeni' }, { key: 'maraqlanir', label: 'Maraqlanır' }, { key: 'tarix', label: 'Tarix' },
  { key: 'beh', label: 'Beh' }, { key: 'tesdiq', label: 'Təsdiq' }, { key: 'geldi', label: 'Gəldi' }, { key: 'itirildi', label: 'İtirildi' },
];
export const stageName = (s: string | null | undefined) => STAGES.find((x) => x.key === s)?.label ?? '';
export const SERVICES: [string, string][] = [['podkast', 'Podkast'], ['reels', 'Reels'], ['icare', 'Studiya icarəsi'], ['korporativ', 'Korporativ'], ['diger', 'Digər']];
export const serviceLabel = (s: string | null | undefined) => SERVICES.find(([k]) => k === s)?.[1] ?? '';

export const contactName = (c: Contact | { name?: string | null; phone?: string | null }) => (c.name || '').trim() || (c.phone ? `+${c.phone}` : 'Naməlum');
export const firstLine = (t: string | undefined | null) => (t || '').split('\n').find((x) => x.trim())?.trim() ?? '';

/** Bu gün: saat; əks halda «12 noy». */
export function whenShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = bakuParts(iso);
  return p.date === bakuToday() ? p.time : dateShort(p.date);
}
export const whenFull = (iso: string) => `${dateShort(bakuParts(iso).date)}, ${bakuParts(iso).time}`;

/** Səhifə açıq olanda hər `ms` millisaniyədən bir fn çağırır. */
export function usePoll(fn: () => void, ms = 15000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

/** Lead sahələri + «Çəkilişə çevir». Söhbət səhifəsində sağ paneldə və ya alt vərəqdə işlənir. */
export function LeadPanel({ conv, onChanged }: { conv: ConvOpen; onChanged: () => void }) {
  const { call } = useAuth();
  const { lead, contact } = conv;
  const act = useAction();
  const [f, setF] = useState(() => formOf(lead));
  const [ok, setOk] = useState('');
  useEffect(() => { setF(formOf(lead)); }, [lead?.id, lead?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [excl, setExcl] = useState(contact.excluded);
  useEffect(() => setExcl(contact.excluded), [contact.excluded]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setOk(''); setF((x) => ({ ...x, [k]: v })); };

  async function save() {
    if (!lead) return;
    const r = await act.run(() => call<Lead>(`/leads/${lead.id}`, {
      method: 'PATCH',
      body: {
        name: f.name.trim() || undefined, phone: f.phone.trim() || undefined, service: f.service || null,
        preferred_date: f.preferred_date.trim() || null, people: f.people === '' ? null : Number(f.people),
        cameras: f.cameras === '' ? null : Number(f.cameras), editing: f.editing, stage: f.stage, notes: f.notes,
        remind_at: f.remind_date ? toIso(f.remind_date, '09:00') : null,
        ...(f.stage === 'itirildi' ? { lost_reason: f.lost_reason || undefined, lost_text: f.lost_text.trim() || null } : {}),
      },
    }));
    if (r) { setOk('Yadda saxlandı.'); onChanged(); }
  }
  async function toggleExcl(v: boolean) {
    setExcl(v);
    const r = await act.run(() => call(`/contacts/${contact.id}/exclude`, { method: 'POST', body: { excluded: v } }));
    if (r) onChanged(); else setExcl(!v);
  }

  return (
    <div className="c-lp">
      <div className="c-row">
        <span>Bu kontakta bot yazmasın</span>
        <Toggle on={excl} onChange={toggleExcl} label="Bu kontakta bot yazmasın" disabled={act.busy} />
      </div>
      {!lead && <p className="c-mut">Bu söhbət üçün hələ lead yoxdur. Bot müştərinin xidmət və tarix haqqında yazdığını görəndə yaradır.</p>}
      {lead && (
        <>
          <h3 className="c-h3">Lead</h3>
          <Field label="Ad" id="l-name"><input id="l-name" className="inp" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Telefon" id="l-phone"><input id="l-phone" className="inp" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Mərhələ" id="l-stage">
            <select id="l-stage" className="inp" value={f.stage} onChange={(e) => set('stage', e.target.value as Stage)}>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          {f.stage === 'itirildi' && (
            <>
              <Field label="İtirilmə səbəbi" id="l-lost">
                <select id="l-lost" className="inp" value={f.lost_reason} onChange={(e) => set('lost_reason', e.target.value as LostReason | '')}>
                  <option value="">Səbəb seçin</option>
                  {LOST_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </Field>
              {f.lost_reason === 'diger' && <Field label="Səbəb (istəyə görə)" id="l-losttx"><input id="l-losttx" className="inp" maxLength={200} value={f.lost_text} onChange={(e) => set('lost_text', e.target.value)} /></Field>}
            </>
          )}
          <Field label="Sonra yazacaq (xatırlatma)" id="l-remind"><input id="l-remind" className="inp" type="date" value={f.remind_date} onChange={(e) => set('remind_date', e.target.value)} /></Field>
          <Field label="Xidmət" id="l-svc">
            <select id="l-svc" className="inp" value={f.service} onChange={(e) => set('service', e.target.value)}>
              <option value="">Seçilməyib</option>
              {SERVICES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="İstədiyi tarix" id="l-date"><input id="l-date" className="inp" value={f.preferred_date} onChange={(e) => set('preferred_date', e.target.value)} placeholder="məs. cümə axşamı, 15:00" /></Field>
          <div className="c-two">
            <Field label="Nəfər" id="l-ppl"><input id="l-ppl" className="inp" type="number" min={0} max={100} inputMode="numeric" value={f.people} onChange={(e) => set('people', e.target.value)} /></Field>
            <Field label="Kamera" id="l-cam"><input id="l-cam" className="inp" type="number" min={0} max={3} inputMode="numeric" value={f.cameras} onChange={(e) => set('cameras', e.target.value)} /></Field>
          </div>
          <div className="c-row"><span>Montaj</span><Toggle on={!!f.editing} onChange={(v) => set('editing', v)} label="Montaj" /></div>
          <Field label="Qeyd" id="l-notes"><textarea id="l-notes" className="inp c-ta" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <Err msg={act.err} />
          {ok && <p className="c-ok" role="status">{ok}</p>}
          <button type="button" className="btn btn-primary btn-sm" disabled={act.busy} onClick={save}>Yadda saxla</button>
          {lead.shoot_id
            ? <a className="btn btn-out btn-sm" href={`#/shoots/${lead.shoot_id}`}>Çəkilişə bax</a>
            : <ConfirmShoot lead={lead} onDone={onChanged} />}
        </>
      )}
    </div>
  );
}

function formOf(l: Lead | null) {
  return {
    name: l?.name ?? '', phone: l?.phone ?? '', service: l?.service ?? '', preferred_date: l?.preferred_date ?? '',
    people: l?.people == null ? '' : String(l.people), cameras: l?.cameras == null ? '' : String(l.cameras),
    editing: l?.editing ?? false, stage: (l?.stage ?? 'yeni') as Stage, notes: l?.notes ?? '',
    lost_reason: (l?.lost_reason ?? '') as LostReason | '', lost_text: l?.lost_text ?? '',
    remind_date: l?.remind_at ? bakuParts(l.remind_at).date : '',
  };
}

type Conflict = { type: 'shoot' | 'block'; starts_at: string; ends_at?: string; duration_min?: number; reason?: string };

function ConfirmShoot({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const { call } = useAuth();
  const [open, setOpen] = useState(false);
  const act = useAction();
  const [date, setDate] = useState(addDays(bakuToday(), 1));
  const [time, setTime] = useState('12:00');
  const [dur, setDur] = useState(60);
  const [cams, setCams] = useState(lead.cameras ?? 2);
  const [editing, setEditing] = useState(!!lead.editing);
  const [loc, setLoc] = useState<'studio' | 'onsite'>('studio');
  const [kind, setKind] = useState<'shoot' | 'reels_pack' | 'studio_rent'>(lead.service === 'reels' ? 'reels_pack' : lead.service === 'icare' ? 'studio_rent' : 'shoot');
  const [conf, setConf] = useState<Conflict[]>([]);
  const slots = useLoad<{ start: string; end: string }[]>(open && date ? `/free-slots?day=${date}` : null);

  async function submit() {
    setConf([]);
    try {
      await act.run(async () => {
        try {
          await call(`/leads/${lead.id}/confirm`, { method: 'POST', body: { starts_at: toIso(date, time), duration_min: dur, cameras: cams, editing, location: loc, kind } });
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && Array.isArray((e.data as { conflicts?: unknown })?.conflicts)) setConf((e.data as { conflicts: Conflict[] }).conflicts);
          throw e;
        }
        onDone();
      });
    } catch { /* act.run xətanı özü tutur */ }
  }

  if (!open) return <button type="button" className="btn btn-out btn-sm" onClick={() => setOpen(true)}>Çəkilişə çevir</button>;
  return (
    <div className="c-box">
      <h3 className="c-h3">Çəkilişə çevir</h3>
      <Field label="Tarix" id="cs-date"><input id="cs-date" type="date" className="inp" value={date} min={bakuToday()} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="c-slots" aria-live="polite">
        {!slots.data && !slots.err && <span className="c-mut">Boş saatlar yüklənir…</span>}
        {slots.data && !slots.data.length && <span className="c-mut">Bu gün boş vaxt yoxdur.</span>}
        {slots.data?.map((s) => (
          <button type="button" key={s.start} className={`c-slot${time === s.start ? ' on' : ''}`} onClick={() => setTime(s.start)}>{s.start}–{s.end}</button>
        ))}
      </div>
      <div className="c-two">
        <Field label="Saat" id="cs-time"><input id="cs-time" type="time" step={900} className="inp" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Müddət" id="cs-dur">
          <select id="cs-dur" className="inp" value={dur} onChange={(e) => setDur(Number(e.target.value))}>
            {[30, 60, 90, 120, 150, 180, 240, 300].map((m) => <option key={m} value={m}>{m % 60 === 0 ? `${m / 60} saat` : m > 60 ? `${Math.floor(m / 60)} saat 30 dəq` : `${m} dəq`}</option>)}
          </select>
        </Field>
      </div>
      <div className="c-two">
        <Field label="Kamera" id="cs-cam">
          <select id="cs-cam" className="inp" value={cams} onChange={(e) => setCams(Number(e.target.value))}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </Field>
        <Field label="Yer" id="cs-loc">
          <select id="cs-loc" className="inp" value={loc} onChange={(e) => setLoc(e.target.value as 'studio' | 'onsite')}><option value="studio">Studiyada</option><option value="onsite">Məkanda</option></select>
        </Field>
      </div>
      <Field label="Növ" id="cs-kind">
        <select id="cs-kind" className="inp" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="shoot">Çəkiliş</option><option value="reels_pack">Reels paketi</option><option value="studio_rent">Studiya icarəsi</option>
        </select>
      </Field>
      <div className="c-row"><span>Montaj</span><Toggle on={editing} onChange={setEditing} label="Montaj" /></div>
      {conf.length > 0 && (
        <div className="c-warn" role="alert">
          <b>Bu vaxt məşğuldur.</b>
          {conf.map((c, i) => (
            <span key={i}>{c.type === 'shoot' ? 'Çəkiliş' : `Blok${c.reason ? ` (${c.reason})` : ''}`}: {whenFull(c.starts_at)}{c.ends_at ? ` – ${bakuParts(c.ends_at).time}` : c.duration_min ? `, ${c.duration_min} dəq` : ''}</span>
          ))}
        </div>
      )}
      {!conf.length && <Err msg={act.err} />}
      <div className="c-btns">
        <button type="button" className="btn btn-out btn-sm" onClick={() => setOpen(false)}>Bağla</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={act.busy || !date || !time} onClick={submit}>Təsdiqlə</button>
      </div>
    </div>
  );
}

/** Lead mərhələsi çipi. */
export function StageChip({ stage }: { stage: Stage | null }) {
  if (!stage) return null;
  const tone = stage === 'itirildi' ? 'off' : stage === 'geldi' ? 'cb' : stage === 'beh' ? 'beh' : 'cal';
  return <AChip tone={tone}>{stageName(stage)}</AChip>;
}
