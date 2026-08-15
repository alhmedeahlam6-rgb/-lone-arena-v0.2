import { useEffect, useRef } from "react";

export type RadarState = {
  fighters: {
    x: number;
    z: number;
    team: "blue" | "red";
    alive: boolean;
    isHuman: boolean;
  }[];
  player: { x: number; z: number; yaw: number } | null;
};

/**
 * Top-down occupancy grid of the arena geometry, sampled from the level mesh.
 * `cells[i]` is 0 (open) or a coverage weight 1..255 for the cell at
 * `(i % res, floor(i / res))`, spanning world [-extent, extent] on both axes.
 */
export type MapGrid = { cells: Uint8Array; res: number; extent: number };

// world half-extent mapped to the radar's edge (arena spans roughly ±73)
const ARENA_EXTENT = 80;

type Props = {
  radarRef: { current: RadarState };
  mapRef: { current: MapGrid | null };
  /** data-url of the arena rendered top-down at load; preferred over the grid */
  imageRef?: { current: string | null };
};

export default function Minimap({ radarRef, mapRef, imageRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const SIZE = cv.width;
    const scale = SIZE / (ARENA_EXTENT * 2);
    const toMap = (x: number, z: number): [number, number] => [
      (x + ARENA_EXTENT) * scale,
      (z + ARENA_EXTENT) * scale,
    ];

    // The level footprint never changes, so it is rasterised once into an
    // offscreen layer and blitted each frame.
    let geoLayer: HTMLCanvasElement | null = null;
    let geoBuilt = false;
    const buildGeoLayer = (grid: MapGrid) => {
      const src = document.createElement("canvas");
      src.width = grid.res;
      src.height = grid.res;
      const g = src.getContext("2d");
      if (!g) return null;
      const img = g.createImageData(grid.res, grid.res);
      for (let i = 0; i < grid.cells.length; i++) {
        const v = grid.cells[i] ?? 0;
        if (!v) continue;
        const o = i * 4;
        img.data[o] = 255;
        img.data[o + 1] = 224;
        img.data[o + 2] = 138;
        img.data[o + 3] = 70 + Math.min(150, v * 18);
      }
      g.putImageData(img, 0, 0);

      const out = document.createElement("canvas");
      out.width = SIZE;
      out.height = SIZE;
      const o2 = out.getContext("2d");
      if (!o2) return null;
      // world [-extent, extent] of the grid mapped onto the radar's own extent
      const span = (grid.extent / ARENA_EXTENT) * SIZE;
      o2.imageSmoothingEnabled = true;
      o2.drawImage(src, (SIZE - span) / 2, (SIZE - span) / 2, span, span);
      return out;
    };

    // real top-down render of the arena, produced once at load
    let shot: HTMLImageElement | null = null;
    let shotSrc: string | null = null;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, SIZE, SIZE);

      // backdrop
      ctx.fillStyle = "rgba(13, 17, 23, 0.78)";
      ctx.fillRect(0, 0, SIZE, SIZE);

      // grid lines
      ctx.strokeStyle = "rgba(255, 224, 138, 0.08)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const p = (i / 4) * SIZE;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(SIZE, p);
        ctx.stroke();
      }

      // static map: the rendered arena image if available, else the occupancy grid
      const src = imageRef?.current ?? null;
      if (src && src !== shotSrc) {
        shotSrc = src;
        const img = new Image();
        img.onload = () => {
          shot = img;
        };
        img.src = src;
      }
      if (shot) {
        ctx.globalAlpha = 0.95;
        ctx.drawImage(shot, 0, 0, SIZE, SIZE);
        ctx.globalAlpha = 1;
      } else {
        const grid = mapRef.current;
        if (grid && !geoBuilt) {
          geoBuilt = true;
          geoLayer = buildGeoLayer(grid);
        }
        if (geoLayer) ctx.drawImage(geoLayer, 0, 0);
      }

      // border
      ctx.strokeStyle = "rgba(255, 224, 138, 0.5)";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2);

      const st = radarRef.current;
      if (!st) return;

      // fighters
      for (const f of st.fighters) {
        if (!f.alive) continue;
        const [mx, mz] = toMap(f.x, f.z);
        ctx.fillStyle = f.team === "blue" ? "#3f8fff" : "#ff3b1f";
        ctx.beginPath();
        ctx.arc(mx, mz, f.isHuman ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fill();
        if (f.isHuman) {
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // player heading arrow
      if (st.player) {
        const [px, pz] = toMap(st.player.x, st.player.z);
        ctx.save();
        ctx.translate(px, pz);
        ctx.rotate(-st.player.yaw);
        ctx.fillStyle = "#ffe08a";
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(4, 5);
        ctx.lineTo(-4, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [radarRef, mapRef, imageRef]);

  return (
    <div className="pointer-events-none absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
      <canvas
        ref={canvasRef}
        width={140}
        height={140}
        className="rounded-lg shadow-[0_0_24px_-6px_rgba(0,0,0,0.8)]"
      />
    </div>
  );
}
