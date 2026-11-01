import { useState, type CSSProperties, type ReactNode } from 'react';
import { AdminShell, formatMoney } from '../../shared/ui';
import { AIcon, type AIconName } from '../components/AIcon';
import { Err, serviceName } from '../components/common';
import { DepositSheet } from '../components/DepositSheet';
import { ShootChip, useCountUp, useToast } from '../components/neon';
import { useLoad } from '../ctx';
import { addDays, bakuParts, bakuToday, dateLong, dateShort, endMs, range } from '../format';
import type { Dashboard, Shoot } from '../types';

// Sayğac kartı: ikon çipi + etiket, rəqəm, izah. hot=true: narıncı parıltı (bağlanmamış çəkiliş var).
function StatCard({ i, label, icon, tone, n, unit, note, href, hot }: {
  i: number; label: string; icon: AIconName; tone: 'mat' | 'cal'; n: number | undefined; unit?: string; note?: string; href?: string; hot?: boolean;
}) {
  const v = useCountUp(n);
  const body = (
    <>
      {hot && <span className="a-hot-glow" aria-hidden="true" />}
      <div className="a-stat-h"><span className={`a-ic a-ic-${tone}`}><AIcon name={icon} size={16} /></span><span className="a-stat-l">{label}</span></div>
      <div className={`a-stat-n${unit ? ' in' : ''}`}>{v ?? '–'}{unit && <small>{unit}</small>}</div>
      {note && <div className="a-stat-t">{note}</div>}
    </>
  );
  const cls = `a-g a-stat a-rise${hot ? ' a-g-hot' : ''}`;
  const st = { '--i': i } as CSSProperties;
  return href
    ? <a className={cls} style={st} href={href} aria-label={label}>{body}</a>
    : <section className={cls} style={st} aria-label={label}>{body}</section>;
}

function Card({ i, label, hot, align, children }: { i: number; label: string; hot?: boolean; align?: boolean; children: ReactNode }) {
  return (
    <section className={`a-g a-rise${hot ? ' a-g-hot' : ''}`} style={{ '--i': i, ...(align ? { alignSelf: 'start' } : {}) } as CSSProperties} aria-label={label}>
      {hot && <span className="a-hot-glow" aria-hidden="true" />}
      {children}
    </section>
  );
}

// Yüklənir: Neon skelet (nəbz 1.4s; azaldılmış hərəkətdə sabit)
const Sk = ({ w, h, cls = '' }: { w: number | string; h: number; cls?: string }) => <span className={`a-sk ${cls}`} style={{ width: w, height: h }} />;
const SkRow = ({ btn }: { btn: number }) => (
  <div className="a-skr"><Sk w={36} h={12} /><div><Sk w="60%" h={12} /><Sk w="82%" h={10} /></div><Sk w={btn} h={36} cls="a-sk-pill" /></div>
);
function Skeleton() {
  return (
    <div role="status" aria-label="Yüklənir" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="a-head">
        <div className="a-head-t"><Sk w={240} h={24} /><Sk w={60} h={12} /></div>
        <Sk w={100} h={44} cls="a-sk-pill" />
      </div>
      <div className="a-stats">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="a-skc a-stat"><Sk w={28} h={28} cls="a-sk-dot" /><Sk w={36} h={24} /><Sk w="70%" h={10} /></div>
        ))}
      </div>
      <div className="a-two">
        <div className="a-skc"><Sk w={140} h={14} /><SkRow btn={84} /><SkRow btn={84} /><span className="a-hide-ph"><SkRow btn={84} /></span></div>
        <div className="a-skc a-hide-ph"><Sk w={70} h={14} /><SkRow btn={88} /><SkRow btn={88} /></div>
        <div className="a-skc"><Sk w={150} h={14} /><SkRow btn={64} /><span className="a-hide-ph"><SkRow btn={64} /></span></div>
        <div className="a-skc a-hide-ph"><Sk w={110} h={14} /><div className="a-uses" style={{ marginTop: 10 }}>{[0, 1, 2, 3].map((k) => <Sk key={k} w="100%" h={56} cls="a-sk-blk" />)}</div></div>
      </div>
    </div>
  );
}

