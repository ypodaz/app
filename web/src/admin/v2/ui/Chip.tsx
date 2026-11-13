import type { ReactNode } from 'react';

/** Rəng mənaları (system.md): now/brand = indi·AI·seçilmiş, deposit = beh gözlənilir (qırıq xətt), done = bitib,
 *  confirmed = təsdiqlənib, edit = montajda, cancel = ləğv/xəta, blocked = bloklanıb (ştrix). */
export type ChipTone = 'neutral' | 'brand' | 'now' | 'deposit' | 'confirmed' | 'done' | 'edit' | 'cancel' | 'blocked' | 'warn';

export function Chip({ tone = 'neutral', children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`chip chip--${tone}`}>{children}</span>;
}

/** Çəkiliş statusları — yalnız 00 §2.2 / 99 G16 adları. */
export type ShootStatusV2 = 'deposit' | 'confirmed' | 'now' | 'to_close' | 'editing' | 'delivered' | 'done' | 'cancelled';
export const STATUS_LABEL: Record<ShootStatusV2, string> = {
  deposit: 'Beh gözlənilir', confirmed: 'Təsdiqləndi', now: 'İndi çəkilir', to_close: 'Bağlanmalı',
  editing: 'Montajda', delivered: 'Təhvil verildi', done: 'Tamamlandı', cancelled: 'Ləğv',
};
const STATUS_TONE: Record<ShootStatusV2, ChipTone> = {
  deposit: 'deposit', confirmed: 'confirmed', now: 'now', to_close: 'cancel', editing: 'edit', delivered: 'done', done: 'done', cancelled: 'cancel',
};

export function StatusChip({ status }: { status: ShootStatusV2 }) {
  return <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>;
}
