import { useEffect, useState } from 'react';
import { api } from '../shared/api';
import { Card, EmptyState, Icon, Pill } from '../shared/ui';
import { AuthCtx, BookButtons, ErrorState, HOME_CACHE, Loading, OfflineBadge, Screen, TopBar, useApi, XIcon } from './core';
import { useContext } from 'react';
import type { HomeData, Pkg } from './home';
import { PackageCard } from './home';
import { PushCard } from './push';
import { dateFull, dateLong, dateShort, daysBetween, fmtHours, money, plainDate, relDay, timeOf, todayKey, waLink } from './util';

// ---------- Keşbek (A7a/A7b) ----------
type CbRow = { kind: string; amount: number; note: string | null; created_at: string; shoot_title: string | null };
const KIND: Record<string, string> = {
  earn: 'Çəkiliş', earn_first: 'İlk çəkiliş bonusu', spend: 'Çəkilişdə istifadə olundu', spend_return: 'Keşbek qaytarıldı', manual: 'Əvvəlki keşbek',
  profile_bonus: 'Profil bonusu', referral: 'Dost dəvəti bonusu', birthday: 'Ad günü hədiyyəsi',
};

export function Cashback() {
  const q = useApi<{ balance: number; min_use?: number; rows: CbRow[] }>('/me/cashback', 'ypod.cashback');
  const d = q.data;
  const min = d?.min_use ?? 7000;
  return (
    <Screen tab="home">
      <TopBar title="Keşbekim" />
      {q.offline && d && <OfflineBadge />}
      {!d ? (q.loading ? <Loading /> : <ErrorState q={q} />) : (
        <>
          <Card tone="violet">
            <span className="t13 w8" style={{ color: '#e9d5ff' }}>Keşbek balansı</span>
            <span className="num-xl" style={{ fontSize: 44 }}>{money(d.balance).replace(' AZN', '')}<span className="unit">AZN</span></span>
            {d.balance < min ? (
              <>
                <div className="cbbar" role="progressbar" aria-valuemin={0} aria-valuemax={min} aria-valuenow={Math.max(0, d.balance)}><i style={{ width: `${Math.max(0, Math.min(100, (d.balance / min) * 100))}%` }} /></div>
                <span className="t13 w7" style={{ color: '#e9d5ff' }}>Balans {money(min)}-ə çatanda növbəti çəkilişdə istifadə olunur · daha {money(min - d.balance)} qalıb</span>
              </>
            ) : <span className="t13 w7" style={{ color: '#e9d5ff' }}>Növbəti çəkilişdə istifadə edə bilərsiniz</span>}
          </Card>
          <Card>
            <span className="h3">Qaydalar</span>
            <ul className="col soft t14 lh" style={{ margin: 0, paddingLeft: 18, gap: 6 }}>
              <li>İlk çəkilişə 50% keşbek</li>
              <li>Hər çəkilişdən məbləğin 10%-i keşbek</li>
              <li>Keşbek çəkiliş bağlananda yazılır</li>
              <li>Balans {money(min)}-ə çatanda istifadə olunur; istifadə olunanda bir dəfəyə tam xərclənir</li>
              <li>Podcastdan Reels: hər biri 10 AZN (montajla birlikdə)</li>
              <li>Müddətsizdir · pul kimi qaytarılmır</li>
            </ul>
          </Card>
          <span className="lbl mt">Tarixçə</span>
          {d.rows.length === 0 ? (
            <>
              <EmptyState icon="wallet" title="Hələ keşbek yoxdur" text="İlk çəkilişinizdən sonra keşbek burada yığılacaq. İlk çəkilişə 50%." />
              <BookButtons />
            </>
          ) : (
            <Card>
              <div className="list">
                {d.rows.map((r, i) => (
                  <div key={i} className="li">
                    <span className="col grow" style={{ gap: 2 }}>
                      <span className="t14 w8">{KIND[r.kind] ?? r.kind}</span>
                      <span className="t12 muted">{[r.shoot_title ?? (r.kind === 'manual' ? null : r.note), dateShort(r.created_at)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className={r.amount >= 0 ? 'amt-plus' : 'amt-minus'}>{r.amount >= 0 ? '+' : ''}{money(r.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

// ---------- Paket (A8) ----------
type PkgFull = Pkg & { usage: { member_name: string | null; delta_minutes: number; note: string | null; date: string }[]; members: { name: string; role: string }[] };
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const shortName = (n: string | null) => (n ? (n.split(' ').length > 1 ? `${n.split(' ')[0]} ${n.split(' ')[1][0]}.` : n) : null);

export function PackagePage() {
  const q = useApi<PkgFull>('/me/package', 'ypod.package');
  const home = useApi<HomeData>('/me/home', HOME_CACHE);
  const p = q.data;
  const left = p ? daysBetween(todayKey(), p.ends_on) : 0;
  const me = home.data?.full_name;
  return (
    <Screen tab="home">
      <TopBar title="Saat paketi" />
      {q.offline && p && <OfflineBadge />}
      {!p ? (q.loading ? <Loading /> : q.err.includes('tapılmadı') ? <EmptyState icon="building" title="Aktiv paketiniz yoxdur" text="Saat paketi üçün bizə yazın." action={<BookButtons text="Salam, saat paketi haqqında məlumat almaq istəyirəm." label="Paket haqqında soruşun" />} /> : <ErrorState q={q} />) : (
        <>
          <div className="col" style={{ gap: 2 }}>
            <h1 className="h2">Saat paketi · {p.title}</h1>
            <span className="t13 muted">Sahibi: {p.owner_name} · {fmtHours(p.minutes_total)} saat · {p.cameras} kamera</span>
          </div>
          <PackageCard p={p} />
          <Card>
            <div className="sum-r"><span className="muted">Başlama</span><span>{plainDate(p.starts_on)}</span></div>
            <div className="sum-r"><span className="muted">Bitmə</span><span>{plainDate(p.ends_on)}</span></div>
          </Card>
          {left <= 30 && left >= 0 && (
            <div className="banner" role="status">
              <Icon name="alert" size={18} />
              <span><b>Paketin bitməsinə {left} gün qalıb.</b><br />Qalan {fmtHours(p.minutes_left)} saatı {plainDate(p.ends_on)} tarixinə qədər istifadə edin.</span>
            </div>
          )}
          <a className="btn btn-cream" href={waLink('Salam, paket saatları ilə çəkilişə yazılmaq istəyirəm.')} target="_blank" rel="noopener"><XIcon name="wa" size={18} />Studiyaya yazın</a>
          <p className="hint">Paket saatları yalnız studiyada keçərlidir. Əlavə kamera: saatda 50 AZN, studiyada ödənir.</p>

          <span className="lbl mt">İstifadə tarixçəsi</span>
          <Card>
            {p.usage.length === 0 ? <p className="t14 muted">Hələ istifadə yoxdur.</p> : (
              <div className="list">
                {p.usage.map((u, i) => (
                  <div key={i} className="li">
                    <span className="col grow" style={{ gap: 2 }}>
                      <span className="t14 w8">{shortName(u.member_name) ?? u.note ?? 'Düzəliş'}</span>
                      <span className="t12 muted">{dateShort(u.date)}{u.member_name && u.note ? ` · ${u.note}` : ''}</span>
                    </span>
                    <span className={u.delta_minutes >= 0 ? 'amt-plus' : 'amt-minus'}>{u.delta_minutes >= 0 ? '+' : '−'}{fmtHours(Math.abs(u.delta_minutes))} saat</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <span className="lbl mt">Üzvlər</span>
          <Card>
            <div className="list">
              {p.members.map((m) => (
                <div key={m.name} className="li">
                  <span className="avatar">{initials(m.name)}</span>
                  <span className="col grow" style={{ gap: 2 }}>
                    <span className="t14 w8">{m.name}</span>
                    <span className="row" style={{ gap: 6 }}>
                      {m.name === me && <span className="tag tag-own">Siz</span>}
                      <span className="tag">{m.role === 'owner' ? 'Sahib' : 'Üzv'}</span>
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <p className="hint">Paket üzvləri qalan saatları görür və onlardan rezervasiya edə bilir.</p>
          </Card>
        </>
      )}
    </Screen>
  );
}

// ---------- Materiallar (A4a/A4b) ----------
type MatGroup = { shoot_id: number; title: string | null; starts_at: string; production: string; materials: { id: number; title: string; drive_url: string }[] };

export function Materials() {
  const q = useApi<MatGroup[]>('/me/materials', 'ypod.materials');
  return (
    <Screen tab="materials">
      <h1 className="h1">Materiallar</h1>
      {q.offline && q.data && <OfflineBadge />}
      {!q.data ? (q.loading ? <Loading /> : <ErrorState q={q} />) : q.data.length === 0 ? (
        <>
          <EmptyState icon="media" title="Hələ material yoxdur" text="Çəkilişdən sonra materiallarınız burada görünəcək." />
          <BookButtons />
        </>
      ) : q.data.map((g, gi) => (
        <Card key={g.shoot_id}>
          <div className="row sb">
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              {gi === 0 && <span className="t12 muted w6">Ən yeni material</span>}
              <span className="t15 w8">{g.title || 'Çəkiliş'}</span>
              <span className="t12 muted">{dateFull(g.starts_at)}</span>
            </div>
            {g.production === 'ready' ? <Pill status="done">Hazırdır</Pill> : <Pill status="confirmed">Montajda</Pill>}
          </div>
          {g.materials.map((m) => (
            <a key={m.id} className="btn btn-out btn-sm" href={m.drive_url} target="_blank" rel="noopener noreferrer">{m.title} · Drive-da aç<XIcon name="ext" size={16} /></a>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

// ---------- Bildirişlər ----------
type Notif = { id: number; type: string; payload: Record<string, number | string>; created_at: string; read_at: string | null };

function describe(n: Notif): { title: string; sub?: string } {
  const p = n.payload;
  switch (n.type) {
    case 'shoot_created': return { title: 'Yeni çəkiliş əlavə olundu' };
    case 'deposit_received': return { title: 'Beh qəbul olundu', sub: p.amount ? money(Number(p.amount)) : undefined };
    case 'shoot_closed': return { title: 'Çəkiliş bağlandı', sub: Number(p.cashback) > 0 ? `+${money(Number(p.cashback))} keşbek yazıldı` : undefined };
    case 'shoot_cancelled': return { title: 'Çəkiliş ləğv olundu', sub: Number(p.refund) > 0 ? `${money(Number(p.refund))} geri qaytarılacaq` : undefined };
    case 'refunded': return { title: 'Ödəniş geri qaytarıldı', sub: p.amount ? money(Number(p.amount)) : undefined };
    case 'shoot_rescheduled': return { title: 'Çəkiliş vaxtı dəyişdi', sub: p.starts_at ? `Yeni vaxt: ${dateLong(String(p.starts_at))} · ${timeOf(String(p.starts_at))}` : undefined };
    case 'shoot_updated': return { title: 'Çəkiliş məlumatı yeniləndi' };
    case 'materials_ready': return { title: 'Materiallar hazırdır' };
    case 'shoot_reminder': return { title: 'Sabah çəkilişiniz var' };
    case 'package_ending': return { title: 'Paketiniz bitmək üzrədir', sub: p.minutes_left !== undefined ? `Qalan ${fmtHours(Number(p.minutes_left))} saat${p.ends_on ? ` · ${plainDate(String(p.ends_on))} tarixinədək` : ''}` : undefined };
    case 'campaign': return { title: String(p.title || 'Yeni təklif'), sub: p.body ? String(p.body) : undefined };
    case 'bonus': return {
      title: p.kind === 'referral' ? `Dostunuz gəldi 🎉${p.friend ? ` · ${p.friend}` : ''}` : p.kind === 'birthday' ? 'Ad günü hədiyyəsi' : 'Profil bonusu',
      sub: p.amount ? `+${money(Number(p.amount))} keşbek yazıldı` : undefined,
    };
    default: return { title: 'Yeni bildiriş' };
  }
}

export function Notifications() {
  const { token } = useContext(AuthCtx);
  const q = useApi<Notif[]>('/me/notifications');
  const [seen, setSeen] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!q.data) return;
    // Açılanda oxunmuşlar işarələnir; bu açılışda yeni olanlar vurğulu qalır.
    setSeen(new Set(q.data.filter((n) => !n.read_at).map((n) => n.id)));
    if (q.data.some((n) => !n.read_at)) api('/me/notifications/read', { token, body: {} }).catch(() => {});
  }, [q.data, token]);
  return (
    <Screen tab="home">
      <TopBar title="Bildirişlər" />
      <PushCard />
      {!q.data ? (q.loading ? <Loading /> : <ErrorState q={q} />) : q.data.length === 0 ? (
        <EmptyState icon="calendar" title="Bildiriş yoxdur" text="Çəkiliş, beh və keşbek xəbərləri burada görünəcək." />
      ) : (
        <Card>
          <div>
            {q.data.map((n) => {
              const t = describe(n);
              const sid = n.payload.shoot_id;
              const body = (
                <>
                  <span className={`ndot${seen.has(n.id) ? '' : ' ndot-off'}`} aria-label={seen.has(n.id) ? 'Yeni' : undefined} />
                  <span className="col grow" style={{ gap: 2 }}>
                    <span className="t14 w8">{t.title}</span>
                    {t.sub && <span className="t13 soft">{t.sub}</span>}
                    <span className="t12 muted">{dateShort(n.created_at)} · {timeOf(n.created_at)} · {relDay(n.created_at)}</span>
                  </span>
                </>
              );
              const href = n.type === 'campaign' ? `#/offer/${n.payload.campaign_id}` : n.type === 'bonus' ? '#/cashback' : sid ? `#/shoots/${sid}` : n.type === 'materials_ready' ? '#/materials' : n.type === 'package_ending' ? '#/package' : '';
              return href ? <a key={n.id} className="nrow" href={href}>{body}</a> : <div key={n.id} className="nrow">{body}</div>;
            })}
          </div>
        </Card>
      )}
    </Screen>
  );
}

