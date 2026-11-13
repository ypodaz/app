import type { Shoot } from '../../types';
import type { ShootStatusV2 } from '../ui';
import { endMs } from '../../format';

/** Backend statusundan (confirmed/completed/cancelled/no_show + vaxt + beh + production) 00 §2.2 statusunu çıxarır.
 *  Backend bu statusları ayrıca saxlamır — hamısı hesablanır. */
export function shootStatus(s: Shoot, now: number): ShootStatusV2 {
  if (s.status === 'cancelled' || s.status === 'no_show') return 'cancelled';
  if (s.status === 'completed') {
    if (s.editing) return s.production === 'ready' ? 'delivered' : 'editing';
    return 'done';
  }
  const start = new Date(s.starts_at).getTime();
  const end = endMs(s.starts_at, s.duration_min);
  if (now >= end) return 'to_close';
  if (now >= start) return 'now';
  return depositPending(s) ? 'deposit' : 'confirmed';
}

export const depositPending = (s: Shoot) => s.status === 'confirmed' && s.deposit_expected > 0 && !s.deposit_received_at && !s.deposit_waived;
