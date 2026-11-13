import { useEffect } from 'react';
import { useRoute } from '../router';
import { Campaigns } from '../pages/Campaigns';
import { Clients } from '../pages/Clients';
import { BotSettings } from '../pages/BotSettings';
import { Inbox } from '../pages/Inbox';
import { Leads } from '../pages/Leads';
import { PackageForm, Packages } from '../pages/Packages';
import { Panel } from '../pages/Panel';
import { People } from '../pages/People';
import { Report } from '../pages/Report';
import { Social } from '../pages/Social';
import { AccountStub, MoreMenu } from './Account';
import { INSAN_TABS, Legacy, SectionTabs } from './Legacy';
import { CekilisRoute } from './screens/Cekilis/CekilisRoute';
import { Today } from './screens/Today/Today';
import { V2Shell } from './shell/Shell';

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
    case 'cekilisler': return <CekilisRoute path={path} query={query} />;

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
    case 'calendar': return <CekilisRoute path={path} query={query} />;
    case 'clients': return <Legacy><Clients id={num || undefined} /></Legacy>;
    case 'shoots':
      if (b === 'new' || num) return <CekilisRoute path={path} query={query} />;
      break;
    case 'packages': return <Legacy>{b === 'new' ? <PackageForm /> : <Packages />}</Legacy>;
    case 'materials': return <CekilisRoute path={path} query={query} />;
    case 'campaigns': return <Legacy><Campaigns /></Legacy>;
    case 'automations': return <Legacy><Campaigns tab="auto" /></Legacy>;
    case 'report': return <Legacy><Report /></Legacy>;
    case 'leads': return <Legacy tabs={<SectionTabs options={INSAN_TABS} value="lead" label="İnsanlar" />}><Leads /></Legacy>;
    case 'people': return <Legacy tabs={<SectionTabs options={INSAN_TABS} value="hamisi" label="İnsanlar" />}><People /></Legacy>;
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
