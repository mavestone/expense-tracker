"use client";

/**
 * Receipt OCR heuristics. OCR runs entirely in the browser (tesseract.js,
 * loaded on demand) and only ever produces SUGGESTIONS the user applies
 * explicitly — nothing is auto-saved.
 */

export type OcrSuggestion = {
  supplier?: string;
  dateISO?: string;
  amountStr?: string;
  rawText: string;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function toIso(y: string, m: string, d: string): string | null {
  if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? null : iso;
}

export function extractDate(text: string): string | null {
  // 14/09/2025 or 14-09-25 (assume DMY — Australian convention)
  let m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (m && Number(m[2]) <= 12) {
    const iso = toIso(m[3], m[2], m[1]);
    if (iso) return iso;
  }
  // 2025-09-14
  m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) {
    const iso = toIso(m[1], m[2], m[3]);
    if (iso) return iso;
  }
  // 14 Sep 2025 / Sep 14, 2025
  m = text.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{2,4})\b/i);
  if (m) return toIso(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2,4})\b/i);
  if (m) return toIso(m[3], MONTHS[m[1].toLowerCase()], m[2]);
  return null;
}

const MONEY_RE = /(?:\$|USD|AUD|EUR|GBP)?\s*(\d{1,3}(?:,\d{3})*\.\d{2})\b/gi;

export function extractAmount(text: string): string | null {
  const lines = text.split(/\n+/);
  const totals: string[] = [];
  const all: string[] = [];
  for (const line of lines) {
    const matches = [...line.matchAll(MONEY_RE)].map((m) => m[1].replace(/,/g, ""));
    all.push(...matches);
    if (/total|amount\s*due|balance|paid|charge/i.test(line) && !/subtotal/i.test(line)) totals.push(...matches);
  }
  const pick = (arr: string[]) => (arr.length ? arr.reduce((a, b) => (Number(a) >= Number(b) ? a : b)) : null);
  return pick(totals) ?? pick(all);
}

export function extractSupplier(text: string): string | null {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    if (line.length < 3 || line.length > 50) continue;
    if (/receipt|invoice|tax|statement|order|welcome|thank|www\.|http|@/i.test(line)) continue;
    if (!/[a-zA-Z]{3}/.test(line)) continue;
    if (/^\d/.test(line)) continue;
    return line.replace(/\s{2,}/g, " ");
  }
  return null;
}

export function parseReceiptText(text: string): OcrSuggestion {
  return {
    supplier: extractSupplier(text) ?? undefined,
    dateISO: extractDate(text) ?? undefined,
    amountStr: extractAmount(text) ?? undefined,
    rawText: text,
  };
}

/** Run OCR on an image file. Loads tesseract.js on demand; returns null on any failure. */
export async function ocrImage(file: File | Blob): Promise<OcrSuggestion | null> {
  try {
    const Tesseract = (await import("tesseract.js")).default;
    const result = await Tesseract.recognize(file, "eng");
    const text = result?.data?.text ?? "";
    if (!text.trim()) return null;
    return parseReceiptText(text);
  } catch {
    return null;
  }
}
