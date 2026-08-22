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
