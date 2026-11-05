import { useContext, useEffect, useState, type CSSProperties } from 'react';
import { api, ApiError } from '../shared/api';
import { NIcon } from '../shared/ui';
import { AuthCtx, ErrorState, InnerHeader, Loading, NEmpty, OfflineBadge, Screen, useApi } from './core';
import { amount2 } from './home';
import { dayMon, waLink } from './util';

type Profile = {
  profession: string | null; workplace: string | null; instagram: string | null; niche: string | null; birthday: string | null;
  source: string | null; marketing_opt_in: boolean; complete: boolean; bonus: number; bonus_received: boolean;
};
type Referral = { code: string; bonus: number; invited: { name: string; rewarded: boolean }[] };
type Offer = { id: number; kind: string; title: string; body: string; url: string | null; created_at: string };

const SOURCES: [string, string][] = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['google', 'Google'], ['youtube', 'YouTube'], ['referral', 'Dost tövsiyəsi'], ['other', 'Digər']];

// ---------- Dostunu gətir ----------
export async function shareReferral(code: string) {
  const text = `Y Pod studiyasında podcast/Reels çəkdirirəm. Mənim kodumla yazılsan, ilk çəkilişindən sonra hər ikimizə 20 AZN keşbek yazılır. Kod: ${code}. Yazmaq üçün: ${waLink(`Salam, dostumun kodu ${code}. Çəkilişə yazılmaq istəyirəm.`)}`;
  if (navigator.share) { try { await navigator.share({ text }); } catch { /* ləğv edildi */ } return; }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

const rise = (i: number) => ({ '--i': i }) as CSSProperties;
const azn = (q: number) => `${amount2(q)} AZN`;
const aznShort = (q: number) => `${q / 100} AZN`;

export function ReferralCard() {
  const q = useApi<Referral>('/me/referral');
  const [copied, setCopied] = useState(false);
  const r = q.data;
  if (!r) return q.loading ? <Loading /> : <ErrorState q={q} title="Dəvət kodu yüklənmədi" />;

  const share = () => shareReferral(r.code);
  const copy = () => navigator.clipboard.writeText(r.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});

  return (
    <section aria-label="Dostunu gətir" className="g rise" style={rise(4)}>
      <div className="npf-bonus-h">
        <span className="nchip"><NIcon name="gift" size={16} /></span>
        <span className="n-col"><span className="n-lbl">Dostunu gətir</span><span className="n-body">Dostunuz ilk çəkilişini edəndə hər ikinizə {aznShort(r.bonus)} keşbek</span></span>
      </div>
      <div className="nref-code">
        <div><span aria-label={`Dəvət kodu ${r.code}`} data-testid="ref-code">{r.code}</span></div>
        <button type="button" className="nb nb-s" onClick={copy}>
          {copied
            ? <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#5BE3A6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" strokeDasharray="24" /></svg>
            : <NIcon name="copy" size={16} />}
          <span aria-live="polite">{copied ? 'Kopyalandı' : 'Kopyala'}</span>
        </button>
      </div>
      <button type="button" className="nb nb-p nref-share" onClick={share}><NIcon name="share" size={18} />Paylaş</button>
      {r.invited.length > 0 && (
        <>
          <h2 className="n-h2 nref-h">Dəvət etdikləriniz</h2>
          <ul className="nrows">
            {r.invited.map((p, i) => (
              <li key={i} className="nref-li">
                <span className="n-body">{p.name}</span>
                <span className={`nstat nstat-${p.rewarded ? 'cb' : 'off'}`}><i aria-hidden="true" />{p.rewarded ? 'Bonus yazıldı' : 'Gözləyir'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------- Çıxış təsdiqi ----------
function ConfirmLogout({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onNo(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  return (
    <div className="nconf" onClick={onNo}>
      <div className="g nconf-b" role="alertdialog" aria-modal="true" aria-labelledby="lo-t" onClick={(e) => e.stopPropagation()}>
        <h2 id="lo-t" className="n-h2">Çıxmaq istəyirsiniz?</h2>
        <p className="n-body c2">Yenidən girmək üçün studiyadan yeni link lazım olacaq.</p>
        <div className="nconf-btns">
          <button type="button" className="nb nb-s" autoFocus onClick={onNo}>Ləğv et</button>
          <button type="button" className="nb nb-p" onClick={onYes}>Çıx</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Profilim ----------
const SPARKS: [number, number, boolean, number][] = [[20, 0, false, 300], [15, 15, true, 330], [0, 21, false, 300], [-15, 15, true, 340], [-20, 0, false, 300], [-15, -15, true, 330], [0, -21, false, 310], [15, -15, true, 340]];
const isoToText = (iso: string) => (iso ? iso.split('-').reverse().join('.') : '');

export function ProfilePage({ onLogout }: { onLogout: () => void }) {
  const { token, signOut } = useContext(AuthCtx);
  const q = useApi<Profile>('/me/profile');
  const [f, setF] = useState({ profession: '', workplace: '', instagram: '', niche: '', birthday: '', source: '' });
  const [opt, setOpt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [granted, setGranted] = useState(0);
  const [saved, setSaved] = useState(false);
  const [askOut, setAskOut] = useState(false);
  const p = q.data;
  const fill = (d: Profile) => { setF({ profession: d.profession ?? '', workplace: d.workplace ?? '', instagram: d.instagram ?? '', niche: d.niche ?? '', birthday: d.birthday ?? '', source: d.source ?? '' }); setOpt(d.marketing_opt_in); };
  useEffect(() => { if (p) fill(p); }, [p]);
  const set = (x: Partial<typeof f>) => { setF({ ...f, ...x }); setSaved(false); setErr(''); };

  async function save() {
    setBusy(true); setErr(''); setGranted(0);
    try {
      const body = { profession: f.profession.trim(), workplace: f.workplace.trim(), instagram: f.instagram.trim().replace(/^@/, ''), niche: f.niche.trim(), birthday: f.birthday || null, source: f.source, marketing_opt_in: opt };
      const r = await api<Profile & { granted: number }>('/me/profile', { method: 'PATCH', token, body });
      fill(r); setGranted(r.granted); setSaved(true);
      q.reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return signOut();
      setErr(e instanceof ApiError ? e.message : 'Xəta baş verdi.');
    }
    setBusy(false);
  }

  const head = <InnerHeader title="Profilim" back="#/" />;
  if (!p) return <Screen tab="home">{head}{q.loading ? <Loading /> : <ErrorState q={q} />}</Screen>;

  const count = [f.profession, f.workplace, f.instagram, f.birthday].filter((x) => x.trim()).length;
  const done = count === 4;
  const bdBad = !!err && /doğum/i.test(err);
  const bonus = aznShort(p.bonus);
  return (
    <Screen tab="home">
      {head}
      {q.offline && <OfflineBadge />}
      <div className="npush">
        {granted > 0 && (
          <div role="status" className="g nok">
            <span className="nchip nchip-cb"><NIcon name="check" size={16} /></span>
            <span className="n-body6" style={{ flex: 1, minWidth: 0 }}>Təbrik edirik! Profiliniz tamamlandı, {azn(granted)} keşbek hesabınıza yazıldı</span>
          </div>
        )}
        {!(p.bonus_received && !done) && (
          <section aria-label="Profil bonusu" className="g glow-cb2 rise" style={rise(0)}>
            <div className="npf-bonus-h">
              <span className="nchip nchip-cb npf-chip"><NIcon name="coins" size={16} />{granted > 0 && SPARKS.map(([dx, dy, s, d], i) => <i key={i} aria-hidden="true" className={s ? 's' : undefined} style={{ '--dx': `${dx}px`, '--dy': `${dy}px`, '--d': `${d}ms` } as CSSProperties} />)}</span>
              <span className="n-col">
                <span className="n-body6">{done ? `Profil tam doldurulub — ${bonus} keşbek yazıldı` : `Profili tam doldurun — ${bonus} keşbek hədiyyə`}</span>
                <span className="n-lbl" style={{ fontWeight: 500 }}>{done ? 'İxtisas, iş yeri, Instagram və doğum günü əlavə olundu.' : 'İxtisas, iş yeri, Instagram və doğum günü lazımdır.'}</span>
              </span>
            </div>
            <div className="npf-prog">
              <div className="nbar" role="progressbar" aria-label="Profil doldurulması" aria-valuemin={0} aria-valuemax={4} aria-valuenow={count}><span className={done ? 'done' : undefined} style={{ transform: `scaleX(${count / 4})` }} /></div>
              <span className="n-meta" style={{ fontWeight: 600 }}>{count}/4</span>
            </div>
          </section>
        )}

        <section aria-label="Profil məlumatları" className="g nf rise" style={rise(1)}>
          <div><label className="n-lbl nf-l" htmlFor="pf-p">İxtisas</label><input id="pf-p" className="nin" value={f.profession} maxLength={80} autoComplete="off" onChange={(e) => set({ profession: e.target.value })} placeholder="məs. Psixoloq" /></div>
          <div><label className="n-lbl nf-l" htmlFor="pf-w">İş yeri</label><input id="pf-w" className="nin" value={f.workplace} maxLength={80} autoComplete="off" onChange={(e) => set({ workplace: e.target.value })} placeholder="məs. klinika və ya özəl praktika" /></div>
          <div>
            <label className="n-lbl nf-l" htmlFor="pf-i">Instagram</label>
            <div className="nin nin-w"><span aria-hidden="true">@</span><input id="pf-i" autoCapitalize="none" autoComplete="off" value={f.instagram} maxLength={60} onChange={(e) => set({ instagram: e.target.value })} placeholder="istifadəçi adı" /></div>
          </div>
          <div><label className="n-lbl nf-l" htmlFor="pf-n">Kontent mövzusu</label><input id="pf-n" className="nin" value={f.niche} maxLength={80} autoComplete="off" onChange={(e) => set({ niche: e.target.value })} placeholder="məs. Psixologiya, münasibətlər" /></div>
          <div>
            <label className="n-lbl nf-l" htmlFor="pf-b">Doğum günü</label>
            <div className={`nin nin-d${bdBad ? ' nin-bad' : ''}`}>
              <span style={{ color: f.birthday ? 'var(--yp-text)' : 'var(--yp-text-3)' }}>{isoToText(f.birthday) || 'gg.aa.iiii'}</span>
              <NIcon name="cal" size={20} />
              <input id="pf-b" type="date" value={f.birthday} aria-invalid={bdBad} aria-label="Doğum günü seçin" onChange={(e) => set({ birthday: e.target.value })} onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* dəstəklənmir */ } }} />
            </div>
          </div>
          <div role="group" aria-labelledby="pf-s">
            <div id="pf-s" className="n-lbl" style={{ marginBottom: 2 }}>Haradan tapdınız?</div>
            <div className="nsrc-w">
              {SOURCES.map(([k, v]) => <button key={k} type="button" className="nsrc" aria-pressed={f.source === k} onClick={() => set({ source: f.source === k ? '' : k })}><span>{v}</span></button>)}
            </div>
          </div>
        </section>

        <section aria-label="Bildiriş seçimi" className="g ntg-c rise" style={rise(2)}>
          <span className="n-col"><span id="pf-nl" className="n-body6">Təkliflər və yeniliklər</span><span id="pf-nd" className="n-lbl" style={{ fontWeight: 500 }}>Bağlı olsa da çəkiliş, beh, keşbek bildirişləri gəlməyə davam edir</span></span>
          <button type="button" className="ntg" role="switch" aria-checked={opt} aria-labelledby="pf-nl" aria-describedby="pf-nd" onClick={() => { setOpt(!opt); setSaved(false); }}><span className="ntg-t"><span className="ntg-k" /></span></button>
        </section>

        <div className="npf-save rise" style={rise(3)}>
          {err && <div className="npf-err" role="alert"><NIcon name="alert" size={16} style={{ flex: 'none' }} /><span>{err}</span></div>}
          <button type="button" className="nb nb-p" disabled={busy} onClick={save}>Yadda saxla</button>
          <div className="npf-ok" aria-live="polite">{saved && !err ? 'Yadda saxlanıldı.' : ''}</div>
        </div>

        <ReferralCard />
        <div className="nlogout rise" style={rise(5)}><button type="button" onClick={() => setAskOut(true)}>Çıxış</button></div>
        {askOut && <ConfirmLogout onYes={onLogout} onNo={() => setAskOut(false)} />}
      </div>
    </Screen>
  );
}

// ---------- Təklif ----------
export function OfferPage({ id }: { id: string }) {
  const { token, signOut } = useContext(AuthCtx);
  const [o, setO] = useState<Offer | null>(null);
  const [state, setState] = useState<'load' | 'none' | 'err'>('load');
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setState('load'); setO(null);
    api<Offer>(`/me/campaigns/${encodeURIComponent(id)}`, { token })
      .then((d) => live && setO(d))
      .catch((e: ApiError) => { if (!live) return; if (e.status === 401) return signOut(); setState(e.status === 404 ? 'none' : 'err'); });
    return () => { live = false; };
  }, [id, token, n]);
  const paras = o ? o.body.split(/\n\s*\n/).filter((x) => x.trim()) : [];
  return (
    <Screen tab="home">
      <InnerHeader title="Təklif" back="#/notifications" />
      <div className="npush npush-f">
        {o ? (
          <article className="g glow-offer2 noffer rise">
            <div className="n-hd"><span className="nchip nchip-offer"><NIcon name="tag" size={16} /></span><span className="ntag">{dayMon(o.created_at)}</span></div>
            <h2 className="n-h1 noffer-h">{o.title}</h2>
            {paras.map((t, i) => <p key={i} className={`noffer-p${paras.length > 1 && i === paras.length - 1 ? ' hi' : ''}`}>{t}</p>)}
            <div className="noffer-b">
              {o.url && <a className="nb nb-s nb-full" href={o.url} target="_blank" rel="noopener noreferrer">Ətraflı<NIcon name="ext" size={16} /></a>}
              <a className="nb nb-p nb-full" href={waLink(`Salam, "${o.title}" təklifi ilə bağlı yazıram.`)} target="_blank" rel="noopener"><NIcon name="msg" size={18} />WhatsApp-da yaz</a>
            </div>
          </article>
        ) : state === 'none' ? (
          <NEmpty fill icon="tag" tone="" title="Təklif tapılmadı" text="Bu təklif artıq mövcud deyil.">
            <a className="nb nb-p nb-auto" href="#/">Ana səhifəyə qayıt</a>
          </NEmpty>
        ) : state === 'err' ? (
          <ErrorState q={{ data: null, err: '', offline: false, loading: false, reload: () => setN(n + 1) }} />
        ) : <Loading />}
      </div>
    </Screen>
  );
}
