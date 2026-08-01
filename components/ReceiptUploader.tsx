"use client";

import { useRef, useState } from "react";
import { ocrImage, type OcrSuggestion } from "@/lib/ocr";

/**
 * Receipt picker with camera support, client-side image compression
 * (keeps uploads well under serverless body limits) and optional OCR
 * that produces confirm-only suggestions.
 */

export type StagedReceipt = { file: File | Blob; filename: string; previewUrl: string | null; mime: string };

async function compressImage(file: File): Promise<StagedReceipt> {
  const mime = file.type || "application/octet-stream";
  const passthrough: StagedReceipt = {
    file,
    filename: file.name || "receipt",
    previewUrl: mime.startsWith("image/") ? URL.createObjectURL(file) : null,
    mime,
  };
  if (!mime.startsWith("image/") || mime === "image/heic") return passthrough;
  if (file.size < 1_800_000) return passthrough; // small enough already
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 2200;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return passthrough;
    const filename = (file.name || "receipt").replace(/\.\w+$/, "") + ".jpg";
    return { file: blob, filename, previewUrl: URL.createObjectURL(blob), mime: "image/jpeg" };
  } catch {
    return passthrough;
  }
}

export default function ReceiptUploader({
  staged,
  onStage,
  ocrEnabled,
  onOcrSuggestion,
}: {
  staged: StagedReceipt | null;
  onStage: (r: StagedReceipt | null) => void;
  ocrEnabled?: boolean;
  onOcrSuggestion?: (s: OcrSuggestion) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("Preparing…");
    try {
      onStage(await compressImage(file));
    } finally {
      setBusy(null);
    }
  }

  async function scan() {
    if (!staged || !staged.mime.startsWith("image/")) return;
    setBusy("Reading receipt… (runs on this device)");
    try {
      const s = await ocrImage(staged.file);
      if (s && onOcrSuggestion) onOcrSuggestion(s);
      if (!s) alert("Couldn't read any text from this image.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="receiptbox">
      <input ref={inputRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={pick} />
      {staged ? (
        <div>
          {staged.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={staged.previewUrl} alt="Receipt preview" />
          ) : (
            <div className="muted" style={{ padding: "16px 0" }}>
              📄 {staged.filename}
            </div>
          )}
          <div className="btnrow mt1" style={{ justifyContent: "center" }}>
            <button type="button" className="btn ghost small" onClick={() => inputRef.current?.click()}>
              Replace
            </button>
            {ocrEnabled && staged.mime.startsWith("image/") && (
              <button type="button" className="btn ghost small" onClick={scan} disabled={!!busy}>
                Scan for details
              </button>
            )}
            <button type="button" className="btn ghost small" onClick={() => onStage(null)}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="muted small mb1">Photo or PDF of the receipt / tax invoice</div>
          <button type="button" className="btn ghost" onClick={() => inputRef.current?.click()}>
            📷 Add receipt
          </button>
        </div>
      )}
      {busy && (
        <div className="small muted mt1">
          <span className="spin" /> {busy}
        </div>
      )}
    </div>
  );
}
