"use client";

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatAUD } from "@/lib/money";

export type TrendMonth = {
  key: string;
  label: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
};

type Row = TrendMonth & { income: number; expense: number; net: number };

/**
 * Axis labels in dollars.
 *
 * Rounding to whole thousands is wrong here: recharts happily picks ticks at
 * 1500 and 4500, and rounding turns the scale into 0, 2k, 3k, 5k, 6k — an axis
 * that is not merely ugly but untrue. Keep one decimal when the tick is not a
 * whole thousand.
 */
function axisTick(v: number): string {
  if (v === 0) return "$0";
  const neg = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a < 1000) return `${neg}$${Math.round(a)}`;
  const k = a / 1000;
  return `${neg}$${k % 1 === 0 ? k : k.toFixed(1)}k`;
}

/**
 * Income against deductible spend across a financial year.
 *
 * Recharts handles the geometry; every colour comes from the app's CSS custom
 * properties rather than a palette of its own, so the chart follows the theme
 * into dark mode instead of having to be re-themed alongside it.
 */
export default function TrendChart({ months }: { months: TrendMonth[] }) {
  const [active, setActive] = useState<Row | null>(null);

  const { data, hasData, totals, peak, showPeakRule } = useMemo(() => {
    const data: Row[] = months.map((m) => ({
      ...m,
      income: m.incomeCents / 100,
      expense: m.expenseCents / 100,
      net: m.netCents / 100,
    }));
    const incomeCents = months.reduce((s, m) => s + m.incomeCents, 0);
    const expenseCents = months.reduce((s, m) => s + m.expenseCents, 0);
    // The best month is worth marking — it is the one the owner asks about.
    const peakIdx = data.reduce((bi, r, i) => (r.income > data[bi].income ? i : bi), 0);
    const peak = data[peakIdx];
    // Only mark an interior month — on the first or last the rule sits on the
    // plot edge and reads as a border.
    const showPeakRule = peak && peak.income > 0 && peakIdx > 0 && peakIdx < data.length - 1;
    return {
      data,
      hasData: months.some((m) => m.incomeCents > 0 || m.expenseCents > 0),
      totals: { incomeCents, expenseCents, netCents: incomeCents - expenseCents },
      peak: peak && peak.income > 0 ? peak : null,
      showPeakRule,
    };
  }, [months]);

  const netPositive = totals.netCents >= 0;
  const marginPct = totals.incomeCents > 0 ? (totals.netCents / totals.incomeCents) * 100 : 0;
  const TrendIcon = totals.netCents === 0 ? Minus : netPositive ? TrendingUp : TrendingDown;

  return (
    <div className="trend">
      <div className="trend-head">
        <div>
          <div className="trend-label">Net for the year</div>
          <div className="trend-figure">
            <span className="trend-amount">{formatAUD(totals.netCents)}</span>
            {totals.incomeCents > 0 && (
              <span className={`trend-delta ${netPositive ? "up" : "down"}`}>
                <TrendIcon size={15} strokeWidth={2.4} />
                {marginPct.toFixed(0)}% margin
              </span>
            )}
          </div>
        </div>

        <div className="trend-stats">
          <div>
            <span className="k">Income</span>
            <span className="v income">{formatAUD(totals.incomeCents)}</span>
          </div>
          <div>
            <span className="k">Spend</span>
            <span className="v expense">{formatAUD(totals.expenseCents)}</span>
          </div>
          <div>
            <span className="k">Best month</span>
            <span className="v">{peak ? `${peak.label} · ${formatAUD(peak.incomeCents)}` : "—"}</span>
          </div>
        </div>
      </div>

      <div className="trend-plot">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 14, right: 8, left: 4, bottom: 4 }}
              // recharts 3 hands back an index rather than the payload here.
              onMouseMove={(s) => {
                const i = typeof s?.activeIndex === "number" ? s.activeIndex : Number(s?.activeIndex);
                setActive(Number.isInteger(i) && i >= 0 && i < data.length ? data[i] : null);
              }}
              onMouseLeave={() => setActive(null)}
            >
              <defs>
                <linearGradient id="incomeArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.26} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expenseArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--warn)" stopOpacity={0.14} />
                  <stop offset="100%" stopColor="var(--warn)" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid stroke="var(--line)" strokeDasharray="3 7" vertical={false} />

              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tickMargin={12}
                tick={{ fontSize: 11.5, fill: "var(--ink-3)" }}
                interval="preserveStartEnd"
                minTickGap={4}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                width={60}
                tick={{ fontSize: 11.5, fill: "var(--ink-3)" }}
                tickFormatter={axisTick}
              />

              {showPeakRule && peak && (
                <ReferenceLine
                  x={peak.label}
                  stroke="var(--accent)"
                  strokeDasharray="3 4"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
              )}

              <Tooltip
                cursor={{ stroke: "var(--line-2)", strokeDasharray: "3 3", strokeWidth: 1 }}
                content={<TrendTooltip />}
                animationDuration={120}
              />

              <Area
                type="linear"
                dataKey="expense"
                stroke="none"
                fill="url(#expenseArea)"
                isAnimationActive={false}
              />
              <Area type="linear" dataKey="income" stroke="none" fill="url(#incomeArea)" isAnimationActive={false} />

              <Line
                type="linear"
                dataKey="expense"
                stroke="var(--warn)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                activeDot={{ r: 4.5, fill: "var(--warn)", stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="income"
                stroke="var(--accent)"
                strokeWidth={2.4}
                dot={false}
                activeDot={{ r: 5, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2.5 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty" style={{ padding: "72px 10px" }}>
            No income or expenses recorded for this year yet.
          </div>
        )}
      </div>

      <div className="trend-legend">
        <span><i className="swatch income" /> Income</span>
        <span><i className="swatch expense" /> Deductible spend</span>
        {active && (
          <span className="trend-readout">
            {active.label}: net <b style={{ color: active.netCents >= 0 ? "var(--ok)" : "var(--danger)" }}>
              {formatAUD(active.netCents)}
            </b>
          </span>
        )}
      </div>
    </div>
  );
}

type TooltipPayload = { payload: Row }[];

function TrendTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="charttip">
      <div className="charttip-head">{r.label}</div>
      <div className="charttip-row">
        <span><i className="swatch income" /> Income</span>
        <b>{formatAUD(r.incomeCents)}</b>
      </div>
      <div className="charttip-row">
        <span><i className="swatch expense" /> Spend</span>
        <b>{formatAUD(r.expenseCents)}</b>
      </div>
      <div className="charttip-row net">
        <span>Net</span>
        <b style={{ color: r.netCents >= 0 ? "var(--ok)" : "var(--danger)" }}>{formatAUD(r.netCents)}</b>
      </div>
    </div>
  );
}
