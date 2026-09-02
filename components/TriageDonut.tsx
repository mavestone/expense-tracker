"use client";

import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

export type Progress = {
  total: number;
  unreviewed: number;
  logged: number;
  personal: number;
  ignored: number;
  donePct: number;
};

/** The four buckets, in the order the eye should read them: done first. */
export const SEGMENTS = [
  { key: "logged", label: "business", colour: "var(--ok)" },
  { key: "personal", label: "personal", colour: "var(--accent)" },
  { key: "ignored", label: "transfers", colour: "var(--ink-3)" },
  { key: "unreviewed", label: "to decide", colour: "var(--line-2)" },
] as const;

export type SegmentKey = (typeof SEGMENTS)[number]["key"];

/**
 * Where a financial year's statement lines have got to.
 *
 * Clickable, because the question this answers — "what is left?" — is always
 * followed by wanting to look at it. Each wedge filters the table to its own
 * bucket, so the chart is a control rather than a decoration.
 *
 * The reveal is a one-off sweep on mount. Recharts re-runs its animation on
 * every data change, which during a bulk triage would mean the chart spinning
 * itself several times a second while you work.
 */
export default function TriageDonut({
  progress,
  active,
  onSelect,
}: {
  progress: Progress;
  active: SegmentKey | "";
  onSelect: (key: SegmentKey) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 40);
    return () => clearTimeout(t);
  }, []);

  const data = SEGMENTS.map((s) => ({ ...s, value: progress[s.key] })).filter((d) => d.value > 0);
  if (progress.total === 0) return null;

  return (
    <div className="triage">
      <div className="triage-chart" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius="63%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="none"
              isAnimationActive={!revealed}
              animationDuration={620}
              animationBegin={0}
              onClick={(_, i) => onSelect(data[i].key)}
            >
              {data.map((d) => (
                <Cell
                  key={d.key}
                  fill={d.colour}
                  cursor="pointer"
                  fillOpacity={active === "" || active === d.key ? 1 : 0.32}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="triage-centre">
          <b>{progress.donePct}%</b>
          <span>done</span>
        </div>
      </div>

      <div className="triage-key">
        {SEGMENTS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`triage-item${active === s.key ? " on" : ""}`}
            onClick={() => onSelect(s.key)}
            disabled={progress[s.key] === 0}
          >
            <i style={{ background: s.colour }} />
            <b>{progress[s.key].toLocaleString()}</b>
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
