import { useState, type CSSProperties, type ReactNode } from 'react';
import { formatHours, formatMoney } from '../../../../shared/ui';
import { SOURCES } from '../../../components/common';
import { useLoad } from '../../../ctx';
import { bakuToday } from '../../../format';
import { PageHeader } from '../../shell/PageHeader';
import { Button, Card, EmptyState, ErrorBox, V2Icon, useOnline } from '../../ui';
import './insanlar.css';

type ByKind = { count: number; minutes: number; total: number };
type ReportData = {
  month: string;
  cash: { deposits: number; at_studio: number; packages: number; refunds: number; net: number };
  shoots: { completed: number; cancelled: number; no_show: number; upcoming: number; minutes: number; revenue: number; discounts: number; retained: number; by_kind: Partial<Record<'shoot' | 'reels_pack' | 'single_reel' | 'studio_rent', ByKind>> };
  packages_sold: number;
  compare?: { days: number; net: number; prev_net: number };
  cashback: { earned: number; manual: number; spent: number; liability: number; bonuses?: number };
  growth?: {
    new_clients: number; by_source: Record<string, number>; referrals: number; repeat_rate: number; avg_check: number; avg_client_value: number;
    bonuses: { profile_bonus?: number; referral?: number; birthday?: number };
    campaigns: { count: number; recipients: number; opened: number; booked_14d: number };
  };
};

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
const KINDS: [keyof ReportData['shoots']['by_kind'], string][] = [['shoot', 'Çəkiliş'], ['reels_pack', 'Reels paketi'], ['single_reel', 'Tək Reels'], ['studio_rent', 'Müştəri özü çəkir']];
const BONUS: [keyof NonNullable<ReportData['growth']>['bonuses'], string][] = [['profile_bonus', 'Profil bonusu'], ['referral', 'Dəvət bonusu'], ['birthday', 'Ad günü hədiyyəsi']];
const srcName = (k: string) => (k === 'unknown' ? 'Bilinmir' : SOURCES.find(([s]) => s === k)?.[1] ?? k);

