import type { V2IconName } from '../ui';

/** Nav bəndləri (01 §Ümumi çərçivə A). href-lər hash route-dur. */
export type NavKey = 'bu-gun' | 'inbox' | 'cekilisler' | 'insanlar' | 'hesabat' | 'paketler' | 'marketinq' | 'avtomat' | 'bot' | 'hesab' | 'daha' | null;

export const MAIN_NAV: { key: Exclude<NavKey, null>; label: string; icon: V2IconName; href: string }[] = [
  { key: 'bu-gun', label: 'Bu gün', icon: 'today', href: '#/bu-gun' },
  { key: 'inbox', label: 'Inbox', icon: 'inbox', href: '#/inbox' },
  { key: 'cekilisler', label: 'Çəkilişlər', icon: 'cal', href: '#/cekilisler' },
  { key: 'insanlar', label: 'İnsanlar', icon: 'users', href: '#/insanlar' },
  { key: 'hesabat', label: 'Hesabat', icon: 'chart', href: '#/hesabat' },
];
export const SETTINGS_NAV: { key: Exclude<NavKey, null>; label: string; href: string }[] = [
  { key: 'paketler', label: 'Paketlər və qiymətlər', href: '#/tenzimleme/paketler' },
  { key: 'marketinq', label: 'Marketinq', href: '#/tenzimleme/marketinq' },
  { key: 'avtomat', label: 'Avtomatlaşdırma', href: '#/tenzimleme/avtomat' },
  { key: 'bot', label: 'Bot', href: '#/tenzimleme/bot' },
  { key: 'hesab', label: 'Hesab', href: '#/tenzimleme/hesab' },
];

/** Route yolundan aktiv nav bəndi. Köhnə (v1) yollar da burada xəritələnir. */
export function sectionOf(path: string[]): NavKey {
  const [a, b] = path;
  switch (a) {
    case undefined: case 'bu-gun': case 'panel': return 'bu-gun';
    case 'inbox': return 'inbox';
    case 'leads': return 'insanlar';
    case 'cekilisler': case 'calendar': case 'shoots': case 'materials': return 'cekilisler';
    case 'insanlar': case 'clients': case 'people': return 'insanlar';
    case 'hesabat': case 'report': return 'hesabat';
    case 'packages': return 'paketler';
    case 'campaigns': case 'social': return 'marketinq';
    case 'automations': return 'avtomat';
    case 'bot': return 'bot';
    case 'tenzimleme': return b === 'paketler' ? 'paketler' : b === 'marketinq' ? 'marketinq' : b === 'avtomat' ? 'avtomat' : b === 'bot' ? 'bot' : 'hesab';
    case 'm': return b === 'bot' ? 'bot' : 'daha';
    default: return null;
  }
}
