import { useEffect, useMemo, useState } from 'react';
import { Button, Sheet } from '../../shared/ui';
import { AIcon } from '../components/AIcon';
import { ASeg, useCountUp } from '../components/neon';
import { ClientPickerSheet } from '../components/ClientPicker';
import { Err, Field, SOURCES, TAG } from '../components/common';
import { TagEditor } from '../components/TagEditor';
import { useAction, useAuth } from '../ctx';
import { addDays, bakuToday, dateLong, parseAzn } from '../format';
import type React from 'react';
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
    <div className="a3-tri">
      <span className="flabel">{label}</span>
      <ASeg<Tri> pill label={label} value={v} onChange={on} options={[{ value: '', label: 'Fərqi yoxdur' }, { value: 'yes', label: yes }, { value: 'no', label: no }]} />
    </div>
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
  const [fopen, setFopen] = useState(true);
  const [tplOn, setTplOn] = useState('');
  const [fly, setFly] = useState(false);
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
    if (r) { setDone(`Göndərildi: ${r.recipients} alıcı`); setFly(true); window.setTimeout(() => { setFly(false); setTitle(''); setBody(''); setUrl(''); }, 420); window.setTimeout(() => setDone(''), 8000); onSent(); }
  }

  // Şablonlar formu doldurur
  function tpl(p: { mode: Mode; fs?: Partial<Fs>; title: string; body: string }, key: string) {
    setTplOn(key);
    setMode(p.mode); setF({ ...EMPTY, ...p.fs }); setTitle(p.title); setBody(p.body); setDone('');
  }

  const cnt = useCountUp(prev?.count, 180);
  const nActive = mode === 'filter' ? Object.keys(filters).length : 0;
  const chipOn = (on: boolean) => `a3-cb${on ? ' on' : ''}`;

  return (
    <div className="a3-cmp">
      <div className="a3-cl">
        <section className="a-g a-rise" style={{ '--i': 1 } as React.CSSProperties} aria-label="Şablonlar">
          <h2 className="a-cardh">Şablonlar</h2>
          <div className="a3-cbs">
            <SlotsTemplate on={tplOn === 'bs'} onFill={(t, b) => { setTitle(t); setBody(b); setDone(''); setTplOn('bs'); }} />
            <button type="button" className={chipOn(tplOn === 'pk')} onClick={() => tpl({ mode: 'filter', fs: { preset: 'package_candidates' }, title: 'Saat paketi sizə sərfəlidir', body: '{name}, tez-tez çəkiliş edirsiniz — saat paketi ilə daha sərfəli olar. Ətraflı üçün yazın.' }, 'pk')}>Paketə keçid</button>
            <button type="button" className={chipOn(tplOn === 'pr')} onClick={() => tpl({ mode: 'filter', fs: { preset: 'podcast_no_reels' }, title: 'Podcastdan Reels', body: '{name}, podcastınızdan Reels kəsimləri hazırlayaq: hər biri 10 AZN (montajla birlikdə). Yazın.' }, 'pr')}>Podcast → Reels</button>
            <button type="button" className={chipOn(tplOn === 'ps')} onClick={() => tpl({ mode: 'filter', fs: { professions: 'psixoloq' }, title: 'Psixoloqlar üçün təklif', body: '{name}, ixtisasınıza uyğun podcast və Reels təklifimiz var. Ətraflı üçün yazın.' }, 'ps')}>Psixoloqlar / ixtisas</button>
          </div>
        </section>

        <section className="a-g a-rise" style={{ '--i': 2 } as React.CSSProperties} aria-label="Kimə">
          <h2 className="a-cardh">Kimə</h2>
          <ASeg<Mode> pill label="Alıcı rejimi" value={mode} onChange={(m) => { setMode(m); setDone(''); }} options={[{ value: 'all', label: 'Hamı' }, { value: 'filter', label: 'Süzgəc' }, { value: 'manual', label: 'Əl ilə seç' }]} />
          {mode === 'all' && <p className="a3-hint0">Bütün müştərilərə göndəriləcək.</p>}
          {mode === 'manual' && (
            <>
              <div className="a3-cbs">
                {picked.map((p) => <button key={p.id} type="button" className="a3-cb on" aria-label={`${p.full_name} sil`} onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>{p.full_name} <AIcon name="x" size={14} /></button>)}
              </div>
              <button type="button" className="a-bg a3-fit" onClick={() => setPickOpen(true)}><AIcon name="plus" size={16} /> {picked.length ? 'Müştəri əlavə et' : 'Müştəriləri seçin'}</button>
              <ClientPickerSheet open={pickOpen} onClose={() => setPickOpen(false)} exclude={picked.map((p) => p.id)} onPick={(c) => setPicked([...picked, { id: c.id, full_name: c.full_name }])} />
            </>
          )}
          {mode === 'filter' && (
            <>
              <button type="button" className="a3-fh" aria-expanded={fopen} onClick={() => setFopen(!fopen)}>
                <b>Süzgəc</b>{nActive > 0 && <span className="a3-nb">{nActive} aktiv</span>}<AIcon name={fopen ? 'chevu' : 'chevd'} size={20} />
              </button>
              <div className={`a3-fb${fopen ? '' : ' shut'}`}>
                <Field label="Hazır süzgəc">
                  <div className="a3-cbs">
                    {PRESETS.map(([k, v]) => <button key={k} type="button" className={chipOn(f.preset === k)} aria-pressed={f.preset === k} onClick={() => set({ preset: f.preset === k ? '' : k })}>{v}</button>)}
                  </div>
                </Field>
                <Field label="Teqlər"><TagEditor value={f.tags} onChange={(tags) => set({ tags })} /></Field>
                <Field label="İxtisas (hissə üzrə, vergüllə)" id="cp-pr"><input id="cp-pr" className="inp" value={f.professions} onChange={(e) => set({ professions: e.target.value })} placeholder="məs. psixoloq, həkim" /></Field>
                <Field label="Xidmət alıb">
                  <div className="a3-cbs">{SERVICES.map(([k, v]) => <button key={k} type="button" className={chipOn(f.services.includes(k))} aria-pressed={f.services.includes(k)} onClick={() => set({ services: toggle(f.services, k) })}>{v}</button>)}</div>
                </Field>
                <Field label="Haradan tapıb">
                  <div className="a3-cbs">{SOURCES.map(([k, v]) => <button key={k} type="button" className={chipOn(f.sources.includes(k))} aria-pressed={f.sources.includes(k)} onClick={() => set({ sources: toggle(f.sources, k) })}>{v}</button>)}</div>
                </Field>
                <div className="a3-two">
                  <Field label="Doğum ayı" id="cp-bm">
                    <select id="cp-bm" className="inp" value={f.month} onChange={(e) => set({ month: Number(e.target.value) })}>
                      <option value={0}>Hamısı</option>
                      {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m[0].toUpperCase() + m.slice(1)}</option>)}
                    </select>
                  </Field>
                  <Field label="Neçə gündür gəlmir (ən azı)" id="cp-in"><input id="cp-in" className="inp" inputMode="numeric" value={f.inactive} onChange={(e) => set({ inactive: e.target.value })} placeholder="0" /></Field>
                  <Field label="Minimum keşbek (AZN)" id="cp-cb"><input id="cp-cb" className="inp" inputMode="decimal" value={f.cashback} onChange={(e) => set({ cashback: e.target.value })} placeholder="0,00" /></Field>
                </div>
                <TriChips label="Saat paketi" v={f.pkg} on={(pkg) => set({ pkg })} yes="Var" no="Yoxdur" />
                <TriChips label="App-a qoşulub" v={f.joined} on={(joined) => set({ joined })} yes="Bəli" no="Xeyr" />
                <TriChips label="Bildiriş" v={f.push} on={(push) => set({ push })} yes="Açıq" no="Bağlı" />
              </div>
            </>
          )}
          <div className="a3-prev" role="status" data-testid="preview" aria-live="polite" style={{ opacity: ploading ? 0.6 : 1 }}>
            {prev ? (
              prev.count === 0 ? <b className="a3-pn">Bu seçimə uyğun müştəri yoxdur.</b> : (
                <>
                  <b className="a3-pn">{cnt ?? prev.count} müştəriyə gedəcək</b>
                  <span>{prev.push_on}-də bildiriş açıqdır · {prev.opted_out} nəfər təklifləri bağlayıb</span>
                  {prev.recently_messaged > 0 && <span className="dim">{prev.recently_messaged} nəfərə bu yaxınlarda mesaj gedib.</span>}
                  {prev.sample.length > 0 && <span className="dim">Məs.: {prev.sample.map((s) => s.full_name.split(' ')[0]).join(', ')}</span>}
                </>
              )
            ) : <span>{perr || 'Hesablanır…'}</span>}
            <small>Yalnız «Təkliflər» açarı açıq müştərilərə gedir.</small>
          </div>
          {prev && perr && <Err msg={perr} />}
        </section>
      </div>

      <div className="a3-cr">
        <section className="a-g a-rise" style={{ '--i': 3 } as React.CSSProperties} aria-label="Mesaj">
          <h2 className="a-cardh">Mesaj</h2>
          <Field label={<span className="a3-lc">Başlıq<small>{title.trim().length}/80</small></span>} id="cp-t"><input id="cp-t" className="inp" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label={<span className="a3-lc">Mətn<small>{body.trim().length}/400</small></span>} id="cp-b" hint="{name} — müştərinin adı ilə əvəz olunur."><textarea id="cp-b" className="inp ta" maxLength={400} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <Field label="Link (ixtiyari)" id="cp-u"><input id="cp-u" className="inp" inputMode="url" autoCapitalize="none" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
          {!urlOk && <Err msg="Link https:// ilə başlamalıdır." />}
        </section>

        <section className="a-g a-rise" style={{ '--i': 4 } as React.CSSProperties} aria-label="Telefonda belə görünəcək">
          <h2 className="a-cardh">Telefonda belə görünəcək</h2>
          <div className="a3-ph" data-testid="push-preview">
            <span className="a3-pd">{dateLong(bakuToday())}</span>
            <span className="a3-pt">9:41</span>
            <div className={`a3-pn2${fly ? ' fly' : ''}`}>
              <span className="a3-fpl">Y</span>
              <span className="a3-fpm">
                <span className="a3-fpr"><b>{title.trim() || 'Başlıq'}</b><em>indi</em></span>
                <span>{shown.trim() || 'Mətn burada görünəcək.'}</span>
              </span>
            </div>
          </div>
        </section>
        <Err msg={send.err} />
        <button type="button" className="a-bp a3-wide a3-go" disabled={!valid || send.busy} onClick={() => { send.setErr(''); setConfirm(true); }}><AIcon name="send" size={18} /> Göndər</button>
      </div>

      {done && (
        <div className="a-toastw"><div className="a-toast a3-toast2" role="status">
          <AIcon name="check" size={18} /><span>{done}</span><i aria-hidden="true">·</i>
          <a className="a3-tl" href="#/campaigns" onClick={() => { onHistory(); setDone(''); }}>Tarixçəyə bax</a>
          <button type="button" className="a3-tx" aria-label="Bağla" onClick={() => setDone('')}><AIcon name="x" size={16} /></button>
        </div></div>
      )}

      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Göndərilsin?">
        <p className="a3-sp"><b>{prev?.count ?? 0} müştəriyə</b> «{title.trim()}» təklifi göndəriləcək. Bildiriş yalnız {prev?.push_on ?? 0} nəfərə telefona düşəcək, hamısı app-da görəcək.</p>
        <Err msg={send.err} />
        <div className="a3-brow a3-brow-st">
          <Button variant="out" onClick={() => setConfirm(false)}>Ləğv et</Button>
          <Button disabled={send.busy} onClick={submit}>Bəli, göndər</Button>
        </div>
      </Sheet>
    </div>
  );
}

