import { api, json } from "@/lib/api";
import { commitImport, type ColumnMapping, type ImportDefaults, type RawRow } from "@/lib/import";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = api(async (req) => {
  const body = (await req.json()) as {
    filename: string;
    rows: RawRow[];
    mapping: ColumnMapping;
    defaults: ImportDefaults;
  };
  if (!Array.isArray(body.rows) || body.rows.length === 0) return json({ error: "rows required" }, { status: 400 });
  if (body.rows.length > 2000) return json({ error: "Too many rows (max 2000 per import)." }, { status: 400 });
  const result = await commitImport(body.filename || "import.csv", body.mapping, body.defaults, body.rows);
  return json(result, { status: 201 });
});
