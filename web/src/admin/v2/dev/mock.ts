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
  const t = tenzimlemeRoute(path, method);
  if (t !== undefined) return t;
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

// --- Inbox ---
// Inbox ekranının saxta məlumatı: `/inbox`, `/inbox/{id}`, `/quick-replies`. window.fetch-i dəyişdirən installMock-dan əvvəl/sonra işləsin deyə
// fetch üstündən sarğı qoyulur (yuxarıdakı route() dəyişdirilmir). Yalnız uydurma ad və nömrə.
const ibMin = (m: number) => iso(Date.now() - m * 60_000);
type IbMsg = ReturnType<typeof msg>;
const ibM = (id: number, dir: 'in' | 'out', text: string, agoMin: number, source = 'customer', type = 'text'): IbMsg => ({ ...msg(id, dir, text, agoMin, source), type });
const ibConv = (id: number, name: string | null, phone: string, mode: string, last: IbMsg, drafts: number, stage: string | null, unread = 0, excluded = false) => ({
  id, contact: { id, name, phone, excluded }, last_message: last, unread, mode, pending_drafts: drafts, lead_stage: stage,
  last_message_at: last.created_at, window_expires_at: iso(Date.now() + 18 * H),
});
const ibThreads: Record<number, { conv: ReturnType<typeof ibConv>; messages: IbMsg[]; draft?: string; reason?: string; lead?: Record<string, unknown> | null }> = {};
function ibAdd(conv: ReturnType<typeof ibConv>, messages: IbMsg[], draft?: string, reason?: string, lead: Record<string, unknown> | null = null) { ibThreads[conv.id] = { conv, messages, draft, reason, lead }; }
const ibLead = (stage: string, extra: Record<string, unknown> = {}) => ({ id: 1, contact_id: 1, conversation_id: 1, name: '', phone: '', service: 'podkast', preferred_date: 'şənbə günü', people: 2, cameras: 2, editing: false, source: 'reklam', stage, notes: '', shoot_id: null, lost_reason: null, lost_text: null, remind_at: null, remind_note: null, created_at: ibMin(600), updated_at: ibMin(30), ...extra });

{
  const a = [ibM(101, 'in', 'Salam, podkast çəkilişi neçəyədir?', 52), ibM(102, 'out', 'Salam! Studiyada 1 saat: 1 kamera 70, 2 kamera 120, 3 kamera 170 AZN. Neçə nəfərsiniz?', 51, 'bot'),
    ibM(103, 'in', '', 48, 'customer', 'audio'), ibM(104, 'out', '2 nəfər üçün 2 kamera ilə 1 saat 120 AZN. Sabah 12:00, 15:00 və 17:00 boşdur. Hansı uyğundur?', 47, 'bot'),
    ibM(105, 'in', 'Sabah saat 3-ə yer var? 2 nəfərik.', 34), ibM(106, 'out', 'Bunu komandamıza ötürürəm, tezliklə sizə yazacaqlar.', 33, 'bot')];
  ibAdd(ibConv(1, 'Nümunə Müştəri A', '994500000001', 'wait', a[a.length - 2], 1, 'tarix', 1), a, 'Salam! Sabah 15:00 boşdur. 2 nəfər üçün 2 kamera ilə 1 saat 120 AZN. Yer saxlayım?', 'Müştəri saat seçdi, təsdiqləyin', ibLead('tarix'));
  const b = [ibM(111, 'in', 'Videonu nə vaxt alacam?', 180)];
  ibAdd(ibConv(2, 'Nümunə Müştəri B', '994500000002', 'wait', b[0], 1, 'geldi', 1), b, 'Salam! Montaj 3 iş günü ərzində hazır olur, link göndərəcəyik.', 'Montaj müddəti sualı', ibLead('geldi', { shoot_id: 5 }));
  const c = [ibM(121, 'in', '5 video çəksək 20% endirim edərsiniz?', 95)];
  ibAdd(ibConv(3, 'Nümunə Müştəri C', '994500000003', 'owner', c[0], 1, 'maraqlanir'), c, 'Salam! 5 video üçün 10% endirim edirik. Müddət 2 saat olacaq.', undefined, ibLead('maraqlanir', { service: 'reels', cameras: null }));
  const d = [ibM(131, 'in', 'Salam, gələn həftə Bakıdasan?', 40)];
  ibAdd(ibConv(4, null, '447700900123', 'human', d[0], 0, null), d);
  const bots = ['Nümunə Müştəri D', 'Nümunə Müştəri E', 'Nümunə Müştəri F', 'Nümunə Müştəri G', 'Nümunə Müştəri H', 'Nümunə Müştəri I'];
  bots.forEach((n, i) => {
    const m1 = ibM(140 + i * 3, 'in', 'Şənbə günü boş vaxtınız olur?', 14 + i * 40);
    const m2 = ibM(141 + i * 3, 'out', 'Şənbə 10:00, 12:30 və 16:00 boşdur. Saatı seçsəniz, komandamız təsdiqləyər.', 13 + i * 40, 'bot');
    ibAdd(ibConv(10 + i, n, `99450000001${i}`, 'bot', i % 2 ? m1 : m2, 0, 'maraqlanir', i === 1 ? 1 : 0), [m1, m2], undefined, undefined, ibLead('maraqlanir', { source: 'whatsapp' }));
  });
  const o = [ibM(201, 'out', 'Tarixi təsdiqləyin, zəhmət olmasa.', 1500, 'panel')];
  ibAdd(ibConv(20, 'Nümunə Müştəri J', '994500000020', 'owner', o[0], 0, 'tarix'), o, undefined, undefined, ibLead('tarix'));
  const o2 = [ibM(211, 'out', 'Qiymət təklifini göndərdim.', 2900, 'panel')];
  ibAdd(ibConv(21, 'Nümunə Müştəri K', '994500000021', 'human', o2[0], 0, 'beh', 0, true), o2, undefined, undefined, ibLead('beh'));
}

