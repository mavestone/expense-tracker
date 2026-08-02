"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/expenses", label: "Expenses" },
  { href: "/income", label: "Income" },
  { href: "/subscriptions", label: "Subscriptions" },
  { href: "/reports", label: "Reports" },
  { href: "/import", label: "Import" },
  { href: "/audit", label: "Audit" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

const ICONS: Record<string, React.ReactNode> = {
  Home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
  ),
  Expenses: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
  ),
  Subscriptions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 9a8 8 0 0 1 14.5-3M20 15a8 8 0 0 1-14.5 3" /><path d="M18 2v4h-4M6 22v-4h4" /></svg>
  ),
  Income: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20V4" /><path d="M6 10l6-6 6 6" /><path d="M4 21h16" /></svg>
  ),
  More: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
  ),
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const moreActive = ["/reports", "/import", "/audit", "/settings", "/subscriptions"].some((h) => pathname.startsWith(h));

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="var(--accent)" />
            <path d="M20 14h24a2 2 0 0 1 2 2v32l-4-3-4 3-4-3-4 3-4-3-4 3V16a2 2 0 0 1 2-2z" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
            <path d="M26 24h12M26 31h12M26 38h7" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Expenses
        </Link>
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={isActive(pathname, n.href) ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="spacer" />
        <button className="btn ghost small" onClick={logout}>
          Lock
        </button>
      </header>

      <main className="main">{children}</main>

      <nav className="bottomnav">
        <Link href="/" className={pathname === "/" ? "active" : ""}>
          {ICONS.Home}
          Home
        </Link>
        <Link href="/expenses" className={pathname.startsWith("/expenses") && pathname !== "/expenses/new" ? "active" : ""}>
          {ICONS.Expenses}
          Expenses
        </Link>
        <Link href="/expenses/new" className="add" aria-label="Add expense">
          <span className="plus">+</span>
        </Link>
        <Link href="/income" className={pathname.startsWith("/income") ? "active" : ""}>
          {ICONS.Income}
          Income
        </Link>
        <Link href="/reports" className={moreActive ? "active" : ""}>
          {ICONS.More}
          More
        </Link>
      </nav>
    </div>
  );
}
