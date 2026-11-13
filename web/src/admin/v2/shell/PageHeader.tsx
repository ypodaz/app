import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../ctx';
import { initials } from '../../format';
import type { Client } from '../../types';
import { maskPhone } from '../data/time';
import { LinkButton, V2Icon } from '../ui';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** C3: kontakt axtarışı (ad, telefon, Instagram, şirkət). ↵ İnsan kartını açır. ⌘K paneli Mərhələ 2. */
function Search() {
  const { call } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hit, setHit] = useState(0);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === '/' && !typing(e.target) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setOpen(true); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    if (!clients) call<Client[]>('/clients').then(setClients).catch(() => setErr('Axtarış yüklənmədi · internet bağlantısını yoxlayın'));
  }, [open, clients, call]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !clients) return [];
    const digits = s.replace(/\D/g, '');
    return clients.filter((c) => c.full_name.toLowerCase().includes(s) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))
      || (c.instagram ?? '').toLowerCase().includes(s.replace(/^@/, '')) || (c.workplace ?? '').toLowerCase().includes(s)).slice(0, 8);
  }, [q, clients]);
  useEffect(() => setHit(0), [q]);

  const close = () => { setOpen(false); setQ(''); };
  const choose = (c: Client) => { close(); location.hash = `#/insanlar/${c.id}`; };

  return (
    <div className="search">
      <button type="button" className="search__btn" onClick={() => setOpen(true)} aria-label="Axtar" aria-expanded={open}>
        <V2Icon name="search" size={18} /><span className="search__lbl">Axtar</span><kbd className="mono">/</kbd>
      </button>
      {open && (
        <>
          <div className="search__scrim" onClick={close} />
          <div className="search__panel" role="dialog" aria-label="Axtar">
            <div className="search__field">
              <V2Icon name="search" />
              <input ref={input} className="search__in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, telefon, Instagram, şirkət" aria-label="Kontakt axtar"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') close();
                  else if (e.key === 'ArrowDown') { e.preventDefault(); setHit((h) => Math.min(results.length - 1, h + 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setHit((h) => Math.max(0, h - 1)); }
                  else if (e.key === 'Enter' && results[hit]) choose(results[hit]);
                }} />
              <button type="button" className="search__x" aria-label="Bağla" onClick={close}><V2Icon name="x" /></button>
            </div>
            {err && <p className="search__msg" role="alert">{err}</p>}
            {!err && q.trim() && clients && results.length === 0 && (
              <div className="search__msg"><b>«{q.trim()}» tapılmadı</b><br />
                {/* TODO [API] «Yeni kontakt yarat» (G8): dialoq 20-insanlar.md sənədinin işidir. */}
                Axtarış ad, telefon, Instagram və iş yerində aparılır.</div>
            )}
            {results.map((c, i) => (
              <button key={c.id} type="button" className="search__hit" aria-selected={i === hit} onMouseEnter={() => setHit(i)} onClick={() => choose(c)}>
                <span className="av">{initials(c.full_name)}</span>
                <span className="row__main"><span className="row__title" style={{ display: 'block' }}>{c.full_name}</span>
                  <span className="row__meta mono" style={{ display: 'block' }}>{maskPhone(c.phone.replace(/\D/g, '').length === 9 ? '994' + c.phone.replace(/\D/g, '') : c.phone)}{c.workplace ? ` · ${c.workplace}` : ''}</span></span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type Props = {
  title: string;
  sub?: ReactNode;
  /** «Yeni çəkiliş» düyməsi (C4). Bu gün-də ekranın qara düyməsi sağ paneldəki əməldir → secondary. */
  newShoot?: false | 'primary' | 'secondary';
  /** Səhifənin öz düymələri (Axtar-dan əvvəl). */
  actions?: ReactNode;
  /** Mobildə «Daha çox» ikonu (yalnız ana ekranlarda). */
  more?: boolean;
};

/** C: web başlığı (h1 + alt sətir + Axtar + Yeni çəkiliş); mobildə kiçik başlıq + Axtar və «Daha çox» ikonları. */
export function PageHeader({ title, sub, newShoot = 'primary', actions, more = true }: Props) {
  return (
    <header className="phead">
      <div className="phead__t">
        <h1 className="phead__h1">{title}</h1>
        {sub && <p className="phead__sub">{sub}</p>}
      </div>
      <div className="phead__acts">
        {actions}
        <Search />
        {newShoot && <LinkButton href="#/shoots/new" size="lg" variant={newShoot} icon={<V2Icon name="plus" />} className="phead__new">Yeni çəkiliş</LinkButton>}
        {more && <a href="#/m/daha" className="phead__more" aria-label="Daha çox"><V2Icon name="user" size={20} /></a>}
      </div>
    </header>
  );
}

