"use client";

import { useMemo, useState } from "react";
import { formatAUD } from "@/lib/money";

export type TrendMonth = { key: string; label: string; incomeCents: number; expenseCents: number; netCents: number };

const W = 720;
const H = 260;
const PAD = { top: 18, right: 14, bottom: 30, left: 58 };

/** A "nice" axis maximum — 1/2/5 × 10ⁿ — so gridline labels are readable numbers. */
function niceCeil(v: number): number {
  if (v <= 0) return 100000; // $1,000 floor keeps an empty chart from collapsing
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

function path(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/**
 * Income against deductible spend across a financial year.
 *
 * Hand-drawn SVG rather than a charting library: the whole app is plain CSS
 * with themed custom properties, and a library would arrive with its own
 * styling model to fight. Both series share one axis so the gap between them
 * is the profit, read directly off the chart.
 */
export default function TrendChart({ months }: { months: TrendMonth[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    const max = niceCeil(Math.max(...months.flatMap((m) => [m.incomeCents, m.expenseCents]), 0));
    const iw = W - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (months.length <= 1 ? iw / 2 : (i / (months.length - 1)) * iw);
    const y = (c: number) => PAD.top + ih - (c / max) * ih;
    return {
      max,
      x,
      y,
      baseline: PAD.top + ih,
      income: months.map((m, i) => ({ x: x(i), y: y(m.incomeCents) })),
      expense: months.map((m, i) => ({ x: x(i), y: y(m.expenseCents) })),
      ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: max * f, y: y(max * f) })),
    };
  }, [months]);

  const active = hover != null ? months[hover] : null;
  const hasData = months.some((m) => m.incomeCents > 0 || m.expenseCents > 0);

  return (
    <div className="trend">
      <div className="trend-legend">
        <span><i className="swatch income" /> Income</span>
        <span><i className="swatch expense" /> Deductible spend</span>
        {active && (
          <span className="trend-readout">
            <b>{active.label}</b>
            {" · "}in {formatAUD(active.incomeCents)}
            {" · "}out {formatAUD(active.expenseCents)}
            {" · "}
            <b style={{ color: active.netCents >= 0 ? "var(--ok)" : "var(--danger)" }}>
              net {formatAUD(active.netCents)}
            </b>
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Income and deductible spend by month" preserveAspectRatio="none">
        <defs>
          <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ok)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--ok)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {geom.ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y} className="grid" />
            <text x={PAD.left - 9} y={t.y + 4} className="axis r" textAnchor="end">
              {t.v >= 100000 ? `$${Math.round(t.v / 100000)}k` : `$${Math.round(t.v / 100)}`}
            </text>
          </g>
        ))}

        {months.map((m, i) => (
          <text key={m.key} x={geom.x(i)} y={H - 9} className="axis" textAnchor="middle">
            {m.label}
          </text>
        ))}

        {hasData && (
          <>
            <path d={`${path(geom.income)} L${geom.income.at(-1)!.x},${geom.baseline} L${geom.income[0].x},${geom.baseline} Z`} fill="url(#incomeFill)" />
            <path d={path(geom.expense)} className="line expense" />
            <path d={path(geom.income)} className="line income" />
          </>
        )}

        {hover != null && (
          <g>
            <line x1={geom.x(hover)} y1={PAD.top} x2={geom.x(hover)} y2={geom.baseline} className="cursor" />
            <circle cx={geom.income[hover].x} cy={geom.income[hover].y} r="4.5" className="dot income" />
            <circle cx={geom.expense[hover].x} cy={geom.expense[hover].y} r="4.5" className="dot expense" />
          </g>
        )}

        {/* One hit zone per month — a band is far easier to hit than a 4px dot,
            and it works the same on a phone as with a mouse. */}
        {months.map((m, i) => {
          const half = (W - PAD.left - PAD.right) / Math.max(1, (months.length - 1) * 2);
          return (
            <rect
              key={m.key}
              x={geom.x(i) - half}
              y={PAD.top}
              width={half * 2}
              height={geom.baseline - PAD.top}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
          );
        })}
      </svg>

      {!hasData && <p className="muted small mt1">No income or expenses recorded for this year yet.</p>}
    </div>
  );
}
