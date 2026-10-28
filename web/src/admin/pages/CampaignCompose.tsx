import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Icon, Segmented, Sheet } from '../../shared/ui';
import { ClientPickerSheet } from '../components/ClientPicker';
import { Err, Field, SOURCES, TAG } from '../components/common';
import { TagEditor } from '../components/TagEditor';
import { useAction, useAuth } from '../ctx';
import { addDays, bakuToday, dateLong, parseAzn } from '../format';
import type { Campaign, Filters, Preview, ServiceKey, Slot } from '../types';

type Mode = 'all' | 'filter' | 'manual';
type Tri = '' | 'yes' | 'no';
const SERVICES: [ServiceKey, string][] = [['podcast', TAG.podcast], ['reels', TAG.reels], ['other', TAG.other], ['reels_pack', 'Reels paketi'], ['studio_rent', 'Studiya icarəsi']];
const PRESETS: [NonNullable<Filters['preset']>, string][] = [['package_candidates', 'Paketə keçid namizədləri'], ['podcast_no_reels', 'Podcast çəkib, Reels yox']];
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];

type Fs = {
  tags: number[]; professions: string; services: ServiceKey[]; sources: string[]; inactive: string; pkg: Tri; cashback: string; month: number;
  joined: Tri; push: Tri; preset: Filters['preset'] | '';
};
const EMPTY: Fs = { tags: [], professions: '', services: [], sources: [], inactive: '', pkg: '', cashback: '', month: 0, joined: '', push: '', preset: '' };

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

function TriChips({ label, v, on, yes, no }: { label: string; v: Tri; on: (v: Tri) => void; yes: string; no: string }) {
  return (
    <Field label={label}>
      <Segmented<Tri> label={label} value={v} onChange={on} options={[{ value: '', label: 'Fərqi yoxdur' }, { value: 'yes', label: yes }, { value: 'no', label: no }]} />
    </Field>
  );
}

function toggle<T>(list: T[], x: T): T[] { return list.includes(x) ? list.filter((y) => y !== x) : [...list, x]; }

