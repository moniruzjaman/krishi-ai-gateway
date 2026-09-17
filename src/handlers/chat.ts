import type { Env } from "../utils";
import { corsHeadersFor, errorResponse, isAuthorized } from "../utils";
import { checkRateLimit } from "../rateLimit";

const RULES: Record<string, { bn: string; en: string }> = {
  "\u09A7\u09BE\u09A8|rice|paddy|boro|aman": {
    bn: "BRRI \u09AA\u09B0\u09BE\u09AE\u09B0\u09CD\u09B6: \u09AC\u09CB\u09B0\u09CB \u09AE\u09CC\u09B8\u09C1\u09AE\u09C7 BRRI \u09A7\u09BE\u09A8-28 \u09AC\u09BE 29 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964 \u09AC\u09BF\u0998\u09BE \u09AA\u09CD\u09B0\u09A4\u09BF \u0987\u0989\u09B0\u09BF\u09AF\u09BC\u09BE \u09E7\u09E9\u0995\u09C7\u099C\u09BF, TSP \u09ED\u0995\u09C7\u099C\u09BF, MOP \u09E7\u09E6\u0995\u09C7\u099C\u09BF\u0964",
    en: "BRRI: Use BRRI dhan-28 or 29 for Boro. Apply urea 13kg, TSP 7kg, MOP 10kg per bigha.",
  },
  "\u09B8\u09BE\u09B0|fertilizer|urea": {
    bn: "\u09B8\u09BE\u09B0 \u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u0997: TSP \u0993 MOP \u09B0\u09CB\u09AA\u09A3\u09C7\u09B0 \u0986\u0997\u09C7 \u09A6\u09BF\u09A8\u0964 \u0987\u0989\u09B0\u09BF\u09AF\u09BC\u09BE \u09E7\u09EB, \u09E9\u09E6, \u09EA\u09EB \u09A6\u09BF\u09A8 \u09AA\u09B0 \u09A4\u09BF\u09A8\u09AD\u09BE\u0997\u09C7 \u09A6\u09BF\u09A8\u0964",
    en: "Apply TSP and MOP before transplanting. Split urea in 3 doses at 15, 30, 45 days.",
  },
  "\u09B0\u09CB\u0997|\u09AA\u09CB\u0995\u09BE|disease|pest|blast|blight": {
    bn: "\u09AC\u09CD\u09B2\u09BE\u09B8\u09CD\u099F \u09B0\u09CB\u0997\u09C7 \u099F\u09CD\u09B0\u09BE\u0987\u09B8\u09BE\u0987\u0995\u09CD\u09B2\u09BE\u099C\u09B2 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964 DAE \u0989\u09AA\u099C\u09C7\u09B2\u09BE \u0985\u09AB\u09BF\u09B8\u09C7 \u09AF\u09CB\u0997\u09BE\u09AF\u09CB\u0997 \u0995\u09B0\u09C1\u09A8\u0964",
    en: "For blast disease use tricyclazole. Contact local DAE Upazila office.",
  },
  "\u0986\u09B2\u09C1|potato": {
    bn: "BARI \u0986\u09B2\u09C1-\u09ED \u09AC\u09BE \u09EE \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964 \u09A8\u09AD\u09C7\u09AE\u09CD\u09AC\u09B0-\u099C\u09BE\u09A8\u09C1\u09AF\u09BC\u09BE\u09B0\u09BF \u09B0\u09CB\u09AA\u09A3\u09C7\u09B0 \u09B8\u09AE\u09AF\u09BC\u0964",
    en: "Use BARI Alu-7 or 8. Plant November to January.",
  },
  "\u0986\u09AC\u09B9\u09BE\u0993\u09AF\u09BC\u09BE|weather|\u09AC\u09C3\u09B7\u09CD\u099F\u09BF|rain": {
    bn: "\u0986\u09AC\u09B9\u09BE\u0993\u09AF\u09BC\u09BE \u09A4\u09A5\u09CD\u09AF\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF /v1/weather \u098F\u09A8\u09CD\u09A1\u09AA\u09AF\u09BC\u09C7\u09A8\u09CD\u099F \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964",
    en: "Use the /v1/weather endpoint for live weather and pest risk data.",
  },
};

