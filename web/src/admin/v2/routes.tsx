import { useEffect } from 'react';
import { ShootDetail } from '../components/ShootDetail';
import { useRoute, useWide } from '../router';
import { useLoad } from '../ctx';
import { bakuParts } from '../format';
import { Calendar } from '../pages/Calendar';
import { CancelShoot } from '../pages/CancelShoot';
import { Clients } from '../pages/Clients';
import { CloseShoot } from '../pages/CloseShoot';
import { Inbox } from '../pages/Inbox';
import { Leads } from '../pages/Leads';
import { Materials } from '../pages/Materials';
import { Panel } from '../pages/Panel';
import { People } from '../pages/People';
import { Report } from '../pages/Report';
import { ShootForm } from '../pages/ShootForm';
import type { Shoot } from '../types';
import { AdminShell } from '../../shared/ui';
import { PageHead } from '../components/neon';
import { MoreMenu } from './Account';
import { Avtomat } from './screens/Tenzimleme/Avtomat';
import { Bot } from './screens/Tenzimleme/Bot';
import { Hesab } from './screens/Tenzimleme/Hesab';
import { Marketinq } from './screens/Tenzimleme/Marketinq';
import { MBot } from './screens/Tenzimleme/MBot';
import { Paketler } from './screens/Tenzimleme/Paketler';
import { Paylasim } from './screens/Tenzimleme/Paylasim';
import { YeniKampaniya } from './screens/Tenzimleme/YeniKampaniya';
import { CEKILIS_TABS, INSAN_TABS, Legacy, SectionTabs } from './Legacy';
import { Today } from './screens/Today/Today';
import { Soon } from './screens/Soon';
import { V2Shell } from './shell/Shell';

// B9: mobil tam ekran; planşet/desktopda təqvim + sağ detal paneli (köhnə main.tsx-dən köçürülüb)
function ShootPage({ id }: { id: number }) {
  const wide = useWide();
  const s = useLoad<Shoot>(wide ? `/shoots/${id}` : null).data;
  if (wide) {
    const q = new URLSearchParams({ v: 'week', d: s ? bakuParts(s.starts_at).date : '' });
    if (!s) q.delete('d');
    return <Calendar query={q} selectedId={id} detail={<ShootDetail id={id} />} />;
  }
  return <AdminShell active="calendar" title="Çəkiliş" bare full><PageHead title="Çəkiliş" back="calendar" /><ShootDetail id={id} /></AdminShell>;
}

/** Route cədvəli. Yeni ekranı bağlamaq üçün: aşağıda uyğun sətirdə <Legacy>…</Legacy> və ya <Soon/> əvəzinə yeni komponenti qoy
 *  (sənədin «Route» sətri ilə eyni yol). Köhnə (v1) yollar da işləyir — köhnə səhifələrin daxili keçidləri onlara baxır. */
