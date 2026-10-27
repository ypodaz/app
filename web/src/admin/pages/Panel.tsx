import { useState } from 'react';
import { AdminShell, Button, Card, Icon, Stat } from '../../shared/ui';
import { Err, ShootRow } from '../components/common';
import { DepositSheet } from '../components/DepositSheet';
import { useAuth, useLoad } from '../ctx';
import { addDays, bakuParts, bakuToday, dateLong, dateShort, endMs, range } from '../format';
import type { Dashboard, Shoot } from '../types';

export function Panel() {
  const { signOut } = useAuth();
  const dash = useLoad<Dashboard>('/dashboard');
  const today = bakuToday();
  // Bağlanmamış siyahısı üçün son 30 gün (dashboard yalnız sayı qaytarır).
  const past = useLoad<Shoot[]>(`/shoots?${range(addDays(today, -30), addDays(today, 1))}`);
  const [dep, setDep] = useState<Shoot | null>(null);
  const d = dash.data;
  const unclosed = (past.data ?? []).filter((s) => s.status === 'confirmed' && endMs(s.starts_at, s.duration_min) < Date.now());
  const reload = () => { dash.reload(); past.reload(); };

  return (
    <AdminShell
      active="panel"
      title={dateLong(today)}
      hrefFor={(t) => `#/${t}`}
      qrHref="#/qr"
      actions={<><Button variant="ghost" small auto onClick={signOut}>Çıxış</Button><a className="btn btn-primary btn-sm btn-auto" href="#/shoots/new"><Icon name="plus" size={18} strokeWidth={2.4} /> Çəkiliş</a></>}
    >
      <Err msg={dash.err} />
      <div className="rs-stats">
        <Stat label="Beh gözlənilənlər" value={d?.deposit_pending.length ?? '–'} icon="wallet" note="Alınanda təsdiqləyin." />
        <Stat label="Bu gün" value={d?.today.length ?? '–'} icon="camera" note="çəkiliş." href="#/calendar" />
        <Stat label="Bağlanmamış" value={d?.unclosed_count ?? '–'} icon="alert" accent={!!d?.unclosed_count} note="Ödəniş və saat daxil edilməyib." />
        <Stat label="Materialı gözləyən" value={d?.awaiting_material_count ?? '–'} icon="media" note="Drive linki yoxdur." href="#/materials" />
      </div>
      <div className="rs-cols">
        <Card>
          <span className="h3">Beh gözlənilənlər</span>
          <div className="list">
            {d?.deposit_pending.map((s) => (
              <div key={s.id} className="li">
                <div className="grow"><ShootRow s={s} withDate /></div>
                <Button variant="cream" small auto onClick={() => setDep(s)}>Beh alındı</Button>
              </div>
            ))}
          </div>
          {d && !d.deposit_pending.length && <p className="t13 muted">Gözləyən beh yoxdur.</p>}
        </Card>
        <Card>
          <span className="h3">Bu gün</span>
          <div className="list">{d?.today.filter((s) => s.status !== 'cancelled').map((s) => <ShootRow key={s.id} s={s} />)}</div>
          {d && !d.today.length && <p className="t13 muted">Bu gün çəkiliş yoxdur.</p>}
        </Card>
        {unclosed.length > 0 && (
          <Card tone="accent">
            <span className="h3">Bağlanmamış çəkilişlər</span>
            {unclosed.map((s) => (
              <div key={s.id} className="row">
                <span className="col grow" style={{ gap: 2 }}>
                  <span className="t14 w8">{s.client_name}</span>
                  <span className="t12 soft">{dateShort(bakuParts(s.starts_at).date)}, {bakuParts(s.starts_at).time}</span>
                </span>
                <a className="btn btn-cream btn-sm btn-auto" href={`#/shoots/${s.id}/close`}>Bağla</a>
              </div>
            ))}
          </Card>
        )}
      </div>
      <DepositSheet shoot={dep} onClose={() => setDep(null)} onDone={reload} />
    </AdminShell>
  );
}

