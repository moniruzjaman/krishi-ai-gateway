export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Krishi-Token",
};

export function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message, status }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Constant-time string comparison to avoid leaking the secret via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks the X-Krishi-Token header against GATEWAY_SECRET.
 * If GATEWAY_SECRET is not set, the gateway is intentionally left open
 * (useful for local dev) — set it in production via `wrangler secret put GATEWAY_SECRET`.
 */
export function isAuthorized(request: Request, gatewaySecret?: string): boolean {
  if (!gatewaySecret) return true;
  const token = request.headers.get("X-Krishi-Token") ?? "";
  return timingSafeEqual(token, gatewaySecret);
}
