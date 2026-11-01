import { useEffect, useState, type CSSProperties } from 'react';
import { NIcon } from '../shared/ui';
import { ErrorState, HOME_CACHE, OfflineBadge, Screen, useApi } from './core';
import { shareReferral } from './profile';
import { PushHint } from './push';
import { ADDRESS, BOOK_TEXT, MAP_URL, PHONE_HREF, baku, dateShort, dayKey, downloadIcs, dur, endTimeOf, fmtHours, relDay, timeOf, todayKey, waLink, weekday, type Shoot } from './util';

export type Pkg = { id: number; title: string; owner_name: string; minutes_total: number; minutes_left: number; cameras: number; starts_on: string; ends_on: string };
export type HomeData = {
  full_name: string; cashback_balance: number; next_shoot: Shoot | null; package: Pkg | null; unread_notifications: number;
  active_offer: { id: number; title: string; body: string } | null;
  last_material: { id: number; title: string; drive_url: string; shoot_id: number; shoot_title: string | null } | null;
  profile_pct: number; referral_code: string; cashback_min_use: number;
};

// --- köməkçilər ---
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Ana səhifədə məbləğ həmişə iki onluqla: «95,00». */
export const amount2 = (q: number) => (q / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const MON3 = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'];
const lower = (s: string) => s.toLocaleLowerCase('az');
const pad = (n: number) => String(n).padStart(2, '0');
const TAG: Record<string, string> = { podcast: 'Podcast', reels: 'Reels', other: 'Çəkiliş' };

const kindLabel = (s: Shoot) => (s.kind === 'reels_pack' ? 'Reels paketi' : s.kind === 'studio_rent' ? 'Studiya icarəsi' : TAG[s.tag] ?? s.tag);
function setupLabel(s: Shoot) {
  const extras = [s.editing ? 'montaj' : '', s.reels_count ? `${s.reels_count} Reels` : ''].filter(Boolean);
  return `${s.cameras} kamera${extras.length ? ' + ' + extras.join(' + ') : ''}`;
}
/** «Podcast · 2 saat · Studiyada · 2 kamera + montaj» */
const shootLine = (s: Shoot) => [kindLabel(s), dur(s.duration_min), s.location === 'studio' ? 'Studiyada' : 'Sizin məkanda', setupLabel(s)].join(' · ');
const payText = (s: Shoot) => s.payment_line ?? `${s.who} çəkilişi (paket)`;
const depositWaiting = (s: Shoot) => !!s.payment_line?.startsWith('Beh gözlənilir');
/** «2 saat 40 dəq» (dəqiqəyə yuxarı yuvarlaq) */
function leftText(ms: number) {
  const m = Math.max(0, Math.ceil(ms / 60000)), h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} saat${r ? ` ${r} dəq` : ''}` : `${r} dəq`;
}
/** Kart qalxması: 360ms, 30ms növbə ilə. */
const rise = (i: number) => ({ style: { '--i': i } as CSSProperties });

/** Dövri «indi» (yalnız lazım olanda işləyir). */
function useNow(on: boolean, ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}

/** Sayğac 0 → hədəf, 700ms ease-out; Reduce Motion-da dərhal. */
export function useCountUp(target: number) {
  const [v, setV] = useState(() => (reduceMotion() ? target : 0));
  useEffect(() => {
    if (reduceMotion()) { setV(target); return; }
    let raf = 0, t0 = 0;
    const step = (t: number) => {
      if (!t0) t0 = t;
      const k = Math.min(1, (t - t0) / 700);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

const Chip = ({ tone, icon }: { tone?: string; icon: Parameters<typeof NIcon>[0]['name'] }) => (
  <span className={`nchip${tone ? ' nchip-' + tone : ''}`}><NIcon name={icon} size={16} /></span>
);
const Chev = () => <NIcon name="chev" style={{ flex: 'none', color: 'var(--yp-text-3)' }} />;

function PayLine({ s, flat }: { s: Shoot; flat?: boolean }) {
  const waiting = depositWaiting(s);
  return (
    <div className="pay-line n-meta" style={flat ? { marginTop: 10, paddingTop: 0, borderTop: 0 } : undefined}>
      <NIcon name={waiting ? 'clock' : 'check'} size={14} style={{ color: waiting ? 'var(--yp-text-2)' : 'var(--yp-cashback)' }} />
      <span>{payText(s)}</span>
    </div>
  );
}

// --- növbəti çəkiliş: adi · <24 saat (geri sayım) · çəkiliş günü · yoxdur ---
function NextShoot({ s, i }: { s: Shoot; i: number }) {
  const b = baku(s.starts_at);
  return (
    <section aria-label="Növbəti çəkiliş" className="g glow-cal rise" {...rise(i)}>
      <div className="n-hd">
        <span><Chip tone="cal" icon="cal" /><span className="n-lbl">Növbəti çəkiliş</span></span>
        <span className="ntag">{relDay(s.starts_at)}</span>
      </div>
      <div className="n-h2" style={{ marginTop: 12 }}>{b.d} {MON3[b.m]}, {lower(weekday(s.starts_at))} · {timeOf(s.starts_at)}</div>
      <div className="n-body c2" style={{ marginTop: 4 }}>{shootLine(s)}</div>
      <PayLine s={s} />
      <div className="n-btns">
        <a className="nb nb-p" href={`#/shoots/${s.id}`}>Təfərrüat</a>
        <button type="button" className="nb nb-s" style={{ flexBasis: 150 }} onClick={() => downloadIcs(s)}><NIcon name="calplus" size={18} />Təqvimə əlavə et</button>
      </div>
    </section>
  );
}

