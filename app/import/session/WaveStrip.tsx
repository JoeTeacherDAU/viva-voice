"use client";

import { useState } from "react";
import type { EnergyTrack } from "@/lib/analysis/types";
import type { Segment } from "@/lib/import/segments";

const W = 1000;
const H = 80;
const FLOOR_DB = -70;

/** Max dBFS per column for one channel over frames [from, to). */
function columns(track: EnergyTrack, ch: 0 | 1, from: number, to: number, fpe: number, n: number) {
  const out = new Float32Array(n);
  const frames = track.channels[ch];
  for (let c = 0; c < n; c++) {
    const k0 = Math.floor((from + ((to - from) * c) / n) / fpe);
    const k1 = Math.max(k0 + 1, Math.floor((from + ((to - from) * (c + 1)) / n) / fpe));
    let m = -100;
    for (let k = Math.max(0, k0); k < Math.min(frames.length, k1); k++) m = Math.max(m, frames[k]);
    out[c] = Math.max(0, Math.min(1, (m - FLOOR_DB) / -FLOOR_DB));
  }
  return out;
}

function path(levels: Float32Array, mid: number, half: number): string {
  let d = "";
  levels.forEach((v, c) => {
    if (v > 0) d += `M${(c * W) / levels.length} ${mid - v * half}V${mid + v * half}`;
  });
  return d;
}

/**
 * A two-channel waveform from the 20 ms energy frames, left channel on top in
 * the student A colour, right channel below in the student B colour. Segment
 * edges in view show as handles that a pointer can drag.
 */
export function WaveStrip({
  energy,
  framesPerEnergyFrame,
  from,
  to,
  segments,
  onMove,
  onMoveEnd,
  label,
  height = H,
}: {
  energy: EnergyTrack;
  framesPerEnergyFrame: number;
  from: number;
  to: number;
  /** Segments to draw, each with its index in the full list. */
  segments: { seg: Segment; index: number }[];
  onMove?: (index: number, edge: "start" | "end", frame: number) => void;
  onMoveEnd?: () => void;
  label: string;
  height?: number;
}) {
  const [drag, setDrag] = useState<{ index: number; edge: "start" | "end" } | null>(null);
  const n = 400;
  const left = columns(energy, 0, from, to, framesPerEnergyFrame, n);
  const right = columns(energy, 1, from, to, framesPerEnergyFrame, n);
  const x = (frame: number) => ((frame - from) / (to - from)) * W;
  const frameAt = (svg: SVGSVGElement, clientX: number) => {
    const r = svg.getBoundingClientRect();
    return from + ((clientX - r.left) / r.width) * (to - from);
  };

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full rounded-control bg-surface-highest touch-none"
      style={{ height }}
      onPointerMove={(e) => {
        if (drag && onMove) onMove(drag.index, drag.edge, frameAt(e.currentTarget, e.clientX));
      }}
      onPointerUp={() => {
        if (drag) onMoveEnd?.();
        setDrag(null);
      }}
    >
      {segments.map(({ seg }) => (
        <rect
          key={seg.key}
          x={x(seg.start)}
          y={0}
          width={Math.max(1, x(seg.end) - x(seg.start))}
          height={H}
          className="fill-primary/10"
        />
      ))}
      <path d={path(left, H / 4, H / 4 - 2)} className="stroke-student-a" strokeWidth={W / n} />
      <path
        d={path(right, (3 * H) / 4, H / 4 - 2)}
        className="stroke-student-b"
        strokeWidth={W / n}
      />
      {onMove
        ? segments.flatMap(({ seg, index }) =>
            (["start", "end"] as const).map((edge) => {
              const at = x(seg[edge]);
              if (at < -1 || at > W + 1) return null;
              return (
                <rect
                  key={`${seg.key}-${edge}`}
                  data-testid={`handle-${index}-${edge}`}
                  x={at - 5}
                  y={0}
                  width={10}
                  height={H}
                  className="fill-on-surface/60 cursor-ew-resize"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
                    setDrag({ index, edge });
                  }}
                />
              );
            }),
          )
        : null}
    </svg>
  );
}
