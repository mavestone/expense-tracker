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

  it("catches rent", () => {
    expect(classify("Payment | Rent | Payment").verdict).toBe("personal");
    expect(classify("SpareRoom.co.uk").verdict).toBe("personal");
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
    // the card descriptor never says "Anthropic" — the alias table bridges it
    expect(namesLookAlike("CLAUDE.AI SUBSCR,SAN FRANCISCO", "Anthropic, PBC")).toBe(true);
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

describe("internal is the owner's own money and the account mechanics", () => {
  it("keeps saver movements, card repayments and own-name transfers", () => {
    expect(classify("[Savings saver] Transfer to Spending").verdict).toBe("internal");
    expect(classify("Transfer from Savings").verdict).toBe("internal");
    expect(classify("Forward to Savings").verdict).toBe("internal");
    expect(classify("Transfer from Travel Fund").verdict).toBe("internal");
    expect(classify("BPAY TO: Qantas Credit Cards").verdict).toBe("internal");
    expect(classify("L B LESLIE | Rent").verdict).toBe("internal");
  });

  it("keeps card fees, interest and nil-value checks", () => {
    expect(classify("Interest Charged").verdict).toBe("internal");
    expect(classify("Annual Fee").verdict).toBe("internal");
    expect(classify("Late Payment Fee").verdict).toBe("internal");
    expect(classify("International Transaction Fee").verdict).toBe("internal");
    expect(classify("Card checked — Apple").verdict).toBe("internal");
  });

  it("sends another person's transfer to personal, not internal", () => {
    expect(classify("Solomon Leslie Payment | Birthday").verdict).toBe("personal");
    expect(classify("ELIZABETH LESLIE Osko Payment Received").verdict).toBe("personal");
    expect(classify("David Malcom Leslie Payment Received").verdict).toBe("personal");
  });

  it("does not sweep up a transfer from someone who might be a client", () => {
    // Brandon Armgardt reads like a personal contact but paid $825 for a wedding film
    expect(classify("ARMGARDT BRANDON LADISLAV | 30% Deposit").verdict).toBe("unsure");
    expect(classify("GODDARD TRAVIS BRADLEY MICHAEL | NOTPROVIDED").verdict).toBe("unsure");
    expect(classify("Emmerson Price | Dj decks").verdict).toBe("unsure");
  });
});

describe("friends, refunds and currency moves", () => {
  it("files friends' transfers as personal", () => {
    expect(classify("Hannah kate Leadbeatter O'Reilly").verdict).toBe("personal");
    expect(classify("J Ekwealor | NOREF").verdict).toBe("personal");
    expect(classify("D Farinha | Rent October").verdict).toBe("personal");
    expect(classify("Chelsea Hatton Copeland | Uber reimbursement").verdict).toBe("personal");
  });

  it("files refunds as personal", () => {
    expect(classify("IKEA | Refund").verdict).toBe("personal");
    expect(classify("Orbit International | Refund").verdict).toBe("personal");
  });

  it("but never a refund from a business vendor", () => {
    // this offsets a Canva expense; filing it personal would hide it
    expect(classify("canva.com Canva | PAYPAL *CANVAPTYLIM | Refund").verdict).toBe("unsure");
    expect(classify("Cutback.video | Refund").verdict).toBe("unsure");
  });

  it("treats Wise currency moves as internal", () => {
    expect(classify("Moved | To AUD").verdict).toBe("internal");
    expect(classify("To GBP | Funds").verdict).toBe("internal");
    expect(classify("To EUR").verdict).toBe("internal");
    expect(classify("To Savings").verdict).toBe("internal");
  });

  it("keeps Brandon Armgardt out of the friend sweep — he is a client", () => {
    expect(classify("ARMGARDT BRANDON LADISLAV | 30% Deposit").verdict).toBe("unsure");
  });
});

describe("merchant aliases", () => {
  it("connects card descriptors to legal supplier names", () => {
    expect(namesLookAlike("CLAUDE.AI SUBSCR,SAN FRANCISCO", "Anthropic, PBC")).toBe(true);
    expect(namesLookAlike("Sqsp* Websit#196100645 New York Us", "Squarespace")).toBe(true);
    expect(namesLookAlike("Google GSUITE_maveston", "Google Australia Pty Limited")).toBe(true);
    expect(namesLookAlike("GYMAX office chair", "Temu (Gymax Limited)")).toBe(true);
  });

  it("still refuses unrelated pairs", () => {
    expect(namesLookAlike("Tesco Stores", "Anthropic, PBC")).toBe(false);
    expect(namesLookAlike("MTA*NYCT PAYGO", "Squarespace")).toBe(false);
  });
});