function shiftMonth(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const R = ({ label, value, bold }: { label: string; value: ReactNode; bold?: boolean }) => <div className={`ins-rr${bold ? ' ins-rr--b' : ''}`}><span>{label}</span><span className="mono">{value}</span></div>;
const Tiles = ({ items }: { items: [string, ReactNode][] }) => <div className="ins-tiles">{items.map(([l, v]) => <div key={l} className="ins-tile"><span>{l}</span><b className="mono">{v}</b></div>)}</div>;
const Sub = ({ children }: { children: ReactNode }) => <h3 className="ins-subh">{children}</h3>;

function Bars({ items }: { items: { key: string; label: string; n: number; text: string }[] }) {
  const max = Math.max(1, ...items.map((x) => x.n));
  return (
    <div className="ins-hbars">
      {items.map((b) => (
        <div key={b.key} className="ins-hbar">
          <span>{b.label}</span>
          <div><i className={b.n === max ? 'max' : ''} style={{ width: `${Math.max(b.n ? 6 : 2, (b.n / max) * 100)}%` } as CSSProperties} /><em className="mono">{b.text}</em></div>
        </div>
      ))}
    </div>
  );
}

/** Hesabat (23): oxuma ekranı, heç nə dəyişmir. Route: /hesabat (köhnə /report). */
export function Hesabat() {
  const [month, setMonth] = useState(bakuToday().slice(0, 7));
  const online = useOnline();
  const cur = bakuToday().slice(0, 7);
  const isCur = month === cur;
  const { data, err, reload } = useLoad<ReportData>(`/report?month=${month}`);
  const prev = useLoad<ReportData>(isCur ? null : `/report?month=${shiftMonth(month, -1)}`).data;
  const d = data && data.month === month ? data : null;
  const [y, m] = month.split('-').map(Number);

  // Dəyişmə: cari ay keçən ayın eyni günləri ilə (99 G10), bitmiş ay tam əvvəlki ayla. Əvvəlki 0-dırsa faiz göstərilmir.
  const base = d && isCur ? d.compare?.prev_net ?? 0 : prev && prev.month === shiftMonth(month, -1) ? prev.cash.net : 0;
  const cmp = d && isCur ? d.compare?.net ?? 0 : d?.cash.net ?? 0;
  const delta = d && base > 0 ? Math.round(((cmp - base) / base) * 100) : null;

  const picker = (
    <div className="ins-mo">
      <Button variant="secondary" size="lg" aria-label="Əvvəlki ay" disabled={!online} onClick={() => setMonth(shiftMonth(month, -1))}><V2Icon name="back" /></Button>
      <b className="ins-mo__l">{MONTHS[m - 1]} {y}</b>
      <Button variant="secondary" size="lg" aria-label="Sonrakı ay" disabled={isCur || !online} onClick={() => setMonth(shiftMonth(month, 1))}><V2Icon name="chev" /></Button>
    </div>
  );

  const body = (r: ReportData) => {
    const cashTot = r.cash.deposits + r.cash.at_studio + r.cash.packages;
    const share = (n: number) => (cashTot > 0 ? Math.round((n / cashTot) * 100) : 0);
    const done = r.shoots.completed;
    const g = r.growth;
    const src = g ? Object.entries(g.by_source).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) : [];
    const empty = done === 0 && cashTot === 0 && r.shoots.upcoming === 0;
    return (
      <>
        {empty && <EmptyState title="Bu dövrdə çəkiliş yoxdur · hesabat çəkiliş olanda dolur" reason="Rəqəmlər 0 göstərilir." />}
        <div className="ins-rep">
          <Card label="Gəlir" title={`${MONTHS[m - 1]} gəliri`} aside={delta !== null ? <span className={`mono ins-delta ins-delta--${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% {isCur ? 'keçən ayın eyni günlərinə görə' : 'əvvəlki aya görə'}</span> : undefined}>
            <div className="ins-big mono">{formatMoney(r.cash.net)}</div>
            <p className="ins-hint">Kassa: həmin ay əldə olan xalis pul (beh, studiyada ödəniş, paket satışı; qaytarılan çıxılır).</p>
            <Tiles items={[['Çəkiliş', done], ['Orta çek', done ? formatMoney(Math.round(r.shoots.revenue / done / 100) * 100) : '—'], ['Saat', formatHours(r.shoots.minutes).replace(' saat', '')], ['Gözlənilən', r.shoots.upcoming]]} />
            {/* TODO [API] Gündəlik gəlir qrafiki, Həftə/İl dövrü, Satış hunisi, Mənbəyə görə gəlir, Reklam xərci və «1 rezerv neçəyə», Vaxtında təhvil, «Excel-ə çıxar»: /report yalnız aylıq cəmləri verir (23-hesabat.md #2–#5, #9–#18). */}
          </Card>

          <Card title="Kassa">
            <div className="ins-rows">
              <R label="Beh" value={formatMoney(r.cash.deposits)} />
              <R label="Studiyada ödəniş" value={formatMoney(r.cash.at_studio)} />
              <R label="Paket satışı" value={formatMoney(r.cash.packages)} />
              <R label="Qaytarılan" value={formatMoney(-Math.abs(r.cash.refunds))} />
              <R label="Xalis" value={formatMoney(r.cash.net)} bold />
            </div>
            {r.packages_sold > 0 && <p className="ins-hint">Satılan paket: <span className="mono">{r.packages_sold}</span></p>}
            {cashTot > 0 && (
              <>
                <div className="ins-stack" role="img" aria-label="Kassa tərkibi"><i style={{ flex: r.cash.deposits }} /><i style={{ flex: r.cash.at_studio }} /><i style={{ flex: r.cash.packages }} /></div>
                <div className="ins-leg"><span><i />Beh · <b className="mono">{share(r.cash.deposits)}%</b></span><span><i />Studiyada · <b className="mono">{share(r.cash.at_studio)}%</b></span><span><i />Paket · <b className="mono">{share(r.cash.packages)}%</b></span></div>
              </>
            )}
          </Card>

          <Card title="Çəkilişlər">
            <Tiles items={[['Bağlanan', done], ['Ləğv / gəlmədi', `${r.shoots.cancelled} / ${r.shoots.no_show}`], ['Gəlir', formatMoney(r.shoots.revenue)]]} />
            <div className="ins-rows">
              <R label="Endirimlər" value={formatMoney(-Math.abs(r.shoots.discounts))} />
              <R label="Tutulan beh" value={formatMoney(r.shoots.retained)} />
            </div>
            <Sub>Xidmət üzrə</Sub>
            <Bars items={KINDS.map(([k, label]) => { const b = r.shoots.by_kind[k]; return { key: k, label: `${label} · ${b?.count ?? 0} · ${formatHours(b?.minutes ?? 0)}`, n: b?.total ?? 0, text: formatMoney(b?.total ?? 0) }; })} />
          </Card>

          <Card title="Keşbek">
            <div className="ins-rows">
              <R label="Yazılan" value={formatMoney(r.cashback.earned)} />
              <R label="Əl ilə" value={formatMoney(r.cashback.manual)} />
              <R label="Xərclənən" value={formatMoney(-Math.abs(r.cashback.spent))} />
              {r.cashback.bonuses !== undefined && <R label="Bonuslar" value={formatMoney(r.cashback.bonuses)} />}
              <R label="Ümumi öhdəlik" value={formatMoney(r.cashback.liability)} bold />
            </div>
            <p className="ins-hint">Öhdəlik: müştərilərin balansındakı keşbek.</p>
          </Card>

          {g && (
            <Card title="Artım">
              <div className="ins-rows">
                <R label="Yeni müştəri" value={g.new_clients} />
                <R label="Dəvətlə gələn" value={g.referrals} />
                <R label="Təkrar müştəri" value={`${g.repeat_rate}%`} />
                <R label="Orta çek" value={formatMoney(Math.round(g.avg_check / 100) * 100)} />
                <R label="Müştəri başına orta gəlir" value={formatMoney(g.avg_client_value)} />
              </div>
              {src.length > 0 && <><Sub>Haradan gəliblər</Sub><Bars items={src.map(([k, n]) => ({ key: k, label: srcName(k), n, text: String(n) }))} /></>}
              <Sub>Bonuslar</Sub>
              <div className="ins-rows">{BONUS.map(([k, label]) => <R key={k} label={label} value={formatMoney(g.bonuses[k] ?? 0)} />)}</div>
              <Sub>Kampaniyalar</Sub>
              <Tiles items={[['Göndərilən', g.campaigns.count], ['Alıcı', g.campaigns.recipients], ['Açan', g.campaigns.opened], ['14 gündə yazılan', g.campaigns.booked_14d]]} />
            </Card>
          )}
        </div>
      </>
    );
  };

  return (
    <>
      <PageHeader title="Hesabat" sub={`${MONTHS[m - 1]} ${y}${isCur ? ' · bu günə qədər' : ''}`} newShoot={false} actions={picker} />
      {err && <ErrorBox title="Hesabat yüklənmədi · internet bağlantısını yoxlayın" detail={err} onRetry={reload} />}
      {!d && !err && <div className="ins-repsk" role="status" aria-label="Yüklənir" aria-busy="true">{[0, 1, 2, 3].map((i) => <span key={i} className="sk" />)}</div>}
      {d && <div key={month}>{body(d)}</div>}
    </>
  );
}