function ruleBasedResponse(message: string, lang: string): string {
  const lower = message.toLowerCase();
  for (const [pattern, response] of Object.entries(RULES)) {
    if (new RegExp(pattern).test(lower)) {
      return lang === "bn" ? response.bn : response.en;
    }
  }
  return lang === "bn"
    ? "DAE \u09B9\u099F\u09B2\u09BE\u0987\u09A8\u09C7 \u0995\u09B2 \u0995\u09B0\u09C1\u09A8: \u09E7\u09EC\u09E7\u09E8\u09E9"
    : "Call DAE hotline: 16123";
}

async function callGemini(apiKey: string, message: string, systemPrompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: message }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data: any = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response");
  return text.trim();
}

async function callOpenRouter(apiKey: string, model: string, message: string, systemPrompt: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://krishiai.live",
      "X-Title": "Krishi AI",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      max_tokens: 400,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}`);
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty response");
  return text.trim();
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return errorResponse(request, "Unauthorized \u2014 missing or invalid X-Krishi-Token", 401);
  }
  const rateLimit = await checkRateLimit(request, env, "chat");
  if (!rateLimit.allowed) {
    return errorResponse(request, "Rate limit exceeded \u2014 try again in a minute", 429);
  }

  const body = (await request.json()) as { message?: string; language?: string };
  const message = body.message?.trim();
  const language = body.language ?? "bn";
  if (!message) return errorResponse(request, "message required", 400);

  const systemPrompt =
    language === "bn"
      ? "\u0986\u09AA\u09A8\u09BF \u0995\u09C3\u09B7\u09BF AI\u0964 BRRI, BARI, DAE \u09AE\u09BE\u09A8\u09A6\u09A3\u09CD\u09A1 \u0985\u09A8\u09C1\u09B8\u09B0\u09A3 \u0995\u09B0\u09C7 \u09B8\u09B9\u099C \u09AC\u09BE\u0982\u09B2\u09BE\u09AF\u09BC \u09B8\u09B0\u09CD\u09AC\u09CB\u099A\u09CD\u099A \u09E7\u09EB\u09E6 \u09B6\u09AC\u09CD\u09A6\u09C7 \u0989\u09A4\u09CD\u09A4\u09B0 \u09A6\u09BF\u09A8\u0964"
      : "You are Krishi AI. Answer in under 150 words following BRRI, BARI, DAE standards.";

  const timeout = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))]);

  // Every tier below is free of charge:
  // - Gemini: free-tier Google AI Studio key (generativelanguage.googleapis.com), rate-limited, no billing.
  // - OpenRouter tiers: only ":free"-suffixed / $0 models. "openrouter/free" is OpenRouter's
  //   auto-router across whatever free models are currently available, so it keeps working even
  //   if a specific free model is retired. Never pass a paid model id here.
  // - rule-based: no API call at all.
  const chain = [
    { name: "gemini-2.0-flash", tier: 1, fn: () => callGemini(env.GEMINI_API_KEY, message, systemPrompt) },
    { name: "nex-n2.5-pro-free", tier: 2, fn: () => callOpenRouter(env.OPENROUTER_API_KEY, "nex-agi/nex-n2.5-pro:free", message, systemPrompt) },
    { name: "openrouter-free-router", tier: 3, fn: () => callOpenRouter(env.OPENROUTER_API_KEY, "openrouter/free", message, systemPrompt) },
    { name: "rule-based", tier: 4, fn: () => Promise.resolve(ruleBasedResponse(message, language)) },
  ];

  for (const step of chain) {
    try {
      const reply = await timeout(step.fn());
      return new Response(
        JSON.stringify({ reply, model: step.name, tier: step.tier, fallback: step.tier > 1 }),
        {
          headers: {
            ...corsHeadersFor(request),
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": String(rateLimit.remaining),
          },
        }
      );
    } catch {
      continue;
    }
  }
  return errorResponse(request, "All tiers failed", 503);
}