export function Panel() {
  const dash = useLoad<Dashboard>('/dashboard');
  const today = bakuToday();
  // Bağlanmamış siyahısı üçün son 30 gün (dashboard yalnız sayı qaytarır).
  const past = useLoad<Shoot[]>(`/shoots?${range(addDays(today, -30), addDays(today, 1))}`);
  const [dep, setDep] = useState<Shoot | null>(null);
  const toast = useToast();
  const d = dash.data;
  const unclosed = (past.data ?? []).filter((s) => s.status === 'confirmed' && endMs(s.starts_at, s.duration_min) < Date.now());
  const reload = () => { dash.reload(); past.reload(); };
  const todays = d?.today.filter((s) => s.status !== 'cancelled') ?? [];
  const loading = !d && !dash.err;

  return (
    <AdminShell
      active="panel"
      title={dateLong(today)}
      sub="Panel"
      bare={loading}
      hrefFor={(t) => `#/${t}`}
      actions={<a className="a-bp" href="#/shoots/new"><AIcon name="plus" size={18} /> Çəkiliş</a>}
    >
      {loading ? <Skeleton /> : (
        <>
          <Err msg={dash.err} />
          <div className="a-stats">
            <StatCard i={1} label="Beh gözlənilənlər" icon="coins" tone="mat" n={d?.deposit_pending.length} note="Alınanda təsdiqləyin." />
            <StatCard i={2} label="Bu gün" icon="cal" tone="cal" n={d?.today.length} unit="çəkiliş" href="#/calendar" />
            <StatCard i={3} label="Bağlanmamış" icon="alert" tone="mat" n={d?.unclosed_count} note="Ödəniş və saat daxil edilməyib." hot={!!d?.unclosed_count} />
            <StatCard i={4} label="Materialı gözləyən" icon="folder" tone="mat" n={d?.awaiting_material_count} note="Drive linki yoxdur." href="#/materials" />
          </div>
          <div className="a-two">
            <Card i={5} label="Beh gözlənilənlər siyahısı">
              <h2 className="a-cardh">Beh gözlənilənlər</h2>
              {d?.deposit_pending.map((s) => {
                const p = bakuParts(s.starts_at);
                return (
                  <div key={s.id} className="a-lr">
                    <span className="a-lr-d">{dateShort(p.date)}</span>
                    <a className="a-lr-m" href={`#/shoots/${s.id}`}><b>{s.client_name}</b><span>{p.time} · {serviceName(s)}</span><ShootChip s={s} withAmount /></a>
                    <button type="button" className="a-bt" onClick={() => setDep(s)}>Beh alındı</button>
                  </div>
                );
              })}
              {d && !d.deposit_pending.length && <p className="a-empty">Gözləyən beh yoxdur.</p>}
            </Card>
            <Card i={6} label="Bu gün siyahısı" align>
              <h2 className="a-cardh">Bu gün</h2>
              {todays.map((s) => (
                <div key={s.id} className="a-lr">
                  <span className="a-lr-t">{bakuParts(s.starts_at).time}</span>
                  <a className="a-lr-m" href={`#/shoots/${s.id}`}><b>{s.client_name}</b><span>{serviceName(s)}</span></a>
                  <ShootChip s={s} />
                </div>
              ))}
              {d && !todays.length && <p className="a-empty">Bu gün çəkiliş yoxdur.</p>}
            </Card>
            {unclosed.length > 0 && (
              <Card i={7} label="Bağlanmamış çəkilişlər" hot align>
                <h2 className="a-cardh">Bağlanmamış çəkilişlər</h2>
                {unclosed.map((s) => (
                  <div key={s.id} className="a-lr">
                    <div className="a-lr-m"><b>{s.client_name}</b><span>{dateShort(bakuParts(s.starts_at).date)}, {bakuParts(s.starts_at).time}</span></div>
                    <a className="a-bt" href={`#/shoots/${s.id}/close`}>Bağla</a>
                  </div>
                ))}
              </Card>
            )}
            {d && (
              <Card i={8} label="App istifadəsi" align>
                <h2 className="a-cardh" style={{ marginBottom: 10 }}>App istifadəsi</h2>
                <div className="a-uses" data-testid="app-usage">
                  <div className="a-use"><b>{d.app_usage.joined}<small> / {d.app_usage.clients}</small></b><span>Qoşulub</span></div>
                  <div className="a-use"><b>{d.app_usage.home_screen}</b><span>Ana ekranda</span></div>
                  <div className="a-use"><b>{d.app_usage.push_on}</b><span>Bildiriş açıq</span></div>
                  <div className="a-use"><b>{d.app_usage.active_7d}</b><span>Son 7 gündə açıb</span></div>
                </div>
                <p className="a-note">Ana ekran və 7 gün yeni versiyadan sonra yığılır.</p>
              </Card>
            )}
          </div>
          <a className="a-g a-link a-only-ph a-rise" style={{ '--i': 9 } as CSSProperties} href="#/campaigns">
            <span className="a-ic"><AIcon name="mega" size={16} /></span>
            <span className="a-lr-m"><b>Kampaniyalar</b><span>Təklif göndər, avtomatik bildirişlər</span></span>
            <AIcon name="chev" size={20} />
          </a>
          <a className="a-g a-link a-only-ph a-rise" style={{ '--i': 10 } as CSSProperties} href="#/materials">
            <span className="a-ic"><AIcon name="folder" size={16} /></span>
            <span className="a-lr-m"><b>Materiallar</b><span>Drive linkləri, montaj statusu</span></span>
            <AIcon name="chev" size={20} />
          </a>
        </>
      )}
      <DepositSheet shoot={dep} onClose={() => setDep(null)} onDone={(amount) => { reload(); toast.show(`Beh qəbul edildi · ${formatMoney(amount)}`); }} />
      {toast.node}
    </AdminShell>
  );
}
