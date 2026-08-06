/** The invoice logo, stored as a JSON pointer in settings rather than inline bytes. */

export type StoredLogo = { driver: string; key: string; mime: string };

/** Raster only — an SVG is a script container, and this file is served to a browser. */
export const ALLOWED_LOGO_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function parseLogo(raw: string): StoredLogo | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as StoredLogo;
    return v?.key ? v : null;
  } catch {
    return null;
  }
}