export function CampaignCompose({ onSent, onHistory }: { onSent: () => void; onHistory: () => void }) {
  const { call } = useAuth();
  const [mode, setMode] = useState<Mode>('all');
  const [f, setF] = useState<Fs>(EMPTY);
  const [picked, setPicked] = useState<{ id: number; full_name: string }[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState('');
  const send = useAction();
  const set = (p: Partial<Fs>) => setF((x) => ({ ...x, ...p }));

  const filters = useMemo(() => buildFilters(mode, f, picked), [mode, f, picked]);
  const key = JSON.stringify(filters);

  // Önizləmə: hər dəyişiklikdən 400ms sonra.
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
        .catch((e) => { if (live) setPerr(e instanceof Error ? e.message : 'Xəta baş verdi.'); })
        .finally(() => live && setPloading(false));
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [key, mode, picked.length, call]);

  const urlOk = !url.trim() || /^https:\/\/\S+$/.test(url.trim());
  const valid = title.trim().length >= 2 && body.trim().length >= 2 && urlOk && !!prev && prev.count > 0;
  const sampleName = prev?.sample[0]?.full_name.split(' ')[0] ?? 'Aysel';
  const shown = body.replace(/\{name\}/g, sampleName);

  async function submit() {
    const r = await send.run(() => call<Campaign>('/campaigns', { body: { title: title.trim(), body: body.trim(), ...(url.trim() ? { url: url.trim() } : {}), filters: JSON.parse(key) } }));
    setConfirm(false);
    if (r) { setDone(`Göndərildi: ${r.recipients} alıcı.`); setTitle(''); setBody(''); setUrl(''); onSent(); }
  }

  // Şablonlar formu doldurur
  function tpl(p: { mode: Mode; fs?: Partial<Fs>; title: string; body: string }) {
    setMode(p.mode); setF({ ...EMPTY, ...p.fs }); setTitle(p.title); setBody(p.body); setDone('');
  }

  return (
    <div className="rs-cols">
      <div className="col" style={{ gap: 14 }}>
        <Card>
          <span className="h3">Şablonlar</span>
          <div className="chips">
            <SlotsTemplate onFill={(t, b) => { setTitle(t); setBody(b); setDone(''); }} />
            <button type="button" className="chip" onClick={() => tpl({ mode: 'filter', fs: { preset: 'package_candidates' }, title: 'Saat paketi sizə sərfəlidir', body: '{name}, tez-tez çəkiliş edirsiniz — saat paketi ilə daha sərfəli olar. Ətraflı üçün yazın.' })}>Paketə keçid</button>
            <button type="button" className="chip" onClick={() => tpl({ mode: 'filter', fs: { preset: 'podcast_no_reels' }, title: 'Podcastdan Reels', body: '{name}, podcastınızdan Reels kəsimləri hazırlayaq: hər biri 10 AZN (montajla birlikdə). Yazın.' })}>Podcast → Reels</button>
            <button type="button" className="chip" onClick={() => tpl({ mode: 'filter', fs: { professions: 'psixoloq' }, title: 'Psixoloqlar üçün təklif', body: '{name}, ixtisasınıza uyğun podcast və Reels təklifimiz var. Ətraflı üçün yazın.' })}>Psixoloqlar / ixtisas</button>
          </div>
        </Card>

        <Card>
          <span className="h3">Kimə</span>
          <Segmented<Mode> label="Alıcı rejimi" value={mode} onChange={(m) => { setMode(m); setDone(''); }} options={[{ value: 'all', label: 'Hamı' }, { value: 'filter', label: 'Süzgəc' }, { value: 'manual', label: 'Əl ilə seç' }]} />
          {mode === 'manual' && (
            <>
              <div className="chips">
                {picked.map((p) => <button key={p.id} type="button" className="chip chip-on" aria-label={`${p.full_name} sil`} onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>{p.full_name} <Icon name="close" size={14} /></button>)}
              </div>
              <Button variant="out" small auto onClick={() => setPickOpen(true)}><Icon name="plus" size={16} /> Müştəri əlavə et</Button>
              <ClientPickerSheet open={pickOpen} onClose={() => setPickOpen(false)} exclude={picked.map((p) => p.id)} onPick={(c) => setPicked([...picked, { id: c.id, full_name: c.full_name }])} />
            </>
          )}
          {mode === 'filter' && (
            <>
              <Field label="Hazır süzgəc">
                <div className="chips">
                  {PRESETS.map(([k, v]) => <button key={k} type="button" className={`chip${f.preset === k ? ' chip-on' : ''}`} aria-pressed={f.preset === k} onClick={() => set({ preset: f.preset === k ? '' : k })}>{v}</button>)}
                </div>
              </Field>
              <Field label="Teqlər"><TagEditor value={f.tags} onChange={(tags) => set({ tags })} /></Field>
              <Field label="İxtisas (hissə üzrə, vergüllə)" id="cp-pr"><input id="cp-pr" className="inp" value={f.professions} onChange={(e) => set({ professions: e.target.value })} placeholder="məs. psixoloq, həkim" /></Field>
              <Field label="Xidmət alıb">
                <div className="chips">{SERVICES.map(([k, v]) => <button key={k} type="button" className={`chip${f.services.includes(k) ? ' chip-on' : ''}`} aria-pressed={f.services.includes(k)} onClick={() => set({ services: toggle(f.services, k) })}>{v}</button>)}</div>
              </Field>
              <Field label="Haradan tapıb">
                <div className="chips">{SOURCES.map(([k, v]) => <button key={k} type="button" className={`chip${f.sources.includes(k) ? ' chip-on' : ''}`} aria-pressed={f.sources.includes(k)} onClick={() => set({ sources: toggle(f.sources, k) })}>{v}</button>)}</div>
              </Field>
              <Field label="Neçə gündür gəlmir (ən azı)" id="cp-in"><input id="cp-in" className="inp" inputMode="numeric" value={f.inactive} onChange={(e) => set({ inactive: e.target.value })} placeholder="məs. 60" /></Field>
              <Field label="Minimum keşbek (AZN)" id="cp-cb"><input id="cp-cb" className="inp" inputMode="decimal" value={f.cashback} onChange={(e) => set({ cashback: e.target.value })} placeholder="məs. 10" /></Field>
              <Field label="Doğum ayı" id="cp-bm">
                <select id="cp-bm" className="inp" value={f.month} onChange={(e) => set({ month: Number(e.target.value) })}>
                  <option value={0}>—</option>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m[0].toUpperCase() + m.slice(1)}</option>)}
                </select>
              </Field>
              <TriChips label="Saat paketi" v={f.pkg} on={(pkg) => set({ pkg })} yes="Var" no="Yoxdur" />
              <TriChips label="App-a qoşulub" v={f.joined} on={(joined) => set({ joined })} yes="Bəli" no="Xeyr" />
              <TriChips label="Bildiriş" v={f.push} on={(push) => set({ push })} yes="Açıq" no="Bağlı" />
            </>
          )}
          <div className="banner" role="status" data-testid="preview" aria-live="polite" style={{ flexDirection: 'column', gap: 6, opacity: ploading ? 0.6 : 1 }}>
            {prev ? (
              <>
                <span><b>{prev.count} müştəriyə gedəcək</b> · {prev.push_on}-də bildiriş açıqdır · {prev.opted_out} nəfər təklifləri bağlayıb</span>
                {prev.recently_messaged > 0 && <span className="t12 soft">{prev.recently_messaged} nəfərə bu yaxınlarda mesaj gedib.</span>}
                {prev.sample.length > 0 && <span className="t12 soft">Məs.: {prev.sample.map((s) => s.full_name).join(', ')}</span>}
              </>
            ) : <span>{perr || 'Hesablanır…'}</span>}
          </div>
          {prev && perr && <Err msg={perr} />}
          <span className="hint">Yalnız “Təkliflər” açarı açıq müştərilərə gedir.</span>
        </Card>
      </div>

      <div className="col" style={{ gap: 14 }}>
        <Card>
          <span className="h3">Mesaj</span>
          <Field label={`Başlıq (${title.trim().length}/80)`} id="cp-t"><input id="cp-t" className="inp" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label={`Mətn (${body.trim().length}/400)`} id="cp-b" hint="{name} — müştərinin adı ilə əvəz olunur."><textarea id="cp-b" className="inp ta" maxLength={400} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <Field label="Link (ixtiyari)" id="cp-u"><input id="cp-u" className="inp" inputMode="url" autoCapitalize="none" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
          {!urlOk && <Err msg="Link https:// ilə başlamalıdır." />}
          <span className="lbl">Telefonda belə görünəcək</span>
          <div className="ax-push" data-testid="push-preview">
            <span className="ic ic-sq"><Icon name="send" size={18} /></span>
            <span className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="t13 w8" style={{ overflowWrap: 'anywhere' }}>{title.trim() || 'Başlıq'}</span>
              <span className="t13 soft" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{shown.trim() || 'Mətn burada görünəcək.'}</span>
            </span>
          </div>
          <Err msg={send.err} />
          {done && <p className="t13 neon" role="status">{done} <a href="#/campaigns" onClick={onHistory}>Tarixçəyə bax</a></p>}
          <Button disabled={!valid || send.busy} onClick={() => { send.setErr(''); setConfirm(true); }}><Icon name="send" size={18} /> Göndər</Button>
        </Card>
      </div>

      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Göndərilsin?">
        <p className="t14 lh"><b>{prev?.count ?? 0} müştəriyə</b> «{title.trim()}» təklifi göndəriləcək. Bildiriş yalnız {prev?.push_on ?? 0} nəfərə telefona düşəcək, hamısı app-da görəcək.</p>
        <Err msg={send.err} />
        <Button disabled={send.busy} onClick={submit}>Bəli, göndər</Button>
        <Button variant="ghost" onClick={() => setConfirm(false)}>Ləğv et</Button>
      </Sheet>
    </div>
  );
}

