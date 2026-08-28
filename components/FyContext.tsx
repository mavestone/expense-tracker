"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/client";
import type { MetaDto } from "@/lib/types";

/**
 * One financial year for the whole app.
 *
 * Every screen used to keep its own, with four different defaults between
 * them — the overview opened on the server's current year, reports on
 * `currentFy`, statements on the newest year holding data, and the three
 * list screens on "all years". Moving between them silently changed the
 * period the figures were for, which is the one thing a bookkeeping tool
 * must never do quietly.
 *
 * The year is deliberately not persisted. "Default to the year we're in"
 * is the rule, so a fresh load always lands on the current FY rather than
 * on whatever was being reviewed last week.
 */

/** `""` means every year — useful for finding an old record, meaningless
 *  for a return. Screens that can only report on one year read `resolved`. */
type FyState = {
  /** The selection. `""` is "all years". */
  fy: string;
  /** The selection, or the current FY when "all years" is chosen. */
  resolved: string;
  /** The FY containing today, from the server's timezone — not the browser's. */
  currentFy: string;
  years: string[];
  setFy: (fy: string) => void;
  /** False until `/api/meta` answers; screens wait rather than fetch FY "". */
  ready: boolean;
};

const Ctx = createContext<FyState | null>(null);

export function FyProvider({ children }: { children: React.ReactNode }) {
  const [years, setYears] = useState<string[]>([]);
  const [currentFy, setCurrentFy] = useState("");
  // null distinguishes "not chosen yet" from "chose all years".
  const [fy, setFyRaw] = useState<string | null>(null);

  useEffect(() => {
    apiGet<MetaDto>("/api/meta")
      .then((m) => {
        // Newest first: the year being worked on is nearly always the newest.
        setYears([...new Set([m.currentFy, ...m.financialYears])].sort().reverse());
        setCurrentFy(m.currentFy);
        // Only seed the default — a deep link that already set a year wins.
        setFyRaw((prev) => (prev === null ? m.currentFy : prev));
      })
      .catch(() => setYears([]));
  }, []);

  const setFy = useCallback((next: string) => setFyRaw(next), []);

  const value = useMemo<FyState>(
    () => ({
      fy: fy ?? "",
      resolved: fy || currentFy,
      currentFy,
      years,
      setFy,
      ready: currentFy !== "" && fy !== null,
    }),
    [fy, currentFy, years, setFy]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFy(): FyState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFy must be used inside <FyProvider>");
  return v;
}

/** The control itself. Lives in the top bar, where the artboards put it. */
export function FySelect() {
  const { fy, years, setFy, ready } = useFy();
  if (!ready) return null;
  return (
    <label className="fyselect">
      <span className="sr-only">Financial year</span>
      <select value={fy} onChange={(e) => setFy(e.target.value)}>
        <option value="">All years</option>
        {years.map((f) => (
          <option key={f} value={f}>
            FY {f}
          </option>
        ))}
      </select>
    </label>
  );
}
