// API cavablarının tipləri (server/routes/admin*.py). Məbləğlər tam qəpikdir.
export type Client = { id: number; full_name: string; phone: string; activated: boolean };
export type ClientRow = Client & { cashback_balance: number; package: { title: string; minutes_left: number } | null; last_shoot_at: string | null };
export type Block = { id: number; starts_at: string; ends_at: string; reason: string | null };
export type InviteOut = { url: string; whatsapp_url: string | null };

export type ShootStatus = 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export type Kind = 'shoot' | 'reels_pack';
export type Tag = 'podcast' | 'reels' | 'other';
export type Location = 'studio' | 'onsite';
export type Production = 'none' | 'editing' | 'ready';

export type Material = { id: number; title: string; drive_url: string };

export type Shoot = {
  id: number; client_id: number; client_name: string | null; package_id: number | null;
  starts_at: string; duration_min: number; kind: Kind; tag: Tag; location: Location; address: string | null;
  cameras: number; editing: boolean; reels_count: number; title: string | null; status: ShootStatus;
  production: Production; delivery_on: string | null;
  price_base: number; price_editing: number; price_reels: number; price_extra_camera: number; total: number;
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

export type LedgerRow = { id: number; kind: 'earn' | 'earn_first' | 'spend' | 'spend_return' | 'manual'; amount: number; note: string; shoot_id: number | null; created_at: string };
export type ClientDetail = Client & {
  notes: string | null; deposit_required: boolean; cashback_balance: number;
  cashback_rows: LedgerRow[]; packages: Package[]; shoots: Shoot[];
};

export type Dashboard = { deposit_pending: Shoot[]; today: Shoot[]; unclosed_count: number; awaiting_material_count: number };

export type Quote = {
  base: number; editing: number; reels: number; extra_camera: number; total: number; deposit_expected: number;
  cashback_earn: number; cashback_kind: string; first_shoot_bonus: boolean; cashback_balance: number; deposit_required: boolean;
};
