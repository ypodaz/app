import { useContext, useEffect, useState } from 'react';
import { api, ApiError } from '../shared/api';
import { Button, Card, EmptyState, Icon } from '../shared/ui';
import { AuthCtx, ErrorState, Loading, OfflineBadge, Screen, TopBar, useApi, XIcon } from './core';
import { dateShort, money, waLink } from './util';

type Profile = {
  profession: string | null; workplace: string | null; instagram: string | null; niche: string | null; birthday: string | null;
  source: string | null; marketing_opt_in: boolean; complete: boolean; bonus: number; bonus_received: boolean;
};
type Referral = { code: string; bonus: number; invited: { name: string; rewarded: boolean }[] };
type Offer = { id: number; kind: string; title: string; body: string; url: string | null; created_at: string };

const SOURCES: [string, string][] = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['google', 'Google'], ['youtube', 'YouTube'], ['referral', 'Dost tövsiyəsi'], ['other', 'Digər']];

// ---------- Dostunu gətir ----------
export function ReferralCard() {
  const q = useApi<Referral>('/me/referral');
  const [copied, setCopied] = useState(false);
  const r = q.data;
  if (!r) return q.loading ? <Loading /> : <ErrorState q={q} title="Dəvət kodu yüklənmədi" />;

  const text = `Y Pod studiyasında podcast/Reels çəkdirirəm. Mənim kodumla yazılsan, ilk çəkilişindən sonra hər ikimizə 20 AZN keşbek yazılır. Kod: ${r.code}. Yazmaq üçün: ${waLink(`Salam, dostumun kodu ${r.code}. Çəkilişə yazılmaq istəyirəm.`)}`;
  async function share() {
    if (navigator.share) { try { await navigator.share({ text }); } catch { /* ləğv edildi */ } return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }
  const copy = () => navigator.clipboard.writeText(r.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});

  return (
    <Card tone="violet">
      <span className="h3">Dostunu gətir</span>
      <p className="t13 lh" style={{ color: '#e9d5ff' }}>Dostunuz ilk çəkilişini edəndə hər ikinizə {money(r.bonus).replace(' AZN', '')} AZN keşbek</p>
      <div className="row sb" style={{ gap: 10 }}>
        <span className="num-s" style={{ letterSpacing: 2 }} data-testid="ref-code">{r.code}</span>
        <Button variant="cream" small auto onClick={copy}>{copied ? 'Kopyalandı' : 'Kodu kopyala'}</Button>
      </div>
      <Button variant="cream" onClick={share}><XIcon name="send" size={18} />Paylaş</Button>
      {r.invited.length > 0 && (
        <>
          <span className="lbl" style={{ color: '#e9d5ff' }}>Dəvət etdikləriniz</span>
          <div className="list">
            {r.invited.map((p, i) => (
              <div key={i} className="li">
                <span className="t14 w7 grow">{p.name}</span>
                <span className={`t12 ${p.rewarded ? 'pink' : ''}`}>{p.rewarded ? 'Bonus yazıldı' : 'Gözləyir'}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------- Profilim ----------
export function ProfilePage() {
  const { token } = useContext(AuthCtx);
  const q = useApi<Profile>('/me/profile');
  const [f, setF] = useState({ profession: '', workplace: '', instagram: '', niche: '', birthday: '', source: '' });
  const [opt, setOpt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [granted, setGranted] = useState(0);
  const [saved, setSaved] = useState(false);
  const p = q.data;
  const fill = (d: Profile) => { setF({ profession: d.profession ?? '', workplace: d.workplace ?? '', instagram: d.instagram ?? '', niche: d.niche ?? '', birthday: d.birthday ?? '', source: d.source ?? '' }); setOpt(d.marketing_opt_in); };
  useEffect(() => { if (p) fill(p); }, [p]);
  const set = (x: Partial<typeof f>) => { setF({ ...f, ...x }); setSaved(false); };

  async function save() {
    setBusy(true); setErr(''); setGranted(0);
    try {
      const body = { profession: f.profession.trim(), workplace: f.workplace.trim(), instagram: f.instagram.trim().replace(/^@/, ''), niche: f.niche.trim(), birthday: f.birthday, source: f.source, marketing_opt_in: opt };
      const r = await api<Profile & { granted: number }>('/me/profile', { method: 'PATCH', token, body });
      fill(r); setGranted(r.granted); setSaved(true);
      q.reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Xəta baş verdi.'); }
    setBusy(false);
  }

  return (
    <Screen tab="home">
      <TopBar title="Profilim" />
      {q.offline && p && <OfflineBadge />}
      {!p ? (q.loading ? <Loading /> : <ErrorState q={q} />) : (
        <>
          {granted > 0 && <div className="banner" role="status"><Icon name="sparkle" size={18} /><span><b>Təbrik edirik!</b> Profiliniz tamamlandı, {money(granted)} keşbek hesabınıza yazıldı 🎉</span></div>}
          {!p.bonus_received && granted === 0 && <div className="banner"><Icon name="wallet" size={18} /><span><b>Profili tam doldurun — {money(p.bonus).replace(' AZN', '')} AZN keşbek hədiyyə</b><br />İxtisas, iş yeri, Instagram və doğum günü lazımdır.</span></div>}
          <Card>
            <div className="field"><label htmlFor="pf-p">İxtisas</label><input id="pf-p" className="inp" value={f.profession} maxLength={80} onChange={(e) => set({ profession: e.target.value })} placeholder="məs. Psixoloq" /></div>
            <div className="field"><label htmlFor="pf-w">İş yeri</label><input id="pf-w" className="inp" value={f.workplace} maxLength={80} onChange={(e) => set({ workplace: e.target.value })} /></div>
            <div className="field"><label htmlFor="pf-i">Instagram</label><input id="pf-i" className="inp" autoCapitalize="none" value={f.instagram} maxLength={60} onChange={(e) => set({ instagram: e.target.value })} placeholder="istifadəçi adı" /></div>
            <div className="field"><label htmlFor="pf-n">Nişa (nə haqqında danışırsınız)</label><input id="pf-n" className="inp" value={f.niche} maxLength={80} onChange={(e) => set({ niche: e.target.value })} /></div>
            <div className="field"><label htmlFor="pf-b">Doğum günü</label><input id="pf-b" type="date" className="inp" style={{ colorScheme: 'dark' }} value={f.birthday} onChange={(e) => set({ birthday: e.target.value })} /></div>
            <div className="field">
              <label htmlFor="pf-s">Haradan tapdınız?</label>
              <select id="pf-s" className="inp" value={f.source} onChange={(e) => set({ source: e.target.value })}>
                <option value="">Seçin</option>
                {SOURCES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </Card>
          <Card>
            <div className="row sb" style={{ gap: 12 }}>
              <span className="col" style={{ gap: 2, minWidth: 0 }}><span className="t14 w8">Təkliflər və yeniliklər</span><span className="t12 muted lh">Bağlı olsa da çəkiliş, beh, keşbek bildirişləri gəlməyə davam edir</span></span>
              <button type="button" className={`tgl${opt ? ' tgl-on' : ''}`} role="switch" aria-checked={opt} aria-label="Təkliflər və yeniliklər" onClick={() => { setOpt(!opt); setSaved(false); }} />
            </div>
          </Card>
          {err && <p className="err" role="alert">{err}</p>}
          {saved && granted === 0 && <p className="t13 neon" role="status">Yadda saxlanıldı.</p>}
          <Button disabled={busy} onClick={save}>Yadda saxla</Button>
          <ReferralCard />
        </>
      )}
    </Screen>
  );
}

// ---------- Təklif ----------
export function OfferPage({ id }: { id: string }) {
  const { token } = useContext(AuthCtx);
  const [o, setO] = useState<Offer | null>(null);
  const [state, setState] = useState<'load' | 'none' | 'err'>('load');
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setState('load'); setO(null);
    api<Offer>(`/me/campaigns/${encodeURIComponent(id)}`, { token })
      .then((d) => live && setO(d))
      .catch((e: ApiError) => live && setState(e.status === 404 ? 'none' : 'err'));
    return () => { live = false; };
  }, [id, token, n]);
  return (
    <Screen tab="home">
      <TopBar title="Təklif" back="#/notifications" />
      {o ? (
        <Card>
          <span className="lbl">{dateShort(o.created_at)}</span>
          <h1 className="h2" style={{ overflowWrap: 'anywhere' }}>{o.title}</h1>
          <p className="t14 soft lh" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{o.body}</p>
          {o.url && <a className="btn btn-out" href={o.url} target="_blank" rel="noopener noreferrer">Ətraflı<XIcon name="ext" size={16} /></a>}
          <a className="btn btn-primary" href={waLink(`Salam, "${o.title}" təklifi ilə bağlı yazıram.`)} target="_blank" rel="noopener"><XIcon name="wa" size={18} />WhatsApp-da yaz</a>
        </Card>
      ) : state === 'none' ? (
        <EmptyState icon="alert" title="Təklif tapılmadı" text="Bu təklif artıq mövcud deyil." />
      ) : state === 'err' ? (
        <div className="card card-dash ctr" style={{ padding: 28 }}>
          <p className="t13 muted lh">Məlumat yüklənmədi. İnternet bağlantısını yoxlayın.</p>
          <Button variant="out" small auto onClick={() => setN(n + 1)}>Yenidən cəhd et</Button>
        </div>
      ) : <Loading />}
    </Screen>
  );
}
