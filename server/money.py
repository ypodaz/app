"""Pul qaydaları: qiymət, beh, ödəniş vəziyyəti, keşbek, ləğv.

Bütün məbləğlər qəpiklə tam ədəddir (75,50 AZN = 7550). Funksiyalar bazaya toxunmur,
route-lar nəticəni yazır. Qaydalar texniki planın «Pul qaydaları» bölməsindən gəlir.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

AZN = 100

# Saatlıq çəkiliş qiyməti, kamera sayına görə.
SHOOT_PER_HOUR = {
    "studio": {1: 70 * AZN, 2: 120 * AZN, 3: 170 * AZN},
    "onsite": {1: 140 * AZN, 2: 240 * AZN, 3: 340 * AZN},
}
REELS_PACK = {"studio": 150 * AZN, "onsite": 250 * AZN}
STUDIO_RENT_PER_HOUR = 50 * AZN  # yalnız studiya (videoqraflar üçün), kamera/montaj yoxdur
EDITING = 100 * AZN
REEL = 10 * AZN
EXTRA_CAMERA_PER_HOUR = 50 * AZN

# Korporativ paketlər: saat → (ay, {kamera: qiymət}). Yalnız studiyada keçərlidir.
PACKAGES = {
    5: (2, {1: 315 * AZN, 2: 540 * AZN, 3: 765 * AZN}),
    10: (4, {1: 560 * AZN, 2: 960 * AZN, 3: 1360 * AZN}),
    15: (8, {1: 735 * AZN, 2: 1260 * AZN, 3: 1785 * AZN}),
    20: (12, {1: 840 * AZN, 2: 1440 * AZN, 3: 2040 * AZN}),
}

CASHBACK_PERCENT = 10
FIRST_SHOOT_PERCENT = 50


def percent(amount: int, pct: int) -> int:
    """Faiz, qəpiyə yarısı yuxarı yuvarlanır."""
    return (amount * pct + 50) // 100


def fmt(amount: int) -> str:
    """7550 → «75,50 AZN», 7000 → «70 AZN». Qəpik yalnız sıfır deyilsə görünür."""
    sign = "−" if amount < 0 else ""
    manat, qepik = divmod(abs(amount), AZN)
    return f"{sign}{manat},{qepik:02d} AZN" if qepik else f"{sign}{manat} AZN"


def fmt_hours(minutes: int) -> str:
    """120 → «2 saat», 90 → «1,5 saat». Müddət yarım saat addımladır."""
    h, m = divmod(minutes, 60)
    return f"{h},5 saat" if m else f"{h} saat"


@dataclass(frozen=True)
class Price:
    base: int
    editing: int
    reels: int
    extra_camera: int
    discount: int = 0

    @property
    def gross(self) -> int:
        return self.base + self.editing + self.reels + self.extra_camera

    @property
    def total(self) -> int:
        """Endirimdən sonrakı məbləğ: beh və keşbek bundan hesablanır."""
        return self.gross - self.discount

    @property
    def paid_extras(self) -> int:
        """Paketdən çəkilişdə pulla ödənən hissə."""
        return self.editing + self.reels + self.extra_camera


def price(
    *,
    kind: str,
    location: str,
    cameras: int,
    duration_min: int,
    editing: bool,
    reels_count: int = 0,
    package_cameras: int | None = None,
    discount: int = 0,
) -> Price:
    """Çəkilişin qiyməti. package_cameras verilirsə, çəkiliş paketdəndir: saatlar paketdən
    çıxılır, yalnız montaj, Reels və əlavə kamera pulla ödənir. discount məbləğdən çıxılır."""
    p = _gross_price(kind=kind, location=location, cameras=cameras, duration_min=duration_min, editing=editing,
                     reels_count=reels_count, package_cameras=package_cameras)
    if discount < 0 or discount > p.gross:
        raise ValueError(f"Endirim 0 ilə {fmt(p.gross)} arasında olmalıdır")
    return Price(p.base, p.editing, p.reels, p.extra_camera, discount)


def _gross_price(*, kind, location, cameras, duration_min, editing, reels_count, package_cameras) -> Price:
    if location not in SHOOT_PER_HOUR:
        raise ValueError("Yer studio və ya onsite olmalıdır")
    if kind == "reels_pack":
        if package_cameras is not None:
            raise ValueError("Reels Paketi saat paketindən seçilmir")
        if duration_min <= 0 or duration_min % 15:
            raise ValueError("Müddət 15 dəqiqə addımla olmalıdır")
        return Price(REELS_PACK[location], 0, 0, 0)
    if kind == "studio_rent":
        if package_cameras is not None:
            raise ValueError("Studiya icarəsi saat paketindən seçilmir")
        if location != "studio":
            raise ValueError("Studiya icarəsi yalnız studiyada olur")
        if duration_min <= 0 or duration_min % 30:
            raise ValueError("Müddət yarım saat addımla olmalıdır")
        if editing or reels_count:
            raise ValueError("Studiya icarəsinə montaj və Reels daxil deyil")
        return Price(STUDIO_RENT_PER_HOUR * duration_min // 60, 0, 0, 0)
    if kind != "shoot":
        raise ValueError("Naməlum xidmət növü")
    if cameras not in SHOOT_PER_HOUR[location]:
        raise ValueError("Kamera sayı 1, 2 və ya 3 olmalıdır")
    if duration_min <= 0 or duration_min % 30:
        raise ValueError("Müddət yarım saat addımla olmalıdır")
    if reels_count < 0:
        raise ValueError("Reels sayı mənfi ola bilməz")
    if reels_count and not editing:
        raise ValueError("Podcastdan Reels montaj olmadan seçilmir")

    editing_price = EDITING if editing else 0
    reels_price = reels_count * REEL
    if package_cameras is not None:
        if location != "studio":
            raise ValueError("Paket saatları yalnız studiyada keçərlidir")
        extra = max(0, cameras - package_cameras) * EXTRA_CAMERA_PER_HOUR * duration_min // 60
        return Price(0, editing_price, reels_price, extra)
    base = SHOOT_PER_HOUR[location][cameras] * duration_min // 60
    return Price(base, editing_price, reels_price, 0)


def check_cashback_use(amount: int, balance: int, total: int) -> None:
    if amount < 0:
        raise ValueError("Keşbek məbləği mənfi ola bilməz")
    if amount > balance:
        raise ValueError(f"Keşbek balansı kifayət etmir: {fmt(balance)}")
    if amount > total:
        raise ValueError("Keşbek çəkilişin məbləğindən çox ola bilməz")


def to_pay(total: int, cashback_used: int) -> int:
    """Pulla ödəniləcək məbləğ."""
    return total - cashback_used


def deposit_expected(total: int, cashback_used: int, from_package: bool) -> int:
    """Beh ödəniləcək məbləğin 50%-idir. Paketdən çəkilişdə beh yoxdur."""
    if from_package:
        return 0
    return percent(to_pay(total, cashback_used), 50)


def studio_balance(total: int, cashback_used: int, deposit_amount: int) -> int:
    """Studiyada ödəniləcək qalıq."""
    return max(0, to_pay(total, cashback_used) - deposit_amount)


def payment_status(
    *,
    total: int,
    cashback_used: int,
    deposit_amount: int,
    deposit_received: bool,
    deposit_waived: bool,
    paid_at_studio: int = 0,
    package_minutes: int | None = None,
    extra_camera: int = 0,
) -> str:
    """Müştəriyə görünən ödəniş sətri. package_minutes verilirsə, çəkiliş paketdəndir
    və total yalnız pullu əlavələrdir."""
    due = to_pay(total, cashback_used)
    paid = (deposit_amount if deposit_received else 0) + paid_at_studio
    if package_minutes is not None:
        line = f"Paketdən {fmt_hours(package_minutes)}"
        if due > paid:
            label = "əlavə kamera" if total == extra_camera else "əlavələr"
            line += f" · {label} {fmt(due - paid)} studiyada"
        return line
    if paid >= due:
        return "Tam ödənib"
    rest = due - paid
    if deposit_received and deposit_amount:
        return f"Beh ödənib · {fmt(deposit_amount)} · qalıq studiyada {fmt(rest)}"
    if deposit_waived:
        return f"Beh 0 AZN · ödəniş studiyada {fmt(rest)}"
    return f"Beh gözlənilir · {fmt(deposit_expected(total, cashback_used, False))}"


def cashback_earned(p: Price, *, from_package: bool, first_shoot: bool) -> tuple[str, int]:
    """Çəkiliş bağlananda yazılan keşbek: (ledger kind, məbləğ).
    Keşbeklə ödənən hissə çıxılmır, endirim çıxılır. Paketdən çəkilişdə yalnız pullu əlavələrə yazılır."""
    base = max(0, p.paid_extras - p.discount) if from_package else p.total
    if first_shoot:
        return "earn_first", percent(base, FIRST_SHOOT_PERCENT)
    return "earn", percent(base, CASHBACK_PERCENT)


@dataclass(frozen=True)
class Cancellation:
    window: str  # gt24 / lt24 / no_show
    retained: int  # tutulan beh
    refund: int  # müştəriyə qaytarılacaq pul
    cashback_return: int  # balansa qayıdan keşbek


def cancel_window(starts_at: datetime, requested_at: datetime) -> str:
    """24 saat və ya daha çox qalıbsa gt24, az qalıbsa lt24."""
    return "gt24" if starts_at - requested_at >= timedelta(hours=24) else "lt24"


def cancellation(*, window: str, deposit_paid: int, cashback_used: int) -> Cancellation:
    """Ləğv və «Gəlmədi» hesabı. Cərimə yalnız ödənilmiş behdən tutulur,
    istifadə olunmuş keşbek hər halda balansa qayıdır."""
    if window == "gt24":
        return Cancellation(window, 0, deposit_paid, cashback_used)
    if window in ("lt24", "no_show"):
        return Cancellation(window, deposit_paid, 0, cashback_used)
    raise ValueError("Naməlum ləğv növü")
