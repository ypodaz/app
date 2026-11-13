import { useEffect } from 'react';
import { useRoute } from '../router';
import { Panel } from '../pages/Panel';
import { MoreMenu } from './Account';
import { Legacy } from './Legacy';
import { CekilisRoute } from './screens/Cekilis/CekilisRoute';
import { Inbox } from './screens/Inbox/Inbox';
import { Hesabat } from './screens/Insanlar/Hesabat';
import { InsanlarRoute } from './screens/Insanlar/Insanlar';
import { ClientCardV2, LeadCardV2 } from './screens/Insanlar/Person';
import { Avtomat } from './screens/Tenzimleme/Avtomat';
import { Bot } from './screens/Tenzimleme/Bot';
import { Hesab } from './screens/Tenzimleme/Hesab';
import { Marketinq } from './screens/Tenzimleme/Marketinq';
import { MBot } from './screens/Tenzimleme/MBot';
import { Paketler } from './screens/Tenzimleme/Paketler';
import { Paylasim } from './screens/Tenzimleme/Paylasim';
import { YeniKampaniya } from './screens/Tenzimleme/YeniKampaniya';
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
    case 'inbox': return <Inbox id={num || undefined} />; // TODO [API] kanal filtrləri və /inbox/komment/…: Instagram DM/komment üçün admin endpoint yoxdur

    // ---- Çəkilişlər (10–15) ----
    case 'cekilisler': return <CekilisRoute path={path} query={query} />;

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
    case 'calendar': return <CekilisRoute path={path} query={query} />;
    case 'clients': return num ? <ClientCardV2 key={num} id={num} /> : <InsanlarRoute query={query} tab="musteri" />;
    case 'shoots':
      if (b === 'new' || num) return <CekilisRoute path={path} query={query} />;
      break;
    case 'packages': return <Paketler />;
    case 'materials': return <CekilisRoute path={path} query={query} />;
    case 'campaigns': return b === 'new' ? <YeniKampaniya /> : <Marketinq />;
    case 'automations': return <Avtomat />;
    case 'report': return <Hesabat />;
    case 'leads': return <InsanlarRoute query={query} tab="lead" />;
    case 'people': return <InsanlarRoute query={query} tab="hamisi" />;
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
