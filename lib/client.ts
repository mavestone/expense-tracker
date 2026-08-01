"use client";

/** Client-side fetch helpers with consistent error handling. */

export class ApiError extends Error {
  status: number;
  errors?: string[];
  code?: string;
  constructor(status: number, message: string, errors?: string[], code?: string) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    if (typeof window !== "undefined" && !location.pathname.startsWith("/login")) location.href = "/login";
    throw new ApiError(401, "Not authenticated");
  }
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const b = body as { error?: string; errors?: string[]; code?: string } | null;
    throw new ApiError(res.status, b?.error || `Request failed (${res.status})`, b?.errors, b?.code);
  }
  return body as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  return handle<T>(await fetch(url, { cache: "no-store" }));
}

export async function apiSend<T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  return handle<T>(
    await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  );
}

export async function apiUpload<T>(url: string, file: File | Blob, filename: string): Promise<T> {
  const fd = new FormData();
  fd.append("file", file, filename);
  return handle<T>(await fetch(url, { method: "POST", body: fd }));
}

/** localStorage helpers for remembered form defaults. */
export function remember(key: string, value: string) {
  try {
    localStorage.setItem(`et:${key}`, value);
  } catch {}
}
export function recall(key: string): string | null {
  try {
    return localStorage.getItem(`et:${key}`);
  } catch {
    return null;
  }
}
