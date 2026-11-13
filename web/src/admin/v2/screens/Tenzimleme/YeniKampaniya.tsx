import { useEffect, useMemo, useState } from 'react';
import { errMsg, useAction, useAuth, useLoad } from '../../../ctx';
import { addDays, bakuToday, dateLong, parseAzn } from '../../../format';
import { go } from '../../../router';
import { SOURCES, TAG } from '../../../components/common';
import type { Campaign, Filters, Preview, ServiceKey, Slot, TagRow } from '../../../types';
import { PageHeader } from '../../shell/PageHeader';
import { Button, Card, Dialog, EmptyState, ErrorBox, Field, Segmented, TextArea, TextInput, V2Icon, useOnline, useToast } from '../../ui';
import { ChangeNote } from '../../ui';
import { Chosen, ClientPickDialog, Fld } from './kit';
import './tenzimleme.css';

type Mode = 'all' | 'filter' | 'manual';
type Tri = '' | 'yes' | 'no';
const SERVICES: [ServiceKey, string][] = [['podcast', TAG.podcast], ['reels', TAG.reels], ['other', TAG.other], ['reels_pack', 'Reels paketi'], ['studio_rent', 'Studiya icarəsi']];
const PRESETS: [NonNullable<Filters['preset']>, string][] = [['package_candidates', 'Paketə keçid namizədləri'], ['podcast_no_reels', 'Podcast çəkib, Reels yox']];
const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];

type Fs = { tags: number[]; professions: string; services: ServiceKey[]; sources: string[]; inactive: string; pkg: Tri; cashback: string; month: number; joined: Tri; push: Tri; preset: Filters['preset'] | '' };
const EMPTY: Fs = { tags: [], professions: '', services: [], sources: [], inactive: '', pkg: '', cashback: '', month: 0, joined: '', push: '', preset: '' };

// Yazılmış qaralama səhifə dəyişəndə itməsin (köhnə kampaniya səhifəsi ilə eyni açar): sessionStorage
const DRAFT = 'ypod:campaign-draft';
type Draft = { mode: Mode; f: Fs; picked: { id: number; full_name: string }[]; title: string; body: string; url: string };
const loadDraft = (): Draft | null => {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT) ?? 'null');
    return d && typeof d.title === 'string' && typeof d.body === 'string' && typeof d.url === 'string' && d.f && Array.isArray(d.picked) ? { ...d, f: { ...EMPTY, ...d.f } } : null;
  } catch { return null; }
};
const saveDraft = (d: Draft | null) => { try { if (d) sessionStorage.setItem(DRAFT, JSON.stringify(d)); else sessionStorage.removeItem(DRAFT); } catch { /* yaddaş bağlıdır */ } };

const tri = (v: Tri) => (v === '' ? undefined : v === 'yes');
function buildFilters(mode: Mode, f: Fs, picked: { id: number }[]): Filters {
  if (mode === 'all') return {};
  if (mode === 'manual') return { client_ids: picked.map((p) => p.id) };
  const o: Filters = {};
  if (f.tags.length) o.tag_ids = f.tags;
  const pr = f.professions.split(',').map((s) => s.trim()).filter(Boolean);
  if (pr.length) o.professions = pr;
  if (f.services.length) o.services = f.services;
  if (f.sources.length) o.sources = f.sources;
  if (/^\d+$/.test(f.inactive.trim())) o.inactive_days = Number(f.inactive);
  if (tri(f.pkg) !== undefined) o.has_package = tri(f.pkg);
  const cb = f.cashback.trim() ? parseAzn(f.cashback) : null;
  if (cb) o.min_cashback = cb;
  if (f.month) o.birthday_month = f.month;
  if (tri(f.joined) !== undefined) o.app_joined = tri(f.joined);
  if (tri(f.push) !== undefined) o.push_on = tri(f.push);
  if (f.preset) o.preset = f.preset;
  return o;
}
const toggle = <T,>(list: T[], x: T): T[] => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

function TriRow({ label, v, on, yes, no }: { label: string; v: Tri; on: (v: Tri) => void; yes: string; no: string }) {
  return <Fld label={label}><Segmented<Tri> label={label} value={v} onChange={on} options={[{ value: '', label: 'Fərqi yoxdur' }, { value: 'yes', label: yes }, { value: 'no', label: no }]} /></Fld>;
}
const Toggle = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" className={`tz-pill${on ? ' tz-pill--on' : ''}`} aria-pressed={on} onClick={onClick}>{children}</button>
);

