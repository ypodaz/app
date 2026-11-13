import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { V2Icon } from './Icon';

/** 300 ms-dən sonra true (skelet dərhal yanıb-sönməsin, 00 §8). */
export function useAfter(ms = 300): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setOn(true), ms); return () => window.clearTimeout(t); }, [ms]);
  return on;
}

/** Yüklənir: real sətir ölçüsündə (52px) skelet sətirlər, spinner yoxdur. */
export function LoadingRows({ rows = 5, label = 'Yüklənir' }: { rows?: number; label?: string }) {
  const show = useAfter();
  return (
    <div role="status" aria-label={label} aria-busy="true" style={{ visibility: show ? 'visible' : 'hidden' }}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i}>
          <span className="sk" style={{ width: 32, height: 32, borderRadius: '50%' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="sk" style={{ width: `${55 + ((i * 13) % 30)}%`, height: 12 }} />
            <span className="sk" style={{ width: `${30 + ((i * 17) % 30)}%`, height: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Xəta: nə oldu + necə düzəlir + «Yenidən cəhd et». Köhnə məlumat varsa, onun üstündə sətir kimi göstər. */
export function ErrorBox({ title, detail, onRetry, retryLabel = 'Yenidən cəhd et' }: { title: string; detail?: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="state state--error" role="alert">
      <div><div className="state__t">{title}</div>{detail && <div className="state__s">{detail}</div>}</div>
      {onRetry && <Button size="sm" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}

/** Boş hal: «<nə yoxdur> · <niyə>» + ən çox bir əməl (99 G8). */
export function EmptyState({ title, reason, action }: { title: string; reason?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state state--empty">
      <div><div className="state__t">{title}</div>{reason && <div className="state__s">{reason}</div>}</div>
      {action}
    </div>
  );
}

/** İnternet yoxdur: yuxarıda zolaq; əməl düymələri çağıran tərəfdə disabled olur (oflayn növbə Mərhələ 2). */
export function OfflineBar({ since }: { since?: string }) {
  return (
    <div className="bar bar--offline" role="status">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><V2Icon name="wifiOff" />İnternet yoxdur{since ? <> · <span className="mono">{since}</span> vəziyyəti</> : null}</span>
    </div>
  );
}

export function useOnline(): boolean {
  const [on, setOn] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}
