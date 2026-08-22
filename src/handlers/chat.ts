import { Env } from "../index";
import { corsHeaders, errorResponse } from "../utils";

const RULES: Record<string, { bn: string; en: string }> = {
  "ধান|rice|paddy|boro|aman": {
    bn: "BRRI পরামর্শ: বোরো মৌসুমে BRRI ধান-28 বা 29 ব্যবহার করুন। বিঘা প্রতি ইউরিয়া ১৩কেজি, TSP ৭কেজি, MOP ১০কেজি।",
    en: "BRRI: Use BRRI dhan-28 or 29 for Boro. Apply urea 13kg, TSP 7kg, MOP 10kg per bigha.",
  },
  "সার|fertilizer|urea": {
    bn: "সার প্রয়োগ: TSP ও MOP রোপণের আগে দিন। ইউরিয়া ১৫, ৩০, ৪৫ দিন পর তিনভাগে দিন।",
    en: "Apply TSP and MOP before transplanting. Split urea in 3 doses at 15, 30, 45 days.",
  },
  "রোগ|পোকা|disease|pest|blast|blight": {
    bn: "ব্লাস্ট রোগে ট্রাইসাইক্লাজল ব্যবহার করুন। DAE উপজেলা অফিসে যোগাযোগ করুন।",
    en: "For blast disease use tricyclazole. Contact local DAE Upazila office.",
  },
  "আলু|potato": {
    bn: "BARI আলু-৭ বা ৮ ব্যবহার করুন। নভেম্বর-জানুয়ারি রোপণের সময়।",
    en: "Use BARI Alu-7 or 8. Plant November to January.",
  },
  "আবহাওয়া|weather|বৃষ্টি|rain": {
    bn: "আবহাওয়া তথ্যের জন্য /v1/weather এন্ডপয়েন্ট ব্যবহার করুন।",
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
    ? "DAE হটলাইনে কল করুন: 16123"
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
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }],
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
  const body: any = await request.json();
  const message = body.message?.trim();
  const language = body.language ?? "bn";
  if (!message) return errorResponse("message required", 400);

  const systemPrompt = language === "bn"
    ? "আপনি কৃষি AI। BRRI, BARI, DAE মানদণ্ড অনুসরণ করে সহজ বাংলায় সর্বোচ্চ ১৫০ শব্দে উত্তর দিন।"
    : "You are Krishi AI. Answer in under 150 words following BRRI, BARI, DAE standards.";

  const timeout = (p: Promise<any>) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 8000))]);

  const chain = [
    { name: "gemini-2.0-flash", tier: 1, fn: () => callGemini(env.GEMINI_API_KEY, message, systemPrompt) },
    { name: "gemini-1.5-flash", tier: 2, fn: () => callOpenRouter(env.OPENROUTER_API_KEY, "google/gemini-flash-1.5", message, systemPrompt) },
    { name: "llama-3.1-8b", tier: 3, fn: () => callOpenRouter(env.OPENROUTER_API_KEY, "meta-llama/llama-3.1-8b-instruct:free", message, systemPrompt) },
    { name: "rule-based", tier: 4, fn: () => Promise.resolve(ruleBasedResponse(message, language)) },
  ];

  for (const step of chain) {
    try {
      const reply = await timeout(step.fn()) as string;
      return new Response(JSON.stringify({ reply, model: step.name, tier: step.tier, fallback: step.tier > 1 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (_) { continue; }
  }

  return errorResponse("All tiers failed", 503);
}
