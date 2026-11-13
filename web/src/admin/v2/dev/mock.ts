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
