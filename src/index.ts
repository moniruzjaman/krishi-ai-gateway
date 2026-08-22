import { corsHeaders, errorResponse } from "./utils";

export interface Env {
  GEMINI_API_KEY: string;
  OPENROUTER_API_KEY: string;
  GATEWAY_SECRET?: string;
  KRISHI_KV: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        service: "Krishi AI Gateway",
        version: "1.1.0",
        endpoints: ["/v1/chat", "/v1/weather", "/v1/storage/:ns/:key"],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === "/v1/chat" && request.method === "POST") {
      const { handleChat } = await import("./handlers/chat");
      return handleChat(request, env);
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

    return errorResponse("Not found", 404);
  },
};