function Countdown({ s, now, i }: { s: Shoot; now: number; i: number }) {
  const left = Math.max(0, Math.floor((new Date(s.starts_at).getTime() - now) / 1000));
  const studio = s.location === 'studio';
  const due = s.studio_balance ? `Studiyada ödəniləcək: ${amount2(s.studio_balance)} AZN · nağd və ya kart` : payText(s);
  const unit = (v: number, label: string) => <span><span className="n-num">{pad(v)}</span><small>{label}</small></span>;
  return (
    <section aria-label="Növbəti çəkiliş" className="g glow-cal2 rise" {...rise(i)}>
      <div className="n-hd">
        <span><Chip tone="cal" icon="cal" /><span className="n-lbl" style={{ color: 'var(--yp-text)' }}>{relDay(s.starts_at)} · {timeOf(s.starts_at)}</span></span>
        <span className="ntag ntag-cal"><i aria-hidden="true" />{depositWaiting(s) ? 'Beh gözlənilir' : 'Təsdiqləndi'}</span>
      </div>
      <div className="timer" role="timer" aria-label={`Çəkilişə ${leftText(left * 1000)} qalıb`}>
        {unit(Math.floor(left / 3600), 'saat')}<b aria-hidden="true">:</b>{unit(Math.floor((left % 3600) / 60), 'dəq')}<b aria-hidden="true">:</b>{unit(left % 60, 'san')}
      </div>
      <div className="n-body c2" style={{ marginTop: 12 }}>{shootLine(s)}</div>
      <div className="inner">
        <div className="row" style={{ alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: '18px', fontWeight: 500 }}>
          <NIcon name="pin" size={16} style={{ flex: 'none', marginTop: 1, color: 'var(--yp-text-2)' }} />
          <span style={{ minWidth: 0 }}>{studio ? ADDRESS : s.address || 'Sizin məkanda'}</span>
        </div>
        <div className="n-meta" style={{ paddingLeft: 24 }}>{due}</div>
      </div>
      <div className="n-btns">
        {studio && <a className="nb nb-p" style={{ flexBasis: 150 }} href={MAP_URL} target="_blank" rel="noopener"><NIcon name="pin" size={18} />Xəritədə aç</a>}
        <a className={`nb ${studio ? 'nb-s' : 'nb-p'}`} href={`#/shoots/${s.id}`}>Təfərrüat</a>
      </div>
    </section>
  );
}

