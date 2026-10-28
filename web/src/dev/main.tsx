// Yalnız dev önbaxış: bütün ortaq komponentlər və hər iki shell. Prod build-ə düşmür.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/ypod.css';
import '../shared/responsive.css';
import { AdminShell, Button, Card, ClientShell, EmptyState, Icon, Money, Pill, Segmented, Sheet, Stat, Stepper, type AdminTab, type ClientTab, type IconName } from '../shared/ui';

const ICONS: IconName[] = ['grid', 'calendar', 'users', 'building', 'media', 'plus', 'minus', 'chevron', 'close', 'check', 'clock', 'home', 'sparkle', 'wallet', 'camera', 'alert', 'pin', 'link', 'scissors'];

function Components() {
  const [place, setPlace] = useState<'studio' | 'site'>('studio');
  const [cam, setCam] = useState(1);
  const [min, setMin] = useState(60);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="rs-stats">
        <Stat label="Beh gözlənilənlər" value={1} icon="wallet" note="Beh mütləqdir. Alınanda təsdiqlə." />
        <Stat label="Bu gün" value={2} icon="camera" note="çəkiliş." href="#today" />
        <Stat label="Bağlanmamış" value={2} icon="alert" accent note="Ödəniş və saat daxil edilməyib." />
        <Stat label="Materialı gözləyən" value={1} icon="media" note="Drive linki yoxdur." />
      </div>
      <div className="rs-cols">
        <Card>
          <span className="lbl">Pill-lər</span>
          <div className="btns">
            <Pill status="confirmed" /><Pill status="deposit" /><Pill status="done" /><Pill status="cancelled" /><Pill status="noshow" />
          </div>
          <span className="lbl">Money</span>
          <div className="col">
            <Money qepik={7550} className="num-s" />
            <Money qepik={7000} />
            <Money qepik={-3500} />
            <Money qepik={123456700} />
          </div>
        </Card>
        <Card>
          <span className="lbl">Düymələr</span>
          <div className="btns">
            <Button>Davam et</Button>
            <Button variant="cream">Krem</Button>
            <Button variant="dark">Tünd</Button>
            <Button variant="out">İkinci</Button>
            <Button variant="danger">Ləğv et</Button>
            <Button variant="ghost">Ghost</Button>
            <Button small disabled>Kiçik</Button>
          </div>
        </Card>
        <Card>
          <span className="lbl">Segmented</span>
          <Segmented label="Məkan" value={place} onChange={setPlace} options={[{ value: 'studio', label: 'Studiyada' }, { value: 'site', label: 'Sizin məkanda' }]} />
          <Segmented label="Kamera" value={cam} onChange={setCam} options={[1, 2, 3].map((n) => ({ value: n, label: `${n} kamera` }))} />
          <span className="lbl">Stepper</span>
          <Stepper minutes={min} onChange={setMin} />
        </Card>
        <Card>
          <span className="lbl">İkonlar</span>
          <div className="btns">{ICONS.map((n) => <span key={n} className="ic ic-sq" title={n}><Icon name={n} /></span>)}</div>
          <Button variant="cream" onClick={() => setOpen(true)}>Sheet aç</Button>
        </Card>
      </div>
      <EmptyState icon="calendar" title="Çəkiliş yoxdur" text="Yaxın günlərdə planlaşdırılmış çəkiliş görünmür." action={<Button variant="out" small auto>Çəkiliş əlavə et</Button>} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Beh alındı">
        <p className="t14 soft lh">Alınan məbləği təsdiqləyin: <Money qepik={3500} className="w8" /></p>
        <Button onClick={() => setOpen(false)}>Təsdiqlə</Button>
      </Sheet>
    </>
  );
}

function Detail() {
  return (
    <div className="col" style={{ gap: 12 }}>
      <h2 className="h3">Detal paneli</h2>
      <Card><span className="t14 w8">Elvin Məmmədov</span><span className="t12 soft">Çəkiliş · 1 kamera · <Money qepik={7000} /></span><Pill status="deposit" /></Card>
    </div>
  );
}

const mode = new URLSearchParams(location.search).get('v') ?? 'admin';

function App() {
  if (mode === 'client') {
    return (
      <ClientShell active={'home' as ClientTab}>
        <h1 className="h2">Salam, Aysel</h1>
        <Components />
      </ClientShell>
    );
  }
  return (
    <AdminShell
      active={'panel' as AdminTab}
      title="Panel · Çərşənbə, 28 oktyabr"
      actions={<a className="btn btn-primary btn-sm btn-auto" href="#add"><Icon name="plus" size={18} strokeWidth={2.4} /> Çəkiliş əlavə et</a>}
      detail={new URLSearchParams(location.search).has('detail') ? <Detail /> : undefined}
    >
      <Components />
    </AdminShell>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
