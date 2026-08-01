import { api, json } from "@/lib/api";
import { validateImportRows, type ColumnMapping, type ImportDefaults, type RawRow } from "@/lib/import";

export const runtime = "nodejs";
export const maxDuration = 120; // FX lookups for many unique dates can take a while

const MAX_ROWS = 2000;

export const POST = api(async (req) => {
  const body = (await req.json()) as { rows: RawRow[]; mapping: ColumnMapping; defaults: ImportDefaults };
  if (!Array.isArray(body.rows)) return json({ error: "rows required" }, { status: 400 });
  if (body.rows.length > MAX_ROWS) return json({ error: `Too many rows (max ${MAX_ROWS} per import).` }, { status: 400 });
  const result = await validateImportRows(body.rows, body.mapping, body.defaults);
  return json(result);
});