function ShootDay({ s, now, i }: { s: Shoot; now: number; i: number }) {
  const studio = s.location === 'studio';
  const left = new Date(s.starts_at).getTime() - now;
  return (
    <>
      <a className="g g-row glow-cal2 drop" href={studio ? MAP_URL : `#/shoots/${s.id}`} {...(studio ? { target: '_blank', rel: 'noopener' } : {})}>
        <span className="nchip nchip-cal" aria-hidden="true"><span className="live" /></span>
        <span className="n-col">
          <span className="n-body6">Bu gün {timeOf(s.starts_at)} · {left > 60000 ? `başlamağa ${leftText(left)}` : 'indi başlayır'}</span>
          <span className="n-meta">{studio ? `${ADDRESS.replace(', Bakı', '')} · xəritədə aç` : s.address || 'Sizin məkanda'}</span>
        </span>
        <Chev />
      </a>
      <section aria-label="Bu günkü çəkiliş" className="g glow-cal rise" {...rise(i)}>
        <span className="n-hd"><span><Chip tone="cal" icon="cal" /><span className="n-lbl">Bu günkü çəkiliş</span></span></span>
        <div className="n-body" style={{ marginTop: 12 }}>{timeOf(s.starts_at)}–{endTimeOf(s.starts_at, s.duration_min)} · {kindLabel(s)} · {setupLabel(s)}</div>
        <PayLine s={s} flat />
        <div className="n-btns">
          <a className="nb nb-s" href={`#/shoots/${s.id}`}>Təfərrüat</a>
          <a className="nb nb-s" style={{ flexBasis: 150 }} href={PHONE_HREF}><NIcon name="phone" size={18} />Studiyaya zəng et</a>
        </div>
      </section>
    </>
  );
}

function NoShoot({ i }: { i: number }) {
  return (
    <section aria-label="Növbəti çəkiliş" className="g rise" {...rise(i)}>
      <span className="n-hd"><span><Chip tone="cal" icon="cal" /><span className="n-lbl">Növbəti çəkiliş</span></span></span>
      <div className="n-h2" style={{ marginTop: 12 }}>Yaxın çəkiliş yoxdur</div>
      <div className="n-body c2" style={{ marginTop: 4 }}>Tarixi və formatı WhatsApp-da birlikdə seçək.</div>
      <a className="nb nb-p" style={{ marginTop: 14, flex: 'none' }} href={waLink(BOOK_TEXT)} target="_blank" rel="noopener"><NIcon name="msg" size={18} />WhatsApp-da yaz</a>
    </section>
  );
}

// --- bento: keşbek + paket ---
function CashbackTile({ bal, min, i }: { bal: number; min: number; i: number }) {
  const v = useCountUp(bal);
  const pct = Math.min(100, (bal / min) * 100);
  const azn = (q: number) => amount2(q).replace(/,00$/, '');
  return (
    <a href="#/cashback" aria-label={`Keşbek: ${amount2(bal)} AZN`} className={`g rise${bal ? ' glow-cb' : ''}`} {...rise(i)}>
      <span className="bento-hd"><span><Chip tone="cb" icon="coins" /><span className="n-lbl">Keşbek</span></span></span>
      <span className="amount">
        <span className="n-num" style={bal ? undefined : { color: 'var(--yp-text-2)' }}>{amount2(v)}</span>
        <span className="n-unit" style={bal ? undefined : { color: 'var(--yp-text-3)' }}>AZN</span>
      </span>
      <span className="nbar" style={{ marginTop: 10 }}>{bal > 0 && <span style={{ width: `${pct}%`, background: 'var(--yp-cashback)' }} />}</span>
      <span className="n-meta" style={{ marginTop: 8 }}>
        {bal >= min ? 'Növbəti çəkilişdə istifadə olunur' : `${azn(min)} AZN-ə qədər daha ${azn(min - bal)} AZN`}
      </span>
    </a>
  );
}

