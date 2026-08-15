import { WEAPONS, isHeavy, getWeapon, getWeaponBehavior, MAX_HEAVY, type Weapon } from "./weapons";

type Props = {
  credits: number;
  owned: string[];
  /** [heavy 1, heavy 2, sidearm] */
  slots: (string | null)[];
  activeSlot: number;
  secondsLeft: number;
  totalSeconds: number;
  onBuy: (w: Weapon) => void;
  onSelectSlot: (index: number) => void;
  onSellAll: () => void;
  onClose: () => void;
};

export default function WeaponShop({
  credits,
  owned,
  slots,
  activeSlot,
  secondsLeft,
  totalSeconds,
  onBuy,
  onSelectSlot,
  onSellAll,
  onClose,
}: Props) {

  const heavyCount = slots.slice(0, 2).filter(Boolean).length;
  const progress = Math.max(0, Math.min(1, secondsLeft / Math.max(1, totalSeconds)));

  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-4 backdrop-blur-md">
      <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--hud-accent)]/40 bg-[var(--hud-panel)] shadow-[var(--shadow-hud)]">
        {/* header */}
        <div className="relative flex items-center justify-between gap-4 border-b border-border/50 px-5 py-3">
          <div className="flex items-center gap-4">
            <div
              className="relative grid h-14 w-14 place-items-center rounded-full"
              style={{
                background: `conic-gradient(var(--hud-accent) ${progress * 360}deg, color-mix(in oklab, var(--foreground) 12%, transparent) 0deg)`,
              }}
            >
              <div className="grid h-11 w-11 place-items-center rounded-full bg-[var(--hud-panel)]">
                <span className="text-base font-bold tabular-nums text-foreground">{secondsLeft}</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.35em] text-[var(--hud-accent)]">Buy phase</p>
              <h2 className="text-lg font-bold uppercase tracking-tight text-foreground">Armory</h2>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                2 heavy weapons · 1 sidearm
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-[var(--hud-accent)]/50 bg-[var(--hud-panel-dim)] px-4 py-1.5 text-sm font-bold tabular-nums text-[var(--hud-accent)]">
              $ {credits}
            </span>
            <button
              onClick={onClose}
              className="rounded-full bg-[var(--hud-accent)] px-6 py-2 text-xs font-bold uppercase tracking-widest text-[var(--hud-accent-foreground)] transition hover:brightness-110"
            >
              Ready
            </button>
          </div>
        </div>

        {/* loadout strip */}
        <div className="flex items-center gap-2 border-b border-border/40 bg-[var(--hud-panel-dim)] px-5 py-3">
          {slots.map((id, i) => {
            const w = getWeapon(id);
            const active = i === activeSlot;
            return (
              <button
                key={i}
                onClick={() => w && onSelectSlot(i)}
                className={`flex h-14 flex-1 items-center gap-2 rounded-lg border px-3 transition ${
                  active
                    ? "border-[var(--hud-accent)] bg-[var(--hud-accent)]/10"
                    : "border-border/50 hover:border-[var(--hud-accent)]/50"
                }`}
              >
                <span className="text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                {w ? (
                  <>
                    <img src={w.image} alt={w.name} width={512} height={512} className="h-9 w-14 object-contain" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{w.name}</span>
                  </>
                ) : (
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {i < MAX_HEAVY ? "Heavy slot empty" : "Sidearm slot"}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* grid */}
        <div className="grid grid-cols-2 gap-2 overflow-y-auto p-4 sm:grid-cols-3 md:grid-cols-4">
          {WEAPONS.map((w) => {
            const isOwned = owned.includes(w.id);
            const inLoadout = slots.includes(w.id);
            const canAfford = credits >= w.price;
            const heavy = isHeavy(w);
            const slotsFull = heavy && heavyCount >= MAX_HEAVY && !inLoadout;
            return (
              <button
                key={w.id}
                onClick={() => onBuy(w)}
                disabled={!isOwned && !canAfford}
                className={`group relative flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition ${
                  inLoadout
                    ? "border-[var(--hud-accent)] bg-[var(--hud-accent)]/10 shadow-[var(--shadow-hud)]"
                    : isOwned
                      ? "border-border bg-[var(--hud-panel-dim)] hover:border-[var(--hud-accent)]/60"
                      : canAfford
                        ? "border-border/50 bg-[var(--hud-panel-dim)] hover:border-[var(--hud-accent)]/60"
                        : "border-border/40 bg-[var(--hud-panel-dim)] opacity-40"
                }`}
              >
                <span className="absolute left-2 top-2 text-[9px] uppercase tracking-widest text-muted-foreground">
                  {heavy ? "Heavy" : "Sidearm"}
                </span>
                <img
                  src={w.image}
                  alt={`${w.name} ${w.cls}`}
                  loading="lazy"
                  width={512}
                  height={512}
                  className="h-16 w-full object-contain"
                />
                <span className="text-xs font-bold uppercase tracking-wide text-foreground">{w.name}</span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{w.cls}</span>
                <div className="mt-1 w-full space-y-1">
                  <Stat label="DMG" value={w.damage} />
                  <Stat label="RNG" value={w.range} />
                </div>
                <span
                  className={`mt-1 w-full rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${
                    inLoadout
                      ? "bg-[var(--hud-accent)] text-[var(--hud-accent-foreground)]"
                      : isOwned
                        ? "bg-muted text-foreground"
                        : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {inLoadout ? "Equipped" : isOwned ? (slotsFull ? "Swap slot" : "Equip") : `$ ${w.price}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 text-left text-[9px] text-muted-foreground">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, value)}%`, background: "var(--gradient-hud)" }}
        />
      </div>
      <span className="w-6 text-right text-[9px] tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}