// «Boş saat» şablonu: gün seç → boş saatları gətir → mətnə yaz.
function SlotsTemplate({ onFill }: { onFill: (title: string, body: string) => void }) {
  const { call } = useAuth();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(addDays(bakuToday(), 1));
  const { busy, err, run } = useAction();
  const [empty, setEmpty] = useState(false);

  async function fetchSlots() {
    setEmpty(false);
    const s = await run(() => call<Slot[]>(`/free-slots?day=${day}`));
    if (!s) return;
    if (!s.length) { setEmpty(true); return; }
    const today = bakuToday();
    const label = day === today ? 'Bu gün' : day === addDays(today, 1) ? 'Sabah' : dateLong(day);
    onFill('Boş saat var', `${label} ${s.map((x) => `${x.start}–${x.end}`).join(', ')} boşdur — yazılın`);
    setOpen(false);
  }

  return (
    <>
      <button type="button" className="chip" onClick={() => setOpen(true)}>Boş saat</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Boş saat">
        <Field label="Gün" id="fs-d"><input id="fs-d" type="date" className="inp" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Err msg={err} />
        {empty && <p className="t13 muted">Həmin gün boş saat yoxdur.</p>}
        <Button disabled={!day || busy} onClick={fetchSlots}>Boş saatları gətir</Button>
      </Sheet>
    </>
  );
}
