import { describe, it, expect } from "vitest";
import { linkParts, parsePaymentBlock } from "../lib/payment-block";

const USD_BLOCK = `Name: Liam Leslie
Account type: Deposit
Routing number: 084009519
Account number: 606513478323413
Address: Wise US Inc, 108 W 13th St, Wilmington, DE, 19801, United States
Swift/BIC: TRWIUS35XXX
Pay by link: https://wise.com/pay/me/liaml296`;

describe("payment block parsing", () => {
  it("reads label/value pairs", () => {
    const rows = parsePaymentBlock(USD_BLOCK);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({ label: "Name", value: "Liam Leslie" });
    expect(rows[2]).toEqual({ label: "Routing number", value: "084009519" });
  });

  it("keeps a value that itself contains commas and colons intact", () => {
    const rows = parsePaymentBlock(USD_BLOCK);
    expect(rows[4].value).toBe("Wise US Inc, 108 W 13th St, Wilmington, DE, 19801, United States");
    // "Pay by link" is the label; the URL's own colon must not split it again.
    expect(rows[6]).toEqual({ label: "Pay by link", value: "https://wise.com/pay/me/liaml296" });
  });

  it("accepts a field name that legitimately contains a slash", () => {
    // Swift/BIC is a real field, and rejecting every slash hid it in the
    // full-width fallback row.
    const rows = parsePaymentBlock(USD_BLOCK);
    expect(rows[5]).toEqual({ label: "Swift/BIC", value: "TRWIUS35XXX" });
  });

  it("does not mistake a bare URL's scheme for a label", () => {
    expect(parsePaymentBlock("https://wise.com/pay/me/liaml296")).toEqual([
      { label: null, value: "https://wise.com/pay/me/liaml296" },
    ]);
  });

  it("never drops a line it cannot parse", () => {
    const rows = parsePaymentBlock("Pay however you like\nName: Liam\n\n  \nreference MAV-1");
    expect(rows.map((r) => r.value)).toEqual(["Pay however you like", "Liam", "reference MAV-1"]);
    expect(rows[0].label).toBeNull();
    expect(rows[1].label).toBe("Name");
  });

  it("treats a long prefix as prose rather than a field name", () => {
    const [row] = parsePaymentBlock("Please quote the invoice reference when paying: thanks");
    expect(row.label).toBeNull();
  });

  it("is empty for an empty block", () => {
    expect(parsePaymentBlock("")).toEqual([]);
    expect(parsePaymentBlock("\n  \n")).toEqual([]);
  });
});

describe("linkifying", () => {
  it("links a bare https URL", () => {
    expect(linkParts("https://wise.com/pay/me/liaml296")).toEqual([
      { kind: "link", text: "https://wise.com/pay/me/liaml296", href: "https://wise.com/pay/me/liaml296" },
    ]);
  });

  it("adds a scheme to a www address so the href actually works", () => {
    const [p] = linkParts("www.mavestone.com");
    expect(p).toEqual({ kind: "link", text: "www.mavestone.com", href: "https://www.mavestone.com" });
  });

  it("links an email as mailto", () => {
    const [p] = linkParts("hello@mavestone.com");
    expect(p).toEqual({ kind: "link", text: "hello@mavestone.com", href: "mailto:hello@mavestone.com" });
  });

  it("leaves trailing sentence punctuation out of the link", () => {
    // Otherwise the full stop ends up inside the href and the link 404s.
    const parts = linkParts("Pay at https://wise.com/pay/me/liaml296.");
    expect(parts[1]).toEqual({
      kind: "link",
      text: "https://wise.com/pay/me/liaml296",
      href: "https://wise.com/pay/me/liaml296",
    });
    expect(parts[2]).toEqual({ kind: "text", text: "." });
  });

  it("keeps the surrounding text", () => {
    const parts = linkParts("Questions? hello@mavestone.com — thanks");
    expect(parts[0]).toEqual({ kind: "text", text: "Questions? " });
    expect(parts[2]).toEqual({ kind: "text", text: " — thanks" });
  });

  it("handles several links in one line", () => {
    const links = linkParts("a https://one.com b https://two.com").filter((p) => p.kind === "link");
    expect(links).toHaveLength(2);
  });

  it("returns plain text unchanged when there is nothing to link", () => {
    expect(linkParts("Payment within 7 days of the invoice date.")).toEqual([
      { kind: "text", text: "Payment within 7 days of the invoice date." },
    ]);
  });
});
