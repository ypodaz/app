import { useEffect, useState } from 'react';
import { Button, Sheet } from '../../shared/ui';
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
      birthday: f.birthday, source: f.source, marketing_opt_in: opt, tag_ids: tags,
    };
    if ((ref?.id ?? 0) !== (c.referred_by?.id ?? 0)) body.referred_by_id = ref?.id ?? 0;
    if (await run(() => call(`/clients/${c.id}`, { method: 'PATCH', body })) !== undefined) { onClose(); onDone(); }
  }

  return (
    <>
      <Sheet open={open && !pick} onClose={onClose} title="Profili redaktə et">
        <Field label="İxtisas" id="pf-p"><input id="pf-p" className="inp" value={f.profession} maxLength={80} onChange={(e) => set({ profession: e.target.value })} placeholder="məs. Psixoloq" /></Field>
        <Field label="İş yeri" id="pf-w"><input id="pf-w" className="inp" value={f.workplace} maxLength={80} onChange={(e) => set({ workplace: e.target.value })} /></Field>
        <Field label="Instagram" id="pf-i"><input id="pf-i" className="inp" autoCapitalize="none" value={f.instagram} maxLength={60} onChange={(e) => set({ instagram: e.target.value })} placeholder="istifadəçi adı" /></Field>
        <Field label="Nişa" id="pf-n"><input id="pf-n" className="inp" value={f.niche} maxLength={80} onChange={(e) => set({ niche: e.target.value })} /></Field>
        <Field label="Doğum günü" id="pf-b"><input id="pf-b" type="date" className="inp" value={f.birthday} onChange={(e) => set({ birthday: e.target.value })} /></Field>
        <Field label="Haradan tapıb" id="pf-s">
          <select id="pf-s" className="inp" value={f.source} onChange={(e) => set({ source: e.target.value })}>
            <option value="">—</option>
            {SOURCES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="row sb"><span className="col" style={{ gap: 2 }}><span className="t14 w7">Təkliflər</span><span className="t12 muted">Kampaniya bildirişləri</span></span><Toggle on={opt} onChange={setOpt} label="Təkliflər" /></div>
        <Field label="Teqlər"><TagEditor value={tags} onChange={setTags} /></Field>
        <Field label="Dəvət edən">
          <div className="row sb" style={{ gap: 8 }}>
            <span className="t14 w7" style={{ overflowWrap: 'anywhere' }}>{ref ? ref.full_name : '—'}</span>
            <span className="row" style={{ gap: 4 }}>
              <Button variant="out" small auto onClick={() => setPick(true)}>Seç</Button>
              {ref && <Button variant="ghost" small auto onClick={() => setRef(null)}>Sil</Button>}
            </span>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
            <input className="inp grow" aria-label="Dəvət kodu" autoCapitalize="characters" placeholder="Dəvət kodu ilə tap" value={code} onChange={(e) => setCode(e.target.value)} />
            <Button variant="out" small auto style={{ flex: 'none' }} disabled={!code.trim() || codeAct.busy} onClick={findCode}>Tap</Button>
          </div>
          <Err msg={codeAct.err} />
        </Field>
        <Err msg={err} />
        <Button disabled={busy} onClick={submit}>Yadda saxla</Button>
      </Sheet>
      <ClientPickerSheet open={open && pick} onClose={() => setPick(false)} title="Dəvət edəni seç" exclude={[c.id]} onPick={(p: Client) => setRef({ id: p.id, full_name: p.full_name })} />
    </>
  );
}
