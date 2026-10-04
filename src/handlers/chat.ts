import type { Env } from "../utils";
import { corsHeadersFor, errorResponse, isAuthorized } from "../utils";
import { checkLimit } from "../rateLimit";
import { ruleBasedResponse } from "../rules";
import { DEFAULT_CHAIN, ProviderError, callStep, resolveCredential } from "../providers";
import type { ChainStep } from "../providers";
import { logUsage, prepare } from "../supabase";

const STEP_TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 25000;
const COOLDOWN_SECONDS = 60; // skip a provider/model for a minute after it rate-limits us
const MAX_TOKENS = 1024;
const MAX_MESSAGE_CHARS = 4000;
const MAX_IMAGE_B64_CHARS = 7_000_000; // ~5 MB
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];

interface ChatBody {
  message?: string;
  language?: string;
  app?: string;
  task?: string;
  image?: { mime?: string; data?: string };
}

function systemPromptFor(language: string, task: string): string {
  if (task === "diagnosis") {
    return language === "bn"
      ? "আপনি কৃষি AI, একজন উদ্ভিদ রোগ ও পোকা নির্ণয় বিশেষজ্ঞ। ছবি দেখে সম্ভাব্য সমস্যা, লক্ষণ এবং BRRI/BARI/DAE মানদণ্ড অনুযায়ী করণীয় সহজ বাংলায় সর্বোচ্চ ২০০ শব্দে বলুন। নিশ্চিত না হলে স্থানীয় DAE অফিসে যোগাযোগ করতে বলুন।"
      : "You are Krishi AI, a plant disease and pest diagnosis expert. From the photo, state the likely problem, symptoms and recommended action per BRRI/BARI/DAE standards in under 200 words. If unsure, advise contacting the local DAE office.";
  }
  return language === "bn"
    ? "আপনি কৃষি AI। BRRI, BARI, DAE মানদণ্ড অনুসরণ করে সহজ বাংলায় সর্বোচ্চ ১৫০ শব্দে উত্তর দিন।"
    : "You are Krishi AI. Answer in under 150 words following BRRI, BARI, DAE standards.";
}

export async function handleChat(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const started = Date.now();

  // --- Authentication: Supabase session (preferred) or legacy X-Krishi-Token ---
  const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const legacy = !bearer && isAuthorized(request, env);
  if (!bearer && !legacy) {
    return errorResponse(request, "Unauthorized — sign in or provide X-Krishi-Token", 401);
  }

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return errorResponse(request, "Invalid JSON body", 400);
  }
  const message = body.message?.trim();
  if (!message) return errorResponse(request, "message required", 400);
  if (message.length > MAX_MESSAGE_CHARS) return errorResponse(request, "message too long", 413);
  const language = body.language === "en" ? "en" : "bn";
  const app = /^[a-z0-9-]{1,40}$/.test(body.app ?? "") ? (body.app as string) : "krishiai";
  const task = /^[a-z0-9_-]{1,40}$/.test(body.task ?? "") ? (body.task as string) : body.image ? "diagnosis" : "chat";

  let image: { mime: string; data: string } | undefined;
  if (body.image?.data) {
    if (!body.image.mime || !IMAGE_MIMES.includes(body.image.mime)) return errorResponse(request, "image.mime must be jpeg, png or webp", 400);
    if (body.image.data.length > MAX_IMAGE_B64_CHARS) return errorResponse(request, "image too large (max ~5 MB)", 413);
    image = { mime: body.image.mime, data: body.image.data };
  }

  // --- Authorization, quota and routing ---
  let chain: ChainStep[] = DEFAULT_CHAIN;
  let rateRemaining = 0;
  let jwt: string | null = null;

  if (bearer) {
    jwt = bearer;
    const prep = await prepare(env, bearer, app, task);
    if (!prep.ok) {
      // Only fall back to the built-in chain for infrastructure problems, never for auth failures.
      if (!prep.transient) return errorResponse(request, prep.message, prep.status);
      jwt = null; // can't log usage if Supabase is down
    } else {
      if (prep.data.remaining_today <= 0) return errorResponse(request, "Daily AI limit reached for this app", 429);
      const rl = await checkLimit(env, `chat:${app}`, `u:${prep.data.user_id}`, prep.data.per_minute);
      if (!rl.allowed) return errorResponse(request, "Rate limit exceeded — try again in a minute", 429);
      rateRemaining = rl.remaining;
      if (prep.data.chain.length > 0) chain = prep.data.chain;
    }
  } else {
    const rl = await checkLimit(env, "chat", request.headers.get("X-Krishi-Token") ?? "legacy", 60);
    if (!rl.allowed) return errorResponse(request, "Rate limit exceeded — try again in a minute", 429);
    rateRemaining = rl.remaining;
  }

  // --- Eligible steps: free-only unless explicitly allowed, vision-capable if an image is attached ---
  const allowPaid = env.ALLOW_PAID_PROVIDERS === "true";
  const steps = chain.filter(
    (s) => (s.is_free || allowPaid) && (!image || s.capabilities?.includes("vision")) && resolveCredential(s, env) !== null
  );

  const input = { message, systemPrompt: systemPromptFor(language, task), maxTokens: MAX_TOKENS, image };
  const failures: string[] = [];
  let result: { text: string; step: ChainStep | null; tier: number; tokensIn?: number; tokensOut?: number } | null = null;

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    if (Date.now() - started > TOTAL_BUDGET_MS) { failures.push("budget"); break; }
    const coolKey = `cooldown:${step.provider}:${step.model_id}`;
    if (env.KRISHI_KV && (await env.KRISHI_KV.get(coolKey))) { failures.push(`${step.provider}:cooldown`); continue; }
    try {
      const out = await callStep(step, env, input, STEP_TIMEOUT_MS);
      result = { text: out.text, step, tier: idx + 1, tokensIn: out.tokensIn, tokensOut: out.tokensOut };
      break;
    } catch (e) {
      const status = e instanceof ProviderError ? e.status : undefined;
      failures.push(`${step.provider}:${status ?? (e as Error).message}`);
      if (status === 429 && env.KRISHI_KV) {
        ctx.waitUntil(env.KRISHI_KV.put(coolKey, "1", { expirationTtl: COOLDOWN_SECONDS }));
      }
    }
  }

  // Terminal tier: offline rules (text only — no meaningful answer for a photo)
  if (!result) {
    if (image) {
      if (jwt) ctx.waitUntil(logUsage(env, jwt, { app, task, provider: null, model: null, latencyMs: Date.now() - started, status: "failed", error: failures.join(",") }));
      return errorResponse(request, "Image analysis is temporarily unavailable — please try again shortly", 503);
    }
    result = { text: ruleBasedResponse(message, language), step: null, tier: steps.length + 1 };
  }

  if (jwt) {
    ctx.waitUntil(
      logUsage(env, jwt, {
        app, task,
        provider: result.step?.provider ?? "rules",
        model: result.step?.model_id ?? "rule-based",
        tokensIn: result.tokensIn, tokensOut: result.tokensOut,
        latencyMs: Date.now() - started,
        status: result.step ? "ok" : "fallback_rules",
        error: failures.length ? failures.join(",") : undefined,
      })
    );
  }

  return new Response(
    JSON.stringify({
      reply: result.text,
      model: result.step?.model_id ?? "rule-based",
      provider: result.step?.provider ?? "rules",
      tier: result.tier,
      fallback: result.tier > 1,
    }),
    {
      headers: {
        ...corsHeadersFor(request),
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": String(rateRemaining),
      },
    }
  );
}
