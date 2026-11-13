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
  const ins = insanlarMock(path, p, method); // Insanlar blokuna bax (faylın sonu)
  if (ins !== undefined) return ins;
  if (p === '/dashboard') return { deposit_pending: [shoots[2], shoots[4]], today: [shoots[1], shoots[2], shoots[3]], unclosed_count: 1, awaiting_material_count: 0, app_usage: { clients: 30, joined: 20, home_screen: 10, push_on: 8, active_7d: 6 } };
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

// --- Insanlar ---
// /leads, /clients, /clients/:id, /tags, /people, /report üçün nümunə (uydurma ad və nömrə). Bu endpoint-lər üçün yuxarıdakı sadə cavabları əvəz edir.
const iDay = (n: number) => iso(Date.now() + n * 24 * H);
function iLead(id: number, name: string, stage: string, over: Record<string, unknown> = {}) {
  return { id, contact_id: id, conversation_id: id <= 3 ? id : null, name, phone: `99450000${String(1000 + id)}`, service: 'podkast', preferred_date: null, people: null, cameras: null, editing: null,
    source: 'whatsapp', stage, notes: '', shoot_id: null, created_at: iDay(-id), updated_at: iso(Date.now() - id * 55 * 60_000), lost_reason: null, lost_text: null, remind_at: null, remind_note: null, ...over };
}
const iLeads = [
  iLead(1, 'Nümunə Müştəri A', 'yeni', { service: 'reels', preferred_date: 'bu həftə' }),
  iLead(2, 'Nümunə Müştəri B', 'yeni'),
  iLead(3, 'Nümunə Müştəri C', 'maraqlanir', { remind_at: iDay(-1), remind_note: 'sabah yazacam dedi', service: 'korporativ' }),
  iLead(4, 'Nümunə Müştəri D', 'maraqlanir', { remind_at: iDay(3), remind_note: 'studiyada ödəyəcəm' }),
  iLead(5, 'Nümunə Müştəri E', 'tarix', { preferred_date: '17.11, 11:00', cameras: 2 }),
  iLead(6, 'Nümunə Müştəri F', 'beh', { preferred_date: '14.11, 11:30', cameras: 3, editing: true }),
  iLead(7, 'Nümunə Müştəri G', 'itirildi', { lost_reason: 'qiymet' }),
  iLead(8, 'Nümunə Müştəri H', 'itirildi', { lost_reason: 'diger', lost_text: 'layihə təxirə düşdü' }),
  iLead(9, 'Nümunə Müştəri I', 'tesdiq', { updated_at: iso(Date.now() - 5 * H), shoot_id: 2 }),
  iLead(10, 'Nümunə Müştəri J', 'geldi', { updated_at: iso(Date.now() - 30 * H) }),
];
const iClients = [
  { id: 1, full_name: 'Nümunə Müştəri A', phone: '994500000001', activated: true, app_seen_at: iDay(-2), app_standalone: true, push_permission: 'granted', cashback_balance: 9600, package: null, last_shoot_at: iDay(-1), tags: [{ id: 1, name: 'Podkast' }], profession: 'Psixoloq' },
  { id: 2, full_name: 'Nümunə Müştəri B', phone: '994500000002', activated: false, app_seen_at: null, app_standalone: false, push_permission: null, cashback_balance: 2800, package: { title: '5 saat', minutes_left: 210, minutes_total: 300 }, last_shoot_at: iDay(-8), tags: [] },
  { id: 3, full_name: 'Nümunə Müştəri C', phone: '994500000003', activated: true, app_seen_at: iDay(-9), app_standalone: false, push_permission: 'default', cashback_balance: 0, package: null, last_shoot_at: null, tags: [{ id: 2, name: 'Reels' }] },
  { id: 4, full_name: 'Nümunə Müştəri D', phone: '994500000004', activated: false, app_seen_at: null, app_standalone: false, push_permission: null, cashback_balance: 6800, package: null, last_shoot_at: iDay(-30), tags: [] },
];
const iShoot = (id: number, ago: number, status: string) => ({ ...shoot(id, 'Nümunə Müştəri A', -24 * ago + 14, 90, { status }), payment_line: 'Ödənilib · 120 AZN' });
const iCbRows = [
  { id: 5, kind: 'referral', amount: 2000, note: 'Dost dəvəti', shoot_id: null, created_at: iDay(-6) }, { id: 4, kind: 'earn', amount: 1200, note: '', shoot_id: 12, created_at: iDay(-10) },
  { id: 3, kind: 'earn', amount: 1800, note: '', shoot_id: 11, created_at: iDay(-30) }, { id: 2, kind: 'manual', amount: 2800, note: 'Başlanğıc keşbek', shoot_id: null, created_at: iDay(-60) },
];
function insanlarMock(path: string, p: string, method: string): unknown {
  if (method !== 'GET') return p.startsWith('/leads/') ? iLeads[0] : p === '/clients' ? iClients[0] : undefined;
  if (p === '/leads') return iLeads;
  if (p === '/clients') return iClients;
  if (p === '/tags') return [{ id: 1, name: 'Podkast', count: 1 }, { id: 2, name: 'Reels', count: 1 }];
  const m = p.match(/^\/clients\/(\d+)$/);
  if (m) {
    const c = iClients.find((x) => x.id === Number(m[1])) ?? iClients[0];
    return { ...c, notes: 'Səhər çəkilişi sevir.', deposit_required: false, profile_complete: true, workplace: 'Nümunə Klinika', instagram: 'numune.a', niche: 'Psixologiya', birthday: '1992-05-14', source: 'referral', marketing_opt_in: true,
      referral_code: 'NUMUNE4', referred_by: { id: 3, full_name: 'Nümunə Müştəri C' }, cashback_rows: iCbRows, packages: c.package ? [{ id: 1, title: c.package.title, owner_client_id: c.id, owner_name: c.full_name, minutes_total: 300, minutes_left: 210, cameras: 2, starts_on: '2026-10-01', ends_on: '2027-02-01', price_paid: 40000, members: [] }] : [],
      shoots: [iShoot(21, 0, 'confirmed'), iShoot(22, 8, 'completed'), iShoot(23, 30, 'completed'), iShoot(24, 60, 'completed')] };
  }
  if (p === '/people') {
    const items = [{ id: 1, display_name: 'Nümunə Müştəri K', phone: '994500000011', ig_username: 'numune.k', client_id: null, profession: 'Dizayner', workplace: '', reason: 'podkast', service: 'Podkast', need: '', phones_found: [], summary: 'Qiymət soruşub.', outcome: 'lead', sources: ['wa', 'ig'], msg_count: 12, first_contact_at: iDay(-9), last_contact_at: iDay(-1), card_at: null, wa_link: 'https://wa.me/994500000011', ig_link: null },
      { id: 2, display_name: 'Nümunə Müştəri A', phone: '994500000001', ig_username: null, client_id: 1, profession: 'Psixoloq', workplace: '', reason: '', service: 'Reels', need: '', phones_found: [], summary: '', outcome: 'client', sources: ['wa'], msg_count: 40, first_contact_at: iDay(-80), last_contact_at: iDay(-2), card_at: null, wa_link: null, ig_link: null }];
    return { items, total: items.length };
  }
  if (p === '/report') {
    const prevMonth = new URLSearchParams(path.split('?')[1] ?? '').get('month') !== baku_month();
    const k = prevMonth ? 1.1 : 1;
    return { month: new URLSearchParams(path.split('?')[1] ?? '').get('month'), cash: { deposits: Math.round(120000 * k), at_studio: Math.round(310000 * k), packages: 56000, refunds: 5000, net: Math.round(481000 * k) },
      shoots: { completed: 31, cancelled: 2, no_show: 1, upcoming: 6, minutes: 3720, revenue: 486000, discounts: 12000, retained: 5000, by_kind: { shoot: { count: 20, minutes: 2400, total: 320000 }, reels_pack: { count: 8, minutes: 960, total: 110000 }, studio_rent: { count: 3, minutes: 360, total: 56000 } } },
      packages_sold: 2, cashback: { earned: 38000, manual: 2800, bonuses: 4000, spent: 9000, liability: 210000 },
      growth: { new_clients: 9, by_source: { instagram: 5, referral: 3, unknown: 1 }, referrals: 3, repeat_rate: 38, avg_check: 15700, avg_client_value: 31000, bonuses: { profile_bonus: 1000, referral: 3000, birthday: 0 }, campaigns: { count: 2, recipients: 60, opened: 41, booked_14d: 4 } } };
  }
  return undefined;
}
const baku_month = () => new Date(Date.now() + 4 * H).toISOString().slice(0, 7);
