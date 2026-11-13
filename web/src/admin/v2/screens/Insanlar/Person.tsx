import { useMemo, useState, type ReactNode } from 'react';
import { formatHours, formatMoney } from '../../../../shared/ui';
import { ProfileSheet } from '../../../components/ProfileSheet';
import { sourceName } from '../../../components/common';
import { lostLabel, serviceLabel } from '../../../components/crm';
import { useLoad } from '../../../ctx';
import { appLine, bakuParts, dateFull, dateShort } from '../../../format';
import { goBack } from '../../../router';
import type { ClientDetail, LedgerRow } from '../../../types';
import { shootStatus } from '../../data/status';
import { ddmmTime } from '../../data/time';
import { shootLabel } from '../Today/helpers';
import { PageHeader } from '../../shell/PageHeader';
import { Avatar, Button, Card, Chip, EmptyState, ErrorBox, LoadingRows, Segmented, StatusChip, V2Icon, useAfter, useOnline } from '../../ui';
import { CashbackDialog, CashbackRowDialog, EditClientDialog, InviteDialog } from './CardDialogs';
import { LostDialog, RemindDialog } from './Dialogs';
import { StageChip } from './LeadViews';
import { OPEN_STAGES, STAGE_LABEL, agoShort, isConverted, leadName, phoneShown, remindDue, remindText, useLeads, type Lead, type Stage } from './data';
import './insanlar.css';

const MIN_USE = 7000; // 70 AZN həddi (00 §5.2)
const KIND: Record<LedgerRow['kind'], string> = {
  earn: 'Çəkiliş keşbeki', earn_first: 'İlk çəkiliş bonusu', spend: 'Keşbekdən istifadə', spend_return: 'Keşbek qaytarıldı', manual: 'Əl ilə düzəliş',
  profile_bonus: 'Profil bonusu', referral: 'Dost dəvəti bonusu', birthday: 'Ad günü hədiyyəsi',
};
const signed = (q: number) => `${q > 0 ? '+' : q < 0 ? '−' : ''}${formatMoney(Math.abs(q)).replace(' AZN', '')}`;
/** 055 530 35 32 → 994555303532 (wa.me üçün). */
const waNumber = (phone: string) => { const d = phone.replace(/\D/g, ''); return d.startsWith('0') && d.length === 10 ? `994${d.slice(1)}` : d; };

const Back = () => <div><Button variant="text" size="sm" icon={<V2Icon name="back" />} onClick={() => goBack('insanlar')}>İnsanlar</Button></div>;

