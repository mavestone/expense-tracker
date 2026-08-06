import { api, json } from "@/lib/api";
import { getStorage, sha256Hex, extensionForMime } from "@/lib/storage";
import { getSettings, setSetting } from "@/lib/settings";
import { ValidationError, NotFoundError } from "@/lib/expenses";
import { parseLogo, ALLOWED_LOGO_MIMES as ALLOWED, MAX_LOGO_BYTES as MAX_BYTES } from "@/lib/branding";

export const runtime = "nodejs";

export const POST = api(async (req) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError(["A file is required."]);
  if (!ALLOWED.has(file.type)) throw new ValidationError(["Logo must be a PNG, JPEG or WebP image."]);
  if (file.size > MAX_BYTES) throw new ValidationError(["Logo must be under 2 MB."]);

  const buf = Buffer.from(await file.arrayBuffer());
  const storage = getStorage();
  const key = `logo-${sha256Hex(buf).slice(0, 32)}.${extensionForMime(file.type, file.name)}`;
  const storageKey = await storage.put(key, buf, file.type);
  await setSetting("invoice_logo", JSON.stringify({ driver: storage.driver, key: storageKey, mime: file.type }));
  return json({ ok: true, mime: file.type, sizeBytes: file.size });
});

export const GET = api(async () => {
  const logo = parseLogo((await getSettings()).invoice_logo);
  if (!logo) throw new NotFoundError("No logo uploaded");
  const { getReceiptBytes } = await import("@/lib/storage");
  const buf = await getReceiptBytes({ storageDriver: logo.driver, storageKey: logo.key });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": logo.mime,
      // Content-addressed key, so the bytes behind a URL never change.
      "Cache-Control": "private, max-age=86400",
    },
  });
});

export const DELETE = api(async () => {
  await setSetting("invoice_logo", "");
  return json({ ok: true });
});
