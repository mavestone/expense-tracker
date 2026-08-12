import type { ReactNode } from "react";
import { linkParts, parsePaymentBlock } from "@/lib/payment-block";

/**
 * Payment instructions, rendered from the free-text block held in Branding.
 *
 * The block is typed as "Label: value" lines, so it prints as a proper
 * label/value table rather than a wall of monospace, and any URL or email in
 * it becomes a real link the client can click.
 */
export function linkify(text: string): ReactNode[] {
  return linkParts(text).map((p, i) =>
    p.kind === "link" ? (
      <a
        key={i}
        href={p.href}
        target={p.href.startsWith("mailto:") ? undefined : "_blank"}
        rel="noreferrer"
      >
        {p.text}
      </a>
    ) : (
      p.text
    )
  );
}

export default function PaymentBlock({ block, currency }: { block: string; currency: string }) {
  const rows = parsePaymentBlock(block);
  if (!rows.length) return null;
  return (
    <section className="paysec">
      <div className="lbl">Payment details — {currency}</div>
      <dl className="paygrid">
        {rows.map((r, i) => (
          <div className={`payrow${r.label ? "" : " full"}`} key={i}>
            {r.label && <dt>{r.label}</dt>}
            <dd>{linkify(r.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
