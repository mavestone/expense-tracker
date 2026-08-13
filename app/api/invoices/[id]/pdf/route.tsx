import { api } from "@/lib/api";
import { getInvoice } from "@/lib/invoices";
import { getSettings } from "@/lib/settings";
import { NotFoundError } from "@/lib/expenses";
import { parseLogo } from "@/lib/branding";
import { getReceiptBytes } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Render the invoice to a real PDF and hand it back as a download. */
export const GET = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const [invoice, settings] = await Promise.all([getInvoice(id), getSettings()]);
  if (!invoice) throw new NotFoundError("Invoice not found");

  // The logo has to be fetched here — the PDF renderer cannot reach storage,
  // and a missing logo must never be the reason an invoice fails to download.
  let logo: { data: Buffer; format: "png" | "jpg" } | null = null;
  const stored = parseLogo(settings.invoice_logo);
  if (stored && stored.mime !== "image/webp") {
    try {
      logo = {
        data: await getReceiptBytes({ storageDriver: stored.driver, storageKey: stored.key }),
        format: stored.mime === "image/png" ? "png" : "jpg",
      };
    } catch (e) {
      console.error("[invoice-pdf] logo unavailable, rendering without it", e);
    }
  }

  // Imported lazily so the PDF renderer is not pulled into every other route.
  const [{ renderToBuffer }, { InvoicePdf, invoicePdfFilename }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/lib/invoice-pdf"),
  ]);

  const buf = await renderToBuffer(<InvoicePdf invoice={invoice} settings={settings} logo={logo} />);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoicePdfFilename(invoice)}"`,
      "Content-Length": String(buf.length),
      // A draft can change; never let a stale copy be served back.
      "Cache-Control": "private, no-store",
    },
  });
});
