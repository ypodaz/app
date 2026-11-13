import { useState } from 'react';
import { useAuth } from '../ctx';
import { formatMoney } from '../../shared/ui';
import { useShellData } from './data/ShellData';
import { PageHeader } from './shell/PageHeader';
import { Button, Card, Dialog, V2Icon, useToast } from './ui';

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];

/** Mobil «Daha çox» (35-hesab-giris.md §FableMDaha, route /m/daha): gəlir kartı + nav-da olmayan bölmələr + çıxış. */
export function MoreMenu() {
  const { signOut } = useAuth();
  const toast = useToast();
  const [out, setOut] = useState(false);
  const { revenue, now, raw } = useShellData();
  const rows: [string, string, string?][] = [
    ['Hesabat', '#/hesabat'],
    ['Bot', '#/m/bot', raw?.botEnabled === undefined || raw?.botEnabled === null ? undefined : raw.botEnabled ? '24/7 aktiv' : 'söndürülüb'],
    ['Hesab', '#/tenzimleme/hesab'],
  ];
  return (
    <>
      <PageHeader title="Daha çox" newShoot={false} more={false} />
      {revenue !== null && (
        <Card small label="Gəlir">
          <div className="rev__l" style={{ color: 'var(--text-2)', fontSize: 12 }}>{MONTHS[new Date(now + 4 * 3600_000).getUTCMonth()]} gəliri</div>
          {/* TODO [API] «↑ N%» müqayisəsi: /report keçən ayın eyni günlərini vermir. */}
          <div className="mono" style={{ fontSize: 24, fontWeight: 500 }}>{formatMoney(revenue)}</div>
        </Card>
      )}
      <Card flush label="Bölmələr">
        {rows.map(([label, href, note]) => (
          <a key={label} className="row" href={href} style={{ minHeight: 56, textDecoration: 'none', color: 'var(--text)' }}>
            <span className="row__hit"><span className="row__main row__title">{label}</span>{note && <span className="row__meta">{note}</span>}<V2Icon name="chev" size={18} /></span>
          </a>
        ))}
        {['Paketlər və qiymətlər', 'Marketinq', 'Avtomatlaşdırma'].map((label) => (
          <button key={label} type="button" className="row" onClick={() => toast.show('Bu bölmə kompüterdə açılır')} style={{ minHeight: 56 }}>
            <span className="row__hit"><span className="row__main row__title">{label}</span><span className="row__meta">kompüterdə</span></span>
          </button>
        ))}
        <button type="button" className="row" onClick={() => setOut(true)} style={{ minHeight: 56 }}>
          <span className="row__hit"><span className="row__main row__title" style={{ color: 'var(--danger-text)' }}>Çıxış</span></span>
        </button>
      </Card>
      <Dialog open={out} onClose={() => setOut(false)} title="Çıxış edilsin?" subtitle="Yenidən daxil olmaq üçün login və parol lazımdır."
        footer={<><Button variant="text" onClick={() => setOut(false)}>Qal</Button><Button variant="danger" onClick={signOut}>Çıxış</Button></>} />
    </>
  );
}
