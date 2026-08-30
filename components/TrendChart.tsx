"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatAUD } from "@/lib/money";
import MonthBreakdown from "@/components/MonthBreakdown";

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
 * Income against deductible spend across a financial year, as paired bars.
 *
 * Bars rather than lines because a financial year is mostly future: a line has
 * to join every month, so the eleven that have not happened yet were drawn at
 * zero and read as a collapse. A bar for a month with nothing in it simply is
 * not there.
 *
 * Recharts handles the geometry; every colour comes from the app's CSS custom
 * properties rather than a palette of its own, so the chart follows the theme
 * into dark mode instead of having to be re-themed alongside it.
 */
export default function TrendChart({ months }: { months: TrendMonth[] }) {
  const [active, setActive] = useState<Row | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const { data, hasData, totals, peak } = useMemo(() => {
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
    return {
      data,
      hasData: months.some((m) => m.incomeCents > 0 || m.expenseCents > 0),
      totals: { incomeCents, expenseCents, netCents: incomeCents - expenseCents },
      peak: peak && peak.income > 0 ? peak : null,
    };
  }, [months]);

  const netPositive = totals.netCents >= 0;
  const marginPct = totals.incomeCents > 0 ? (totals.netCents / totals.incomeCents) * 100 : 0;
  const TrendIcon = totals.netCents === 0 ? Minus : netPositive ? TrendingUp : TrendingDown;

  return (
    <div className="trend">
      {openMonth && <MonthBreakdown month={openMonth} onClose={() => setOpenMonth(null)} />}
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
            <BarChart
              data={data}
              margin={{ top: 14, right: 8, left: 4, bottom: 4 }}
              barGap={3}
              barCategoryGap="22%"
              // recharts 3 hands back an index rather than the payload here.
              onMouseMove={(st) => {
                const i = typeof st?.activeIndex === "number" ? st.activeIndex : Number(st?.activeIndex);
                setActive(Number.isInteger(i) && i >= 0 && i < data.length ? data[i] : null);
              }}
              onMouseLeave={() => setActive(null)}
              // A month with nothing in it has nothing to show, so it does not
              // open an empty panel.
              onClick={(st) => {
                const i = typeof st?.activeIndex === "number" ? st.activeIndex : Number(st?.activeIndex);
                const r = Number.isInteger(i) && i >= 0 && i < data.length ? data[i] : null;
                if (r && (r.income > 0 || r.expense > 0)) setOpenMonth(r.key);
              }}
              style={{ cursor: "pointer" }}
            >
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 7" vertical={false} />

              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tickMargin={12}
                tick={{ fontSize: 11.5, fill: "var(--ink-3)" }}
                interval={0}
                minTickGap={0}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                width={60}
                tick={{ fontSize: 11.5, fill: "var(--ink-3)" }}
                tickFormatter={axisTick}
              />

              <Tooltip
                cursor={{ fill: "var(--hover)" }}
                content={<TrendTooltip />}
                animationDuration={120}
              />

              {/* A month with nothing in it gets no bar at all. The line chart
                  this replaced drew future months as zero, which read as income
                  collapsing rather than as a year that has not happened yet. */}
              <Bar dataKey="income" radius={[5, 5, 2, 2]} isAnimationActive={false} maxBarSize={26}>
                {data.map((r) => (
                  <Cell key={r.key} fill="var(--accent)" fillOpacity={r.income > 0 ? 1 : 0} />
                ))}
              </Bar>
              <Bar dataKey="expense" radius={[5, 5, 2, 2]} isAnimationActive={false} maxBarSize={26}>
                {data.map((r) => (
                  <Cell key={r.key} fill="var(--warn)" fillOpacity={r.expense > 0 ? 0.85 : 0} />
                ))}
              </Bar>
            </BarChart>
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
