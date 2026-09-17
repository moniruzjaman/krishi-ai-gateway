import type { Env } from "./utils";

const WINDOW_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 60;

export async function checkRateLimit(
  request: Request,
  env: Env,
  bucket: string
): Promise<{ allowed: boolean; remaining: number }> {
  if (!env.KRISHI_KV) {
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW };
  }
  const identity = request.headers.get("X-Krishi-Token") ?? request.headers.get("CF-Connecting-IP") ?? "anonymous";
  const windowStart = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const key = `ratelimit:${bucket}:${identity}:${windowStart}`;
  const current = await env.KRISHI_KV.get(key, "text");
  const count = current ? parseInt(current, 10) : 0;
  if (count >= MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, remaining: 0 };
  }
  await env.KRISHI_KV.put(key, String(count + 1), { expirationTtl: WINDOW_SECONDS + 5 });
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - count - 1 };
}
