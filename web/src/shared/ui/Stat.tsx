import { Icon, type IconName } from './Icon';

// Sayğac kartı (B1): etiket + ikon, böyük rəqəm, izah.
export function Stat({ label, value, note, icon, accent, href }: { label: string; value: number | string; note?: string; icon: IconName; accent?: boolean; href?: string }) {
  const body = (
    <>
      <div className="row sb">
        <span className="lbl">{label}</span>
        <span className="ic ic-sq"><Icon name={icon} /></span>
      </div>
      <span className="num-l rs-nowrap">{value}</span>
      {note && <span className="t13 soft lh">{note}</span>}
    </>
  );
  const cls = `card${accent ? ' card-accent' : ''} rs-stat`;
  return href ? <a className={cls} href={href}>{body}</a> : <div className={cls}>{body}</div>;
}
