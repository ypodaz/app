import { useState, type ReactNode } from 'react';
import { AdminShell, formatHours, formatMoney2 } from '../../shared/ui';
import { AIcon, type AIconName } from '../components/AIcon';
import { stag } from '../components/a3';
import { Err, SOURCES } from '../components/common';
import { useCountUp } from '../components/neon';
import { useDesktop } from '../router';
import { useLoad } from '../ctx';
import { bakuToday } from '../format';

type ByKind = { count: number; minutes: number; total: number };
type ReportData = {
  month: string;
  cash: { deposits: number; at_studio: number; packages: number; refunds: number; net: number };
  shoots: { completed: number; cancelled: number; no_show: number; upcoming: number; minutes: number; revenue: number; discounts: number; retained: number; by_kind: Partial<Record<'shoot' | 'reels_pack' | 'single_reel' | 'studio_rent', ByKind>> };
  packages_sold: number;
  cashback: { earned: number; manual: number; spent: number; liability: number; bonuses?: number };
  growth?: {
    new_clients: number; by_source: Record<string, number>; referrals: number; repeat_rate: number; avg_check: number; avg_client_value: number;
    bonuses: { profile_bonus?: number; referral?: number; birthday?: number };
    campaigns: { count: number; recipients: number; opened: number; booked_14d: number };
  };
};

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
const KINDS: [keyof ReportData['shoots']['by_kind'], string][] = [['shoot', 'Çəkiliş'], ['reels_pack', 'Reels paketi'], ['single_reel', 'Tək Reels'], ['studio_rent', 'Studiya icarəsi']];

