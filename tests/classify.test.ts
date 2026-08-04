import { describe, it, expect } from "vitest";
import { classify, namesLookAlike, nameTokens } from "../lib/classify";

describe("personal spending triage", () => {
  it("catches groceries, takeaway and eating out", () => {
    expect(classify("Tesco Stores").verdict).toBe("personal");
    expect(classify("DD *DOORDASH KUNGFOOD SAN FRANCISCO CA").verdict).toBe("personal");
    expect(classify("McDonalds 48 London Gbr").verdict).toBe("personal");
    expect(classify("Chipotle Mexican Grill").verdict).toBe("personal");
    expect(classify("Circle K,Bal0142-Ck114 Denpasar Id").verdict).toBe("personal");
  });

  it("catches transit, rideshare and accommodation", () => {
    expect(classify("Tfl Travel Ch Tfl.Gov.Uk/Cp Gbr").verdict).toBe("personal");
    expect(classify("MTA*NYCT PAYGO NEW YORK NY").verdict).toBe("personal");
    expect(classify("LIME*RIDE, LONDON").verdict).toBe("personal");
    expect(classify("Www.Hostelworld.Com Dublin Ie").verdict).toBe("personal");
    expect(classify("Bkg*Hotel At Booking.C").verdict).toBe("personal");
  });

  it("catches rent and card fees", () => {
    expect(classify("Payment | Rent | Payment").verdict).toBe("personal");
    expect(classify("SpareRoom.co.uk").verdict).toBe("personal");
    expect(classify("International Transaction Fee").verdict).toBe("personal");
    expect(classify("Late Payment Fee").verdict).toBe("personal");
  });

  it("separates internal movement from spending", () => {
    expect(classify("Transfer from Savings").verdict).toBe("internal");
    expect(classify("BPAY TO: Qantas Credit Cards").verdict).toBe("internal");
    expect(classify("Sent | Wise Australia Pty Ltd").verdict).toBe("internal");
    expect(classify("Direct Debit Dishonour | 51 - DE DISHONOUR").verdict).toBe("internal");
  });

  it("refuses to classify merchants that sell both", () => {
    // this is where the standing desk and the monitor came from
    expect(classify("Temu.com, LONDON").verdict).toBe("unsure");
    expect(classify("Amazon.co.uk").verdict).toBe("unsure");
    expect(classify("APPLE.COM/BILL, SYDNEY").verdict).toBe("unsure");
    expect(classify("PAYPAL *GODADDY COM").verdict).toBe("unsure");
    expect(classify("EBAY COMMERCE AU").verdict).toBe("unsure");
  });

  it("leaves genuine business software alone", () => {
    expect(classify("ADOBE, ADOBE.LY/ENAU").verdict).toBe("unsure");
    expect(classify("Google GSUITE_maveston").verdict).toBe("unsure");
    expect(classify("ELEVENLABS.IO, NEW YORK").verdict).toBe("unsure");
    expect(classify("Sqsp* Inv191211353 New York Us").verdict).toBe("unsure");
    expect(classify("KIRIN CONSULTING").verdict).toBe("unsure");
  });

  it("does not mistake Amazon Fresh groceries for the ambiguous retailer", () => {
    expect(classify("Amazon Fresh").verdict).toBe("personal");
  });

  it("returns unsure on empty text rather than guessing", () => {
    expect(classify("").verdict).toBe("unsure");
  });
});

describe("merchant name comparison", () => {
  it("drops noise words and short tokens", () => {
    const t = nameTokens("Adobe Systems Software Ireland Ltd");
    expect(t.has("adobe")).toBe(true);
    expect(t.has("ltd")).toBe(false);
    expect(t.has("pty")).toBe(false);
  });

  it("matches a statement line to its supplier", () => {
    expect(namesLookAlike("ADOBE, ADOBE.LY/ENAU", "Adobe Systems Software Ireland Ltd")).toBe(true);
    expect(namesLookAlike("ELEVENLABS.IO, NEW YORK", "Eleven Labs Inc.")).toBe(true);
    expect(namesLookAlike("Google GSUITE_maveston, Sydney", "Google Australia Pty Limited")).toBe(true);
    expect(namesLookAlike("CLAUDE.AI SUBSCR,SAN FRANCISCO", "Anthropic, PBC")).toBe(false);
  });

  it("rejects coincidences — the false matches that made this necessary", () => {
    expect(namesLookAlike("TST* PERRY'S RESTAURANT", "Squarespace")).toBe(false);
    expect(namesLookAlike("Tesco Stores", "Namecheap, Inc.")).toBe(false);
    expect(namesLookAlike("MTA*NYCT PAYGO", "Beeble AI Inc.")).toBe(false);
  });

  it("is safe on empty input", () => {
    expect(namesLookAlike("", "Adobe")).toBe(false);
    expect(namesLookAlike("Adobe", "")).toBe(false);
  });
});
