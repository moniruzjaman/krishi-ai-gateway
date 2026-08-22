import { Env } from "../index";
import { corsHeaders, errorResponse } from "../utils";

const VALID_NS = ["farmer","crops","tasks","chat","prefs","field"];

export async function handleStorage(request: Request, env: Env, namespace: string, key?: string): Promise<Response> {
  if (!env.KRISHI_KV) return errorResponse("KV not configured", 503);
  if (!VALID_NS.includes(namespace)) return errorResponse(`Invalid namespace`, 400);

  const method = request.method.toUpperCase();
  const ok = (data: unknown) => new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!key) {
    if (method !== "GET") return errorResponse("Key required", 400);
    const list = await env.KRISHI_KV.list({ prefix: `${namespace}:` });
    return ok({ namespace, keys: list.keys.map(k => k.name.replace(`${namespace}:`, "")) });
  }

  const kvKey = `${namespace}:${key}`;
  if (method === "GET") {
    const value = await env.KRISHI_KV.get(kvKey, "text");
    if (!value) return errorResponse("Not found", 404);
    return ok({ namespace, key, value: JSON.parse(value) });
  }
  if (method === "PUT" || method === "POST") {
    const raw = await request.text();
    await env.KRISHI_KV.put(kvKey, raw, { expirationTtl: parseInt(new URL(request.url).searchParams.get("ttl") ?? "0") || undefined });
    return ok({ status: "stored", key });
  }
  if (method === "DELETE") {
    await env.KRISHI_KV.delete(kvKey);
    return ok({ status: "deleted", key });
  }
  return errorResponse("Method not allowed", 405);
}
