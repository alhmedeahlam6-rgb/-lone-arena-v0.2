import { getWeapon } from "./weapons";

type Props = {
  /** [heavy 1, heavy 2, sidearm] — nulls render as empty slots */
  slots: (string | null)[];
  activeSlot: number;
  onSelect: (index: number) => void;
};

const LABELS = ["1", "2", "3"];

export default function WeaponSlots({ slots, activeSlot, onSelect }: Props) {
  return (
    <div className="pointer-events-auto absolute left-1/2 top-24 z-10 flex -translate-x-1/2 gap-2 sm:top-28">
      {slots.map((id, i) => {
        const w = getWeapon(id);
        const active = i === activeSlot;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            disabled={!w}
            className={`group relative flex h-16 w-28 items-center justify-center rounded-md border backdrop-blur transition sm:h-[68px] sm:w-32 ${
              active
                ? "border-[var(--hud-accent)] bg-[var(--hud-panel)] shadow-[var(--shadow-hud)]"
                : w
                  ? "border-border/60 bg-[var(--hud-panel-dim)] hover:border-[var(--hud-accent)]/60"
                  : "border-dashed border-border/40 bg-[var(--hud-panel-dim)] opacity-50"
            }`}
          >
            <span
              className={`absolute left-1.5 top-1 text-[10px] font-bold tabular-nums ${
                active ? "text-[var(--hud-accent)]" : "text-muted-foreground"
              }`}
            >
              {LABELS[i]}
            </span>
            {w ? (
              <>
                <img
                  src={w.image}
                  alt={`${w.name} ${w.cls}`}
                  width={512}
                  height={512}
                  className="h-10 w-full object-contain px-3"
                />
                <span className="absolute bottom-1 text-[9px] font-semibold uppercase tracking-widest text-foreground/90">
                  {w.name}
                </span>
              </>
            ) : (
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                {i < 2 ? "Empty" : "Sidearm"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
