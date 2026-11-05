import { useEffect, useState } from 'react';
import { Button, Sheet } from '../../shared/ui';
import { AIcon } from './AIcon';
import { Av } from './a3';
import { useAction, useAuth } from '../ctx';
import type { Client, ClientDetail } from '../types';
import { ClientPickerSheet } from './ClientPicker';
import { Err, Field, SOURCES, Toggle } from './common';
import { TagEditor } from './TagEditor';

type Ref = { id: number; full_name: string } | null;

// Müştəri profilinin redaktəsi (PATCH /clients/{id}). Boş sətir sahəni təmizləyir.
export function ProfileSheet({ open, c, onClose, onDone }: { open: boolean; c: ClientDetail; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const { busy, err, setErr, run } = useAction();
  const [f, setF] = useState({ profession: '', workplace: '', instagram: '', niche: '', birthday: '', source: '' });
  const [opt, setOpt] = useState(true);
  const [tags, setTags] = useState<number[]>([]);
  const [ref, setRef] = useState<Ref>(null);
  const [pick, setPick] = useState(false);
  const [code, setCode] = useState('');
  const codeAct = useAction();
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    if (!open) return;
    setF({ profession: c.profession ?? '', workplace: c.workplace ?? '', instagram: c.instagram ?? '', niche: c.niche ?? '', birthday: c.birthday ?? '', source: c.source ?? '' });
    setOpt(c.marketing_opt_in ?? true); setTags((c.tags ?? []).map((t) => t.id)); setRef(c.referred_by ?? null); setCode(''); setErr(''); codeAct.setErr('');
  }, [open]);

  async function findCode() {
    const r = await codeAct.run(() => call<{ id: number; full_name: string }>(`/referrals/${encodeURIComponent(code.trim())}`));
    if (r) { setRef(r); setCode(''); }
  }

  async function submit() {
    const body: Record<string, unknown> = {
      profession: f.profession.trim(), workplace: f.workplace.trim(), instagram: f.instagram.trim().replace(/^@/, ''), niche: f.niche.trim(),
      birthday: f.birthday || null, source: f.source, marketing_opt_in: opt, tag_ids: tags,
    };
    if ((ref?.id ?? 0) !== (c.referred_by?.id ?? 0)) body.referred_by_id = ref?.id ?? 0;
    if (await run(() => call(`/clients/${c.id}`, { method: 'PATCH', body })) !== undefined) { onClose(); onDone(); }
  }

  return (
    <>
      <Sheet open={open && !pick} onClose={onClose} title="Profili redaktə et">
        <div className="a3-pf2">
        <Field label="İxtisas" id="pf-p"><input id="pf-p" className="inp" value={f.profession} maxLength={80} onChange={(e) => set({ profession: e.target.value })} placeholder="məs. Psixoloq" /></Field>
        <Field label="İş yeri" id="pf-w"><input id="pf-w" className="inp" value={f.workplace} maxLength={80} onChange={(e) => set({ workplace: e.target.value })} /></Field>
        <Field label="Instagram" id="pf-i"><input id="pf-i" className="inp" autoCapitalize="none" value={f.instagram} maxLength={60} onChange={(e) => set({ instagram: e.target.value })} placeholder="istifadəçi adı" /></Field>
        <Field label="Kontent mövzusu" id="pf-n"><input id="pf-n" className="inp" value={f.niche} maxLength={80} onChange={(e) => set({ niche: e.target.value })} /></Field>
        <Field label="Doğum günü" id="pf-b"><input id="pf-b" type="date" className="inp" value={f.birthday} onChange={(e) => set({ birthday: e.target.value })} /></Field>
        </div>
        <div className="field">
          <span className="flabel" id="pf-s-l">Haradan tapıb</span>
          <div className="a3-opts" role="group" aria-labelledby="pf-s-l">
            {SOURCES.map(([k, v]) => <button key={k} type="button" className={`a3-opt${f.source === k ? ' on' : ''}`} aria-pressed={f.source === k} onClick={() => set({ source: f.source === k ? '' : k })}>{v}</button>)}
          </div>
        </div>
        <div className="a3-tog"><span><b>Təkliflər</b> — Kampaniya bildirişləri</span><Toggle on={opt} onChange={setOpt} label="Təkliflər" /></div>
        <Field label="Teqlər"><TagEditor value={tags} onChange={setTags} /></Field>
        <div className="a3-ref">
          <span className="a3-rl">Dəvət edən</span>
          <div className="a3-rr">
            {ref ? <Av name={ref.full_name} size={36} /> : null}
            <span className="a3-rn">{ref ? ref.full_name : '—'}</span>
            <button type="button" className="a-bt" onClick={() => setPick(true)}>Seç</button>
            {ref && <button type="button" className="a-bt a3-dng-t" onClick={() => setRef(null)}>Sil</button>}
          </div>
          <span className="a3-rl2">Dəvət kodu ilə tap</span>
          <div className="a3-rr">
            <input className="inp" aria-label="Dəvət kodu" autoCapitalize="characters" placeholder="MƏS. AYSEL20" value={code} onChange={(e) => setCode(e.target.value)} />
            <button type="button" className="a-bt" disabled={!code.trim() || codeAct.busy} onClick={findCode}><AIcon name="search" size={16} /> Tap</button>
          </div>
          <Err msg={codeAct.err} />
        </div>
        <Err msg={err} />
        <Button disabled={busy} onClick={submit}>Yadda saxla</Button>
      </Sheet>
      <ClientPickerSheet open={open && pick} onClose={() => setPick(false)} title="Dəvət edəni seç" exclude={[c.id]} onPick={(p: Client) => setRef({ id: p.id, full_name: p.full_name })} />
    </>
  );
}