function Page() {
  const { path, query } = useRoute();
  const [a, b, c] = path;
  const num = Number(b);
  switch (a) {
    case 'bu-gun': return <Today />;

    // ---- Inbox (02) ----
    case 'inbox': return <Legacy><Inbox id={num || undefined} /></Legacy>; // TODO v2: 02-inbox.md, kanal filtrləri və /inbox/komment/…

    // ---- Çəkilişlər (10–15) ----
    case 'cekilisler':
      if (b === 'siyahi') return <><Soon title="Çəkilişlər" sub="Siyahı" /></>; // 12-cekilis-siyahi.md
      if (b === 'teqvim-ferqi') return <Soon title="Təqvim fərqi" />; // 11-teqvim-ferqi.md
      if (b === 'montaj') return <Legacy tabs={<SectionTabs options={CEKILIS_TABS} value="montaj" label="Çəkilişlər" />}><Materials /></Legacy>; // 13-montaj.md
      if (b === 'yeni') return <Legacy><ShootForm key={location.hash} query={query} /></Legacy>; // 14-yeni-cekilis.md (v2-də modal)
      return <Legacy tabs={<SectionTabs options={CEKILIS_TABS} value="teqvim" label="Çəkilişlər" />}><Calendar query={query} /></Legacy>; // 10-teqvim.md

    // ---- İnsanlar (20–22) ----
    case 'insanlar': {
      if (num) return <Legacy><Clients id={num} /></Legacy>; // 22-insan-karti.md
      const tab = query.get('tab') ?? 'lead'; // TODO v2: 20-insanlar.md (Addım gözləyən / Lövhə / Müştəri / Hamısı)
      const body = tab === 'musteri' ? <Clients /> : tab === 'hamisi' ? <People /> : <Leads />;
      return <Legacy tabs={<SectionTabs options={INSAN_TABS} value={tab === 'musteri' || tab === 'hamisi' ? tab : 'lead'} label="İnsanlar" />}>{body}</Legacy>;
    }

    // ---- Hesabat (23) ----
    case 'hesabat': return <Legacy><Report /></Legacy>;

    // ---- Tənzimləmə (30–35) ----
    case 'tenzimleme':
      switch (b) {
        case 'paketler': return <Paketler />; // 30-paketler.md (/yeni dialoqu Paketler daxilində)
        case 'marketinq': return c === 'paylasim' ? <Paylasim /> : c === 'yeni' ? <YeniKampaniya /> : <Marketinq />; // 31/32
        case 'avtomat': return <Avtomat />; // 33-avtomat.md
        case 'bot': return <Bot />; // 34-bot.md
        default: return <Hesab />; // 35-hesab-giris.md
      }

    // ---- Mobil ----
    case 'm':
      if (b === 'bot') return <MBot />;
      return <MoreMenu />;

    // ---- Köhnə (v1) yollar: eyni səhifələr, yeni qabıqda ----
    case 'calendar': return <Legacy tabs={<SectionTabs options={CEKILIS_TABS} value="teqvim" label="Çəkilişlər" />}><Calendar query={query} /></Legacy>;
    case 'clients': return <Legacy><Clients id={num || undefined} /></Legacy>;
    case 'shoots':
      if (b === 'new') return <Legacy><ShootForm key={location.hash} query={query} /></Legacy>;
      if (!num) break;
      if (c === 'edit') return <Legacy><ShootForm key={num} query={query} editId={num} /></Legacy>;
      if (c === 'close') return <Legacy><CloseShoot id={num} /></Legacy>;
      if (c === 'cancel') return <Legacy><CancelShoot id={num} /></Legacy>;
      return <Legacy><ShootPage key={num} id={num} /></Legacy>;
    case 'packages': return <Paketler />;
    case 'materials': return <Legacy tabs={<SectionTabs options={CEKILIS_TABS} value="montaj" label="Çəkilişlər" />}><Materials /></Legacy>;
    case 'campaigns': return b === 'new' ? <YeniKampaniya /> : <Marketinq />;
    case 'automations': return <Avtomat />;
    case 'report': return <Legacy><Report /></Legacy>;
    case 'leads': return <Legacy tabs={<SectionTabs options={INSAN_TABS} value="lead" label="İnsanlar" />}><Leads /></Legacy>;
    case 'people': return <Legacy tabs={<SectionTabs options={INSAN_TABS} value="hamisi" label="İnsanlar" />}><People /></Legacy>;
    case 'social': return <Paylasim />;
    case 'bot': return <Bot />;
    case 'panel': return <Legacy><Panel /></Legacy>;
  }
  return <Today />;
}

export function V2Routes() {
  const { path } = useRoute();
  // `/` və `/giris` (giriş artıq edilib) → Bu gün (01: «/ bura yönləndirir»)
  useEffect(() => { if (path.length === 0 || path[0] === 'giris') location.replace('#/bu-gun'); }, [path]);
  return <V2Shell><Page /></V2Shell>;
}
