import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney } from '../../../../shared/ui';
import { errMsg, useAuth } from '../../../ctx';
import { addDays, bakuParts, bakuToday, dateLong, dateShort, endMs } from '../../../format';
import { go, useDesktop } from '../../../router';
import { estimateMin } from '../../data/queue';
import type { QueueItem } from '../../data/queue';
import { useShellData } from '../../data/ShellData';
import { shootStatus } from '../../data/status';
import { fmtLeft, msOf } from '../../data/time';
import { PageHeader } from '../../shell/PageHeader';
import { Avatar, Button, Card, EmptyState, ErrorBox, ListRow, LoadingRows, V2Icon, useAfter, useOnline, useToast, Chip } from '../../ui';
import type { Shoot } from '../../../types';
import { DepositDialog } from './DepositDialog';
import { freeRanges, freeText, mx, shootLabel, shortName } from './helpers';
import { ChatPanel, ShootPanel, type PrimaryRef } from './Panels';
import { Timeline } from './Timeline';
import './today.css';

const hhmm = (ms: number) => bakuParts(new Date(ms).toISOString()).time;

/** "Bu gün" (01-bu-gun.md): günün zolağı + növbə + seçilmiş işin paneli. Route: /bu-gun */
export function Today() {
  const sd = useShellData();
  const { call } = useAuth();
  const toast = useToast();
  const desk = useDesktop();
  const online = useOnline();
  const { raw, now, items, leaving, queueCount, error, lastOk } = sd;
  const today = bakuToday();

  const [selKey, setSelKey] = useState<string | null>(null);
  const lastIdx = useRef(0);
  const primaryRef: PrimaryRef = useRef(null);
  const [dep, setDep] = useState<Shoot | null>(null);

  const active = useMemo(() => items.filter((i) => !leaving.has(i.key)), [items, leaving]);
  // R5: seçilmiş sətir yox olanda seçim növbəti sətrə keçir (sonuncu idisə əvvəlkinə).
  const sel = active.find((i) => i.key === selKey) ?? active[Math.min(lastIdx.current, active.length - 1)] ?? null;
  useEffect(() => {
    if (!sel) return;
    lastIdx.current = active.indexOf(sel);
    if (sel.key !== selKey) setSelKey(sel.key);
  }, [sel, active, selKey]);

  const doDeposit = (item: QueueItem) => item.shoot && setDep(item.shoot);
  const doDeliver = (item: QueueItem) => {
    const s = item.shoot!;
    sd.sendLater(item.key, `Təhvil verildi · ${item.name}`, () => call(`/shoots/${s.id}/production`, { method: 'PATCH', body: { production: 'ready', delivery_on: s.delivery_on } }));
  };
  const rowAction = (item: QueueItem) => {
    if (item.kind === 'deposit') return { label: 'Beh alındı', run: () => doDeposit(item) };
    if (item.kind === 'close') return { label: 'Bağla', run: () => go(`shoots/${item.shoot!.id}/close`) };
    if (item.kind === 'delivery') return item.shoot!.materials.length ? { label: 'Təhvil ver', run: () => doDeliver(item) } : { label: 'Link əlavə et', run: () => go('cekilisler/montaj') };
    return null;
  };

  // Klaviatura: J/K seç, ↵ əsas əməl (99 / 00 §8). E (ikinci əməl) — «Xatırlat» üçün endpoint yoxdur.
  useEffect(() => {
    if (!desk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[data-v2-dialog]')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      const i = sel ? active.indexOf(sel) : -1;
      if (k === 'j' && active[i + 1]) { e.preventDefault(); setSelKey(active[i + 1].key); }
      else if (k === 'k' && i > 0) { e.preventDefault(); setSelKey(active[i - 1].key); }
      else if (e.key === 'Enter' && online && primaryRef.current && !(t && /^(BUTTON|A)$/.test(t.tagName) && !t.closest('.row__hit'))) { e.preventDefault(); primaryRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desk, active, sel, online]);

  // ---- Zolaq məlumatı ----
  const todays = useMemo(() => (raw ? raw.dash.today.filter((s) => s.status !== 'cancelled' && s.status !== 'no_show') : []), [raw]);
  const current = todays.find((s) => shootStatus(s, now) === 'now');
  const next = todays.find((s) => { const st = shootStatus(s, now); return (st === 'deposit' || st === 'confirmed') && msOf(s.starts_at) > now; });
  const tomorrow = addDays(today, 1);
  const tomorrowCount = raw ? raw.shoots.filter((s) => s.status !== 'cancelled' && s.status !== 'no_show' && bakuParts(s.starts_at).date === tomorrow).length : 0;

  const extend = async (s: Shoot) => {
    const body = { starts_at: s.starts_at, duration_min: s.duration_min + 30, kind: s.kind, tag: s.tag, location: s.location, cameras: s.cameras, editing: s.editing, reels_count: s.reels_count,
      address: s.address, title: s.title, note: s.note, discount: s.discount, discount_note: s.discount_note, prep_min: s.prep_min, wrap_min: s.wrap_min, extras: s.extras };
    try {
      await call(`/shoots/${s.id}`, { method: 'PATCH', body });
      sd.reload();
      toast.show(`Uzadıldı · ${hhmm(endMs(s.starts_at, s.duration_min + 30))}-dək`, {
        undo: () => { call(`/shoots/${s.id}`, { method: 'PATCH', body: { ...body, duration_min: s.duration_min } }).then(sd.reload).catch((e) => toast.show(`Alınmadı: ${errMsg(e)}`, { error: true })); },
      });
    } catch (e) { toast.show(`Alınmadı: ${errMsg(e)}`, { error: true, retry: () => void extend(s) }); }
  };
  // Uzatma toqquşursa düymə deaktiv + ipucu «20:30-da Elvin var» (99 G14).
  const clash = (() => {
    if (!current || !raw) return null;
    const end = endMs(current.starts_at, current.duration_min + current.wrap_min);
    const cands = [...todays.filter((s) => s.id !== current.id && msOf(s.starts_at) - s.prep_min * 60_000 >= end - 1).map((s) => ({ at: msOf(s.starts_at) - s.prep_min * 60_000, who: shortName(s.client_name) })),
      ...raw.blocks.filter((b) => msOf(b.starts_at) >= end - 1).map((b) => ({ at: msOf(b.starts_at), who: 'blok' }))].sort((a, b) => a.at - b.at)[0];
    return cands && cands.at < end + 30 * 60_000 ? `${hhmm(cands.at)}-da ${cands.who} var` : null;
  })();

  const loading = !raw && !error;
  const showSkeleton = useAfter();
  const est = estimateMin(queueCount);
  const [wd] = dateLong(today).split(', ');
  const title = desk ? dateLong(today) : `${wd}, ${dateShort(today)}`;
  const sub = raw && <><b className="mono">{queueCount}</b> iş gözləyir{est > 0 && <> · təxminən <span className="mono">{est} dəq</span></>}</>;

  const stripe = raw && (
    todays.length === 0 && raw.blocks.length === 0 ? (
      <Card small label="Günün zolağı">
        <EmptyState title="Boş gün · boş vaxtları paylaşmaq üçün" reason="Bu gün 08:00–22:00 arası heç bir çəkiliş planlanmayıb."
          action={<Button size="sm" onClick={() => { navigator.clipboard?.writeText(freeText(freeRanges([], raw.blocks))).then(() => toast.show('Kopyalandı'), () => toast.show('Kopyalanmadı', { error: true })); }}>Boş vaxtları kopyala</Button>} />
      </Card>
    ) : desk ? (
      <Card small label="Günün zolağı">
        <div className="tl-head">
          {current && (
            <>
              <span className="tl-now"><span className="dot" />İndi studiyada</span>
              <b>{current.client_name}</b>
              <span className="tl-sub">{shootLabel(current)} · <b className="mono">{fmtLeft(endMs(current.starts_at, current.duration_min) - now)}</b> qalıb</span>
              <Button size="row" disabled={!online || !!clash} title={clash ?? undefined} onClick={() => void extend(current)}>+30 dəq</Button>
            </>
          )}
          {next && (
            <span className="tl-next">Sonra: <b>{next.client_name}</b> · <span className="mono">{bakuParts(next.starts_at).time}</span>
              {shootStatus(next, now) === 'deposit' && <> · <b className="tl-dep">beh yox</b></>}
              {tomorrowCount > 0 && <> · sabah <span className="mono">{tomorrowCount}</span> çəkiliş</>}</span>
          )}
        </div>
        <Timeline shoots={todays} blocks={raw.blocks} now={now} />
      </Card>
    ) : (current || next) ? (
      <section className="mnow" aria-label="İndi studiyada">
        {current ? (
          <>
            <div className="mnow__r"><span className="tl-now tl-now--sm"><span className="dot" />İndi studiyada</span><span className="mnow__left"><b className="mono">{fmtLeft(endMs(current.starts_at, current.duration_min) - now)}</b> qalıb</span></div>
            <div className="mnow__name">{current.client_name}</div>
            <div className="mnow__bar" role="progressbar" aria-label="Çəkilişin gedişi" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(1, Math.max(0, (now - msOf(current.starts_at)) / (current.duration_min * 60_000))) * 100)}>
              <i style={{ width: `${Math.round(Math.min(1, Math.max(0, (now - msOf(current.starts_at)) / (current.duration_min * 60_000))) * 100)}%` }} />
            </div>
          </>
        ) : null}
        {next && (
          <div className="mnow__r"><span className="tl-sub">Sonra: <b>{shortName(next.client_name)}</b> · <span className="mono">{bakuParts(next.starts_at).time}</span></span>
            {shootStatus(next, now) === 'deposit' && <Chip tone="deposit">beh yox</Chip>}</div>
        )}
      </section>
    ) : null
  );

  const emptyQueue = raw && queueCount === 0;
  const showError = error && !(raw && online && !error);
  const retryIn = <>Son uğurlu yenilənmə <span className="mono">{lastOk ? hhmm(lastOk) : '—'}</span> · avtomatik yenidən cəhd 30 san sonra</>;

  return (
    <>
      <PageHeader title={title} sub={sub} newShoot="secondary" />
      {raw && raw.botEnabled === false && (
        <div className="bar bar--warn" role="status">
          <span><b>Bot söndürülüb:</b> bütün mesajlar sizə düşür</span>
          <Button size="sm" disabled={!online} onClick={() => { call('/bot/settings', { method: 'POST', body: { bot_enabled: true } }).then(() => { sd.reload(); toast.show('Yadda saxlandı'); }).catch((e) => toast.show(`Alınmadı: ${errMsg(e)}`, { error: true })); }}>Botu yandır</Button>
        </div>
      )}
      {loading && showSkeleton && <Card small label="Yüklənir"><LoadingRows rows={1} /></Card>}
      {stripe}
      <div className="today">
        <Card flush label="Növbə">
          <div className="card__head" style={{ padding: '0 12px' }}>
            <h2 className="card__title">Növbə <small>· ən təcilisi yuxarıda</small></h2>
            {desk && <span className="q-hint"><kbd>J</kbd> <kbd>K</kbd> keç</span>}
          </div>
          {!online && raw && <div className="q-state"><div className="bar bar--offline">İnternet yoxdur · <span className="mono">{lastOk ? hhmm(lastOk) : '—'}</span> vəziyyəti</div></div>}
          {showError && <div className="q-state"><ErrorBox title="Növbə yüklənmədi · internet bağlantısını yoxlayın" detail={retryIn} onRetry={sd.reload} /></div>}
          {loading && <LoadingRows rows={5} label="Növbə yüklənir" />}
          {emptyQueue && !showError && <EmptyQueue />}
          {desk ? items.map((it, i) => {
            const a = rowAction(it);
            return (
              <ListRow key={it.key} n={i + 1} leaving={leaving.has(it.key)} selected={sel?.key === it.key} onSelect={() => setSelKey(it.key)}
                avatar={<Avatar name={it.name} tone={sel?.key === it.key ? 'brand' : it.avatar} />}
                title={<>{it.verb} · {it.name}{it.amount && <span className="mono"> · {it.amount}</span>}</>}
                meta={mx(it.meta)} metaTone={it.metaTone} time={it.right}
                actions={a && <Button size="row" disabled={!online} onClick={a.run}>{a.label}</Button>} />
            );
          }) : <MobileList items={items} leaving={leaving} rowAction={rowAction} primaryRef={primaryRef} online={online} />}
          {desk && raw && !emptyQueue && current && (
            <div className="q-foot"><span>{(raw.dash.bot_handled_today ?? 0) > 0 && `bot özü apardı: ${raw.dash.bot_handled_today} söhbət`}</span>
              <span>Bağlanma: {current.client_name} · <span className="mono">{fmtLeft(endMs(current.starts_at, current.duration_min) - now)}</span> sonra</span></div>
          )}
        </Card>
        {desk && (
          <aside className="today__side" aria-label="Seçilmiş iş">
            {sel ? (
              <Card label="Seçilmiş iş">
                {sel.kind === 'chat'
                  ? <ChatPanel key={sel.key} item={sel} primaryRef={primaryRef} />
                  : <ShootPanel key={sel.key} item={sel} primaryRef={primaryRef} onDeposit={() => doDeposit(sel)} onDeliver={() => doDeliver(sel)} />}
              </Card>
            ) : emptyQueue ? <DaySummary /> : null}
          </aside>
        )}
      </div>
      <DepositDialog shoot={dep} onClose={() => setDep(null)} onDone={(_a, s) => { sd.dismiss(`deposit:${s.id}`); sd.reload(); toast.show(`Beh alındı · ${s.client_name}`); /* TODO [API] «Geri al»: behi geri qaytaran endpoint yoxdur. */ }} />
    </>
  );
}

