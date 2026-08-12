/**
 * Parsing for the free-text payment-instruction blocks held in Branding.
 *
 * Kept separate from rendering so the fiddly parts — deciding what is a field
 * label and what is a link — are plain data that can be tested directly.
 */

// Trailing punctuation belongs to the sentence, not to the address.
const LINKABLE = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|[^\s@<>"]+@[^\s@<>",;]+\.[^\s@<>",;]+)/g;
const TRAILING = /[.,;:)\]]+$/;

export type Part = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

/** Split free text into plain runs and linkable URLs / email addresses. */
export function linkParts(text: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(LINKABLE)) {
    const start = m.index ?? 0;
    let token = m[0];
    const trailing = TRAILING.exec(token)?.[0] ?? "";
    if (trailing) token = token.slice(0, -trailing.length);
    if (!token) continue;

    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    const isEmail = !/^https?:\/\//i.test(token) && token.includes("@");
    out.push({
      kind: "link",
      text: token,
      href: isEmail ? `mailto:${token}` : /^https?:\/\//i.test(token) ? token : `https://${token}`,
    });
    if (trailing) out.push({ kind: "text", text: trailing });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out.length ? out : [{ kind: "text", text }];
}

export type PayRow = { label: string | null; value: string };

/**
 * Read "Label: value" lines into rows. A line that is not in that shape still
 * prints, as a full-width row — the owner must never lose a line because it
 * failed to parse.
 */
export function parsePaymentBlock(block: string): PayRow[] {
  return block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(":");
      // A URL's own "https:" is not a label, and a long prefix is prose rather
      // than a field name. A slash on its own is fine — "Swift/BIC" is a real
      // field name — so only a protocol-ish or address-ish prefix is rejected.
      const label = i > 0 && i <= 26 ? line.slice(0, i).trim() : "";
      const looksLikeUrl = /^https?$/i.test(label) || label.includes("//") || /^www\./i.test(label);
      if (label && !looksLikeUrl && !label.includes("@") && !label.includes(" ".repeat(2))) {
        return { label, value: line.slice(i + 1).trim() };
      }
      return { label: null, value: line };
    });
}
