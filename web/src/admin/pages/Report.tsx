import { useState } from 'react';
import { AdminShell, Card, Icon, formatHours, formatMoney } from '../../shared/ui';
import { Err, SOURCES } from '../components/common';
import { useLoad } from '../ctx';
import { bakuToday } from '../format';

type ByKind = { count: number; minutes: number; total: number };
type ReportData = {
  month: string;
  cash: { deposits: number; at_studio: number; packages: number; refunds: number; net: number };
  shoots: { completed: number; cancelled: number; no_show: number; upcoming: number; minutes: number; revenue: number; discounts: number; retained: number; by_kind: Partial<Record<'shoot' | 'reels_pack' | 'studio_rent', ByKind>> };
  packages_sold: number;
  cashback: { earned: number; manual: number; spent: number; liability: number; bonuses?: number };
  growth?: {
    new_clients: number; by_source: Record<string, number>; referrals: number; repeat_rate: number; avg_check: number; avg_client_value: number;
    bonuses: { profile_bonus?: number; referral?: number; birthday?: number };
    campaigns: { count: number; recipients: number; opened: number; booked_14d: number };
  };
};

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
const KINDS: [keyof ReportData['shoots']['by_kind'], string][] = [['shoot', 'Çəkiliş'], ['reels_pack', 'Reels paketi'], ['studio_rent', 'Studiya icarəsi']];

function shiftMonth(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function Row({ label, value, bold }: { label: string; value: string | number; bold?: boolean }) {
  return <div className="sum-r"><span className={bold ? 'w8' : 'muted'}>{label}</span><span>{value}</span></div>;
}

const BONUS: [keyof NonNullable<ReportData['growth']>['bonuses'], string][] = [['profile_bonus', 'Profil bonusu'], ['referral', 'Dəvət bonusu'], ['birthday', 'Ad günü hədiyyəsi']];
const srcName = (k: string) => (k === 'unknown' ? 'Bilinmir' : SOURCES.find(([s]) => s === k)?.[1] ?? k);

function Growth({ g }: { g: NonNullable<ReportData['growth']> }) {
  const src = Object.entries(g.by_source).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const c = g.campaigns;
  return (
    <Card>
      <span className="h3">Artım</span>
      <div className="ax-rows" data-testid="growth">
        <Row label="Yeni müştəri" value={g.new_clients} />
        <Row label="Dəvətlə gələn" value={g.referrals} />
        <Row label="Təkrar müştəri" value={`${g.repeat_rate}%`} />
        <Row label="Orta çek" value={formatMoney(g.avg_check)} />
        <Row label="Müştəri başına orta gəlir" value={formatMoney(g.avg_client_value)} bold />
      </div>
      {src.length > 0 && (
        <>
          <span className="lbl">Haradan gəliblər</span>
          <div className="ax-rows">{src.map(([k, n]) => <Row key={k} label={srcName(k)} value={n} />)}</div>
        </>
      )}
      <span className="lbl">Bonuslar</span>
      <div className="ax-rows">{BONUS.map(([k, label]) => <Row key={k} label={label} value={formatMoney(g.bonuses[k] ?? 0)} />)}</div>
      <span className="lbl">Kampaniyalar</span>
      <div className="ax-rows">
        <Row label="Göndərilən" value={c.count} />
        <Row label="Alıcı" value={c.recipients} />
        <Row label="Açan" value={c.opened} />
        <Row label="14 gündə yazılan" value={c.booked_14d} />
      </div>
    </Card>
  );
}

// Aylıq hesabat: kassa, çəkilişlər, keşbek. Məbləğlər qəpikdir.
export function Report() {
  const [month, setMonth] = useState(bakuToday().slice(0, 7));
  const { data: d, err } = useLoad<ReportData>(`/report?month=${month}`);
  const [y, m] = month.split('-').map(Number);
  const cur = bakuToday().slice(0, 7);
  const ok = d && d.month === month;
  return (
    <AdminShell active="report" title="Hesabat">
      <div className="ax-month">
        <button type="button" className="iconbtn" aria-label="Əvvəlki ay" onClick={() => setMonth(shiftMonth(month, -1))}><span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevron" /></span></button>
        <b className="h3">{MONTHS[m - 1]} {y}</b>
        <button type="button" className="iconbtn" aria-label="Sonrakı ay" disabled={month >= cur} style={month >= cur ? { opacity: 0.4 } : undefined} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="chevron" /></button>
      </div>
      <Err msg={err} />
      {!ok && !err && <div className="sk" style={{ height: 160, borderRadius: 24 }} aria-busy="true" />}
      {ok && (
        <div className="rs-cols">
          <Card>
            <span className="h3">Kassa</span>
            <div className="ax-rows">
              <Row label="Beh" value={formatMoney(d.cash.deposits)} />
              <Row label="Studiyada ödəniş" value={formatMoney(d.cash.at_studio)} />
              <Row label="Paket satışı" value={formatMoney(d.cash.packages)} />
              <Row label="Qaytarılan" value={formatMoney(-Math.abs(d.cash.refunds))} />
              <Row label="Xalis" value={formatMoney(d.cash.net)} bold />
            </div>
            {d.packages_sold > 0 && <p className="t12 muted">Satılan paket: {d.packages_sold}</p>}
          </Card>
          <Card>
            <span className="h3">Çəkilişlər</span>
            <div className="ax-rows">
              <Row label="Bağlanan" value={d.shoots.completed} />
              <Row label="Ləğv / gəlmədi" value={`${d.shoots.cancelled} / ${d.shoots.no_show}`} />
              <Row label="Gözlənilən" value={d.shoots.upcoming} />
              <Row label="Saat" value={formatHours(d.shoots.minutes)} />
              <Row label="Gəlir" value={formatMoney(d.shoots.revenue)} bold />
              <Row label="Endirimlər" value={formatMoney(d.shoots.discounts)} />
              <Row label="Tutulan beh" value={formatMoney(d.shoots.retained)} />
            </div>
            <span className="lbl">Xidmət növünə görə</span>
            <div className="ax-rows">
              {KINDS.map(([k, label]) => {
                const b = d.shoots.by_kind[k];
                return <Row key={k} label={`${label} · ${b?.count ?? 0} · ${formatHours(b?.minutes ?? 0)}`} value={formatMoney(b?.total ?? 0)} />;
              })}
            </div>
          </Card>
          <Card>
            <span className="h3">Keşbek</span>
            <div className="ax-rows">
              <Row label="Yazılan" value={formatMoney(d.cashback.earned)} />
              <Row label="Əl ilə" value={formatMoney(d.cashback.manual)} />
              <Row label="Xərclənən" value={formatMoney(d.cashback.spent)} />
              {d.cashback.bonuses !== undefined && <Row label="Bonuslar" value={formatMoney(d.cashback.bonuses)} />}
              <Row label="Ümumi öhdəlik" value={formatMoney(d.cashback.liability)} bold />
            </div>
            <p className="t12 muted">Öhdəlik: müştərilərin balansındakı keşbek.</p>
          </Card>
          {d.growth && <Growth g={d.growth} />}
        </div>
      )}
    </AdminShell>
  );
}
