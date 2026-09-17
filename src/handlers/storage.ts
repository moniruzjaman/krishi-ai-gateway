import type { Env } from "../utils";
import { corsHeadersFor, errorResponse, isAuthorized } from "../utils";
import { checkRateLimit } from "../rateLimit";

const VALID_NS = ["farmer", "crops", "tasks", "chat", "prefs", "field"];

export async function handleStorage(
  request: Request,
  env: Env,
  namespace: string,
  key?: string
): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return errorResponse(request, "Unauthorized \u2014 missing or invalid X-Krishi-Token", 401);
  }
  const rateLimit = await checkRateLimit(request, env, "storage");
  if (!rateLimit.allowed) {
    return errorResponse(request, "Rate limit exceeded \u2014 try again in a minute", 429);
  }
  if (!env.KRISHI_KV) return errorResponse(request, "KV not configured", 503);
  if (!VALID_NS.includes(namespace)) return errorResponse(request, "Invalid namespace", 400);

  const method = request.method.toUpperCase();
  const ok = (data: unknown) =>
    new Response(JSON.stringify(data), {
      headers: { ...corsHeadersFor(request), "Content-Type": "application/json" },
    });

  if (!key) {
    if (method !== "GET") return errorResponse(request, "Key required", 400);
    const list = await env.KRISHI_KV.list({ prefix: `${namespace}:` });
    return ok({ namespace, keys: list.keys.map((k) => k.name.replace(`${namespace}:`, "")) });
  }

  const kvKey = `${namespace}:${key}`;

  if (method === "GET") {
    const value = await env.KRISHI_KV.get(kvKey, "text");
    if (!value) return errorResponse(request, "Not found", 404);
    return ok({ namespace, key, value: JSON.parse(value) });
  }

  if (method === "PUT" || method === "POST") {
    const raw = await request.text();
    const ttl = parseInt(new URL(request.url).searchParams.get("ttl") ?? "0", 10) || undefined;
    await env.KRISHI_KV.put(kvKey, raw, { expirationTtl: ttl });
    return ok({ status: "stored", key });
  }

  if (method === "DELETE") {
    await env.KRISHI_KV.delete(kvKey);
    return ok({ status: "deleted", key });
  }

  return errorResponse(request, "Method not allowed", 405);
}
