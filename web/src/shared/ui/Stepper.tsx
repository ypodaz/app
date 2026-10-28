import { Icon } from './Icon';

// Saat seçici: dəyər dəqiqə ilə, addım 30 dəq. Mətn: "1 saat", "1,5 saat".
export function formatHours(minutes: number): string {
  if (minutes % 30) return minutes < 60 ? `${minutes} dəq` : `${Math.floor(minutes / 60)} saat ${minutes % 60} dəq`;
  const h = minutes / 60;
  return `${String(h).replace('.', ',')} saat`;
}

export const formatMin = (m: number) => `${m} dəq`;

export function Stepper({ minutes, onChange, min = 30, max = 600, step = 30, fmt = formatHours, label }: { minutes: number; onChange: (m: number) => void; min?: number; max?: number; step?: number; fmt?: (m: number) => string; label?: string }) {
  return (
    <div className="stp" role="group" aria-label={label}>
      <button type="button" aria-label="Azalt" disabled={minutes <= min} onClick={() => onChange(Math.max(min, minutes - step))}><Icon name="minus" /></button>
      <span className="v rs-nowrap" aria-live="polite">{fmt(minutes)}</span>
      <button type="button" aria-label="Artır" disabled={minutes >= max} onClick={() => onChange(Math.min(max, minutes + step))}><Icon name="plus" /></button>
    </div>
  );
}
