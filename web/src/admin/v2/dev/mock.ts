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
