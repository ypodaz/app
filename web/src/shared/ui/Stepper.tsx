import { Icon } from './Icon';

// Saat seçici: dəyər dəqiqə ilə, addım 30 dəq. Mətn: "1 saat", "1,5 saat".
export function formatHours(minutes: number): string {
  const h = minutes / 60;
  return `${String(h).replace('.', ',')} saat`;
}

export function Stepper({ minutes, onChange, min = 30, max = 600, step = 30 }: { minutes: number; onChange: (m: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div className="stp">
      <button type="button" aria-label="Azalt" disabled={minutes <= min} onClick={() => onChange(Math.max(min, minutes - step))}><Icon name="minus" /></button>
      <span className="v rs-nowrap" aria-live="polite">{formatHours(minutes)}</span>
      <button type="button" aria-label="Artır" disabled={minutes >= max} onClick={() => onChange(Math.min(max, minutes + step))}><Icon name="plus" /></button>
    </div>
  );
}