/** Mobil: hər iş ayrı kart; ilk söhbət işi açıq (son mesaj + qaralama + Göndər). Düyməsiz söhbət sətri → tam söhbət. */
function MobileList({ items, leaving, rowAction, primaryRef, online }: {
  items: QueueItem[]; leaving: ReadonlySet<string>; rowAction: (i: QueueItem) => { label: string; run: () => void } | null; primaryRef: PrimaryRef; online: boolean;
}) {
  const first = items.find((i) => !leaving.has(i.key));
  return (
    <div className="mlist">
      {items.map((it) => {
        const open = it.kind === 'chat' && first?.key === it.key;
        const a = rowAction(it);
        const cls = `mcard${open ? ' mcard--open' : ''}${leaving.has(it.key) ? ' row--leaving' : ''}`;
        const head = (
          <>
            <Avatar name={it.name} tone={open ? 'brand' : it.avatar} large />
            <span className="row__main" style={{ display: 'block' }}>
              <span className="row__title" style={{ display: 'block' }}>{it.verb} · {it.name}{it.amount && <span className="mono"> · {it.amount}</span>}</span>
              <span className={`row__meta${it.metaTone ? ` row__meta--${it.metaTone}` : ''}`} style={{ display: 'block' }}>{mx(it.meta)}</span>
            </span>
            {it.right && <span className="row__time mono">{it.right}</span>}
          </>
        );
        if (open) return <article key={it.key} className={cls}><div className="mcard__h">{head}</div><ChatPanel item={it} primaryRef={primaryRef} compact /></article>;
        if (it.kind === 'chat') return <a key={it.key} className={`${cls} mcard--link`} href={`#/inbox/${it.conv!.id}`}>{head}<V2Icon name="chev" size={18} /></a>;
        return <article key={it.key} className={cls}><div className="mcard__h">{head}{a && <Button disabled={!online} onClick={a.run}>{a.label}</Button>}</div></article>;
      })}
    </div>
  );
}

