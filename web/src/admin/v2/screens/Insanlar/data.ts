import { useCallback, useEffect, useMemo, useState } from 'react';
import { LOST_REASONS, type Lead, type LostReason, type Stage } from '../../../components/crm';
import { errMsg, useAuth, useLoad } from '../../../ctx';
import { addDays, bakuParts, bakuToday } from '../../../format';
import { ddmm } from '../../data/time';
import { useToast } from '../../ui';

export { LOST_REASONS };
export type { Lead, LostReason, Stage };

/** Lövhədə mərhələ sütunları (21): Yeni → Maraqlanır → Tarix → Beh. «Təsdiq» və «Gəldi» birlikdə «Çəkilişə çevrildi» nəticəsidir. */
export const OPEN_STAGES: Stage[] = ['yeni', 'maraqlanir', 'tarix', 'beh'];
export const STAGE_LABEL: Record<Stage, string> = {
  yeni: 'Yeni', maraqlanir: 'Maraqlanır', tarix: 'Tarix', beh: 'Beh', tesdiq: 'Çəkilişə çevrildi', geldi: 'Çəkilişə çevrildi', itirildi: 'İtirildi',
};
export const isConverted = (l: Pick<Lead, 'stage'>) => l.stage === 'tesdiq' || l.stage === 'geldi';
export const leadName = (l: Lead) => l.name || (l.phone ? `+${l.phone}` : 'Naməlum');
export const phoneShown = (p: string | null | undefined) => {
  const d = (p ?? '').replace(/\D/g, '');
  return d.length === 12 ? `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}` : d ? `+${d}` : '';
};

/** Son aktivlik (21 dizayn qeydi 1): <1 saat «N dəq», bu gün «N saat», dünən «dünən», əvvəl «dd.mm». */
export function agoShort(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${Math.max(1, m)} dəq`;
  const today = bakuToday(), d = bakuParts(iso).date;
  if (d === today) return `${Math.floor(m / 60)} saat`;
  if (d === addDays(today, -1)) return 'dünən';
  return ddmm(d);
}

/** Xatırlatma vaxtı gəlib (bu gün və ya keçib)? */
export const remindDue = (l: Lead) => !!l.remind_at && bakuParts(l.remind_at).date <= bakuToday();
export const remindText = (l: Lead) => (l.remind_at ? ddmm(bakuParts(l.remind_at).date) : '');

/** Lead siyahısı + mərhələ dəyişmə (optimistik, «Geri al» ilə). İtirildi üçün səbəb məcburidir (server 422 verir). */
export function useLeads() {
  const { call } = useAuth();
  const toast = useToast();
  const load = useLoad<Lead[]>('/leads');
  const [over, setOver] = useState<Record<number, Stage>>({});
  useEffect(() => { setOver({}); }, [load.data]);
  const leads = useMemo(() => (load.data ?? []).map((l) => (over[l.id] ? { ...l, stage: over[l.id] } : l)), [load.data, over]);

  const patch = useCallback((id: number, body: Record<string, unknown>) => call<Lead>(`/leads/${id}`, { method: 'PATCH', body }), [call]);

  const move = useCallback(async (l: Lead, stage: Stage, lost?: { reason: LostReason; text: string }): Promise<boolean> => {
    if (l.stage === stage) return true;
    const prev = { stage: l.stage, reason: l.lost_reason, text: l.lost_text };
    setOver((o) => ({ ...o, [l.id]: stage }));
    try {
      await patch(l.id, lost ? { stage, lost_reason: lost.reason, lost_text: lost.text || null } : { stage });
    } catch (e) {
      setOver((o) => { const n = { ...o }; delete n[l.id]; return n; });
      toast.show(`Alınmadı: ${errMsg(e)}`, { error: true, retry: () => void move(l, stage, lost) });
      return false;
    }
    load.reload();
    toast.show(`${leadName(l)} · ${STAGE_LABEL[stage]} mərhələsinə keçirildi`, {
      undo: () => {
        const back = prev.stage === 'itirildi' && prev.reason ? { stage: prev.stage, lost_reason: prev.reason, lost_text: prev.text } : { stage: prev.stage };
        patch(l.id, back).then(load.reload).catch((e) => toast.show(`Alınmadı: ${errMsg(e)}`, { error: true }));
      },
    });
    return true;
  }, [patch, load.reload, toast]);

  /** Xatırlatma qoy / sil (remind_at null = sil). */
  const remind = useCallback(async (l: Lead, at: string | null, note: string): Promise<string | null> => {
    try {
      await patch(l.id, at ? { remind_at: at, remind_note: note.trim() || null } : { remind_at: null });
      load.reload();
      toast.show(at ? `Xatırlatma qoyuldu · ${leadName(l)}` : `Xatırlatma silindi · ${leadName(l)}`);
      return null;
    } catch (e) { return errMsg(e); }
  }, [patch, load.reload, toast]);

  return { leads, loaded: !!load.data, error: load.err, reload: load.reload, move, remind };
}
