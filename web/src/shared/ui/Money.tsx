// Tam qəpik → "75,50 AZN" / "70 AZN"; mənfi üçün "−".
export function formatMoney(qepik: number): string {
  const neg = qepik < 0;
  const abs = Math.abs(Math.round(qepik));
  const man = Math.floor(abs / 100);
  const q = abs % 100;
  const manStr = String(man).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const body = q === 0 ? manStr : `${manStr},${String(q).padStart(2, '0')}`;
  return `${neg ? '−' : ''}${body} AZN`;
}

// Həmişə iki qəpik rəqəmi (admin cədvəl/detal sətirləri): 9500 → "95,00 AZN".
export function formatMoney2(qepik: number): string {
  const neg = qepik < 0;
  const abs = Math.abs(Math.round(qepik));
  const manStr = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '−' : ''}${manStr},${String(abs % 100).padStart(2, '0')} AZN`;
}

export function Money({ qepik, className = '' }: { qepik: number; className?: string }) {
  return <span className={`rs-nowrap${className ? ' ' + className : ''}`}>{formatMoney(qepik)}</span>;
}
