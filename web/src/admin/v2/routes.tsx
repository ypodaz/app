import { useEffect } from 'react';
import { ShootDetail } from '../components/ShootDetail';
import { useRoute, useWide } from '../router';
import { useLoad } from '../ctx';
import { bakuParts } from '../format';
import { Calendar } from '../pages/Calendar';
import { Campaigns } from '../pages/Campaigns';
import { CancelShoot } from '../pages/CancelShoot';
import { CloseShoot } from '../pages/CloseShoot';
import { BotSettings } from '../pages/BotSettings';
import { Inbox } from '../pages/Inbox';
import { Materials } from '../pages/Materials';
import { PackageForm, Packages } from '../pages/Packages';
import { Panel } from '../pages/Panel';
import { ShootForm } from '../pages/ShootForm';
import { Social } from '../pages/Social';
import type { Shoot } from '../types';
import { AdminShell } from '../../shared/ui';
import { PageHead } from '../components/neon';
import { AccountStub, MoreMenu } from './Account';
import { CEKILIS_TABS, Legacy, SectionTabs } from './Legacy';
import { Hesabat } from './screens/Insanlar/Hesabat';
import { InsanlarRoute } from './screens/Insanlar/Insanlar';
import { ClientCardV2, LeadCardV2 } from './screens/Insanlar/Person';
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
    case 'insanlar':
      if (b?.startsWith('lead-') && Number(b.slice(5))) return <LeadCardV2 key={b} leadId={Number(b.slice(5))} />; // 22-insan-karti.md (hələ müştəri olmayan lead)
      if (num) return <ClientCardV2 key={num} id={num} />; // 22-insan-karti.md
      return <InsanlarRoute query={query} />; // 20-insanlar.md + 21-lovhe.md (?gorunus=lovhe)

    // ---- Hesabat (23) ----
    case 'hesabat': return <Hesabat />;

    // ---- Tənzimləmə (30–35) ----
    case 'tenzimleme':
      switch (b) {
        case 'paketler': return <Legacy>{c === 'yeni' ? <PackageForm /> : <Packages />}</Legacy>; // 30-paketler.md
        case 'marketinq': return <Legacy>{c === 'paylasim' ? <Social /> : <Campaigns />}</Legacy>; // 31/32
        case 'avtomat': return <Legacy><Campaigns tab="auto" /></Legacy>; // 33-avtomat.md
        case 'bot': return <Legacy><BotSettings /></Legacy>; // 34-bot.md
        default: return <AccountStub />; // 35-hesab-giris.md
      }

    // ---- Mobil ----
    case 'm':
      if (b === 'bot') return <Legacy><BotSettings /></Legacy>;
      return <MoreMenu />;

    // ---- Köhnə (v1) yollar: eyni səhifələr, yeni qabıqda ----
    case 'calendar': return <Legacy tabs={<SectionTabs options={CEKILIS_TABS} value="teqvim" label="Çəkilişlər" />}><Calendar query={query} /></Legacy>;
    case 'clients': return num ? <ClientCardV2 key={num} id={num} /> : <InsanlarRoute query={query} tab="musteri" />;
    case 'shoots':
      if (b === 'new') return <Legacy><ShootForm key={location.hash} query={query} /></Legacy>;
      if (!num) break;
      if (c === 'edit') return <Legacy><ShootForm key={num} query={query} editId={num} /></Legacy>;
      if (c === 'close') return <Legacy><CloseShoot id={num} /></Legacy>;
      if (c === 'cancel') return <Legacy><CancelShoot id={num} /></Legacy>;
      return <Legacy><ShootPage key={num} id={num} /></Legacy>;
    case 'packages': return <Legacy>{b === 'new' ? <PackageForm /> : <Packages />}</Legacy>;
    case 'materials': return <Legacy tabs={<SectionTabs options={CEKILIS_TABS} value="montaj" label="Çəkilişlər" />}><Materials /></Legacy>;
    case 'campaigns': return <Legacy><Campaigns /></Legacy>;
    case 'automations': return <Legacy><Campaigns tab="auto" /></Legacy>;
    case 'report': return <Hesabat />;
    case 'leads': return <InsanlarRoute query={query} tab="lead" />;
    case 'people': return <InsanlarRoute query={query} tab="hamisi" />;
    case 'social': return <Legacy><Social /></Legacy>;
    case 'bot': return <Legacy><BotSettings /></Legacy>;
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