// «Boş saat» şablonu: gün seç → boş saatları gətir → saatları seç → mətnə yaz.
function SlotsTemplate({ onFill, on }: { onFill: (title: string, body: string) => void; on?: boolean }) {
  const { call } = useAuth();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(addDays(bakuToday(), 1));
  const { busy, err, run } = useAction();
  const [empty, setEmpty] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [pick, setPick] = useState<number[]>([]);
  const today = bakuToday();
  const dayLabel = (d: string) => (d === today ? 'Bu gün' : d === addDays(today, 1) ? 'Sabah' : '');
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  if (!days.includes(day)) days.push(day);

  function write(sl: Slot[], idx: number[]) {
    const chosen = sl.filter((_, i) => idx.includes(i));
    if (!chosen.length) return;
    const label = dayLabel(day) || dateLong(day);
    onFill('Boş saat var', `${label} ${chosen.map((x) => `${x.start}–${x.end}`).join(', ')} boşdur — yazılın`);
  }

  async function fetchSlots() {
    setEmpty(false); setSlots(null); setPick([]);
    const s = await run(() => call<Slot[]>(`/free-slots?day=${day}`));
    if (!s) return;
    if (!s.length) { setEmpty(true); return; }
    setSlots(s);
    const all = s.map((_, i) => i);
    setPick(all);
    write(s, all);
  }

  function toggle(i: number) {
    if (!slots) return;
    const next = pick.includes(i) ? pick.filter((x) => x !== i) : [...pick, i].sort((a, b) => a - b);
    setPick(next);
    write(slots, next);
  }

  return (
    <>
      <button type="button" className={`a3-cb${on ? ' on' : ''}`} onClick={() => setOpen(true)}>Boş saat</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Boş saat">
        <Field label="Gün" id="fs-d">
          <select id="fs-d" className="inp" value={day} onChange={(e) => { setDay(e.target.value); setSlots(null); setEmpty(false); }}>
            {days.map((d) => <option key={d} value={d}>{dayLabel(d) ? `${dayLabel(d)} · ${dateLong(d)}` : dateLong(d)}</option>)}
          </select>
        </Field>
        <Err msg={err} />
        <button type="button" className="a-bp a-bw" disabled={!day || busy} onClick={fetchSlots}>Boş saatları gətir</button>
        {empty && <p className="a3-sp">Həmin gün boş saat yoxdur.</p>}
        {slots && (
          <div className="a3-slots">
            <span className="a3-lb">Boş saatlar</span>
            <div className="a3-opts">
              {slots.map((x, i) => (
                <button key={i} type="button" className={`a3-slot${pick.includes(i) ? ' on' : ''}`} aria-pressed={pick.includes(i)} onClick={() => toggle(i)}>
                  <AIcon name="clock" size={16} />{x.start}–{x.end}
                </button>
              ))}
            </div>
            <p className="a3-sp">Seçilən saatlar mesaja yazılacaq.</p>
          </div>
        )}
      </Sheet>
    </>
  );
}
