export function Segmented<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="segw" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={`seg${o.value === value ? ' seg-on' : ''}`} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
