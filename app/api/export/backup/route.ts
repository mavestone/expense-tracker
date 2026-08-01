import { api } from "@/lib/api";
import { buildBackupStream } from "@/lib/backup";
import { Readable } from "stream";

export const runtime = "nodejs";
export const maxDuration = 300; // large backups need time on Vercel

export const GET = api(async (req) => {
  const fy = new URL(req.url).searchParams.get("fy") || undefined;
  const { stream, filename } = await buildBackupStream({ fy: fy === "all" ? undefined : fy });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});