/** Növbə boş (FableBosNovbe): «Sonra nə düşəcək», «Vaxtınız var», altda Telegram qeydi. */
function EmptyQueue() {
  const { raw, now } = useShellData();
  if (!raw) return null;
  const todays = raw.dash.today.filter((s) => s.status !== 'cancelled' && s.status !== 'no_show');
  const rows: { at: string; text: string }[] = [];
  const cur = todays.find((s) => shootStatus(s, now) === 'now');
  if (cur) rows.push({ at: hhmm(endMs(cur.starts_at, cur.duration_min)), text: `Çəkilişi bağla · ${cur.client_name} · çəkiliş bitəndə` });
  for (const s of todays) {
    const st = shootStatus(s, now);
    if (st === 'deposit' || st === 'confirmed') rows.push({ at: bakuParts(s.starts_at).time, text: `${s.client_name} · ${shootLabel(s)}${st === 'deposit' ? ' · beh gözlənilir' : ''}` });
  }
  const tm = addDays(bakuToday(), 1);
  const tmr = raw.shoots.filter((s) => s.status !== 'cancelled' && s.status !== 'no_show' && bakuParts(s.starts_at).date === tm);
  if (tmr.length) rows.push({ at: `sabah ${bakuParts(tmr[0].starts_at).time}`, text: `ilk çəkiliş · sabah ${tmr.length} çəkiliş` });
  const cold = raw.convs.filter((c) => c.lead_stage && !['geldi', 'itirildi'].includes(c.lead_stage) && c.last_message?.direction === 'out' && c.last_message_at && now - msOf(c.last_message_at) >= 2 * 86_400_000).length;
  return (
    <div className="eq">
      <div className="eq__t">Növbə boşdur</div>
      {/* TODO [API] «Bu gün N iş bitirdiniz · bot N söhbəti özü apardı»: server bu günün görülən iş və bot söhbət sayını vermir. */}
      {rows.length > 0 && (
        <>
          <div className="eq__h">Sonra nə düşəcək</div>
          {rows.slice(0, 3).map((r) => <div key={r.at + r.text} className="eq__r"><span className="mono eq__at">{r.at}</span><span>{r.text}</span></div>)}
        </>
      )}
      {cold > 0 && (
        <div className="state"><span className="state__t">Vaxtınız var: <span className="mono">{cold}</span> lead 2 gündür cavabsızdır</span><a className="btn btn--secondary btn--sm" href="#/insanlar">Bax</a></div>
      )}
      <p className="eq__n">Yeni iş gələndə növbədə görünəcək, bot ötürsə Telegram bildirişi gəlir.</p>
    </div>
  );
}

