import { NextResponse } from "next/server";
import { isAuthed } from "./auth";
import { ValidationError, NotFoundError } from "./expenses";
import { FxUnavailableError } from "./fx";

type RouteCtx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: RouteCtx) => Promise<Response>;

/**
 * Wrap an API route handler with authentication and consistent error
 * responses. Every route is authenticated unless opts.auth === false.
 */
export function api(handler: Handler, opts: { auth?: boolean } = {}): Handler {
  return async (req, ctx) => {
    try {
      if (opts.auth !== false) {
        if (!(await isAuthed())) {
          return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }
      }
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof ValidationError)
        return NextResponse.json({ error: e.errors.join(" "), errors: e.errors }, { status: 400 });
      if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
      if (e instanceof FxUnavailableError)
        return NextResponse.json({ error: e.message, code: "fx_unavailable" }, { status: 422 });
      console.error("[api]", e);
      return NextResponse.json({ error: (e as Error).message || "Internal error" }, { status: 500 });
    }
  };
}

export function json(data: unknown, init?: ResponseInit): Response {
  return NextResponse.json(data, init);
}