const ibRealFetch = window.fetch.bind(window);
let ibNext: typeof fetch = ibRealFetch;
const ibJson = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
const ibWrapped: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const i = url.indexOf('/api/admin');
  if (i < 0) return ibRealFetch(input, init);
  const p = url.slice(i + 10).split('?')[0];
  const method = (init?.method ?? 'GET').toUpperCase();
  const q = new URLSearchParams(location.search);
  if (q.has('fail')) return new Response('{}', { status: 500 });
  if (p === '/inbox' && method === 'GET') return q.has('empty') ? ibJson([]) : ibJson(Object.values(ibThreads).map((t) => t.conv));
  if (p === '/quick-replies') return ibJson([{ id: 1, title: 'Qiymətlər', text: 'Studiyada 1 saat: 1 kamera 70, 2 kamera 120, 3 kamera 170 AZN.' }, { id: 2, title: 'Ünvan', text: 'Ünvanımız: Nümunə küç. 1, Bakı.' }]);
  const m = p.match(/^\/inbox\/(\d+)$/);
  if (m && method === 'GET') {
    const t = ibThreads[Number(m[1])];
    if (!t) return new Response('{"detail":"Söhbət tapılmadı"}', { status: 404 });
    const c = t.conv;
    return ibJson({ id: c.id, mode: c.mode, unread: 0, contact: { ...c.contact, bot_muted_until: null }, messages: t.messages,
      drafts: t.draft ? [{ id: 900 + c.id, conversation_id: c.id, text: t.draft, status: 'pending', reason: null, model_output: { handoff: !!t.reason, handoff_reason: t.reason ?? null }, created_at: ibMin(20) }] : [],
      lead: t.lead ? { ...t.lead, contact_id: c.contact.id, conversation_id: c.id } : null, window_expires_at: c.window_expires_at, window_open: !q.has('closed') });
  }
  return ibNext(input, init);
};
Object.defineProperty(window, 'fetch', { configurable: true, get: () => ibWrapped, set: (f: typeof fetch) => { ibNext = f; } });

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

