import { Icon, type IconName } from './Icon';

export type PillStatus = 'confirmed' | 'deposit' | 'done' | 'cancelled' | 'noshow';

const MAP: Record<PillStatus, { cls: string; icon: IconName; text: string }> = {
  confirmed: { cls: 'p-ok', icon: 'check', text: 'Təsdiqləndi' },
  deposit: { cls: 'p-beh', icon: 'clock', text: 'Beh gözlənilir' },
  done: { cls: 'p-done', icon: 'check', text: 'Tamamlandı' },
  cancelled: { cls: 'p-cancel', icon: 'close', text: 'Ləğv olundu' },
  // Dizaynda "Gəlmədi" yoxdur: p-cancel rəngi + xəbərdarlıq ikonu.
  noshow: { cls: 'p-cancel', icon: 'alert', text: 'Gəlmədi' },
};

export function Pill({ status, children }: { status: PillStatus; children?: string }) {
  const m = MAP[status];
  return (
    <span className={`pill ${m.cls}`}>
      <Icon name={m.icon} size={12} />
      {children ?? m.text}
    </span>
  );
}
