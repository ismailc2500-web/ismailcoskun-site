import { ZodError, z } from "zod";
import { ensureBootstrapped } from "@/lib/bootstrap";
import { HttpError } from "@/lib/services";
import { BudgetExceededError, PipelineBusyError } from "@/lib/pipeline/runner";

/** Wraps a route handler: bootstraps the DB, serialises the result and maps errors to HTTP statuses. */
export async function handle(fn: () => unknown | Promise<unknown>): Promise<Response> {
  try {
    ensureBootstrapped();
    const data = await fn();
    if (data instanceof Response) return data;
    return Response.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof ZodError) return Response.json({ error: z.prettifyError(err) }, { status: 400 });
    if (err instanceof HttpError) return Response.json({ error: err.message, ...err.extra }, { status: err.status });
    if (err instanceof BudgetExceededError) {
      return Response.json({ error: err.message, needsConfirmation: true, estimate: err.estimate, budget: err.budget }, { status: 402 });
    }
    if (err instanceof PipelineBusyError) return Response.json({ error: err.message }, { status: 409 });
    console.error("[api]", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export function intParam(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(400, `Invalid id "${value}"`);
  return n;
}
