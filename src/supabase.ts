import type { Env } from "./utils";
import type { ChainStep } from "./providers";

export interface Prepared {
  user_id: string;
  remaining_today: number;
  per_minute: number;
  chain: ChainStep[];
}

export type PrepareResult =
  | { ok: true; data: Prepared }
  | { ok: false; status: number; message: string; transient: boolean };

function rpcHeaders(env: Env, jwt: string): Record<string, string> {
  return { apikey: env.SUPABASE_ANON_KEY ?? "", Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
}

// One round trip: validates the user's Supabase JWT (PostgREST rejects bad tokens), checks app
// access, remaining daily quota, and returns the routing chain. Runs as the user, so RLS applies.
export async function prepare(env: Env, jwt: string, app: string, task: string): Promise<PrepareResult> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { ok: false, status: 503, message: "Supabase not configured", transient: true };
  }
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ai_prepare`, {
      method: "POST",
      headers: rpcHeaders(env, jwt),
      body: JSON.stringify({ p_app: app, p_task: task }),
    });
    if (res.ok) return { ok: true, data: (await res.json()) as Prepared };
    const err: any = await res.json().catch(() => ({}));
    const msg = String(err?.message ?? "");
    if (res.status === 401 || /not authenticated|jwt/i.test(msg)) return { ok: false, status: 401, message: "Invalid or expired session", transient: false };
    if (/no access/i.test(msg) || res.status === 403) return { ok: false, status: 403, message: "No access to this app", transient: false };
    if (/unknown app/i.test(msg)) return { ok: false, status: 400, message: "Unknown app", transient: false };
    return { ok: false, status: 502, message: "Auth service error", transient: res.status >= 500 };
  } catch {
    return { ok: false, status: 502, message: "Auth service unreachable", transient: true };
  }
}

export async function logUsage(
  env: Env,
  jwt: string,
  row: { app: string; task: string; provider: string | null; model: string | null; tokensIn?: number; tokensOut?: number; latencyMs: number; status: string; error?: string }
): Promise<void> {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ai_log_usage`, {
      method: "POST",
      headers: rpcHeaders(env, jwt),
      body: JSON.stringify({
        p_app: row.app, p_task: row.task, p_provider: row.provider, p_model: row.model,
        p_tokens_in: row.tokensIn ?? null, p_tokens_out: row.tokensOut ?? null,
        p_latency_ms: row.latencyMs, p_status: row.status, p_error: row.error ?? null,
      }),
    });
  } catch {
    // Logging must never break a user request.
  }
}
