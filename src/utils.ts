export interface Env {
  GEMINI_API_KEY: string;
  OPENROUTER_API_KEY: string;
  KRISHI_API_TOKEN?: string;
  KRISHI_KV: KVNamespace;
}

const ALLOWED_ORIGIN_SUFFIX = ".krishiai.live";

function isAllowedOrigin(origin: string): boolean {
  if (origin.includes("localhost") || origin.includes("127.0.0.1")) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && (hostname === "krishiai.live" || hostname.endsWith(ALLOWED_ORIGIN_SUFFIX));
  } catch {
    return false;
  }
}

export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = origin ? isAllowedOrigin(origin) : false;
  return {
    "Access-Control-Allow-Origin": allowed ? (origin as string) : "https://krishiai.live",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Krishi-Token",
  };
}

export function errorResponse(request: Request, message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message, status }), {
    status,
    headers: { ...corsHeadersFor(request), "Content-Type": "application/json" },
  });
}

// Constant-time compare so response timing can't be used to guess the token byte-by-byte.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAuthorized(request: Request, env: Env): boolean {
  if (!env.KRISHI_API_TOKEN) return false;
  const token = request.headers.get("X-Krishi-Token") ?? "";
  return timingSafeEqual(token, env.KRISHI_API_TOKEN);
}
