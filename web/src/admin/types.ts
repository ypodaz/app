// API cavablarının tipləri (server/routes/admin*.py). Məbləğlər tam qəpikdir.
export type PushPerm = 'default' | 'granted' | 'denied' | 'unsupported' | null;
export type Source = 'instagram' | 'tiktok' | 'google' | 'youtube' | 'referral' | 'other';
export type ClientTag = { id: number; name: string };
export type TagRow = ClientTag & { count: number };
export type ClientProfile = {
  profession: string | null; workplace: string | null; instagram: string | null; niche: string | null; birthday: string | null;
  source: Source | null; marketing_opt_in: boolean; profile_complete: boolean;
  referral_code: string | null; referred_by_id: number | null; referred_by: { id: number; full_name: string } | null; tags: ClientTag[];
};
export type Client = { id: number; full_name: string; phone: string; notes?: string | null; activated: boolean; app_seen_at: string | null; app_standalone: boolean; push_permission: PushPerm } & Partial<ClientProfile>;
export type ClientRow = Client & { cashback_balance: number; package: { title: string; minutes_left: number } | null; last_shoot_at: string | null };
export type Block = { id: number; starts_at: string; ends_at: string; reason: string | null };
export type InviteOut = { url: string; whatsapp_url: string | null };

export type ShootStatus = 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export type Kind = 'shoot' | 'reels_pack' | 'studio_rent';
export type Tag = 'podcast' | 'reels' | 'other';
export type Location = 'studio' | 'onsite';
export type Production = 'none' | 'editing' | 'ready';

export type Material = { id: number; title: string; drive_url: string };

export type Extra = { name: string; amount: number };

export type Shoot = {
  id: number; client_id: number; client_name: string | null; package_id: number | null;
  starts_at: string; duration_min: number; kind: Kind; tag: Tag; location: Location; address: string | null;
  cameras: number; editing: boolean; reels_count: number; title: string | null; status: ShootStatus;
  production: Production; delivery_on: string | null;
  price_base: number; price_editing: number; price_reels: number; price_extra_camera: number; discount: number; discount_note: string | null; extras: Extra[]; prep_min: number; wrap_min: number; total: number;
  note: string | null; source_note: string | null; cashback_used: number;
  deposit_expected: number; deposit_amount: number; deposit_received_at: string | null; deposit_waived: boolean;
  paid_at_studio: number; paid_method: 'cash' | 'card' | null; closed_at: string | null;
  cancel_requested_at: string | null; cancel_window: 'gt24' | 'lt24' | 'no_show' | null;
  retained_amount: number; refund_amount: number; refunded_at: string | null; rescheduled_lt24: boolean;
  payment_line: string; studio_balance: number; materials: Material[]; created_at: string;
};
export type CloseOut = Shoot & { cashback_earned: number };
export type CancelOut = Shoot & { refund: number; retained: number; cashback_return: number; window: 'gt24' | 'lt24' | 'no_show' };

export type Member = { client_id: number; full_name: string; role: 'owner' | 'member' };
export type Package = {
  id: number; title: string; owner_client_id: number; owner_name: string; minutes_total: number; minutes_left: number;
  cameras: number; starts_on: string; ends_on: string; price_paid: number; members: Member[];
};

export type LedgerRow = { id: number; kind: 'earn' | 'earn_first' | 'spend' | 'spend_return' | 'manual' | 'profile_bonus' | 'referral' | 'birthday'; amount: number; note: string; shoot_id: number | null; created_at: string };
export type ClientDetail = Client & {
  notes: string | null; deposit_required: boolean; cashback_balance: number;
  cashback_rows: LedgerRow[]; packages: Package[]; shoots: Shoot[];
};

export type AppUsage = { clients: number; joined: number; home_screen: number; push_on: number; active_7d: number };
export type Dashboard = { deposit_pending: Shoot[]; today: Shoot[]; unclosed_count: number; awaiting_material_count: number; app_usage: AppUsage };

export type Conflict =
  | { type: 'shoot'; id: number; client_id: number; starts_at: string; duration_min: number }
  | { type: 'block'; id: number; starts_at: string; ends_at: string; reason: string | null };

export type Quote = {
  base: number; editing: number; reels: number; extra_camera: number; extras: number; gross: number; discount: number; total: number; deposit_expected: number;
  conflicts: Conflict[];
  cashback_earn: number; cashback_kind: string; first_shoot_bonus: boolean; cashback_balance: number; deposit_required: boolean;
};

// Kampaniyalar və avtomatik bildirişlər
export type ServiceKey = 'podcast' | 'reels' | 'other' | 'reels_pack' | 'studio_rent';
export type Filters = {
  client_ids?: number[]; tag_ids?: number[]; professions?: string[]; services?: ServiceKey[]; sources?: string[];
  inactive_days?: number; has_package?: boolean; min_cashback?: number; birthday_month?: number;
  app_joined?: boolean; push_on?: boolean; preset?: 'package_candidates' | 'podcast_no_reels';
};
export type Preview = { count: number; push_on: number; opted_out: number; recently_messaged: number; sample: { id: number; full_name: string }[] };
export type CampaignKind = 'manual' | 'winback' | 'cashback' | 'birthday' | 'review';
export type Campaign = {
  id: number; kind: CampaignKind; title: string; body: string; url: string | null; filters: Filters;
  recipients: number; push_on: number; created_at: string; created_by: string | null; opened: number; booked_14d: number;
};
export type CampaignDetail = Campaign & { list: { id: number; full_name: string; opened_at: string | null }[] };
export type Slot = { start: string; end: string };
export type Automations = {
  send_hour: number; studio_hours: [number, number];
  winback: { enabled: boolean; days: number; title: string; body: string };
  cashback: { enabled: boolean; min: number; title: string; body: string };
  birthday: { enabled: boolean; gift: number; title: string; body: string };
  review: { enabled: boolean; url: string; title: string; body: string };
};
