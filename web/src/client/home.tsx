import { Button, Card, Icon, Pill } from '../shared/ui';
import { BookButtons, ErrorState, HOME_CACHE, Loading, OfflineBadge, Screen, useApi, XIcon } from './core';
import { PushHint } from './push';
import { Chips } from './shoots';
import { ADDRESS, MAP_URL, PHONE_HREF, dayNum, isIOS, fmtHours, money, monShort, relDay, standalone, statusKey, timeOf, waLink, weekday, dateLong, dur, type Shoot } from './util';

export type Pkg = { id: number; title: string; owner_name: string; minutes_total: number; minutes_left: number; cameras: number; starts_on: string; ends_on: string };
export type HomeData = { full_name: string; cashback_balance: number; next_shoot: Shoot | null; package: Pkg | null; unread_notifications: number };

export function PackageCard({ p }: { p: Pkg }) {
  const pct = p.minutes_total ? Math.max(0, Math.min(100, (p.minutes_left / p.minutes_total) * 100)) : 0;
  return (
    <a className="card card-cream" href="#/package" style={{ textDecoration: 'none' }}>
      <div className="row sb">
        <span className="lbl">Saat paketi · {p.title}</span>
        <XIcon name="out" size={18} sw={2.2} />
      </div>
      <span className="num-m">{fmtHours(p.minutes_left)}<span className="unit"> / {fmtHours(p.minutes_total)} saat qalıb</span></span>
      <div className="prog" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
    </a>
  );
}

function NextShoot({ s }: { s: Shoot }) {
  const st = statusKey(s);
  return (
    <section className="tbig" aria-label="Növbəti çəkiliş">
      <a className="tbig-main" href={`#/shoots/${s.id}`}>
        <span className="tbig-date"><small>{weekday(s.starts_at).toUpperCase()}</small><b>{dayNum(s.starts_at)}</b><small>{monShort(s.starts_at)}</small></span>
        <span className="tbig-body">
          <span className="row sb" style={{ gap: 6 }}><span className="lbl">Növbəti çəkiliş</span><Pill status={st} /></span>
          <span className="col" style={{ gap: 2 }}>
            <span className="tbig-time">{timeOf(s.starts_at)}</span>
            <span className="t15 w8">{dateLong(s.starts_at)} · {dur(s.duration_min)}</span>
          </span>
          <Chips s={s} />
        </span>
      </a>
      <div className="tbig-foot">
        {s.payment_line
          ? <span className="row t13 w7" style={{ gap: 8, color: '#e9e0f5' }}><Icon name="wallet" size={16} />{s.payment_line}</span>
          : <span className="row t13 w7" style={{ gap: 8, color: '#e9e0f5' }}><Icon name="users" size={16} />{s.who} çəkilişi (paket)</span>}
        <span className="row sb">
          <span className="t15 w8"><span className="mk">{relDay(s.starts_at)}</span></span>
          <a className="link" href={`#/shoots/${s.id}`}>Ətraflı<Icon name="chevron" size={16} /></a>
        </span>
      </div>
    </section>
  );
}

export function Contact() {
  return (
    <Card>
      <span className="h3">Studiya ilə əlaqə</span>
      <div className="g3 cgrid">
        <a href={waLink('Salam!')} target="_blank" rel="noopener"><XIcon name="wa" size={22} />WhatsApp</a>
        <a href={PHONE_HREF}><XIcon name="phone" size={22} />Zəng</a>
        <a href={MAP_URL} target="_blank" rel="noopener"><XIcon name="nav" size={22} />Xəritə</a>
      </div>
      <div className="row t13 muted lh" style={{ alignItems: 'flex-start' }}><Icon name="pin" size={18} /><span>{ADDRESS}</span></div>
    </Card>
  );
}

export function Home({ onLogout }: { onLogout: () => void }) {
  const q = useApi<HomeData>('/me/home', HOME_CACHE);
  const noShoots = useApi<Shoot[]>(q.data && !q.data.next_shoot ? '/me/shoots' : null);
  const d = q.data;
  return (
    <Screen tab="home">
      {!d ? (q.loading ? <Loading /> : <ErrorState q={q} />) : (
        <>
          <header className="top" style={{ marginBottom: 6 }}>
            <div className="hello"><span className="t14 muted w6">Salam,</span><b>{d.full_name.split(' ')[0]}</b></div>
            <div className="row">
              <a className="iconbtn iconbtn-cream" href="#/qr" aria-label="QR müştəri kartı"><Icon name="qr" size={22} strokeWidth={2} /></a>
              <a className="iconbtn bell" href="#/notifications" aria-label={`Bildirişlər${d.unread_notifications ? `, ${d.unread_notifications} oxunmamış` : ''}`}>
                <XIcon name="bell" size={22} />
                {d.unread_notifications > 0 && <span className="badge">{d.unread_notifications}</span>}
              </a>
            </div>
          </header>
          {q.offline && <OfflineBadge />}

          <a className="big-link" href="#/cashback" aria-label={`Keşbekim, ${money(d.cashback_balance)}`}>
            <span className="bubble"><XIcon name="pct" size={24} /></span>
            <span className="col grow" style={{ gap: 4 }}>
              <span className="t13 w8" style={{ color: '#e9d5ff' }}>Keşbekim</span>
              <span className="num-l" style={{ fontSize: 34 }}>{money(d.cashback_balance).replace(' AZN', '')}<span className="unit">AZN</span></span>
              <span className="t12 w7" style={{ color: '#e9d5ff' }}>Hər çəkilişdən məbləğin 10%-i keşbek</span>
            </span>
            <XIcon name="out" size={20} sw={2.2} />
          </a>

          {d.package && <PackageCard p={d.package} />}

          {d.next_shoot ? <NextShoot s={d.next_shoot} /> : (
            <Card tone="dash">
              <span className="lbl">Növbəti çəkiliş</span>
              <h3 className="h3">Yaxın çəkiliş yoxdur</h3>
              <p className="t13 soft lh">{noShoots.data && noShoots.data.length === 0
                ? 'İlk çəkilişinizə 50% keşbek. Siz gəlib danışırsınız, çəkilişi, montajı və təhvili Y Pod komandası edir.'
                : 'Yeni çəkiliş üçün bizə yazın, gün və saatı birlikdə seçək.'}</p>
            </Card>
          )}

          <BookButtons />

          <a className="card" href="#/profile" style={{ flexDirection: 'row', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
            <span className="ic"><Icon name="users" size={20} /></span>
            <span className="col grow"><span className="t14 w8">Profilim · Dostunu gətir</span><span className="t12 muted">Profili doldurun, dostunuzu dəvət edin — keşbek qazanın</span></span>
            <Icon name="chevron" size={18} />
          </a>

          <PushHint />

          {!standalone && !isIOS && (
            <a className="card" href="#/install" style={{ flexDirection: 'row', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
              <span className="ic"><Icon name="plus" size={20} /></span>
              <span className="col grow"><span className="t14 w8">Ana ekrana əlavə edin</span><span className="t12 muted">App kimi bir toxunuşla açılsın</span></span>
              <Icon name="chevron" size={18} />
            </a>
          )}

          <Contact />
          <Button variant="ghost" small onClick={onLogout}>Çıxış</Button>
        </>
      )}
    </Screen>
  );
}
