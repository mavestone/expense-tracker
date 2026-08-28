"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ToastProvider } from "@/components/Toast";
import { FyProvider, FySelect } from "@/components/FyContext";

/**
 * Two sections, one system. **Tax** is the compliance ledger — everything that
 * feeds a return or a BAS. **Invoicing** is the client-facing side that raises
 * the documents and posts them into that ledger. They are separated in the nav
 * because they are used at different times, not because they hold different
 * data: an invoice marked sent becomes an income record immediately.
 */
const TAX_NAV = [
  { href: "/", label: "Overview" },
  { href: "/expenses", label: "Expenses" },
  { href: "/income", label: "Income" },
  { href: "/reports", label: "Reports" },
  { href: "/statements", label: "Statements" },
  { href: "/audit", label: "Audit" },
  { href: "/settings", label: "Settings" },
];

const INVOICE_NAV = [
  { href: "/invoices", label: "Invoices" },
  { href: "/clients", label: "Clients" },
  { href: "/branding", label: "Branding" },
];

const INVOICING_ROOTS = ["/invoices", "/clients", "/branding"];

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
  Income: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20V4" /><path d="M6 10l6-6 6 6" /><path d="M4 21h16" /></svg>
  ),
  Invoices: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>
  ),
  Clients: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 11a3 3 0 1 0 0-6" /><path d="M18 20c0-2.6-1-4.4-2.6-5.3" /></svg>
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

  const inInvoicing = INVOICING_ROOTS.some((r) => pathname.startsWith(r));
  const nav = inInvoicing ? INVOICE_NAV : TAX_NAV;
  const moreActive = ["/reports", "/statements", "/import", "/audit", "/settings", "/subscriptions"].some((h) =>
    pathname.startsWith(h)
  );

  return (
    <ToastProvider>
    <FyProvider>
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="var(--accent)" />
            <path d="M20 14h24a2 2 0 0 1 2 2v32l-4-3-4 3-4-3-4 3-4-3-4 3V16a2 2 0 0 1 2-2z" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
            <path d="M26 24h12M26 31h12M26 38h7" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          </svg>
          {/* The artboards set the wordmark to the trading name alone — the
              full product name crowded the 56px bar and repeated the tab title. */}
          <span className="brand-name">Mavestone</span>
        </Link>

        <div className="sectionswitch" role="group" aria-label="Section">
          <Link href="/" className={!inInvoicing ? "active" : ""} aria-current={!inInvoicing ? "page" : undefined}>
            Tax
          </Link>
          <Link href="/invoices" className={inInvoicing ? "active" : ""} aria-current={inInvoicing ? "page" : undefined}>
            Invoicing
          </Link>
        </div>

        {/* The year applies to Tax and Invoicing alike, so it sits in the bar
            above both rather than being restated on six screens. */}
        <span className="actions">
          <FySelect />
          <button className="btn ghost small" onClick={logout}>
            Lock
          </button>
        </span>
      </header>

      <nav className="subnav" aria-label={inInvoicing ? "Invoicing" : "Tax"}>
        <div className="subnav-inner">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={isActive(pathname, n.href) ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </div>
      </nav>

      <main className="main">{children}</main>

      {inInvoicing ? (
        <nav className="bottomnav">
          <Link href="/" className="">
            {ICONS.Home}
            Tax
          </Link>
          <Link href="/invoices" className={pathname.startsWith("/invoices") && pathname !== "/invoices/new" ? "active" : ""}>
            {ICONS.Invoices}
            Invoices
          </Link>
          <Link href="/invoices/new" className="add" aria-label="New invoice">
            <span className="plus">+</span>
          </Link>
          <Link href="/clients" className={pathname.startsWith("/clients") ? "active" : ""}>
            {ICONS.Clients}
            Clients
          </Link>
          <Link href="/branding" className={pathname.startsWith("/branding") ? "active" : ""}>
            {ICONS.More}
            Branding
          </Link>
        </nav>
      ) : (
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
      )}
    </div>
    </FyProvider>
    </ToastProvider>
  );
}
