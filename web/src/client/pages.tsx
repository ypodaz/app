import { useContext, useEffect, useState, type CSSProperties } from 'react';
import { api } from '../shared/api';
import { NIcon, type NIconName } from '../shared/ui';
import { AuthCtx, ErrorState, HOME_CACHE, InnerHeader, Loading, NEmpty, OfflineBadge, Screen, useApi } from './core';
import { amount2, useCountUp, type HomeData, type Pkg } from './home';
import { PushCard } from './push';
import { BOOK_TEXT, dayKey as dayKeyOf, dayLabel, dayMon, daysBetween, fmtHours, relDay, timeOf, todayKey, waLink, weekday } from './util';

const rise = (i: number) => ({ '--i': i }) as CSSProperties;
const azn2 = (q: number) => `${amount2(q)} AZN`;
/** Saat/dəqiqə: «2 saat», «1 s 30 dəq», «45 dəq». */
const hm = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return h && m ? `${h} s ${m} dəq` : h ? `${h} saat` : `${m} dəq`; };
const Chip = ({ tone, icon, size = 16 }: { tone?: string; icon: NIconName; size?: number }) => (
  <span className={`nchip${tone ? ' nchip-' + tone : ''}`}><NIcon name={icon} size={size} /></span>
);

// ---------- Keşbek ----------
type CbRow = { kind: string; amount: number; note: string | null; created_at: string; shoot_title: string | null };
const KIND: Record<string, string> = {
  earn: 'Çəkiliş', earn_first: 'İlk çəkiliş bonusu', spend: 'Çəkilişdə istifadə olundu', spend_return: 'Keşbek qaytarıldı', manual: 'Əvvəlki keşbek',
  profile_bonus: 'Profil bonusu', referral: 'Dost dəvəti bonusu', birthday: 'Ad günü hədiyyəsi',
};
const WA_CB = 'Salam, keşbek haqqında soruşmaq istəyirəm.';