/** «Boş saat» şablonu: gün seç → boş saatları gətir → mətnə yaz. */
function SlotsDialog({ open, onClose, onFill }: { open: boolean; onClose: () => void; onFill: (title: string, body: string) => void }) {
  const { call } = useAuth();
  const act = useAction();
  const today = bakuToday();
  const [day, setDay] = useState(addDays(today, 1));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [pick, setPick] = useState<number[]>([]);
  const [empty, setEmpty] = useState(false);
  useEffect(() => { if (open) { setSlots(null); setEmpty(false); setPick([]); act.setErr(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const label = (d: string) => (d === today ? 'Bu gün' : d === addDays(today, 1) ? 'Sabah' : dateLong(d));
  async function fetchSlots() {
    setEmpty(false); setSlots(null);
    const s = await act.run(() => call<Slot[]>(`/free-slots?day=${day}`));
    if (!s) return;
    if (!s.length) { setEmpty(true); return; }
    setSlots(s); setPick(s.map((_, i) => i));
  }
  function apply() {
    if (!slots) return;
    const chosen = slots.filter((_, i) => pick.includes(i));
    if (!chosen.length) return;
    onFill('Boş saat var', `${label(day)} ${chosen.map((x) => `${x.start}–${x.end}`).join(', ')} boşdur — yazılın`);
    onClose();
  }
  return (
    <Dialog open={open} onClose={onClose} title="Boş saat şablonu" subtitle="Seçilən saatlar mesaja yazılacaq"
      footer={<><Button variant="text" onClick={onClose}>Ləğv et</Button><Button variant="primary" disabled={!slots || !pick.length} onClick={apply}>Mətnə yaz</Button></>}>
      <Field label="Gün">{(id) => <select id={id} className="input" value={day} onChange={(e) => { setDay(e.target.value); setSlots(null); setEmpty(false); }}>{days.map((d) => <option key={d} value={d}>{label(d)}</option>)}</select>}</Field>
      <div><Button disabled={act.busy} onClick={fetchSlots}>Boş saatları gətir</Button></div>
      {act.err && <ErrorBox title="Boş saatlar alınmadı" detail={act.err} />}
      {empty && <EmptyState title="Həmin gün boş saat yoxdur" reason="Başqa gün seçin." />}
      {slots && <div className="kp-slots">{slots.map((x, i) => <Toggle key={i} on={pick.includes(i)} onClick={() => setPick(toggle(pick, i))}>{x.start}–{x.end}</Toggle>)}</div>}
    </Dialog>
  );
}

/** Yeni kampaniya (31-marketinq.md §Yeni kampaniya): auditoriya, mesaj, önizləmə. Route: /tenzimleme/marketinq/yeni */
export function YeniKampaniya() {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const [draft] = useState(loadDraft);
  const [mode, setMode] = useState<Mode>(draft?.mode ?? 'all');
  const [f, setF] = useState<Fs>(draft?.f ?? EMPTY);
  const [picked, setPicked] = useState<{ id: number; full_name: string }[]>(draft?.picked ?? []);
  const [pickOpen, setPickOpen] = useState(false);
  const [title, setTitle] = useState(draft?.title ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [url, setUrl] = useState(draft?.url ?? '');
  const [confirm, setConfirm] = useState(false);
  const [leave, setLeave] = useState(false);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const send = useAction();
  const tags = useLoad<TagRow[]>('/tags');
  const hist = useLoad<Campaign[]>('/campaigns');
  const set = (p: Partial<Fs>) => setF((x) => ({ ...x, ...p }));
  const dirty = !!(title || body || url);

  useEffect(() => { saveDraft(dirty ? { mode, f, picked, title, body, url } : null); }, [mode, f, picked, title, body, url, dirty]);

  const filters = useMemo(() => buildFilters(mode, f, picked), [mode, f, picked]);
  const key = JSON.stringify(filters);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [perr, setPerr] = useState('');
  const [ploading, setPloading] = useState(false);
  useEffect(() => {
    if (mode === 'manual' && !picked.length) { setPrev({ count: 0, push_on: 0, opted_out: 0, recently_messaged: 0, sample: [] }); setPerr(''); return; }
    let live = true;
    setPloading(true);
    const t = setTimeout(() => {
      call<Preview>('/segments/preview', { body: JSON.parse(key) })
        .then((r) => { if (live) { setPrev(r); setPerr(''); } })
        .catch((e) => { if (live) setPerr(errMsg(e)); })
        .finally(() => live && setPloading(false));
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [key, mode, picked.length, call]);

  const urlOk = !url.trim() || /^https:\/\/\S+$/.test(url.trim());
  const count = prev?.count ?? 0;
  const valid = title.trim().length >= 2 && body.trim().length >= 2 && urlOk && count > 0;
  const sample = prev?.sample[0]?.full_name.split(' ')[0] ?? 'Nümunə';
  const shown = body.replace(/\{name\}/g, sample);

  // Gözlənilən nəticə: keçmiş kampaniyaların orta göstəricisi (hist)
  const past = (hist.data ?? []).filter((c) => c.recipients > 0);
  const totR = past.reduce((s, c) => s + c.recipients, 0);
  const openRate = totR ? past.reduce((s, c) => s + c.opened, 0) / totR : null;
  const bookRate = totR ? past.reduce((s, c) => s + c.booked_14d, 0) / totR : null;

  function insertVar(v: string) {
    const el = document.querySelector<HTMLTextAreaElement>('textarea[data-kp-body]');
    const a = el?.selectionStart ?? body.length, b = el?.selectionEnd ?? body.length;
    const next = body.slice(0, a) + v + body.slice(b);
    setBody(next.slice(0, 400));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + v.length, a + v.length); });
  }
  function tpl(p: { mode: Mode; fs?: Partial<Fs>; title: string; body: string }) { setMode(p.mode); setF({ ...EMPTY, ...p.fs }); setTitle(p.title); setBody(p.body); }

  async function submit() {
    const r = await send.run(() => call<Campaign>('/campaigns', { body: { title: title.trim(), body: body.trim(), ...(url.trim() ? { url: url.trim() } : {}), filters: JSON.parse(key) } }));
    setConfirm(false);
    if (r) { saveDraft(null); toast.show(`Göndərildi · ${r.recipients} nəfər`); go('tenzimleme/marketinq'); }
  }
  const back = () => { if (dirty) setLeave(true); else go('tenzimleme/marketinq'); };

  return (
    <>
      <PageHeader title="Yeni kampaniya" sub="Kimə, nə?" newShoot={false} more={false} />
      <div className="tz-crumb"><V2Icon name="back" size={14} /><a href="#/tenzimleme/marketinq">Marketinq · Kampaniyalar</a></div>
      <div className="tz-split">
        <div className="tz">
          <Card>
            <section className="tz-sec" aria-label="Auditoriya">
              <div className="tz-hsec"><span className="tz-num">1</span><h2>Auditoriya</h2><span className="tz-muted">Müştərilər bazasından</span>
                <span style={{ marginLeft: 'auto' }} className="mono tz-big" aria-live="polite">{ploading || !prev ? '…' : count} <span className="tz-muted" style={{ fontSize: 13 }}>nəfər</span></span></div>
              <div className="tz-stack">
                <Segmented<Mode> label="Alıcı rejimi" value={mode} onChange={setMode} options={[{ value: 'all', label: 'Hamı' }, { value: 'filter', label: 'Süzgəc' }, { value: 'manual', label: 'Əl ilə seç' }]} />
                {mode === 'all' && <p className="tz-muted">Bütün müştərilərə göndəriləcək.</p>}
                {mode === 'manual' && (
                  <div className="tz-pills">
                    {picked.map((p) => <Chosen key={p.id} name={p.full_name} onRemove={() => setPicked(picked.filter((x) => x.id !== p.id))} />)}
                    <button type="button" className="tz-pill tz-pill--dash" onClick={() => setPickOpen(true)}><V2Icon name="plus" size={12} />{picked.length ? 'Müştəri əlavə et' : 'Müştəriləri seçin'}</button>
                  </div>
                )}
                {mode === 'filter' && (
                  <>
                    <Fld label="Hazır süzgəc"><div className="tz-pills">{PRESETS.map(([k, v]) => <Toggle key={k} on={f.preset === k} onClick={() => set({ preset: f.preset === k ? '' : k })}>{v}</Toggle>)}</div></Fld>
                    {tags.data && tags.data.length > 0 && <Fld label="Teqlər"><div className="tz-pills">{tags.data.map((t) => <Toggle key={t.id} on={f.tags.includes(t.id)} onClick={() => set({ tags: toggle(f.tags, t.id) })}>{t.name}</Toggle>)}</div></Fld>}
                    <Field label="İxtisas (hissə üzrə, vergüllə)">{(id) => <TextInput id={id} value={f.professions} onChange={(e) => set({ professions: e.target.value })} placeholder="məs. psixoloq, həkim" />}</Field>
                    <Fld label="Xidmət alıb"><div className="tz-pills">{SERVICES.map(([k, v]) => <Toggle key={k} on={f.services.includes(k)} onClick={() => set({ services: toggle(f.services, k) })}>{v}</Toggle>)}</div></Fld>
                    <Fld label="Haradan tapıb"><div className="tz-pills">{SOURCES.map(([k, v]) => <Toggle key={k} on={f.sources.includes(k)} onClick={() => set({ sources: toggle(f.sources, k) })}>{v}</Toggle>)}</div></Fld>
                    <div className="tz-row2">
                      <Field label="Doğum ayı">{(id) => <select id={id} className="input" value={f.month} onChange={(e) => set({ month: Number(e.target.value) })}><option value={0}>Hamısı</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>}</Field>
                      <Field label="Neçə gündür gəlmir (ən azı)">{(id) => <TextInput id={id} inputMode="numeric" value={f.inactive} onChange={(e) => set({ inactive: e.target.value })} placeholder="0" />}</Field>
                      <Field label="Minimum keşbek (AZN)">{(id) => <TextInput id={id} inputMode="decimal" value={f.cashback} onChange={(e) => set({ cashback: e.target.value })} placeholder="0,00" />}</Field>
                    </div>
                    <TriRow label="Saat paketi" v={f.pkg} on={(pkg) => set({ pkg })} yes="Var" no="Yoxdur" />
                    <TriRow label="App-a qoşulub" v={f.joined} on={(joined) => set({ joined })} yes="Bəli" no="Xeyr" />
                    <TriRow label="Bildiriş" v={f.push} on={(push) => set({ push })} yes="Açıq" no="Bağlı" />
                  </>
                )}
                <div className="tz-info" role="status" style={{ marginBottom: 0 }}>
                  {perr ? <span>{perr}</span> : !prev ? <span>Hesablanır…</span> : count === 0 ? <span>Bu filtrlərlə heç kim tapılmadı. Bir filtri söndürün.</span> : (
                    <>
                      <span>{prev.push_on} nəfərdə bildiriş açıqdır · {prev.opted_out} nəfər təklifləri bağlayıb</span>
                      {prev.recently_messaged > 0 && <span>{prev.recently_messaged} nəfərə bu yaxınlarda mesaj gedib</span>}
                      <span>Yalnız «Təkliflər» açarı açıq müştərilərə gedir</span>
                    </>
                  )}
                </div>
              </div>
            </section>

            <section className="tz-sec" aria-label="Mesaj">
              <div className="tz-hsec"><span className="tz-num">2</span><h2>Mesaj</h2><span className="tz-muted">Dəyişən əlavə et:</span><button type="button" className="tz-var" onClick={() => insertVar('{name}')}>{'{name}'}</button></div>
              <div className="tz-stack">
                <div className="tz-pills">
                  <button type="button" className="tz-pill tz-pill--dash" onClick={() => setSlotsOpen(true)}>Boş saat</button>
                  <button type="button" className="tz-pill tz-pill--dash" onClick={() => tpl({ mode: 'filter', fs: { preset: 'package_candidates' }, title: 'Saat paketi sizə sərfəlidir', body: '{name}, tez-tez çəkiliş edirsiniz — saat paketi ilə daha sərfəli olar. Ətraflı üçün yazın.' })}>Paketə keçid</button>
                  <button type="button" className="tz-pill tz-pill--dash" onClick={() => tpl({ mode: 'filter', fs: { preset: 'podcast_no_reels' }, title: 'Podcastdan Reels', body: '{name}, podcastınızdan Reels kəsimləri hazırlayaq: hər biri 10 AZN (montajla birlikdə). Yazın.' })}>Podcast → Reels</button>
                  <button type="button" className="tz-pill tz-pill--dash" onClick={() => tpl({ mode: 'filter', fs: { professions: 'psixoloq' }, title: 'Psixoloqlar üçün təklif', body: '{name}, ixtisasınıza uyğun podcast və Reels təklifimiz var. Ətraflı üçün yazın.' })}>Psixoloqlar / ixtisas</button>
                  {/* TODO [API] «AI ilə yaz» (31 §2): kampaniya mətni üçün AI endpoint-i yoxdur. */}
                </div>
                <Field label="Başlıq">{(id) => <TextInput id={id} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
                <span className="kp-hd" style={{ marginTop: -10 }}><span /><span className={`mono ${title.trim().length > 80 ? 'tz-count-bad' : 'tz-count-ok'}`}>{title.trim().length} / 80</span></span>
                <Field label="Mətn" hint="{name} — müştərinin adı ilə əvəz olunur">{(id) => <TextArea id={id} data-kp-body maxLength={400} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
                <span className="kp-hd" style={{ marginTop: -10 }}><span /><span className="mono tz-count-ok">{body.trim().length} / 400</span></span>
                <Field label="Link (ixtiyari)" error={urlOk ? undefined : 'Link https:// ilə başlamalıdır'}>{(id, bad) => <TextInput id={id} inputMode="url" autoCapitalize="none" value={url} invalid={bad} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />}</Field>
                {/* TODO [API] Vaxt (31 §3: İndi/Planla, gecə qaydası): kampaniya yalnız dərhal göndərilir, planlama yoxdur. Qaralama da yalnız bu sessiyada saxlanır. */}
              </div>
            </section>
          </Card>
          {send.err && <ErrorBox title="Göndərmək alınmadı" detail={send.err} />}
          <div className="tz-actions tz-actions--end">
            <Button variant="text" onClick={back}>Ləğv et</Button>
            <Button variant="primary" size="lg" disabled={!valid || !online || send.busy} onClick={() => { send.setErr(''); setConfirm(true); }}>{count > 0 ? `${count} nəfərə göndər` : 'Göndər'}</Button>
          </div>
        </div>

        <div className="tz">
          <Card title="Önizləmə">
            <div className="kp-push" data-testid="push-preview">
              <span className="kp-hd"><span>{dateLong(bakuToday())}</span><span className="mono">9:41</span></span>
              <div className="kp-notif"><span className="kp-logo">Y</span><span style={{ minWidth: 0 }}><b>{title.trim() || 'Başlıq'}</b><p>{shown.trim() || 'Mətn burada görünəcək.'}</p></span></div>
            </div>
            <p className="tz-muted" style={{ marginTop: 10 }}>Nümunə ad: {sample}. {'{name}'} hər adama öz adı ilə gedir.</p>
          </Card>
          <Card title="Gözlənilən nəticə" aside={<span className="tz-aside">keçmiş kampaniyalara görə</span>}>
            {openRate === null || bookRate === null ? <p className="tz-muted">Hələ müqayisə üçün kampaniya yoxdur.</p> : (
              <div className="tz-stack">
                <div className="tz-ba"><span>Açma ~{Math.round(openRate * 100)}%</span><span className="mono">{Math.round(count * openRate)}</span></div>
                <div className="bt-bar"><i style={{ width: `${Math.round(openRate * 100)}%` }} /></div>
                <div className="tz-ba"><span>14 gündə yazılma ~{Math.round(bookRate * 100)}%</span><span className="mono">{Math.round(count * bookRate)}</span></div>
                <div className="bt-bar"><i style={{ width: `${Math.min(100, Math.round(bookRate * 100))}%` }} /></div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <ClientPickDialog open={pickOpen} onClose={() => setPickOpen(false)} exclude={picked.map((p) => p.id)} onPick={(c) => setPicked([...picked, { id: c.id, full_name: c.full_name }])} title="Müştəri seç" />
      <SlotsDialog open={slotsOpen} onClose={() => setSlotsOpen(false)} onFill={(t, b) => { setTitle(t); setBody(b); }} />
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Göndərilsin?" subtitle={`«${title.trim()}» · ${count} nəfər`}
        footer={<><Button variant="text" onClick={() => setConfirm(false)}>Ləğv et</Button><Button variant="primary" disabled={send.busy || !online} onClick={submit}>Bəli, göndər</Button></>}>
        <ChangeNote changes={[`${count} müştəriyə app bildirişi gedir (telefonda düşür: ${prev?.push_on ?? 0})`]} unchanged={['Müştərilərin keşbek balansı', 'Çəkilişlər']} />
      </Dialog>
      <Dialog open={leave} onClose={() => setLeave(false)} title="Kampaniya saxlanmayacaq" subtitle="Yazdığınız mətn və seçimlər silinəcək."
        footer={<><Button variant="text" onClick={() => setLeave(false)}>Qal</Button><Button variant="danger" onClick={() => { saveDraft(null); go('tenzimleme/marketinq'); }}>Ləğv et</Button></>} />
    </>
  );
}