function PackageTile({ p, i }: { p: Pkg | null; i: number }) {
  if (!p) {
    return (
      <a href={waLink('Salam, saatlıq paket haqqında məlumat almaq istəyirəm.')} target="_blank" rel="noopener" className="g rise" {...rise(i)}>
        <span className="bento-hd"><span><Chip tone="pkg" icon="pkg" /><span className="n-lbl">Paket</span></span></span>
        <span className="n-body6" style={{ marginTop: 10 }}>Saatlıq paket — daha sərfəli</span>
        <span className="n-link" style={{ marginTop: 'auto', paddingTop: 10 }}>WhatsApp-da soruş<NIcon name="arrow" size={14} /></span>
      </a>
    );
  }
  const frac = p.minutes_total ? Math.max(0, Math.min(1, p.minutes_left / p.minutes_total)) : 0;
  const h = Math.floor(p.minutes_left / 60), m = p.minutes_left % 60;
  const [, em, ed] = p.ends_on.split('-').map(Number);
  return (
    <a href="#/package" aria-label={`Paket: ${h} saat ${m ? `${m} dəqiqə ` : ''}qalıb`} className="g glow-pkg rise" {...rise(i)}>
      <span className="bento-hd">
        <span><Chip tone="pkg" icon="pkg" /><span className="n-lbl">Paket</span></span>
        <svg width="36" height="36" viewBox="0 0 48 48" aria-hidden="true" style={{ flex: 'none', transform: 'rotate(-90deg)' }}>
          <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="5" />
          <circle className="ring-v" cx="24" cy="24" r="20" fill="none" stroke="var(--yp-package)" strokeWidth="5" strokeLinecap="round" strokeDasharray="125.66" strokeDashoffset={125.66 * (1 - frac)} />
        </svg>
      </span>
      <span className="amount">
        <span className="n-num">{h}</span><span className="n-unit">saat</span>
        {m > 0 && <><span className="n-num" style={{ marginLeft: 2 }}>{m}</span><span className="n-unit">dəq</span></>}
      </span>
      <span className="n-meta" style={{ marginTop: 8 }}>{fmtHours(p.minutes_total)} saatlıq paket · {ed} {MON3[em - 1]}-dək</span>
    </a>
  );
}

function Skeleton() {
  const b = (w: number | string, h: number, r = 8, extra?: CSSProperties) => <span className="skel" style={{ display: 'block', width: w, height: h, borderRadius: r, ...extra }} />;
  return (
    <div className="col" style={{ gap: 10 }} aria-busy="true" aria-label="Yüklənir">
      <div className="home-top">
        <span className="col" style={{ gap: 8 }}>{b(150, 20)}{b(96, 10)}</span>
        <span className="acts">{b(44, 44, 22)}{b(44, 44, 22)}</span>
      </div>
      <div className="g" style={{ gap: 12, minHeight: 228 }}>
        <span className="row" style={{ gap: 8 }}>{b(28, 28, 14)}{b(110, 12)}</span>
        {b('60%', 18)}{b('88%', 12)}{b('50%', 12)}
        <span className="row" style={{ gap: 8, marginTop: 'auto' }}>{b('48%', 44, 22)}{b('52%', 44, 22)}</span>
      </div>
      <div className="bento">
        {[0, 1].map((k) => (
          <div key={k} className="g" style={{ gap: 12, minHeight: 164 }}>
            <span className="row" style={{ gap: 8 }}>{b(28, 28, 14)}{b(60, 12)}</span>{b(96, 24, 12)}<span style={{ marginTop: 'auto' }}>{b('80%', 10)}</span>
          </div>
        ))}
      </div>
      {[200, 150].map((w) => <div key={w} className="g g-row">{b(28, 28, 14)}{b(w, 12)}</div>)}
    </div>
  );
}