function shiftMonth(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Hesabatda məbləğ həmişə 2 onluqla: «1 120,00 AZN».
const money = formatMoney2;

function Row({ label, value, bold }: { label: string; value: string | number; bold?: boolean }) {
  return <div className="a3-rr"><span className={bold ? 'b' : ''}>{label}</span><span>{value}</span></div>;
}

/** Böyük məbləğ: 500ms sayır (azaldılmış hərəkətdə dərhal). */
function Big({ label, q }: { label: string; q: number }) {
  const v = useCountUp(q);
  return <div className="a3-big"><span>{label}</span><b>{money(v ?? q)}</b></div>;
}

function RCard({ i, icon, tone, title, children }: { i: number; icon: AIconName; tone?: 'cal' | 'cb'; title: string; children: ReactNode }) {
  return (
    <section className="a-g a3-rc2 a-rise" style={stag(i)} aria-label={title}>
      <div className="a3-rh"><span className={`a-ic${tone ? ` a-ic-${tone}` : ''}`}><AIcon name={icon} size={16} /></span><h2>{title}</h2></div>
      {children}
    </section>
  );
}

const Tiles = ({ items }: { items: [string, string | number][] }) => (
  <div className="a3-tl4">{items.map(([l, v]) => <div key={l} className="a3-t4"><span>{l}</span><b>{v}</b></div>)}</div>
);

function Bars({ items, fmt }: { items: { key: string; label: string; n: number; text: string }[]; fmt?: 'inline' }) {
  const max = Math.max(1, ...items.map((x) => x.n));
  return (
    <div className="a3-bars">
      {items.map((b, i) => (
        <div key={b.key} className="a3-bar">
          <span>{b.label}</span>
          <div><i className={b.n === max ? 'top' : ''} style={{ width: `${Math.max(6, (b.n / max) * 100)}%`, '--i': i } as React.CSSProperties} /><em>{b.text}</em></div>
        </div>
      ))}
    </div>
  );
}

const BONUS: [keyof NonNullable<ReportData['growth']>['bonuses'], string][] = [['profile_bonus', 'Profil bonusu'], ['referral', 'Dəvət bonusu'], ['birthday', 'Ad günü hədiyyəsi']];
const srcName = (k: string) => (k === 'unknown' ? 'Bilinmir' : SOURCES.find(([s]) => s === k)?.[1] ?? k);

function Growth({ g, i }: { g: NonNullable<ReportData['growth']>; i: number }) {
  const src = Object.entries(g.by_source).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const c = g.campaigns;
  return (
    <RCard i={i} icon="trend" title="Artım">
      <div className="a3-rows" data-testid="growth">
        <Row label="Yeni müştəri" value={g.new_clients} />
        <Row label="Dəvətlə gələn" value={g.referrals} />
        <Row label="Təkrar müştəri" value={`${g.repeat_rate}%`} />
        <Row label="Orta çek" value={money(g.avg_check)} />
        <Row label="Müştəri başına orta gəlir" value={money(g.avg_client_value)} />
      </div>
      {src.length > 0 && (
        <>
          <span className="a3-sl">Haradan gəliblər</span>
          <Bars items={src.map(([k, n]) => ({ key: k, label: srcName(k), n, text: String(n) }))} />
        </>
      )}
      <span className="a3-sl">Bonuslar</span>
      <div className="a3-rows">{BONUS.map(([k, label]) => <Row key={k} label={label} value={money(g.bonuses[k] ?? 0)} />)}</div>
      <span className="a3-sl">Kampaniyalar</span>
      <Tiles items={[['Göndərilən', c.count], ['Alıcı', c.recipients], ['Açan', c.opened], ['14 gündə yazılan', c.booked_14d]]} />
    </RCard>
  );
}

// Aylıq hesabat: kassa, çəkilişlər, keşbek. Məbləğlər qəpikdir.
export function Report() {
  const [month, setMonth] = useState(bakuToday().slice(0, 7));
  const { data: d, err } = useLoad<ReportData>(`/report?month=${month}`);
  const desktop = useDesktop();
  const [y, m] = month.split('-').map(Number);
  const cur = bakuToday().slice(0, 7);
  const ok = d && d.month === month;

  const cards = (d: ReportData) => {
    const cashTot = d.cash.deposits + d.cash.at_studio + d.cash.packages;
    const share = (n: number) => (cashTot > 0 ? Math.round((n / cashTot) * 100) : 0);
    const kassa = (
      <RCard key="k" i={1} icon="wallet" title="Kassa">
        <div className="a3-rows">
          <Row label="Beh" value={money(d.cash.deposits)} />
          <Row label="Studiyada ödəniş" value={money(d.cash.at_studio)} />
          <Row label="Paket satışı" value={money(d.cash.packages)} />
          <Row label="Qaytarılan" value={money(-Math.abs(d.cash.refunds))} />
        </div>
        <div className="a3-sec"><Big label="Xalis" q={d.cash.net} />{d.packages_sold > 0 && <p className="a3-nt">Satılan paket: {d.packages_sold}</p>}</div>
        {cashTot > 0 && (
          <div className="a3-sec">
            <span className="a3-sl">Kassa tərkibi</span>
            <div className="a3-stack" role="img" aria-label="Kassa tərkibi">
              <i style={{ flex: d.cash.deposits }} /><i style={{ flex: d.cash.at_studio }} /><i style={{ flex: d.cash.packages }} />
            </div>
            <div className="a3-leg"><span><i />Beh · {share(d.cash.deposits)}%</span><span><i />Studiyada · {share(d.cash.at_studio)}%</span><span><i />Paket · {share(d.cash.packages)}%</span></div>
          </div>
        )}
      </RCard>
    );
    const shoots = (
      <RCard key="c" i={2} icon="cal" tone="cal" title="Çəkilişlər">
        <Tiles items={[['Bağlanan', d.shoots.completed], ['Ləğv / gəlmədi', `${d.shoots.cancelled} / ${d.shoots.no_show}`], ['Gözlənilən', d.shoots.upcoming], ['Saat', formatHours(d.shoots.minutes).replace(' saat', '')]]} />
        <Big label="Gəlir" q={d.shoots.revenue} />
        <div className="a3-rows">
          <Row label="Endirimlər" value={money(-Math.abs(d.shoots.discounts))} />
          <Row label="Tutulan beh" value={money(d.shoots.retained)} />
        </div>
        <span className="a3-sl">Xidmət növünə görə</span>
        <Bars items={KINDS.map(([k, label]) => { const b = d.shoots.by_kind[k]; return { key: k, label: `${label} · ${b?.count ?? 0} · ${formatHours(b?.minutes ?? 0)}`, n: b?.total ?? 0, text: money(b?.total ?? 0) }; })} />
      </RCard>
    );
    const cash = (
      <RCard key="b" i={3} icon="coins" tone="cb" title="Keşbek">
        <div className="a3-rows">
          <Row label="Yazılan" value={money(d.cashback.earned)} />
          <Row label="Əl ilə" value={money(d.cashback.manual)} />
          <Row label="Xərclənən" value={money(-Math.abs(d.cashback.spent))} />
          {d.cashback.bonuses !== undefined && <Row label="Bonuslar" value={money(d.cashback.bonuses)} />}
        </div>
        <div className="a3-sec"><Big label="Ümumi öhdəlik" q={d.cashback.liability} /><p className="a3-nt">Öhdəlik: müştərilərin balansındakı keşbek.</p></div>
      </RCard>
    );
    const growth = d.growth ? <Growth key="g" g={d.growth} i={4} /> : null;
    return desktop ? <div className="a3-pkg2"><div>{kassa}{shoots}</div><div>{cash}{growth}</div></div> : <div className="a3-pkg1">{kassa}{shoots}{cash}{growth}</div>;
  };

  return (
    <AdminShell
      active="report"
      title="Hesabat"
      actions={
        <div className="a3-mo">
          <button type="button" className="a-bg a-bg-i" aria-label="Əvvəlki ay" onClick={() => setMonth(shiftMonth(month, -1))}><AIcon name="chevl" size={20} /></button>
          <b>{MONTHS[m - 1]} {y}</b>
          <button type="button" className="a-bg a-bg-i" aria-label="Sonrakı ay" disabled={month >= cur} onClick={() => setMonth(shiftMonth(month, 1))}><AIcon name="chev" size={20} /></button>
        </div>
      }
    >
      <Err msg={err} />
      {!ok && !err && <div className="a-sk" style={{ height: 160, borderRadius: 22 }} aria-busy="true" />}
      {ok && <div key={month} className="a3-xf">{cards(d)}</div>}
    </AdminShell>
  );
}
