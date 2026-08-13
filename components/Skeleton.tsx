/**
 * Loading placeholders shaped like the content that is coming.
 *
 * A centred spinner tells you nothing and lets the layout jump when the data
 * lands. A skeleton in the shape of the page keeps the height stable and makes
 * the wait feel shorter, because the structure is already there.
 *
 * These are decorative: aria-hidden, with the live region left to the caller.
 */

export function SkeletonLine({ w = "100%", h = 13 }: { w?: string | number; h?: number }) {
  return <span className="sk" style={{ width: typeof w === "number" ? `${w}px` : w, height: h }} aria-hidden />;
}

/** A row of stat tiles, matching the .stats grid. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="stats" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div className="stat sk-card" key={i}>
          <SkeletonLine w={82} h={9} />
          <SkeletonLine w={124} h={23} />
          <SkeletonLine w={96} h={10} />
        </div>
      ))}
    </div>
  );
}

/** List rows — expenses, income, invoices. */
export function SkeletonRows({ rows = 5, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`sk-rows ${className}`} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div className="sk-row" key={i}>
          <div className="sk-row-main">
            <SkeletonLine w={`${38 + ((i * 13) % 34)}%`} h={14} />
            <SkeletonLine w={`${26 + ((i * 17) % 28)}%`} h={11} />
          </div>
          <div className="sk-row-amt">
            <SkeletonLine w={78} h={14} />
            <SkeletonLine w={54} h={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A card-shaped block, e.g. where the chart will be. */
export function SkeletonBlock({ height = 240 }: { height?: number }) {
  return <div className="sk sk-block" style={{ height }} aria-hidden />;
}

/**
 * Wraps a loading region so screen readers are told something is happening
 * without having every shimmering bar announced.
 */
export function Loading({ label = "Loading", children }: { label?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}
