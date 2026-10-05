import type { Env } from "./utils";
import { corsHeadersFor, errorResponse, isAuthorized } from "./utils";

export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeadersFor(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "Krishi AI Gateway",
          version: "2.0.0",
          endpoints: ["/v1/chat", "/v1/status", "/v1/weather", "/v1/storage/:ns/:key"],
        }),
        { headers: { ...corsHeadersFor(request), "Content-Type": "application/json" } }
      );
    }

    if (path === "/v1/chat" && request.method === "POST") {
      const { handleChat } = await import("./handlers/chat");
      return handleChat(request, env, ctx);
    }

    // Which provider keys / Supabase settings are configured (booleans only, never values).
    if (path === "/v1/status" && request.method === "GET") {
      if (!isAuthorized(request, env)) return errorResponse(request, "Unauthorized", 401);
      const e = env as unknown as Record<string, string | undefined>;
      const configured = Object.fromEntries(
        ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "HF_TOKEN", "ANTHROPIC_API_KEY", "XAI_API_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY"].map((k) => [k, Boolean(e[k])])
      );
      return new Response(JSON.stringify({ configured, allowPaidProviders: env.ALLOW_PAID_PROVIDERS === "true" }), {
        headers: { ...corsHeadersFor(request), "Content-Type": "application/json" },
      });
    }

    if (path === "/v1/weather" && request.method === "GET") {
      const { handleWeather } = await import("./handlers/weather");
      return handleWeather(request, env);
    }

    const storageMatch = path.match(/^\/v1\/storage\/([^/]+)\/?([^/]*)?$/);
    if (storageMatch) {
      const { handleStorage } = await import("./handlers/storage");
      return handleStorage(request, env, storageMatch[1], storageMatch[2] || undefined);
    }

    return errorResponse(request, "Not found", 404);
  },
};
