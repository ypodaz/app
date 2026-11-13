// Segmented tablar: fon #F4F4F5, aktiv = qara pill, sayla («Hamısı 247»).
export type SegOption<T extends string> = { value: T; label: string; count?: number };

export function Segmented<T extends string>({ options, value, onChange, label }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="seg__b" onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && <span className="mono">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Keçid kimi işləyən segmented (hash route): hər bəndin href-i var. */
export function SegmentedLinks({ options, value, label }: { options: { value: string; label: string; href: string; count?: number }[]; value: string; label: string }) {
  return (
    <nav className="seg" aria-label={label}>
      {options.map((o) => (
        <a key={o.value} href={o.href} className="seg__b" aria-current={o.value === value ? 'page' : undefined} style={{ textDecoration: 'none' }}>
          {o.label}{o.count !== undefined && <span className="mono">{o.count}</span>}
        </a>
      ))}
    </nav>
  );
}
