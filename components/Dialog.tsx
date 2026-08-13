"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * A modal that replaces window.confirm and window.prompt.
 *
 * The native ones block the whole page, cannot be styled, and on a phone look
 * like the browser is warning you about the site rather than the app asking a
 * question. Every destructive action here asks for a reason, and a reason is
 * worth typing into something that looks like it belongs to the app.
 */
export type DialogProps = {
  open: boolean;
  title: string;
  /** Explanation shown under the title. */
  body?: React.ReactNode;
  /** Present a text field; the value is passed to onConfirm. */
  prompt?: {
    label: string;
    placeholder?: string;
    required?: boolean;
    multiline?: boolean;
    /** "date" gives a real picker — asking someone to type YYYY-MM-DD is not a question, it is a format test. */
    type?: "text" | "date";
    defaultValue?: string;
  };
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

export default function Dialog({
  open,
  title,
  body,
  prompt,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  busy,
  onConfirm,
  onCancel,
}: DialogProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setValue(prompt?.defaultValue ?? "");
    // Focus the field if there is one, otherwise the panel, so Escape and Tab
    // both land somewhere sensible rather than on whatever was behind.
    const t = setTimeout(() => (inputRef.current ?? panelRef.current)?.focus(), 20);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey);
    // Stop the page behind scrolling under the overlay.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onCancel, prompt?.defaultValue]);

  if (!open) return null;

  const blocked = Boolean(prompt?.required && !value.trim());

  function confirm() {
    if (blocked || busy) return;
    onConfirm(value);
  }

  return (
    <div className="dlg-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef} tabIndex={-1}>
        <h2 id={titleId} className="dlg-title">{title}</h2>
        {body && <div className="dlg-body">{body}</div>}

        {prompt && (
          <label className="dlg-field">
            {prompt.label}
            {prompt.multiline ? (
              <textarea
                ref={(el) => { inputRef.current = el; }}
                rows={3}
                value={value}
                placeholder={prompt.placeholder}
                onChange={(e) => setValue(e.target.value)}
              />
            ) : (
              <input
                ref={(el) => { inputRef.current = el; }}
                type={prompt.type ?? "text"}
                value={value}
                placeholder={prompt.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirm()}
              />
            )}
          </label>
        )}

        <div className="dlg-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button className={danger ? "btn danger" : "btn"} onClick={confirm} disabled={blocked || busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type AskOptions = Omit<DialogProps, "open" | "onConfirm" | "onCancel" | "busy"> & {
  onConfirm: (value: string) => void | Promise<void>;
};

/**
 * Drop-in replacement for confirm()/prompt() at a call site.
 *
 *   const { ask, dialog } = useDialog();
 *   <button onClick={() => ask({ title: "…", onConfirm: () => doIt() })} />
 *   {dialog}
 *
 * The dialog stays open while onConfirm is running, so a slow request shows
 * progress in place rather than closing and leaving the page looking idle.
 */
export function useDialog() {
  const [opts, setOpts] = useState<AskOptions | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = (o: AskOptions) => setOpts(o);

  const dialog = opts ? (
    <Dialog
      {...opts}
      open
      busy={busy}
      onCancel={() => !busy && setOpts(null)}
      onConfirm={async (value) => {
        setBusy(true);
        try {
          await opts.onConfirm(value);
          setOpts(null);
        } finally {
          setBusy(false);
        }
      }}
    />
  ) : null;

  return { ask, dialog };
}
