import type { Env } from "./utils";

const WINDOW_SECONDS = 60;
const DEFAULT_MAX = 60;

export async function checkLimit(
  env: Env,
  bucket: string,
  identity: string,
  max = DEFAULT_MAX
): Promise<{ allowed: boolean; remaining: number }> {
  if (!env.KRISHI_KV) return { allowed: true, remaining: max };
  const windowStart = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const key = `ratelimit:${bucket}:${identity}:${windowStart}`;
  const current = await env.KRISHI_KV.get(key, "text");
  const count = current ? parseInt(current, 10) : 0;
  if (count >= max) return { allowed: false, remaining: 0 };
  await env.KRISHI_KV.put(key, String(count + 1), { expirationTtl: WINDOW_SECONDS + 5 });
  return { allowed: true, remaining: max - count - 1 };
}

// Legacy entry point (X-Krishi-Token / IP identity) used by storage and weather handlers.
export async function checkRateLimit(request: Request, env: Env, bucket: string) {
  const identity = request.headers.get("X-Krishi-Token") ?? request.headers.get("CF-Connecting-IP") ?? "anonymous";
  return checkLimit(env, bucket, identity, DEFAULT_MAX);
}
