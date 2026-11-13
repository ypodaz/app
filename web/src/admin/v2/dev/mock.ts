// Yalnız DEV: `?mock` ilə açılanda API sorğularını saxta (nümunə) məlumatla əvəz edir — ekran görüntüləri üçün.
// Real müştəri adı yoxdur; ad/rəqəmlər dizayn nümunəsidir. Build-də import.meta.env.DEV false olduğundan çıxarılır.
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const baku = () => { const d = new Date(Date.now() + 4 * H); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 4 * H; }; // Bakı gecəyarısı (UTC ms)

function shoot(id: number, name: string, startH: number, dur: number, over: Record<string, unknown> = {}) {
  return {
    id, client_id: id, client_name: name, package_id: null, starts_at: iso(baku() + startH * H), duration_min: dur, kind: 'shoot', tag: 'podcast',
    location: 'studio', address: null, cameras: 3, editing: true, reels_count: 0, title: null, status: 'confirmed', production: 'none', delivery_on: null,
    price_base: 12000, price_editing: 3000, price_reels: 0, price_extra_camera: 0, discount: 0, discount_note: null, extras: [], prep_min: 15, wrap_min: 15, total: 15000,
    note: null, source_note: null, cashback_used: 0, deposit_expected: 5000, deposit_amount: 5000, deposit_received_at: iso(Date.now() - 48 * H), deposit_waived: false,
    paid_at_studio: 0, paid_method: null, closed_at: null, cancel_requested_at: null, cancel_window: null, retained_amount: 0, refund_amount: 0, refunded_at: null,
    rescheduled_lt24: false, payment_line: '', studio_balance: 10000, materials: [], created_at: iso(Date.now() - 72 * H), ...over,
  };
}
const msg = (id: number, dir: 'in' | 'out', text: string, agoMin: number, source = 'customer') => ({
  id, direction: dir, source, type: 'text', text, media_url: null, status: null, created_at: iso(Date.now() - agoMin * 60_000), error: null,
});
const conv = (id: number, name: string, mode: string, text: string, agoMin: number) => ({
  id, contact: { id, name, phone: `+99450${String(1000000 + id * 1111)}`, excluded: false }, last_message: msg(id * 10, 'in', text, agoMin), unread: 1, mode,
  pending_drafts: mode === 'wait' ? 1 : 0, lead_stage: 'maraqlanir', last_message_at: iso(Date.now() - agoMin * 60_000), window_expires_at: iso(Date.now() + 20 * H),
});

const shoots = [
  shoot(1, 'Nümunə Müştəri A', -20, 120, { status: 'completed', closed_at: iso(Date.now() - 18 * H) }),
  shoot(2, 'Nümunə Müştəri B', 10, 90),
  shoot(3, 'Nümunə Müştəri C', 12.5, 120, { deposit_amount: 0, deposit_received_at: null }),
  shoot(4, 'Nümunə Müştəri D', 15, 60, { status: 'confirmed' }),
  shoot(5, 'Nümunə Müştəri E', 46, 120, { deposit_amount: 0, deposit_received_at: null }),
  shoot(6, 'Nümunə Müştəri F', -50, 90, { status: 'completed', closed_at: iso(Date.now() - 40 * H), production: 'ready', delivery_on: iso(baku()).slice(0, 10) }),
];
const convs = [conv(1, 'Söhbət Bir', 'wait', 'Sabah üçün yer var?', 25), conv(2, 'Söhbət İki', 'owner', 'Qiymət nə qədərdir?', 140), conv(3, 'Söhbət Üç', 'human', 'Təşəkkür edirəm', 400)];

