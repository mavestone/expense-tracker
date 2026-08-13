"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Transient confirmation that something happened.
 *
 * Saves used to report themselves as a line of text near the button, which is
 * easy to miss — particularly after scrolling down a long form to hit Save.
 * A toast appears in the same place every time, whatever page you are on.
 */
type Toast = { id: number; message: string; kind: "ok" | "error" };

const ToastContext = createContext<{
  toast: (message: string, kind?: Toast["kind"]) => void;
} | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  // A component used outside the provider should not crash the page over a
  // notification — it just does not get one.
  return ctx ?? { toast: () => {} };
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const toast = useCallback((message: string, kind: Toast["kind"] = "ok") => {
    setItems((prev) => [...prev, { id: Date.now() + Math.random(), message, kind }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => setItems((p) => p.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Errors stay longer — they usually need reading, not just noticing.
    const life = toast.kind === "error" ? 6000 : 3200;
    const out = setTimeout(() => setLeaving(true), life);
    const gone = setTimeout(onDone, life + 220);
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [toast.kind, onDone]);

  return (
    <button
      className={`toast ${toast.kind}${leaving ? " leaving" : ""}`}
      onClick={onDone}
      aria-label={`Dismiss: ${toast.message}`}
    >
      <span className="toast-dot" />
      {toast.message}
    </button>
  );
}