export function Home() {
  const q = useApi<HomeData>('/me/home', HOME_CACHE);
  const d = q.data;
  const s = d?.next_shoot ?? null;
  const today = !!s && dayKey(s.starts_at) === todayKey();
  const soon = !!s && !today && new Date(s.starts_at).getTime() - Date.now() < 24 * 3600_000;
  const now = useNow(today || soon, today ? 30_000 : 1000);

  if (!d) return <Screen tab="home">{q.loading ? <Skeleton /> : <ErrorState q={q} />}</Screen>;
  let i = 0;
  const name = d.full_name.split(' ')[0];
  const filled = Math.round((d.profile_pct / 100) * 4);
  const nowIso = new Date(now).toISOString();
  return (
    <Screen tab="home">
      <header className="home-top rise" {...rise(i++)}>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <h1 className="n-h1">Salam, {name}</h1>
          <div className="n-meta">{weekday(nowIso)}, {dateShort(nowIso)}</div>
        </div>
        <div className="acts">
          <a className="rbtn" href="#/notifications" aria-label={`Bildirişlər${d.unread_notifications ? `, ${d.unread_notifications} oxunmamış` : ''}`}>
            <NIcon name="bell" />{d.unread_notifications > 0 && <span className="dot" aria-hidden="true" />}
          </a>
          <a className="rbtn" href="#/profile" aria-label="Profil">{name.charAt(0).toLocaleUpperCase('az')}</a>
        </div>
      </header>
      {q.offline && <OfflineBadge />}

      {!s ? <NoShoot i={i++} /> : today ? <ShootDay s={s} now={now} i={i++} /> : soon ? <Countdown s={s} now={now} i={i++} /> : <NextShoot s={s} i={i++} />}

      <div className="bento">
        <CashbackTile bal={d.cashback_balance} min={d.cashback_min_use} i={i++} />
        <PackageTile p={d.package} i={i++} />
      </div>

      {/* çəkiliş günü təklif zolağı gizlidir */}
      {d.active_offer && !today && (
        <a href={`#/offer/${d.active_offer.id}`} className="g g-row glow-offer rise" {...rise(i++)}>
          <Chip tone="offer" icon="tag" />
          <span className="n-col">
            <span className="n-body6">{d.active_offer.title}</span>
            {d.active_offer.body && <span className="n-meta">{d.active_offer.body.split(/(?<=[.!?])\s/)[0]}</span>}
          </span>
          <Chev />
        </a>
      )}

      {d.last_material && (
        <a href={d.last_material.drive_url} target="_blank" rel="noopener" className="g g-row rise" {...rise(i++)}>
          <Chip tone="mat" icon="folder" />
          <span className="n-body6" style={{ flex: 1, minWidth: 0 }}>{d.last_material.shoot_title || d.last_material.title} hazırdır</span>
          <span className="n-meta row" style={{ flex: 'none', gap: 4, fontWeight: 600 }}>Drive-da aç<NIcon name="ext" size={14} /></span>
        </a>
      )}

      <section aria-label="Dostunu gətir" className="g g-row rise" style={{ padding: 16, '--i': i++ } as CSSProperties}>
        <Chip icon="gift" />
        <span className="n-col"><span className="n-lbl">Dostunu gətir</span><span className="n-body">Dostunuz ilk çəkilişini edəndə hər ikinizə 20 AZN</span></span>
        <button type="button" className="nb nb-s nb-auto" onClick={() => shareReferral(d.referral_code)}><NIcon name="share" size={16} />Paylaş</button>
      </section>

      {d.profile_pct < 100 && (
        <a href="#/profile" className="g rise" style={{ gap: 10, '--i': i++ } as CSSProperties}>
          <span className="row" style={{ gap: 12 }}>
            <Chip icon="user" />
            <span className="n-body6" style={{ flex: 1, minWidth: 0 }}>Profili tamamlayın — +5 AZN keşbek</span>
            <Chev />
          </span>
          <span className="row" style={{ gap: 10, paddingLeft: 40 }}>
            <span className="nbar" style={{ flex: 1 }}>{filled > 0 && <span style={{ width: `${d.profile_pct}%`, background: 'var(--yp-accent)', animationDelay: '240ms' }} />}</span>
            <span className="n-meta" style={{ flex: 'none', fontWeight: 600 }}>{filled}/4</span>
          </span>
        </a>
      )}

      <PushHint />

      <nav aria-label="Studiya ilə əlaqə" className="contact rise" {...rise(i++)}>
        <span className="n-meta">Studiya ilə əlaqə</span>
        <div>
          <a className="nb nb-o" href={waLink('Salam!')} target="_blank" rel="noopener"><NIcon name="msg" size={16} />WhatsApp</a>
          <a className="nb nb-o" href={PHONE_HREF}><NIcon name="phone" size={16} />Zəng</a>
          <a className="nb nb-o" href={MAP_URL} target="_blank" rel="noopener"><NIcon name="pin" size={16} />Ünvan</a>
        </div>
      </nav>
    </Screen>
  );
}
