import { useEffect, useState, type ReactNode } from 'react';
import { formatHours, formatMoney, formatMoney2 } from '../../../../shared/ui';
import { useAction, useAuth, useLoad } from '../../../ctx';
import { bakuParts, busyRange, dateShort, dateWd, timeRange } from '../../../format';
import type { Shoot } from '../../../types';
import { shootStatus } from '../../data/status';
import { ddmm } from '../../data/time';
import { Avatar, Button, Chip, EmptyState, ErrorBox, LoadingRows, StatusChip, useOnline, useToast } from '../../ui';
import { DepositDialog } from '../Today/DepositDialog';
import { CancelDialog, CloseDialog, NoShowDialog, RescheduleDialog } from './Dialogs';
import { NewShootDialog } from './NewShoot';
import { SRC_LABEL, money, nextStep, personName, readOnly, refresh, srcOf, svcText } from './bits';

const STAGES = ['Beh', 'Təsdiq', 'İndi', 'Bağla', 'Montaj', 'Təhvil'];
const STAGE_AT: Record<string, number> = { deposit: 0, confirmed: 1, now: 2, to_close: 3, editing: 4, delivered: 5, done: 3 };

export type PanelDialog = 'edit' | 'close' | 'cancel' | null;

/** Seçilmiş çəkilişin paneli (10 yan panel, 12 sağ panel). Köhnə ShootDetail-in bütün əməlləri burada. */
export function ShootPanel({ id, now, initial, onInitialDone, children }: { id: number | null; now: number; initial?: PanelDialog; onInitialDone?: () => void; children?: ReactNode }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const { data: s, err, reload } = useLoad<Shoot>(id ? `/shoots/${id}` : null);
  const act = useAction();
  const [dlg, setDlg] = useState<PanelDialog | 'dep' | 'resched' | 'noshow'>(initial ?? null);
  useEffect(() => { if (initial) setDlg(initial); }, [initial, id]);
  const closeDlg = () => { const was = dlg; setDlg(null); if (was === initial) onInitialDone?.(); reload(); };

  if (!id) return <div className="ck-panel">{children ?? <EmptyState title="Çəkiliş seçin" reason="Siyahıdan və ya təqvimdən bir çəkilişə toxunun." />}</div>;
  if (err) return <div className="ck-panel"><ErrorBox title="Çəkiliş yüklənmədi" detail={err} onRetry={reload} /></div>;
  if (!s) return <div className="ck-panel"><LoadingRows rows={4} /></div>;

  const st = shootStatus(s, now);
  const src = srcOf(s);
  const ro = readOnly(s);
  const open = s.status === 'confirmed' && !ro;
  const off = s.status === 'cancelled' || s.status === 'no_show';
  const next = nextStep(s, now);
  const p = bakuParts(s.starts_at);
  const cur = STAGE_AT[st];
  const post = (path: string, okMsg: string) => act.run(() => call(`/shoots/${s.id}/${path}`, { body: {} })).then((r) => { if (r !== undefined) { toast.show(okMsg); refresh(); reload(); } });

  // G14: «+30 dəq» çəkilişin sonunu uzadır (PATCH, bütün sahələr olduğu kimi)
  async function extend() {
    const endMin = Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3)) + s!.duration_min + 30;
    if (endMin > 22 * 60) { toast.show('Alınmadı: studiya 22:00-da bağlanır', { error: true }); return; }
    const body = { starts_at: s!.starts_at, duration_min: s!.duration_min + 30, kind: s!.kind, tag: s!.tag, location: s!.location, cameras: s!.cameras, editing: s!.editing,
      reels_count: s!.reels_count, address: s!.address, title: s!.title, note: s!.note, discount: s!.discount, discount_note: s!.discount_note, prep_min: s!.prep_min, wrap_min: s!.wrap_min, extras: s!.extras ?? [] };
    const r = await act.run(() => call(`/shoots/${s!.id}`, { method: 'PATCH', body }));
    if (r !== undefined) { toast.show(`Uzadıldı · ${endMin >= 600 ? '' : '0'}${Math.floor(endMin / 60)}:${String(endMin % 60).padStart(2, '0')}-dək`); refresh(); reload(); }
  }

  const lines: [string, number][] = s.kind === 'reels_pack'
    ? [['Reels paketi', s.price_base]]
    : s.kind === 'studio_rent' ? [[`Müştəri özü çəkir · ${formatHours(s.duration_min)}`, s.price_base]]
    : [[s.package_id ? 'Paketdən saatlar' : `${s.cameras} kameralı ${formatHours(s.duration_min)} çəkiliş`, s.price_base], ['Əlavə kamera', s.price_extra_camera], ['Montaj', s.price_editing], [`Podcastdan Reels · ${s.reels_count} əd.`, s.price_reels]];

  return (
    <div className="ck-panel" aria-label="Seçilmiş çəkiliş">
      <div className="ck-panel__head">
        <Avatar name={personName(s)} tone={off ? 'cancel' : undefined} large />
        <div className="ck-panel__who">
          <a className="ck-panel__name" href={`#/insanlar/${s.client_id}`}>{personName(s)}</a>
          <span className="ck-sub"><span className="mono">{dateWd(p.date)} · {timeRange(s.starts_at, s.duration_min)}</span></span>
        </div>
        {off ? <Chip tone="cancel">Ləğv</Chip> : <StatusChip status={st} />}
      </div>
      {(src !== 'app') && <div className="ck-chips-row"><Chip tone={src === 'apple' ? 'confirmed' : 'neutral'}>{SRC_LABEL[src]}</Chip>{src === 'arxiv' && <Chip tone="neutral">keşbek —</Chip>}</div>}

      {!off && !ro && (
        <ol className="ck-stages" aria-label={`Mərhələ: ${STAGES[cur]}`}>
          {STAGES.map((n, i) => <li key={n} className={i < cur || (st === 'done' && i <= 3) ? 'is-done' : i === cur && st !== 'done' ? 'is-cur' : undefined}><i />{n}</li>)}
        </ol>
      )}

      <div className={`ck-next${next.act ? ' ck-next--act' : ''}`}>
        <div className="ck-next__t"><b>{next.text}</b>{next.ctx && <span className={next.tone ? `ck-tone-${next.tone}` : undefined}>{next.ctx}</span>}</div>
        {open && next.act === 'deposit' && (
          <div className="ck-acts">
            <Button variant="primary" kbd="E" disabled={!online} onClick={() => setDlg('dep')}>Beh alındı</Button>
            <Button disabled={!online || act.busy} onClick={() => post('deposit/waive', `Behsiz təsdiq · ${personName(s)}`)}>Behsiz təsdiq</Button>
          </div>
        )}
        {open && next.act === 'close' && <div className="ck-acts"><Button variant="primary" kbd="E" disabled={!online} onClick={() => setDlg('close')}>Çəkilişi bağla</Button></div>}
        {open && next.act === 'extend' && (
          <div className="ck-acts">
            <Button disabled={!online || act.busy} onClick={extend}>+30 dəq</Button>
            <Button disabled={!online} onClick={() => setDlg('close')}>Çəkilişi bağla</Button>
          </div>
        )}
      </div>
      {/* TODO [API] «Xatırlat» (WhatsApp beh xatırlatması): endpoint yoxdur. */}

      {off && (
        <section className="ck-box">
          <h3 className="ck-box__h">Ləğv</h3>
          {s.cancel_window && <p className="ck-info">{({ gt24: '24 saatdan əvvəl ləğv: cərimə yoxdur, beh tam qaytarılır.', lt24: '24 saatdan az qalıb: beh tutulur.', no_show: 'Gəlmədi: beh tutulur.' })[s.cancel_window]}</p>}
          <dl className="ck-facts">
            {s.deposit_received_at && <div><dt>Beh alınıb · {dateShort(bakuParts(s.deposit_received_at).date)}</dt><dd className="mono">{formatMoney2(s.deposit_amount)}</dd></div>}
            <div><dt>Tutulur</dt><dd className="mono">{formatMoney2(s.retained_amount)}</dd></div>
            <div className="ck-facts__sum"><dt>Qaytarılacaq</dt><dd className="mono">{formatMoney2(s.refund_amount)}</dd></div>
          </dl>
          {s.refund_amount > 0 && (s.refunded_at ? <Chip tone="done">Qaytarıldı</Chip>
            : <Button disabled={!online || act.busy} onClick={() => post('refunded', 'Qaytarıldı qeyd olundu')}>Qaytarıldı · {formatMoney2(s.refund_amount)}</Button>)}
        </section>
      )}

      <dl className="ck-facts">
        <div><dt>Xidmət</dt><dd>{svcText(s)}</dd></div>
        <div><dt>Yer</dt><dd>{s.location === 'studio' ? 'Studiyada' : s.address || 'Məkanda'}</dd></div>
        {!off && <div><dt>Studiya məşğul</dt><dd className="mono">{busyRange(p.time, s.duration_min, s.prep_min, s.wrap_min)}</dd></div>}
        {!ro && <div><dt>Məbləğ</dt><dd className="mono">{money(s.total)}{s.package_id ? ' · paketdən' : ''}</dd></div>}
        {!ro && s.deposit_received_at && <div><dt>Beh</dt><dd className="mono">{formatMoney(s.deposit_amount)} · alınıb</dd></div>}
        {!ro && !s.deposit_received_at && s.deposit_expected > 0 && !s.deposit_waived && <div><dt>Beh (50%)</dt><dd className="mono">{formatMoney(s.deposit_expected)} · gözlənilir</dd></div>}
        {!ro && s.deposit_waived && <div><dt>Beh</dt><dd>0 AZN (behsiz təsdiq)</dd></div>}
        {open && <div><dt>Qalıq</dt><dd className="mono">{formatMoney2(s.studio_balance)}</dd></div>}
        {s.status === 'completed' && s.paid_at_studio > 0 && <div><dt>Studiyada ödənib</dt><dd className="mono">{formatMoney2(s.paid_at_studio)} · {s.paid_method === 'card' ? 'kart' : 'nağd'}</dd></div>}
        {s.status === 'completed' && s.editing && <div><dt>Montaj</dt><dd>{s.production === 'ready' ? 'Hazırdır' : s.production === 'editing' ? 'Montajda' : 'Material gözləyir'}{s.delivery_on ? ` · təhvil ${ddmm(s.delivery_on)}` : ''} · <a href="#/cekilisler/montaj">Montaj</a></dd></div>}
        <div><dt>Müştəri</dt><dd><a href={`#/insanlar/${s.client_id}`}>Müştəri kartı</a></dd></div>
        {s.note && <div><dt>Qeyd</dt><dd>{s.note}</dd></div>}
      </dl>

      {!ro && (
        <details className="ck-det">
          <summary>Ödəniş təfərrüatı</summary>
          <dl className="ck-facts">
            {lines.filter(([, v]) => v > 0).map(([l, v]) => <div key={l}><dt>{l}</dt><dd className="mono">{formatMoney2(v)}</dd></div>)}
            {(s.extras ?? []).map((x, i) => <div key={i}><dt>{x.name}</dt><dd className="mono">{formatMoney2(x.amount)}</dd></div>)}
            {s.discount > 0 && <div><dt>Endirim{s.discount_note ? ` · ${s.discount_note}` : ''}</dt><dd className="mono">{formatMoney2(-s.discount)}</dd></div>}
            <div className="ck-facts__sum"><dt>{s.discount > 0 ? 'Yekun' : 'Cəmi'}</dt><dd className="mono">{formatMoney2(s.total)}</dd></div>
            {s.cashback_used > 0 && <div><dt>Keşbekdən</dt><dd className="mono">{formatMoney2(-s.cashback_used)}</dd></div>}
          </dl>
          {s.payment_line && <p className="ck-sub" data-testid="payment-line">{s.payment_line}</p>}
        </details>
      )}

      {act.err && <span className="field__err" role="alert">{act.err}</span>}
      {open && (
        <div className="ck-acts ck-acts--sec">
          <Button size="sm" disabled={!online} onClick={() => setDlg('resched')}>Vaxtı dəyiş</Button>
          <Button size="sm" disabled={!online} onClick={() => setDlg('edit')}>Düzəlt</Button>
          <Button size="sm" disabled={!online || act.busy} onClick={() => setDlg('noshow')}>Gəlmədi</Button>
          <Button size="sm" variant="danger" disabled={!online} onClick={() => setDlg('cancel')}>Çəkilişi ləğv et</Button>
        </div>
      )}
      {children}

      <DepositDialog shoot={dlg === 'dep' ? s : null} onClose={closeDlg} onDone={(amount) => { toast.show(`Beh qeyd edildi · ${personName(s)} · ${formatMoney(amount)} · Təsdiqləndi`); refresh(); reload(); }} />
      {dlg === 'resched' && <RescheduleDialog shoot={s} onClose={closeDlg} />}
      {dlg === 'cancel' && <CancelDialog shoot={s} onClose={closeDlg} />}
      {dlg === 'close' && <CloseDialog shoot={s} onClose={closeDlg} />}
      {dlg === 'noshow' && <NoShowDialog shoot={s} onClose={closeDlg} />}
      {dlg === 'edit' && <NewShootDialog editId={s.id} query={new URLSearchParams()} onClose={closeDlg} />}
    </div>
  );
}
