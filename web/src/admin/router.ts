import { useEffect, useState } from 'react';

// Sadə hash marşrutlayıcı: "#/shoots/new?date=2026-10-28" → { path: ['shoots','new'], query }
export type Route = { path: string[]; query: URLSearchParams };

function read(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = h.split('?');
  return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => setR(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

// Geri: əvvəlki ekran tətbiq daxilindədirsə history.back(); birbaşa linkdə və ya əvvəlki ekran
// forma idisə (yeni/düzəliş/bağlama/ləğv — artıq göndərilib) ehtiyat səhifəyə.
const FORM = /(^|\/)(new|edit|close|cancel)(\/|\?|$)/;
let prev = '';
window.addEventListener('hashchange', (e) => { prev = new URL(e.oldURL).hash.replace(/^#\/?/, ''); });
export const goBack = (fallback: string) => { if (prev && !FORM.test(prev)) history.back(); else go(fallback); };

export const go = (to: string) => { location.hash = '#/' + to.replace(/^#?\/?/, ''); };

export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
export const useDesktop = () => useMedia('(min-width:1024px)');
/** ≥640px: planşet və kompüter (vaxt şəbəkəsi, detal paneli). */
export const useWide = () => useMedia('(min-width:640px)');
