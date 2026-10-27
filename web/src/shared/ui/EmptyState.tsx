import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({ icon = 'calendar', title, text, action }: { icon?: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card card-dash ctr" style={{ padding: 28 }}>
      <span className="ic ic-l"><Icon name={icon} size={26} /></span>
      <h3 className="h3">{title}</h3>
      {text && <p className="t13 muted lh">{text}</p>}
      {action}
    </div>
  );
}