// --- Tenzimleme ---
function tenzimlemeRoute(path: string, method: string): unknown {
  const p = path.split('?')[0];
  const day = (n: number, h = 20) => iso(baku() + (n * 24 + h) * H);
  const cl = (id: number, name: string, over: Record<string, unknown> = {}) => ({ id, full_name: name, phone: `99450000${String(1000 + id)}`, activated: true, app_seen_at: null, app_standalone: false, push_permission: 'granted', cashback_balance: 1500, package: null, last_shoot_at: null, ...over });
  const camp = (id: number, title: string, rec: number, op: number, bk: number, ago: number) => ({ id, kind: 'manual', title, body: '{name}, yeni təklifimiz var.', url: null, filters: { has_package: false }, recipients: rec, push_on: rec - 3, created_at: iso(Date.now() - ago * 24 * H), created_by: 'Admin', opened: op, booked_14d: bk });
  const camps = [camp(1, 'Noyabr təklifi', 42, 25, 4, 3), camp(2, 'Reels endirimi', 30, 12, 2, 12)];
  if (p === '/whoami') return { name: 'Nümunə Admin' };
  if (p === '/bot/settings') return { bot_enabled: true, bot_mode: 'draft', kapso_month_count: 640, kapso_month_limit: 1000 };
  if (p === '/packages/quote') {
    const q = new URLSearchParams(path.split('?')[1] ?? ''); const h = Number(q.get('hours') || 5); const c = Number(q.get('cameras') || 1);
    return { price: Math.round(h * 5000 * (1 - h / 50) * (1 + (c - 1) * 0.3)), months: h <= 5 ? 3 : h <= 10 ? 4 : h <= 15 ? 6 : 8 };
  }
  if (p === '/packages' && method === 'GET') {
    const pk = (id: number, owner: string, total: number, left: number, endsIn: number) => ({ id, title: `${total / 60} saatlıq paket`, owner_client_id: id, owner_name: owner, minutes_total: total, minutes_left: left, cameras: 2, starts_on: day(-60).slice(0, 10), ends_on: day(endsIn).slice(0, 10), price_paid: 45000, members: [] });
    return [pk(1, 'Nümunə Müştəri A', 600, 90, 9), pk(2, 'Nümunə Müştəri B', 1200, 800, 90), pk(3, 'Nümunə Müştəri C', 300, 240, 40), pk(4, 'Nümunə Müştəri D', 300, 0, -10)];
  }
  if (p === '/clients') return [cl(1, 'Nümunə Müştəri A'), cl(2, 'Nümunə Müştəri B'), cl(3, 'Nümunə Müştəri C')];
  if (p === '/campaigns' && method === 'GET') return camps;
  const cm = p.match(/^\/campaigns\/(\d+)$/);
  if (cm) return { ...camps[0], list: [1, 2, 3].map((i) => ({ id: i, full_name: `Nümunə Müştəri ${'ABC'[i - 1]}`, opened_at: i < 3 ? iso(Date.now() - i * H) : null })) };
  if (p === '/segments/preview') return { count: 38, push_on: 31, opted_out: 4, recently_messaged: 2, sample: [{ id: 1, full_name: 'Nümunə Müştəri A' }] };
  if (p === '/tags') return [{ id: 1, name: 'Podcast', count: 12 }, { id: 2, name: 'Psixoloq', count: 5 }];
  if (p === '/free-slots') return [{ start: '10:00', end: '12:00' }, { start: '15:00', end: '17:00' }];
  if (p === '/automations') return { send_hour: 11, studio_hours: [10, 22], winback: { enabled: true, days: 60, title: 'Sizi görmək istəyirik', body: '{name}, çoxdandır gəlmirsiniz.' }, cashback: { enabled: true, min: 1000, title: 'Keşbekiniz var', body: '{name}, {balance} keşbekiniz gözləyir.' }, birthday: { enabled: false, gift: 1000, title: 'Ad gününüz mübarək', body: '{name}, {gift} hədiyyə.' }, review: { enabled: true, url: 'https://g.page/nümunə', title: 'Rəyiniz vacibdir', body: '{name}, rəy yazın.' } };
  if (p === '/social/status') return { queue_enabled: true, channels: [{ id: 'a', service: 'instagram', name: 'nümunə', queue_paused: false }, { id: 'b', service: 'tiktok', name: 'nümunə', queue_paused: false }], requests_today: 6, request_cap: 80, next_posts: [], recent_errors: [] };
  if (p === '/social/posts') {
    const post = (id: number, mid: number, plat: string, d: number, status: string) => ({ id, platform: plat, scheduled_at: day(d), text: 'Nümunə mətn', title: plat === 'youtube' ? 'Nümunə başlıq' : null, status, external_id: null, error: status === 'error' ? 'Nümunə xəta' : null, attempts: 0, media: { id: mid, number: mid, day: d, slot: 'axsam', title: `Nümunə video ${mid}`, file_name: `v${mid}.mp4`, public_url: null } });
    return [post(1, 1, 'instagram', -1, 'published'), post(2, 1, 'tiktok', -1, 'published'), post(3, 2, 'instagram', 0, 'queued'), post(4, 2, 'youtube', 0, 'planned'), post(5, 3, 'instagram', 1, 'planned'), post(6, 3, 'tiktok', 1, 'error')];
  }
  if (p === '/faqs') return [{ id: 1, question: 'Qiymət nə qədərdir?', answer: 'Podcast üçün saatı 60 AZN.', active: true }, { id: 2, question: 'Ünvan haradadır?', answer: 'Nümunə küçə 1.', active: false }];
  if (p === '/quick-replies') return [{ id: 1, title: 'Kart nömrəsi', text: 'Kart: 0000 0000 0000 0000' }];
  if (p === '/unanswered') return [{ id: 1, conversation_id: 1, question: 'Parkinq var?', created_at: iso(Date.now() - 5 * H) }];
  if (p === '/bot/test' && method === 'POST') return { reply: 'Salam! Podcast üçün saatı 60 AZN-dir.', language: 'az', handoff: false, handoff_reason: null, filtered: null, lead: {} };
  return undefined;
}