/** Növbə boş olanda sağ panel: «Bu günün yekunu». */
function DaySummary() {
  const { raw, now } = useShellData();
  if (!raw) return null;
  const today = bakuToday();
  const todays = raw.dash.today.filter((s) => s.status !== 'cancelled' && s.status !== 'no_show');
  const sts = todays.map((s) => shootStatus(s, now));
  const done = sts.filter((x) => ['to_close', 'editing', 'delivered', 'done'].includes(x)).length;
  const going = sts.filter((x) => x === 'now').length;
  const ahead = sts.filter((x) => x === 'deposit' || x === 'confirmed').length;
  const dayOf = (iso: string | null) => (iso ? bakuParts(iso).date : '');
  const deposits = raw.shoots.filter((s) => dayOf(s.deposit_received_at) === today);
  // 01: «bağlanmış çəkilişlər və alınan behlər» (geri qaytarmalar nəzərə alınmır).
  const income = deposits.reduce((a, s) => a + s.deposit_amount, 0) + raw.shoots.filter((s) => dayOf(s.closed_at) === today).reduce((a, s) => a + s.paid_at_studio, 0);
  return (
    <Card title="Bu günün yekunu" aside={<span className="mono q-hint">{today.slice(8, 10)}.{today.slice(5, 7)} · {hhmm(now)}</span>}>
      <dl className="pn__facts">
        <div><dt>Çəkiliş</dt><dd><span className="mono">{todays.length}</span> · <span className="mono">{done}</span> tamamlandı · <span className="mono">{going}</span> indi gedir · <span className="mono">{ahead}</span> qarşıda</dd></div>
        <div><dt>Gəlir bu gün</dt><dd className="mono">{formatMoney(income)}</dd></div>
        {deposits.length > 0 && <div><dt>Beh alındı</dt><dd><span className="mono">{deposits.length}</span> · {deposits.map((s) => s.client_name).join(', ')}</dd></div>}
      </dl>
    </Card>
  );
}
