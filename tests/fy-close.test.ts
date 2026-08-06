import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/** Finalising a financial year, and the working papers attached to it. */

let T: typeof import("../lib/fy-close");

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "et-fyclose-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
  process.env.DATA_DIR = dir;
  process.env.STORAGE_DRIVER = "local";
  T = await import("../lib/fy-close");
});

describe("finalising a year", () => {
  it("records what the return was lodged as", async () => {
    const c = await T.finaliseFy("2025-26", {
      lodgedDate: "2026-08-05",
      atoReceipt: "24112 4813 6673",
      taxableIncomeCents: 1482000,
      taxPayableCents: 0,
      note: "Income tax on accruals; GST on cash.",
    });
    expect(c.atoReceipt).toBe("24112 4813 6673");
    expect(c.taxableIncomeCents).toBe(1482000);
    // Nil tax must survive as 0 and not be flattened to null by a falsy check.
    expect(c.taxPayableCents).toBe(0);
    expect(await T.isFyFinalised("2025-26")).toBe(true);
  });

  it("reports an untouched year as not finalised", async () => {
    expect(await T.isFyFinalised("2024-25")).toBe(false);
    expect(await T.getFyClosure("2024-25")).toBeNull();
  });

  it("rejects a malformed year label rather than creating a stray row", async () => {
    await expect(T.finaliseFy("2025")).rejects.toThrow(/Invalid financial year/);
    await expect(T.finaliseFy("FY2025-26")).rejects.toThrow(/Invalid financial year/);
  });

  it("rejects a bad lodgement date", async () => {
    await expect(T.finaliseFy("2023-24", { lodgedDate: "5 Aug 2026" })).rejects.toThrow(/valid date/);
  });
});

describe("reopening", () => {
  it("requires a reason, and stops the year reading as finalised", async () => {
    await expect(T.reopenFy("2025-26", "  ")).rejects.toThrow(/reason is required/);

    const r = await T.reopenFy("2025-26", "Amendment — Ted's Camera invoice located.");
    expect(r.reopenedAt).toBeTruthy();
    expect(await T.isFyFinalised("2025-26")).toBe(false);

    // The lodgement details survive the reopen — an amendment has to reconcile
    // to them, so losing them here would defeat the point of recording them.
    expect(r.atoReceipt).toBe("24112 4813 6673");
  });

  it("closes again cleanly when re-finalised", async () => {
    const c = await T.finaliseFy("2025-26", { atoReceipt: "24112 4813 6673", note: "Amended return lodged." });
    expect(c.reopenedAt).toBeNull();
    expect(c.reopenedReason).toBeNull();
    expect(await T.isFyFinalised("2025-26")).toBe(true);
  });

  it("refuses to reopen a year that was never finalised", async () => {
    await expect(T.reopenFy("2022-23", "why not")).rejects.toThrow(/not been finalised/);
  });
});

describe("working papers", () => {
  const bytes = (s: string) => Buffer.from(s, "utf8");

  it("stores a document against the year", async () => {
    const d = await T.addFyDocument(
      "2025-26",
      { filename: "note.md", mime: "text/markdown", bytes: bytes("# PSI file note") },
      { title: "PSI results test — file note", kind: "file_note" }
    );
    expect(d.title).toBe("PSI results test — file note");
    expect(d.sizeBytes).toBeGreaterThan(0);
    expect((await T.listFyDocuments("2025-26")).length).toBe(1);
  });

  it("is content-addressed — the same bytes twice is one document", async () => {
    const again = await T.addFyDocument(
      "2025-26",
      { filename: "note-copy.md", mime: "text/markdown", bytes: bytes("# PSI file note") },
      { title: "Duplicate upload", kind: "file_note" }
    );
    expect(again.title).toBe("PSI results test — file note"); // the original, not the copy
    expect((await T.listFyDocuments("2025-26")).length).toBe(1);
  });

  it("keeps years separate", async () => {
    await T.addFyDocument(
      "2024-25",
      { filename: "other.txt", mime: "text/plain", bytes: bytes("different year") },
      { title: "Prior year paper" }
    );
    expect((await T.listFyDocuments("2025-26")).length).toBe(1);
    expect((await T.listFyDocuments("2024-25")).length).toBe(1);
  });

  it("refuses a file type that is not a document", async () => {
    await expect(
      T.addFyDocument("2025-26", { filename: "x.zip", mime: "application/zip", bytes: bytes("PK") }, {})
    ).rejects.toThrow(/Unsupported file type/);
  });

  it("refuses an empty file", async () => {
    await expect(
      T.addFyDocument("2025-26", { filename: "empty.txt", mime: "text/plain", bytes: Buffer.alloc(0) }, {})
    ).rejects.toThrow(/empty/);
  });

  it("falls back to the filename when no title is given", async () => {
    const d = await T.addFyDocument(
      "2025-26",
      { filename: "lodgement-receipt.pdf", mime: "application/pdf", bytes: bytes("%PDF-1.4 fake") },
      {}
    );
    expect(d.title).toBe("lodgement-receipt.pdf");
  });
});
