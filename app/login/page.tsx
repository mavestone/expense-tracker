"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error || "Login failed.");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <svg className="mark" viewBox="0 0 64 64" aria-hidden="true">
          <rect width="64" height="64" rx="14" fill="var(--accent)" />
          <path d="M20 14h24a2 2 0 0 1 2 2v32l-4-3-4 3-4-3-4 3-4-3-4 3V16a2 2 0 0 1 2-2z" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
          <path d="M26 24h12M26 31h12M26 38h7" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <h1>Expenses</h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          Business expense records — private access.
        </p>
        <div className="field mt2">
          <label htmlFor="pw">Password</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </div>
        {error && <div className="alert danger">{error}</div>}
        <button className="btn block" disabled={busy || !password}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