/** Mərhələ zolağı (22): Yeni → Maraqlanır → Tarix → Beh → Çəkilişə çevrildi. Yalnız lead-də basılır. */
function Steps({ stage, converted, onPick, disabled }: { stage: Stage; converted: boolean; onPick?: (s: Stage) => void; disabled?: boolean }) {
  const idx = converted ? 4 : OPEN_STAGES.indexOf(stage);
  const items: { key: Stage | 'conv'; label: string }[] = [...OPEN_STAGES.map((s) => ({ key: s, label: STAGE_LABEL[s] })), { key: 'conv', label: 'Çəkilişə çevrildi' }];
  return (
    <ol className="ins-steps" aria-label="Lead mərhələləri">
      {items.map((it, i) => {
        const state = i < idx ? 'done' : i === idx ? 'cur' : 'todo';
        const body = <>{state === 'done' && <V2Icon name="check" size={14} sw={2} />}{it.label}</>;
        const pickable = onPick && it.key !== 'conv' && i !== idx;
        return (
          <li key={it.key} className={`ins-step ins-step--${state}`} aria-current={state === 'cur' ? 'step' : undefined}>
            {pickable ? <button type="button" disabled={disabled} onClick={() => onPick(it.key as Stage)}>{body}</button> : <span>{body}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function KV({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ins-kv"><span>{label}</span><span>{children || <span className="ins-dim">—</span>}</span></div>;
}

// ===================== Müştəri kartı =====================
export function ClientCardV2({ id }: { id: number }) {
  const detail = useLoad<ClientDetail>(`/clients/${id}`);
  const online = useOnline();
  const showSkeleton = useAfter();
  const c = detail.data;
  const [tab, setTab] = useState<'all' | 'shoot' | 'cb'>('all');
  const [cb, setCb] = useState(false);
  const [row, setRow] = useState<LedgerRow | null>(null);
  const [edit, setEdit] = useState(false);
  const [prof, setProf] = useState(false);
  const [inv, setInv] = useState(false);
  const now = Date.now();

  const history = useMemo(() => {
    if (!c) return [];
    const a = c.shoots.map((s) => ({ t: new Date(s.starts_at).getTime(), kind: 'shoot' as const, s }));
    const b = c.cashback_rows.map((r) => ({ t: new Date(r.created_at).getTime(), kind: 'cb' as const, r }));
    return [...a, ...b].sort((x, y) => y.t - x.t);
  }, [c]);
  // TODO [API] Tarixçədə «Söhbət» və «Qeyd» hadisələri və daxili qeyd əlavə etmək: müştəriyə bağlı söhbət/qeyd endpoint-i yoxdur (22-insan-karti.md #11, #13). Yalnız tək `notes` sahəsi var (Redaktə).
  const shown = history.filter((h) => tab === 'all' || h.kind === tab);

  if (!c) {
    return (
      <>
        <PageHeader title="İnsan kartı" newShoot={false} more={false} />
        <Back />
        {detail.err ? <ErrorBox title="İnsan yüklənmədi · internet bağlantısını yoxlayın" detail={detail.err} onRetry={detail.reload} /> : (showSkeleton ? <LoadingRows rows={5} /> : null)}
        {detail.err && <Button onClick={() => goBack('insanlar')}>İnsanlara qayıt</Button>}
      </>
    );
  }
  const started = c.shoots.filter((s) => s.status !== 'cancelled' && s.status !== 'no_show' && new Date(s.starts_at).getTime() <= now);
  const closed = c.shoots.filter((s) => s.status === 'completed').length;
  const bal = c.cashback_balance;
  const okLimit = bal >= MIN_USE, okShoots = closed >= 2;
  const scale = Math.max(12000, bal);
  const first = [...c.shoots].sort((x, y) => x.starts_at.localeCompare(y.starts_at))[0];
  const wa = c.phone ? `https://wa.me/${waNumber(c.phone)}` : '';
  const ig = c.instagram?.replace(/^@/, '');

  return (
    <>
      <PageHeader title="İnsan kartı" newShoot={false} more={false} />
      <Back />
      <div className="ins-person">
        <div className="ins-main">
          <Card label="İnsan">
            <div className="ins-id">
              <Avatar name={c.full_name} large />
              <div className="ins-id__t">
                <h2 className="ins-id__n">{c.full_name}</h2>
                <div className="ins-id__m">
                  <Chip tone="done">Müştəri · <span className="mono">{started.length}</span> çəkiliş</Chip>
                  <span className="mono">{phoneShown(c.phone) || 'telefon yoxdur'}</span>
                  <span className="ins-app"><i className={c.activated ? 'on' : ''} aria-hidden="true" />{appLine(c).replace('App: ', 'App · ')}</span>
                </div>
                {!!c.tags?.length && <div className="ins-tags">{c.tags.map((t) => <Chip key={t.id}>{t.name}</Chip>)}</div>}
                {c.notes && <p className="ins-note">Qeyd: {c.notes}</p>}
              </div>
              <Button variant="text" size="sm" onClick={() => setEdit(true)} disabled={!online}>Redaktə et</Button>
            </div>
            <div className="ins-acts">
              {wa
                // TODO [API] «Yaz WhatsApp» Inbox söhbətini açmalıdır (/inbox/:söhbət); müştəri ilə söhbət arasında əlaqə endpoint-i yoxdur, indi wa.me açılır.
                ? <a className="btn btn--primary btn--lg" href={wa} target="_blank" rel="noopener noreferrer">Yaz WhatsApp</a>
                : <Button variant="primary" size="lg" disabled title="Telefon yoxdur">Yaz WhatsApp</Button>}
              {c.phone ? <a className="btn btn--secondary btn--lg" href={`tel:+${waNumber(c.phone)}`}>Zəng et</a> : <Button size="lg" disabled>Zəng et</Button>}
              <a className="btn btn--secondary btn--lg" href={`#/shoots/new?client=${c.id}`}>Çəkiliş yaz</a>
            </div>
            <Steps stage="geldi" converted />
          </Card>
          {c.deposit_required && <p className="ins-banner ins-banner--warn"><V2Icon name="alert" /> <b>Beh mütləqdir</b> · müştəri əvvəl gəlməyib.</p>}
          {/* TODO [API] «Növbəti addım» bloku (Keşbeki xatırlat, Rəy istə …): server hesablanmış addım vermir (22-insan-karti.md #7–#8). */}

          <Card title={<>Tarixçə <small className="mono">{history.length}</small></>} aside={
            <Segmented label="Tarixçə filtri" value={tab} onChange={setTab} options={[
              { value: 'all', label: 'Hamısı', count: history.length }, { value: 'shoot', label: 'Çəkiliş', count: c.shoots.length }, { value: 'cb', label: 'Keşbek', count: c.cashback_rows.length },
            ]} />}>
            {shown.length === 0 ? <EmptyState title={tab === 'all' ? 'Hələ çəkiliş və ya keşbek yoxdur' : 'Bu növdə hadisə yoxdur'} reason={tab === 'all' ? 'Çəkiliş yazanda burada görünəcək.' : undefined} /> : (
              <ul className="ins-hist">
                {shown.map((h) => h.kind === 'shoot' ? (
                  <li key={`s${h.s.id}`}>
                    <a className="ins-hrow" href={`#/shoots/${h.s.id}`}>
                      <V2Icon name="cal" />
                      <span className="ins-hrow__t"><b>Çəkiliş</b> · {shootLabel(h.s)}{h.s.editing ? ' + montaj' : ''} · <span className="mono">{formatMoney(h.s.total)}</span><span className="ins-sub">{h.s.payment_line}</span></span>
                      <span className="mono ins-dim2">{ddmmTime(h.s.starts_at)}</span>
                      <StatusChip status={shootStatus(h.s, now)} />
                    </a>
                  </li>
                ) : (
                  <li key={`c${h.r.id}`}>
                    {h.r.kind === 'manual'
                      ? <button type="button" className="ins-hrow" onClick={() => setRow(h.r)} disabled={!online} aria-label={`${KIND[h.r.kind]} · redaktə et`}><HistCb r={h.r} /></button>
                      : <div className="ins-hrow"><HistCb r={h.r} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="ins-side" aria-label="Yan panel">
          <Card title="Keşbek" aside={<span className="mono ins-kb">{formatMoney(bal)}</span>}>
            <div className="ins-prog" role="progressbar" aria-label="Keşbek balansı" aria-valuemin={0} aria-valuemax={scale / 100} aria-valuenow={bal / 100}>
              <i style={{ width: `${Math.min(100, (bal / scale) * 100)}%` }} /><b style={{ left: `${(MIN_USE / scale) * 100}%` }} aria-hidden="true" />
            </div>
            <div className="ins-conds">
              <Chip tone={okLimit ? 'done' : 'neutral'}>{okLimit ? '✓' : '✗'} 70 AZN həddi</Chip>
              <Chip tone={okShoots ? 'done' : 'neutral'}>{okShoots ? '✓' : '✗'} 3-cü çəkiliş</Chip>
              {okLimit && okShoots && <Chip tone="brand">işlənə bilər</Chip>}
            </div>
            <p className="ins-hint">İlk çəkiliş 40%, sonra 10%. Keşbek yalnız çəkiliş ödənişinə gedir, nağd verilmir.</p>
            {/* TODO [API] «Keşbeki tətbiq et» dialoqu: tətbiq çəkiliş formasında (cashback_used) edilir, kartdan ayrıca endpoint yoxdur (22 #17). */}
            <Button size="sm" onClick={() => setCb(true)} disabled={!online}>Başlanğıc keşbek</Button>
          </Card>

          <Card title="Paket">
            {c.packages.length === 0 ? <p className="ins-hint">Paket yoxdur · hər çəkilişə ayrıca ödəyir.</p> : c.packages.map((p) => (
              <a key={p.id} className="ins-pk" href="#/tenzimleme/paketler">
                <b>{p.title}</b>
                <span className="ins-sub"><span className="mono">{formatHours(p.minutes_left).replace(' saat', '')} / {formatHours(p.minutes_total)}</span> qalıb · {dateShort(p.ends_on)}-dək · {p.cameras} kamera</span>
                <i className="ins-bar"><b style={{ width: `${p.minutes_total ? (p.minutes_left / p.minutes_total) * 100 : 0}%` }} /></i>
              </a>
            ))}
            {/* TODO [API] «Paket sat» düyməsi: paket satış ekranı (/paket-sat?insan=:id) bu agentin işi deyil. */}
          </Card>

          <Card title="Məlumat" aside={<Button variant="text" size="sm" onClick={() => setProf(true)} disabled={!online}>Profil</Button>}>
            <div className="ins-kvs">
              <KV label="Çəkilişlər"><span className="mono">{started.length}</span></KV>
              <KV label="İlk çəkiliş">{first && <span className="mono">{dateFull(bakuParts(first.starts_at).date)}</span>}</KV>
              <KV label="İxtisas">{c.profession}</KV>
              <KV label="İş yeri">{c.workplace}</KV>
              <KV label="Instagram">{ig && <a href={`https://instagram.com/${ig}`} target="_blank" rel="noopener noreferrer">@{ig}</a>}</KV>
              <KV label="Kontent mövzusu">{c.niche}</KV>
              <KV label="Doğum günü">{c.birthday && dateFull(c.birthday)}</KV>
              <KV label="Mənbə">{sourceName(c.source)}</KV>
              <KV label="Təkliflər">{c.marketing_opt_in === false ? 'Bağlıdır' : 'Açıqdır'}</KV>
              <KV label="Kim tövsiyə edib">{c.referred_by && <a href={`#/insanlar/${c.referred_by.id}`}>{c.referred_by.full_name}</a>}</KV>
              {c.referral_code && <KV label="Dəvət kodu"><span className="mono">{c.referral_code}</span></KV>}
            </div>
            {c.profile_complete === false && <p className="ins-hint">Profil tam doldurulmayıb.</p>}
            <Button size="sm" onClick={() => setInv(true)} disabled={!online}>{c.activated ? 'Yeni dəvət linki' : 'Dəvət linki'}</Button>
            {/* TODO [API] «Dostdur · bot yazmır» açarı: müştəri ilə WhatsApp kontaktı arasında əlaqə yoxdur (POST /contacts/:id/exclude yalnız kontakt id ilə işləyir). */}
          </Card>
        </aside>
      </div>
      <CashbackDialog open={cb} id={c.id} onClose={() => setCb(false)} onDone={detail.reload} />
      <CashbackRowDialog row={row} onClose={() => setRow(null)} onDone={detail.reload} />
      <EditClientDialog open={edit} c={c} onClose={() => setEdit(false)} onDone={detail.reload} onDeleted={() => goBack('insanlar')} />
      <InviteDialog open={inv} c={c} onClose={() => setInv(false)} />
      <ProfileSheet open={prof} c={c} onClose={() => setProf(false)} onDone={detail.reload} />
    </>
  );
}

function HistCb({ r }: { r: LedgerRow }) {
  return (
    <>
      <V2Icon name="check" />
      <span className="ins-hrow__t"><b>Keşbek</b> · {KIND[r.kind]}{r.note && <span className="ins-sub">{r.note}</span>}</span>
      <span className="mono ins-dim2">{ddmmTime(r.created_at)}</span>
      <span className={`mono ins-amt${r.amount > 0 ? ' ins-amt--pos' : ''}`}>{signed(r.amount)} AZN</span>
    </>
  );
}

// ===================== Lead kartı =====================
export function LeadCardV2({ leadId }: { leadId: number }) {
  const L = useLeads();
  const online = useOnline();
  const showSkeleton = useAfter();
  const [lost, setLost] = useState<Lead | null>(null);
  const [rem, setRem] = useState<Lead | null>(null);
  const lead = L.leads.find((l) => l.id === leadId);

  if (!lead) {
    return (
      <>
        <PageHeader title="İnsan kartı" newShoot={false} more={false} />
        <Back />
        {L.error ? <ErrorBox title="İnsan yüklənmədi · internet bağlantısını yoxlayın" detail={L.error} onRetry={L.reload} />
          : L.loaded ? <EmptyState title="Bu insan tapılmadı" reason="Silinib və ya başqa mərhələyə keçib." action={<Button size="sm" onClick={() => goBack('insanlar')}>İnsanlara qayıt</Button>} />
            : (showSkeleton ? <LoadingRows rows={5} /> : null)}
      </>
    );
  }
  const conv = isConverted(lead);
  const wa = lead.phone ? `https://wa.me/${waNumber(lead.phone)}` : '';
  const fields: [string, ReactNode][] = [
    ['Xidmət', serviceLabel(lead.service)], ['Tarix', lead.preferred_date], ['İnsan sayı', lead.people != null ? <span className="mono">{lead.people}</span> : null],
    ['Kamera', lead.cameras != null ? <span className="mono">{lead.cameras}</span> : null], ['Montaj', lead.editing == null ? null : lead.editing ? 'Bəli' : 'Xeyr'], ['Mənbə', lead.source],
  ];

  return (
    <>
      <PageHeader title="İnsan kartı" newShoot={false} more={false} />
      <Back />
      <div className="ins-person">
        <div className="ins-main">
          <Card label="İnsan">
            <div className="ins-id">
              <Avatar name={leadName(lead)} large tone={remindDue(lead) ? 'deposit' : 'neutral'} />
              <div className="ins-id__t">
                <h2 className="ins-id__n">{leadName(lead)}</h2>
                <div className="ins-id__m"><StageChip stage={lead.stage} /><span className="mono">{phoneShown(lead.phone) || 'telefon yoxdur'}</span><span>son əlaqə <span className="mono">{agoShort(lead.updated_at)}</span></span></div>
              </div>
            </div>
            <div className="ins-acts">
              {lead.conversation_id
                ? <a className="btn btn--primary btn--lg" href={`#/inbox/${lead.conversation_id}`}>Söhbəti aç</a>
                : wa ? <a className="btn btn--primary btn--lg" href={wa} target="_blank" rel="noopener noreferrer">Yaz WhatsApp</a> : <Button variant="primary" size="lg" disabled>Yaz WhatsApp</Button>}
              {lead.phone ? <a className="btn btn--secondary btn--lg" href={`tel:+${waNumber(lead.phone)}`}>Zəng et</a> : <Button size="lg" disabled>Zəng et</Button>}
              {lead.shoot_id ? <a className="btn btn--secondary btn--lg" href={`#/shoots/${lead.shoot_id}`}>Çəkilişi aç</a> : <a className="btn btn--secondary btn--lg" href="#/shoots/new">Çəkiliş yaz</a>}
            </div>
            {lead.stage === 'itirildi'
              ? <p className="ins-banner ins-banner--lost">İtirildi · <b>{lostText(lead)}</b> · mərhələni seçsəniz yenidən aktiv olur</p> : null}
            <Steps stage={lead.stage} converted={conv} disabled={!online} onPick={conv ? undefined : (s) => void L.move(lead, s)} />
            {!conv && lead.stage !== 'itirildi' && (
              <div><Button size="sm" variant="danger" disabled={!online} onClick={() => setLost(lead)}>İtirildi kimi işarələ</Button></div>
            )}
          </Card>
          {/* TODO [API] Tarixçə (söhbət xülasələri, qeydlər, mərhələ hadisələri) və «Növbəti addım»: lead üçün hadisə endpoint-i yoxdur (LeadEvent yalnız serverdə yazılır). */}
          {lead.notes && <Card title="Qeyd"><p className="ins-notes">{lead.notes}</p></Card>}
        </div>
        <aside className="ins-side" aria-label="Yan panel">
          <Card title="Xatırlatma">
            {lead.remind_at
              ? <p className={`ins-remind${remindDue(lead) ? ' ins-due' : ''}`}>🔔 <b className="mono">{remindText(lead)}</b>{lead.remind_note ? ` · ${lead.remind_note}` : ''}</p>
              : <p className="ins-hint">Müştəri «sonra / sabah yazacam / studiyada ödəyəcəm» deyibsə, itirmək əvəzinə xatırlatma qoyun.</p>}
            {!conv && <Button size="sm" disabled={!online} onClick={() => setRem(lead)}>{lead.remind_at ? 'Xatırlatmanı dəyiş' : 'Xatırlatma qoy'}</Button>}
          </Card>
          <Card title="Sorğu">
            <div className="ins-kvs">{fields.map(([l, v]) => <KV key={l} label={l}>{v}</KV>)}</div>
          </Card>
        </aside>
      </div>
      <LostDialog lead={lost} onClose={() => setLost(null)} onConfirm={async (reason, text) => { if (lost && await L.move(lost, 'itirildi', { reason, text })) setLost(null); }} />
      <RemindDialog lead={rem} onClose={() => setRem(null)} onSave={(at, note) => L.remind(rem!, at, note)} />
    </>
  );
}

const lostText = (l: Lead) => lostLabel(l) || 'səbəb yoxdur';