export function Cashback() {
  const q = useApi<{ balance: number; min_use?: number; shoots_left?: number; rows: CbRow[] }>('/me/cashback', 'ypod.cashback');
  const d = q.data;
  const min = d?.min_use ?? 7000;
  const bal = Math.max(0, d?.balance ?? 0);
  const v = useCountUp(bal);
  const [open, setOpen] = useState<boolean | null>(null);
  const head = <InnerHeader title="Keşbekim" back="#/" />;
  if (!d) return <Screen tab="home">{head}{q.loading ? <Loading /> : <ErrorState q={q} />}</Screen>;

  const ok = d.balance >= min;
  const isOpen = open ?? (!ok && d.rows.length > 0);
  const RULES = [
    'İlk çəkilişə 40% keşbek',
    'Keşbek 2 çəkiliş bağlandıqdan sonra, 3-cü çəkilişdən istifadə olunur',
    'Hər çəkilişdən məbləğin 10%-i keşbek',
    'Keşbek çəkiliş bağlananda yazılır',
    `Balans ${azn2(min)}-ə çatanda istifadə olunur; istifadə olunanda bir dəfəyə tam xərclənir`,
    'Podcastdan Reels: hər biri 10 AZN (montajla birlikdə)',
    'Müddətsizdir · pul kimi qaytarılmır',
  ];
  return (
    <Screen tab="home">
      {head}
      {q.offline && <OfflineBadge />}
      <div className="npush npush-f">
        <section aria-label="Keşbek balansı" className="g glow-cb2 rise" style={rise(0)}>
          <div className="n-hd"><span><Chip tone="cb" icon="coins" /><span className="n-lbl">Keşbek balansı</span></span></div>
          <div className={`ncb-n${ok ? ' ok' : ''}`}>
            <b>{amount2(v)}</b><span className="n-unit">AZN</span>
            {ok && <span className="ncb-pop" role="img" aria-label="Balans kifayətdir"><NIcon name="check" size={14} /></span>}
          </div>
          <div className="nbar ncb-bar" role="progressbar" aria-label={`${azn2(min)}-ə qədər`} aria-valuemin={0} aria-valuemax={min / 100} aria-valuenow={Math.min(bal, min) / 100}>
            <span style={{ width: `${Math.min(100, (bal / min) * 100)}%` }} />
          </div>
          <div className="n-meta ncb-sub">{(d.shoots_left ?? 0) > 0 ? (d.shoots_left === 2 ? '3-cü çəkilişdən istifadə olunur' : 'Növbəti çəkilişdən sonra istifadə olunur') : ok ? 'Növbəti çəkilişdə istifadə edə bilərsiniz' : `Balans ${azn2(min)}-ə çatanda növbəti çəkilişdə istifadə olunur · daha ${azn2(min - bal)} qalıb`}</div>
        </section>

        <section aria-label="Qaydalar" className="g nrules rise" style={rise(1)}>
          <button type="button" className="nrules-b" aria-expanded={isOpen} aria-controls="cb-rules" onClick={() => setOpen(!isOpen)}>
            <span className="n-h2">Qaydalar</span>
            <NIcon name="chev" className="nrules-c" style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} />
          </button>
          <div id="cb-rules" className={`nrules-p${isOpen ? ' open' : ''}`}>
            <ul className="nrules-ul">
              {RULES.map((t) => <li key={t}><span className="nck" aria-hidden="true"><NIcon name="check" size={12} /></span><span className="n-body" style={{ flex: 1, minWidth: 0 }}>{t}</span></li>)}
            </ul>
          </div>
        </section>

        {d.rows.length === 0 ? (
          <NEmpty fill icon="coins" tone="cb" title="Hələ keşbek yoxdur" text="İlk çəkilişinizdən sonra keşbek burada yığılacaq. İlk çəkilişə 40%.">
            <a className="nb nb-p nb-auto" href={waLink(WA_CB)} target="_blank" rel="noopener">WhatsApp-da yaz</a>
          </NEmpty>
        ) : (
          <section aria-label="Tarixçə" className="g nlist rise" style={rise(2)}>
            <h2 className="n-h2 nsec-h">Tarixçə</h2>
            <ul className="nrows">
              {d.rows.map((r, i) => (
                <li key={i} className="nrow nrow-f" style={rise(i)}>
                  <span className="nrow-t">
                    <span className="n-body6">{KIND[r.kind] ?? r.kind}</span>
                    <span className="n-meta">{[r.shoot_title ?? (r.kind === 'manual' ? null : r.note), dayMon(r.created_at)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={`nrow-a${r.amount >= 0 ? ' pos' : ''}`}>{r.amount >= 0 ? '+' : '−'}{amount2(Math.abs(r.amount))}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Screen>
  );
}

// ---------- Paket ----------
type PkgFull = Pkg & { usage: { member_name: string | null; delta_minutes: number; note: string | null; date: string }[]; members: { name: string; role: string }[] };
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const shortName = (n: string | null) => (n ? (n.split(' ').length > 1 ? `${n.split(' ')[0]} ${n.split(' ')[1][0]}.` : n) : null);
const plainDay = (s: string) => `${dayMon(`${s}T00:00:00+04:00`)} ${s.slice(0, 4)}`;
const RING = 351.86;

export function PackagePage() {
  const q = useApi<PkgFull>('/me/package', 'ypod.package');
  const home = useApi<HomeData>('/me/home', HOME_CACHE);
  const p = q.data;
  const left = p ? daysBetween(todayKey(), p.ends_on) : 0;
  const me = home.data?.full_name;
  const head = <InnerHeader title="Saat paketi" back="#/" />;
  if (!p) {
    return (
      <Screen tab="home">
        {head}
        {q.loading ? <Loading /> : q.err.includes('tapılmadı') ? (
          <div className="npush npush-f">
            <NEmpty fill icon="pkg" tone="pkg" title="Aktiv paketiniz yoxdur" text="Saat paketi üçün bizə yazın.">
              <a className="nb nb-p nb-auto" href={waLink('Salam, saat paketi haqqında məlumat almaq istəyirəm.')} target="_blank" rel="noopener">Paket haqqında soruşun</a>
            </NEmpty>
          </div>
        ) : <ErrorState q={q} />}
      </Screen>
    );
  }
  const h = Math.floor(p.minutes_left / 60), m = p.minutes_left % 60;
  const pct = p.minutes_total ? Math.max(0, Math.min(1, p.minutes_left / p.minutes_total)) : 0;
  return (
    <Screen tab="home">
      {head}
      {q.offline && <OfflineBadge />}
      <div className="npush">
        <div className="npk-hd rise" style={rise(0)}>
          <h2 className="n-h2">{p.title}</h2>
          <div className="n-meta">Sahibi: {p.owner_name} · {fmtHours(p.minutes_total)} saat · {p.cameras} kamera</div>
        </div>

        <section aria-label="Qalan saatlar" className="g glow-pkg2 rise" style={rise(1)}>
          <div className="n-hd"><span><Chip tone="pkg" icon="pkg" /><span className="n-lbl">Paket</span></span></div>
          <div className="npk-top">
            <div className="npk-ring" role="img" aria-label={`${h ? `${h} saat ` : ''}${m ? `${m} dəqiqə ` : ''}qalıb`}>
              <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden="true">
                <circle cx="64" cy="64" r="56" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="8" />
                <circle cx="64" cy="64" r="56" fill="none" stroke="#FFC94D" strokeWidth="8" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - pct)} />
              </svg>
              <span className="npk-mid" aria-hidden="true">
                {h ? <><b>{h} s</b>{m > 0 && <span className="n-lbl">{m} dəq</span>}</> : <b>{m} dəq</b>}
              </span>
            </div>
            <div className="n-h2" style={{ flex: 1, minWidth: 0 }}>{fmtHours(p.minutes_total)} saatdan qalıb</div>
          </div>
          <div className="npk-dates">
            <div><span className="n-meta">Başlama</span><span className="n-body6">{plainDay(p.starts_on)}</span></div>
            <div><span className="n-meta">Bitmə</span><span className="n-body6">{plainDay(p.ends_on)}</span></div>
          </div>
        </section>

        {left <= 30 && left >= 0 && (
          <div className="g nwarn" role="status">
            <Chip tone="pkg" icon="alert" />
            <span className="n-col">
              <span className="n-body6">Paketin bitməsinə {left} gün qalıb.</span>
              <span className="n-lbl" style={{ fontWeight: 500 }}>Qalan {m ? `${h ? `${h} s ` : ''}${m} dəq-i` : `${h} saatı`} {dayMon(`${p.ends_on}T00:00:00+04:00`)} tarixinə qədər istifadə edin.</span>
            </span>
          </div>
        )}
        <a className="nb nb-p nb-full npk-cta rise" style={rise(2)} href={waLink('Salam, paket saatları ilə çəkilişə yazılmaq istəyirəm.')} target="_blank" rel="noopener">Studiyaya yazın</a>
        <p className="n-meta npk-hint rise" style={rise(3)}>Paket saatları yalnız studiyada keçərlidir. Əlavə kamera: saatda 50 AZN, studiyada ödənir.</p>

        <section aria-label="İstifadə tarixçəsi" className="g nlist rise" style={{ ...rise(4), marginTop: 4 }}>
          <h2 className="n-h2 nsec-h">İstifadə tarixçəsi</h2>
          {p.usage.length === 0 ? <p className="n-body c2" style={{ margin: '4px 0 12px' }}>Hələ istifadə yoxdur.</p> : (
            <ul className="nrows">
              {p.usage.map((u, i) => (
                <li key={i} className="nrow">
                  <span className="nrow-t">
                    <span className="n-body6">{shortName(u.member_name) ?? u.note ?? 'Düzəliş'}</span>
                    <span className="n-meta">{dayMon(u.date)}{u.member_name && u.note ? ` · ${u.note}` : ''}</span>
                  </span>
                  <span className={`nrow-a${u.delta_minutes > 0 ? ' pos' : ''}`}>{u.delta_minutes >= 0 ? '+' : '−'}{hm(Math.abs(u.delta_minutes))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Üzvlər" className="g npk-mem rise" style={rise(5)}>
          <h2 className="n-h2">Üzvlər</h2>
          <ul className="nmems">
            {p.members.map((mb) => (
              <li key={mb.name}>
                <span className={`nmav${mb.name === me ? ' nmav-me' : ''}`} aria-hidden="true">{initials(mb.name)}</span>
                <span className="nmem">
                  <span className="n-body6">{mb.name}</span>
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    {mb.name === me && <span className="nowner nowner-me">Siz</span>}
                    <span className="nowner">{mb.role === 'owner' ? 'Sahib' : 'Üzv'}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="n-meta npk-note">Paket üzvləri qalan saatları görür və onlardan rezervasiya edə bilir.</p>
        </section>
      </div>
    </Screen>
  );
}

// ---------- Materiallar (A4a/A4b) ----------
const MAT_AUDIO = /audio|mp3|səs/i;
type MatGroup = { shoot_id: number; title: string | null; starts_at: string; production: string; delivery_on: string | null; materials: { id: number; title: string; drive_url: string }[] };

export function Materials() {
  const q = useApi<MatGroup[]>('/me/materials', 'ypod.materials');
  const head = <header className="ncal-head rise"><h1 className="n-h1">Materiallar</h1></header>;
  if (!q.data) return <Screen tab="materials">{head}{q.loading ? <Loading /> : <ErrorState q={q} />}</Screen>;
  if (q.data.length === 0) {
    return (
      <Screen tab="materials">
        {head}
        {q.offline && <OfflineBadge />}
        <NEmpty fill icon="folder" tone="mat" title="Hələ material yoxdur" text="Çəkilişdən sonra materiallarınız burada görünəcək.">
          <a className="nb nb-p nb-auto" href={waLink(BOOK_TEXT)} target="_blank" rel="noopener"><NIcon name="msg" size={18} />WhatsApp-da yaz</a>
        </NEmpty>
      </Screen>
    );
  }
  return (
    <Screen tab="materials">
      {head}
      {q.offline && <OfflineBadge />}
      {q.data.map((g, gi, all) => {
        const newest = gi === all.findIndex((x) => x.materials.length > 0);
        const name = g.title || 'Çəkiliş';
        const ready = g.production === 'ready';
        return (
          <section key={g.shoot_id} aria-label={name} className={`g rise${newest ? ' glow-mat' : ''}`} style={{ '--i': gi + 1 } as CSSProperties}>
            {newest && <div className="nmat-new"><i aria-hidden="true" />Ən yeni material</div>}
            <div className="nmat-hd" style={newest ? { marginTop: 8 } : undefined}>
              <div className="n-col" style={{ gap: 2 }}><h2 className="n-body6">{name}</h2><span className="n-meta">{dayLabel(g.starts_at)}</span></div>
              <span className={`nstat nstat-${ready ? 'cb' : 'pkg'}`}><i aria-hidden="true" />{ready ? 'Hazırdır' : 'Montajda'}</span>
            </div>
            {g.materials.length === 0 ? (
              <div className="nmat-pend"><NIcon name="clock" size={16} style={{ flex: 'none' }} /><span style={{ minWidth: 0 }}>Montaj gedir{g.delivery_on ? ` · təhvil ${dayMon(`${g.delivery_on}T00:00:00+04:00`)}` : ''}</span></div>
            ) : <div className="nmat-list">
              {g.materials.map((m) => (
                <a key={m.id} className="nmat-row" href={m.drive_url} target="_blank" rel="noopener noreferrer">
                  <span className="nchip nchip-mat"><NIcon name={MAT_AUDIO.test(m.title) ? 'faudio' : 'fvideo'} size={16} /></span>
                  <span className="n-body" style={{ flex: 1, minWidth: 0 }}>{m.title}</span>
                  <span className="nmat-o">Drive-da aç<NIcon name="ext" size={14} className="nmat-a" /></span>
                </a>
              ))}
            </div>}
          </section>
        );
      })}
    </Screen>
  );
}

// ---------- Bildirişlər ----------
type Notif = { id: number; type: string; payload: Record<string, number | string>; created_at: string; read_at: string | null; shoot: { starts_at: string; tag: string } | null };
const TAG_LBL: Record<string, string> = { podcast: 'Podcast', reels: 'Reels', other: 'Çəkiliş' };
const cap = (t: string) => t.charAt(0).toLocaleUpperCase('az') + t.slice(1);
const when = (n: Notif) => (n.shoot ? [`${dayLabel(n.shoot.starts_at)} · ${timeOf(n.shoot.starts_at)}`, TAG_LBL[n.shoot.tag]].filter(Boolean).join(' · ') : undefined);

type Desc = { title: string; sub?: string; icon: NIconName; tone?: string };
function describe(n: Notif): Desc {
  const p = n.payload;
  switch (n.type) {
    case 'shoot_created': return { title: 'Yeni çəkiliş əlavə olundu', sub: when(n), icon: 'cal', tone: 'cal' };
    case 'deposit_received': return { title: 'Beh qəbul olundu', sub: p.amount ? azn2(Number(p.amount)) : undefined, icon: 'coins' };
    case 'shoot_closed': return { title: 'Çəkiliş bağlandı', sub: Number(p.cashback) > 0 ? `+${azn2(Number(p.cashback))} keşbek yazıldı` : undefined, icon: 'coins', tone: 'cb' };
    case 'shoot_cancelled': return { title: 'Çəkiliş ləğv olundu', sub: Number(p.refund) > 0 ? `${azn2(Number(p.refund))} geri qaytarılacaq` : when(n), icon: 'cal' };
    case 'refunded': return { title: 'Ödəniş geri qaytarıldı', sub: p.amount ? azn2(Number(p.amount)) : undefined, icon: 'undo' };
    case 'shoot_rescheduled': return { title: 'Çəkiliş vaxtı dəyişdi', sub: p.starts_at ? `Yeni vaxt: ${dayLabel(String(p.starts_at))} · ${timeOf(String(p.starts_at))}` : undefined, icon: 'cal', tone: 'cal' };
    case 'shoot_updated': return { title: 'Çəkiliş məlumatı yeniləndi', sub: when(n), icon: 'cal', tone: 'cal' };
    case 'materials_ready': return { title: 'Materiallar hazırdır', icon: 'folder', tone: 'mat' };
    case 'shoot_reminder': return { title: n.shoot ? `${cap(weekday(n.shoot.starts_at))} çəkilişiniz var` : 'Sabah çəkilişiniz var', sub: when(n), icon: 'cal', tone: 'cal' };
    case 'package_ending': return { title: 'Paketiniz bitmək üzrədir', sub: p.minutes_left !== undefined ? `Qalan ${hm(Number(p.minutes_left))}${p.ends_on ? ` · ${dayMon(`${p.ends_on}T00:00:00+04:00`)} tarixinədək` : ''}` : undefined, icon: 'pkg', tone: 'pkg' };
    case 'campaign': return { title: String(p.title || 'Yeni təklif'), sub: p.body ? String(p.body) : undefined, icon: 'tag', tone: 'offer' };
    case 'bonus': {
      const amt = p.amount ? `+${azn2(Number(p.amount))} keşbek yazıldı` : undefined;
      return p.kind === 'referral' ? { title: 'Dostunuz gəldi', sub: [p.friend, amt].filter(Boolean).join(' · ') || undefined, icon: 'gift' }
        : { title: p.kind === 'birthday' ? 'Ad günü hədiyyəsi' : 'Profil bonusu', sub: amt, icon: 'gift' };
    }
    default: return { title: 'Yeni bildiriş', icon: 'bell' };
  }
}

const hrefOf = (n: Notif) => {
  const sid = n.payload.shoot_id;
  return n.type === 'campaign' ? `#/offer/${n.payload.campaign_id}` : n.type === 'bonus' ? '#/cashback' : sid ? `#/shoots/${sid}` : n.type === 'materials_ready' ? '#/materials' : n.type === 'package_ending' ? '#/package' : '';
};

/** Bu gün / Bu həftə (bazar ertəsindən) / Daha əvvəl. */
function groupOf(iso: string): 0 | 1 | 2 {
  const today = todayKey(), n = daysBetween(dayKeyOf(iso), today);
  if (n <= 0) return 0;
  const wd = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // bazar ertəsi = 0
  return n <= wd ? 1 : 2;
}
const GROUPS = ['Bu gün', 'Bu həftə', 'Daha əvvəl'];

export function Notifications() {
  const { token } = useContext(AuthCtx);
  const q = useApi<Notif[]>('/me/notifications');
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [gone, setGone] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!q.data) return;
    // Açılanda oxunmuşlar işarələnir; bu açılışda yeni olanlar vurğulu qalır.
    setSeen(new Set(q.data.filter((n) => !n.read_at).map((n) => n.id)));
    if (q.data.some((n) => !n.read_at)) api('/me/notifications/read', { token, body: {} }).catch(() => {});
  }, [q.data, token]);
  const head = <InnerHeader title="Bildirişlər" back="#/" />;
  const list = q.data ?? [];
  return (
    <Screen tab="home">
      {head}
      <div className="npush npush-f">
        <PushCard />
        {!q.data ? (q.loading ? <Loading /> : <ErrorState q={q} />) : list.length === 0 ? (
          <NEmpty fill icon="inbox" tone="" title="Bildiriş yoxdur" text="Çəkiliş, beh və keşbek xəbərləri burada görünəcək." />
        ) : [0, 1, 2].map((g) => {
          const items = list.filter((n) => groupOf(n.created_at) === g);
          if (!items.length) return null;
          return (
            <div key={g} style={{ display: 'contents' }}>
              <h2 className="ngrp rise" style={rise(g * 2 + 1)}>{GROUPS[g]}</h2>
              <section aria-label={GROUPS[g]} className="g ngl rise" style={rise(g * 2 + 2)}>
                {items.map((n) => {
                  const t = describe(n), href = hrefOf(n), isNew = seen.has(n.id);
                  const body = (
                    <>
                      <span className={`nchip${t.tone ? ' nchip-' + t.tone : ''}`}><NIcon name={t.icon} size={16} /></span>
                      <span className="nnt-b">
                        <span className="n-body6">{t.title}</span>
                        {t.sub && <span className="nnt-s">{t.sub}</span>}
                        <span className="nnt-m">{dayMon(n.created_at)} · {timeOf(n.created_at)} · {relDay(n.created_at).toLocaleLowerCase('az')}</span>
                      </span>
                      {n.type === 'campaign' && <NIcon name="chev" style={{ flex: 'none', alignSelf: 'center', color: 'var(--yp-text-3)' }} />}
                      {isNew && <><span className="nsr">Yeni</span><span aria-hidden="true" className={`nnt-dot${gone.has(n.id) ? ' off' : ''}`} /></>}
                    </>
                  );
                  const open = () => isNew && setGone((s) => new Set(s).add(n.id));
                  return href ? <a key={n.id} className="nnt" href={href} onClick={open}>{body}</a> : <div key={n.id} className="nnt" onClick={open}>{body}</div>;
                })}
              </section>
            </div>
          );
        })}
      </div>
    </Screen>
  );
}
