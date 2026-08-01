import path from "path";
import fs from "fs/promises";
import { createHash } from "crypto";

/**
 * Receipt file storage. Files are content-addressed by SHA-256 and never
 * overwritten — replacing a receipt writes a NEW object and the old one is
 * kept forever (the receipts table tracks versions). Access always goes
 * through authenticated API routes; storage URLs are never handed out.
 *
 * Drivers:
 *  - "local"       : files under DATA_DIR/receipts (dev + self-hosting)
 *  - "vercel-blob" : Vercel Blob (production on Vercel)
 */

export interface ReceiptStorage {
  driver: string;
  /** Store bytes under key. Must be a no-op if the key already exists (content-addressed). */
  put(key: string, buf: Buffer, mime: string): Promise<string>; // returns storageKey to persist
  get(storageKey: string): Promise<Buffer>;
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function extensionForMime(mime: string, filename: string): string {
  const byMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "application/pdf": "pdf",
  };
  if (byMime[mime]) return byMime[mime];
  const ext = path.extname(filename).replace(".", "").toLowerCase();
  return ext || "bin";
}

export const ALLOWED_RECEIPT_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

class LocalStorage implements ReceiptStorage {
  driver = "local";
  private dir: string;
  constructor() {
    const dataDir = process.env.DATA_DIR || "./data";
    this.dir = path.isAbsolute(dataDir) ? path.join(dataDir, "receipts") : path.join(process.cwd(), dataDir, "receipts");
  }
  async put(key: string, buf: Buffer): Promise<string> {
    await fs.mkdir(this.dir, { recursive: true });
    const p = path.join(this.dir, key);
    try {
      // "wx" = fail if exists — enforces immutability at the filesystem level.
      await fs.writeFile(p, buf, { flag: "wx" });
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // Same content hash already stored — that's fine (content-addressed).
    }
    return key;
  }
  async get(storageKey: string): Promise<Buffer> {
    // storageKey may be a bare key (current) or an absolute path (defensive).
    const p = path.isAbsolute(storageKey) ? storageKey : path.join(this.dir, path.basename(storageKey));
    return fs.readFile(p);
  }
}

class VercelBlobStorage implements ReceiptStorage {
  driver = "vercel-blob";
  async put(key: string, buf: Buffer, mime: string): Promise<string> {
    const { put } = await import("@vercel/blob");
    const res = await put(`receipts/${key}`, buf, {
      access: "public", // URL is unguessable and never exposed; all reads go through authed routes
      contentType: mime,
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31536000,
    }).catch(async (e: Error) => {
      // Blob already exists for this content hash — retrieve its URL instead.
      if (/already exists/i.test(e.message)) {
        const { head } = await import("@vercel/blob");
        const info = await head(`receipts/${key}`).catch(() => null);
        if (info) return { url: info.url };
      }
      throw e;
    });
    return res.url; // persist the blob URL as the storage key
  }
  async get(storageKey: string): Promise<Buffer> {
    const res = await fetch(storageKey, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Blob fetch failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

export function getStorage(): ReceiptStorage {
  const driver = process.env.STORAGE_DRIVER || (process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local");
  if (driver === "vercel-blob") return new VercelBlobStorage();
  return new LocalStorage();
}

/** Fetch bytes for a stored receipt row, honouring the driver it was written with. */
export async function getReceiptBytes(row: { storageDriver: string; storageKey: string }): Promise<Buffer> {
  const s = row.storageDriver === "vercel-blob" ? new VercelBlobStorage() : new LocalStorage();
  return s.get(row.storageKey);
}
