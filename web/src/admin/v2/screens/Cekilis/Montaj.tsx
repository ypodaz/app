import { useState } from 'react';
import { errMsg, useAction, useAuth, useLoad } from '../../../ctx';
import { addDays, bakuParts, bakuToday, dateShort, dateWd, range } from '../../../format';
import { go } from '../../../router';
import type { Material, Production, Shoot } from '../../../types';
import { Button, Dialog, EmptyState, ErrorBox, Field, LoadingRows, Segmented, TextInput, useOnline, useToast } from '../../ui';
import { CekHead } from './Head';
import { Ic, personName, refresh, svcText } from './bits';

const PROD: { value: Production; label: string }[] = [{ value: 'none', label: 'Material gözləyir' }, { value: 'editing', label: 'Montajda' }, { value: 'ready', label: 'Təhvil verildi' }];

/** Çəkilişlər › Montaj (13): üç sütun (production). «Hamısı» montajsızları da göstərir. */
export function Montaj() {
  const today = bakuToday();
  const q = useLoad<Shoot[]>(`/shoots?${range(addDays(today, -120), addDays(today, 14))}`);
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState<Shoot | null>(null);
  const done = (q.data ?? []).filter((s) => s.status === 'completed' && (all || s.editing)).reverse();
  const cols = PROD.map((c) => ({ ...c, items: done.filter((s) => s.production === c.value) }));
  // Hələ montaj gözləyən (təhvil verilməyən) sayı
  const open = done.filter((s) => s.production !== 'ready').length;
  // TODO [API] «Son təhvillər» (vaxtında/gecikmiş): Shoot-da delivered_at yoxdur, yalnız delivery_on (plan) var.
  // TODO [API] «Hazır, təhvil gözləyir» ayrıca sütunu: production yalnız none/editing/ready-dir (ready = təhvil verilib).
  return (
    <>
      <CekHead tab="montaj" sub={q.data ? <><b className="mono">{open}</b> iş davam edir</> : undefined}
        tools={<Segmented<'wait' | 'all'> label="Filtr" value={all ? 'all' : 'wait'} onChange={(v) => setAll(v === 'all')} options={[{ value: 'wait', label: 'Montajlılar' }, { value: 'all', label: 'Hamısı' }]} />} />
      {q.err ? <ErrorBox title="Montaj yüklənmədi" detail={q.err} onRetry={q.reload} />
        : !q.data ? <LoadingRows rows={5} />
        : !done.length ? <EmptyState title="Material gözləyən çəkiliş yoxdur" reason="Montajlı bağlanmış çəkilişlər burada görünəcək. Montajsızlar «Hamısı»ndadır." />
        : (
          <div className="ck-board">
            {cols.map((c) => (
              <section key={c.value} className="ck-board__c" aria-label={c.label}>
                <h2 className="ck-board__h">{c.label} <span className="mono">{c.items.length}</span></h2>
                {c.items.length === 0 && <p className="ck-sub">Boşdur</p>}
                {c.items.map((s) => {
                  const p = bakuParts(s.starts_at);
                  return (
                    <article key={s.id} className="ck-job">
                      <button type="button" className="ck-job__h" onClick={() => go(`cekilisler/teqvim?tarix=${p.date}&gorunus=gun&secili=${s.id}`)}>
                        <b>{personName(s)}</b><span className="ck-sub">{svcText(s)} · {dateShort(p.date)}, {p.time}</span>
                      </button>
                      <p className="ck-sub">{s.delivery_on ? <>Təhvil: <b className="mono">{dateShort(s.delivery_on)}</b></> : 'Təhvil tarixi yoxdur'} · {s.materials.length} link</p>
                      <Button size="sm" onClick={() => setEdit(s)}>Status və linklər</Button>
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      {edit && <JobDialog shoot={(q.data ?? []).find((x) => x.id === edit.id) ?? edit} onClose={() => { setEdit(null); q.reload(); }} />}
    </>
  );
}

function JobDialog({ shoot: s, onClose }: { shoot: Shoot; onClose: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const [prod, setProd] = useState<Production>(s.production);
  const [delivery, setDelivery] = useState(s.delivery_on ?? '');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [ask, setAsk] = useState<Material | null>(null);
  const save = useAction();
  const add = useAction();
  const del = useAction();
  const [links, setLinks] = useState<Material[]>(s.materials);
  const urlOk = /^https:\/\/\S+$/.test(url.trim());

  async function saveStatus() {
    if (await save.run(() => call(`/shoots/${s.id}/production`, { method: 'PATCH', body: { production: prod, delivery_on: delivery || null } })) !== undefined) {
      toast.show(prod === 'ready' ? 'Təhvil verildi · müştəriyə bildiriş getdi' : 'Yadda saxlanıldı'); refresh(); onClose();
    }
  }
  async function addLink() {
    const m = await add.run(() => call<Material>(`/shoots/${s.id}/materials`, { body: { title: title.trim(), drive_url: url.trim() } }));
    if (m !== undefined && m) { setLinks([...links, m as Material]); setTitle(''); setUrl(''); }
  }
  async function remove(m: Material) {
    setAsk(null);
    if (await del.run(() => call(`/materials/${m.id}`, { method: 'DELETE' })) !== undefined) setLinks(links.filter((x) => x.id !== m.id));
  }
  const p = bakuParts(s.starts_at);
  return (
    <Dialog open onClose={onClose} title={personName(s)} subtitle={<>{svcText(s)} · {dateWd(p.date)}, {p.time}</>}
      footer={<><Button variant="text" onClick={onClose}>Bağla</Button><Button variant="primary" disabled={!online || save.busy} onClick={saveStatus}>Statusu saxla</Button></>}>
      <div className="field"><span className="field__label">Status</span><Segmented<Production> label="Montaj statusu" value={prod} onChange={setProd} options={PROD} /></div>
      {prod === 'ready' && <p className="ck-info">«Təhvil verildi» seçiləndə müştəriyə bildiriş göndəriləcək.</p>}
      <Field label="Təhvil tarixi">{(id) => <TextInput id={id} type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} />}</Field>
      {save.err && <span className="field__err" role="alert">{save.err}</span>}
      <h3 className="ck-sec__h">Drive linkləri</h3>
      {links.map((m) => (
        <div key={m.id} className="ck-line">
          <Ic name="drive" /><span>{m.title}</span>
          <a href={m.drive_url} target="_blank" rel="noopener" aria-label={`${m.title} aç`}><Ic name="ext" /></a>
          <button type="button" className="ck-ico" aria-label={`${m.title} sil`} onClick={() => setAsk(m)}><Ic name="trash" /></button>
        </div>
      ))}
      {!links.length && <p className="ck-sub">Hələ link əlavə olunmayıb.</p>}
      <Field label="Material adı">{(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="məs. Söhbət #13" />}</Field>
      <Field label="Google Drive linki" hint="Link https:// ilə başlamalıdır." error={url && !urlOk ? 'Link https:// ilə başlamalıdır' : undefined}>{(id, invalid) => <TextInput id={id} invalid={invalid} inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/…" />}</Field>
      {(add.err || del.err) && <span className="field__err" role="alert">{add.err || del.err}</span>}
      <Button size="sm" disabled={!online || !title.trim() || !urlOk || add.busy} onClick={addLink}>Link əlavə et</Button>
      {ask && (
        <Dialog open onClose={() => setAsk(null)} title="Link silinsin?" subtitle={`«${ask.title}» linki materialdan silinəcək.`}
          footer={<><Button variant="text" onClick={() => setAsk(null)}>Geri</Button><Button variant="primary" onClick={() => remove(ask)}>Sil</Button></>}><span /></Dialog>
      )}
    </Dialog>
  );
}
void errMsg;
