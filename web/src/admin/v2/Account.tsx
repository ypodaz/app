import { useAuth } from '../ctx';
import { formatMoney } from '../../shared/ui';
import { useShellData } from './data/ShellData';
import { PageHeader } from './shell/PageHeader';
import { Button, Card, V2Icon } from './ui';

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];

/** Mobil «Daha çox» (35-hesab-giris.md §FableMDaha, route /m/daha): gəlir kartı + nav-da olmayan bölmələr + çıxış. */
export function MoreMenu() {
  const { signOut } = useAuth();
  const { revenue, now, raw } = useShellData();
  const rows: [string, string, string?][] = [
    ['Hesabat', '#/hesabat'],
    ['Paketlər və qiymətlər', '#/tenzimleme/paketler'],
    ['Marketinq', '#/tenzimleme/marketinq'],
    ['Avtomatlaşdırma', '#/tenzimleme/avtomat'],
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
        <button type="button" className="row" onClick={signOut} style={{ minHeight: 56 }}>
          <span className="row__hit"><span className="row__main row__title" style={{ color: 'var(--danger-text)' }}>Çıxış</span></span>
        </button>
      </Card>
    </>
  );
}

/** Hesab (35): hələ qurulmayıb. Köhnə panelin yeganə yeri (app istifadəsi) burada qalır ki, itməsin. */
export function AccountStub() {
  const { signOut } = useAuth();
  return (
    <>
      <PageHeader title="Hesab" />
      <Card label="Hesab">
        <h2 className="soon__t">Tezliklə</h2>
        <p className="soon__s" style={{ margin: '4px 0 14px' }}>Hesab ekranı yeni dizaynda hələ hazır deyil.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn btn--secondary btn--md" href="#/panel">Köhnə panel (app istifadəsi)</a>
          <Button variant="danger" onClick={signOut}>Çıxış</Button>
        </div>
      </Card>
    </>
  );
}