function route(path: string, method: string): unknown {
  const p = path.split('?')[0];
  if (p === '/dashboard') return { deposit_pending: [shoots[2], shoots[4]], today: [shoots[1], shoots[2], shoots[3]], unclosed_count: 1, awaiting_material_count: 0, app_usage: { clients: 30, joined: 20, home_screen: 10, push_on: 8, active_7d: 6 } };
  const ck = cekilisRoute(p);
  if (ck !== undefined) return ck;
  if (p === '/shoots') return shoots;
  if (p === '/blocks') return [];
  if (p === '/inbox') return convs;
  if (p === '/bot/settings') return { bot_enabled: true };
  if (p === '/leads') return [{ stage: 'yeni' }, { stage: 'maraqlanir' }, { stage: 'geldi' }];
  if (p === '/report') return { cash: { net: 842000 } };
  if (p === '/clients') return [{ id: 1, full_name: 'Nümunə Müştəri A', phone: '+994500000001' }];
  const m = p.match(/^\/inbox\/(\d+)$/);
  if (m) {
    const c = convs.find((x) => x.id === Number(m[1])) ?? convs[0];
    return { id: c.id, mode: c.mode, unread: 0, contact: { ...c.contact, bot_muted_until: null }, messages: [msg(1, 'in', 'Salam, sabah üçün yer var?', 30), msg(2, 'in', 'Saat 15:00 uyğun olar.', 25)],
      drafts: c.mode === 'wait' ? [{ id: 9, conversation_id: c.id, text: 'Salam! Sabah 15:00-da yer var. Depozit 50 AZN-dir.', status: 'pending', reason: null, model_output: { handoff: true }, created_at: iso(Date.now() - 20 * 60_000) }] : [],
      lead: null, window_expires_at: c.window_expires_at, window_open: true };
  }
  return method === 'GET' ? [] : {};
}

export function installMock() {
  localStorage.setItem('ypod.admin', 'mock-token');
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const i = url.indexOf('/api/');
    if (i < 0) return real(input, init);
    if (new URLSearchParams(location.search).has('fail')) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify(route(url.slice(i + 10), (init?.method ?? 'GET').toUpperCase())), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

// --- Cekilis ---
// Çəkilişlər ekranları üçün əlavə nümunələr (uydurma ad/rəqəm): Apple təqvimi, arxiv, bloklar, boş vaxtlar.
const ckShoots = [
  ...shoots,
  shoot(21, 'Nümunə Müştəri F', 24 + 11, 120, { source_note: 'calendar' }),
  shoot(22, 'Nümunə Müştəri G', -48 + 14, 90, { status: 'completed', closed_at: iso(Date.now() - 40 * H), production: 'editing', delivery_on: null }),
  shoot(23, 'Nümunə Müştəri H', -72 + 12, 90, { status: 'completed', closed_at: iso(Date.now() - 60 * H), production: 'ready', delivery_on: '2026-11-10', materials: [{ id: 1, title: 'Söhbət #1', drive_url: 'https://drive.google.com/x' }] }),
  shoot(24, 'Nümunə Müştəri I', -24 * 9 + 13, 120, { status: 'completed', source_note: 'calendar-archive', closed_at: iso(Date.now() - 24 * 9 * H) }),
  shoot(25, 'Nümunə Layihə Y Pod', 24 * 2 + 15, 90, { source_note: 'calendar' }),
];
function cekilisRoute(p: string): unknown {
  if (p === '/shoots') return ckShoots;
  if (p === '/blocks') return [{ id: 1, starts_at: iso(baku() + 18 * H), ends_at: iso(baku() + 20 * H), reason: 'Avadanlıq' }];
  if (p === '/free-slots') return [{ start: '08:00', end: '10:00' }, { start: '16:30', end: '22:00' }];
  const m = p.match(/^\/shoots\/(\d+)$/);
  if (m) return ckShoots.find((x) => x.id === Number(m[1])) ?? ckShoots[1];
  if (/^\/clients\/\d+$/.test(p)) return { id: 1, full_name: 'Nümunə Müştəri A', phone: '+994500000001', notes: null, deposit_required: false, cashback_balance: 0, cashback_rows: [], packages: [], shoots: [] };
  if (p.endsWith('/quote')) return { base: 12000, editing: 3000, reels: 0, extra_camera: 0, extras: 0, gross: 15000, discount: 0, total: 15000, deposit_expected: 5000, conflicts: [], cashback_earn: 0, cashback_kind: 'none', first_shoot_bonus: false, cashback_balance: 0, cashback_usable: 0, cashback_min_use: 0, cashback_shoots_left: 0, deposit_required: false };
  return undefined;
}
