import type { Env } from "./utils";

export interface ChainStep {
  priority: number;
  provider: string;
  protocol: "gemini" | "openai" | "anthropic";
  base_url: string | null;
  secret_name: string | null;
  is_free: boolean;
  model_id: string;
  capabilities: string[];
}

export interface ChatInput {
  message: string;
  systemPrompt: string;
  maxTokens: number;
  image?: { mime: string; data: string };
}

export interface ChatOutput {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

export class ProviderError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

// Routing config lives in the database, so lock down what it can point at:
// only these hosts may receive requests, and only these secrets may be used as credentials.
const ALLOWED_HOSTS = new Set([
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "openrouter.ai",
  "router.huggingface.co",
  "api.anthropic.com",
  "api.x.ai",
]);
const ALLOWED_SECRETS = ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "HF_TOKEN", "ANTHROPIC_API_KEY", "XAI_API_KEY"] as const;

export function resolveCredential(step: ChainStep, env: Env): { baseUrl: string; apiKey: string } | null {
  if (!step.base_url || !step.secret_name) return null;
  if (!(ALLOWED_SECRETS as readonly string[]).includes(step.secret_name)) return null;
  let host: string;
  try {
    const u = new URL(step.base_url);
    if (u.protocol !== "https:") return null;
    host = u.hostname;
  } catch {
    return null;
  }
  if (!ALLOWED_HOSTS.has(host)) return null;
  const apiKey = (env as unknown as Record<string, string | undefined>)[step.secret_name];
  if (!apiKey) return null;
  return { baseUrl: step.base_url.replace(/\/+$/, ""), apiKey };
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new ProviderError(`HTTP ${res.status}`, res.status);
    return await res.json();
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError((e as Error).name === "AbortError" ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(base: string, key: string, model: string, i: ChatInput, timeoutMs: number): Promise<ChatOutput> {
  const parts: unknown[] = [{ text: i.message }];
  if (i.image) parts.push({ inline_data: { mime_type: i.image.mime, data: i.image.data } });
  const data = await post(
    `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": key },
    {
      system_instruction: { parts: [{ text: i.systemPrompt }] },
      contents: [{ role: "user", parts }],
      generationConfig: { maxOutputTokens: i.maxTokens, temperature: 0.7 },
    },
    timeoutMs
  );
  const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("").trim();
  if (!text) throw new ProviderError("empty");
  return { text, tokensIn: data?.usageMetadata?.promptTokenCount, tokensOut: data?.usageMetadata?.candidatesTokenCount };
}

async function callOpenAI(base: string, key: string, model: string, i: ChatInput, timeoutMs: number): Promise<ChatOutput> {
  const userContent: unknown = i.image
    ? [
        { type: "text", text: i.message },
        { type: "image_url", image_url: { url: `data:${i.image.mime};base64,${i.image.data}` } },
      ]
    : i.message;
  const data = await post(
    `${base}/chat/completions`,
    { Authorization: `Bearer ${key}`, "HTTP-Referer": "https://krishiai.live", "X-Title": "Krishi AI" },
    {
      model,
      messages: [
        { role: "system", content: i.systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: i.maxTokens,
    },
    timeoutMs
  );
  const text = data?.choices?.[0]?.message?.content?.trim?.();
  if (!text) throw new ProviderError("empty");
  return { text, tokensIn: data?.usage?.prompt_tokens, tokensOut: data?.usage?.completion_tokens };
}

async function callAnthropic(base: string, key: string, model: string, i: ChatInput, timeoutMs: number): Promise<ChatOutput> {
  const content: unknown[] = [];
  if (i.image) content.push({ type: "image", source: { type: "base64", media_type: i.image.mime, data: i.image.data } });
  content.push({ type: "text", text: i.message });
  const data = await post(
    `${base}/v1/messages`,
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    { model, max_tokens: i.maxTokens, system: i.systemPrompt, messages: [{ role: "user", content }] },
    timeoutMs
  );
  const text = (data?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("").trim();
  if (!text) throw new ProviderError("empty");
  return { text, tokensIn: data?.usage?.input_tokens, tokensOut: data?.usage?.output_tokens };
}

export async function callStep(step: ChainStep, env: Env, input: ChatInput, timeoutMs: number): Promise<ChatOutput> {
  const cred = resolveCredential(step, env);
  if (!cred) throw new ProviderError("not-configured");
  switch (step.protocol) {
    case "gemini":
      return callGemini(cred.baseUrl, cred.apiKey, step.model_id, input, timeoutMs);
    case "anthropic":
      return callAnthropic(cred.baseUrl, cred.apiKey, step.model_id, input, timeoutMs);
    default:
      return callOpenAI(cred.baseUrl, cred.apiKey, step.model_id, input, timeoutMs);
  }
}

// Used when the database is unreachable or has no routes, and for legacy X-Krishi-Token clients.
export const DEFAULT_CHAIN: ChainStep[] = [
  { priority: 1, provider: "gemini", protocol: "gemini", base_url: "https://generativelanguage.googleapis.com", secret_name: "GEMINI_API_KEY", is_free: true, model_id: "gemini-flash-latest", capabilities: ["text", "vision"] },
  { priority: 2, provider: "groq", protocol: "openai", base_url: "https://api.groq.com/openai/v1", secret_name: "GROQ_API_KEY", is_free: true, model_id: "llama-3.3-70b-versatile", capabilities: ["text"] },
  { priority: 3, provider: "openrouter", protocol: "openai", base_url: "https://openrouter.ai/api/v1", secret_name: "OPENROUTER_API_KEY", is_free: true, model_id: "nex-agi/nex-n2.5-pro:free", capabilities: ["text"] },
  { priority: 4, provider: "openrouter", protocol: "openai", base_url: "https://openrouter.ai/api/v1", secret_name: "OPENROUTER_API_KEY", is_free: true, model_id: "openrouter/free", capabilities: ["text"] },
  { priority: 5, provider: "huggingface", protocol: "openai", base_url: "https://router.huggingface.co/v1", secret_name: "HF_TOKEN", is_free: true, model_id: "meta-llama/Llama-3.3-70B-Instruct", capabilities: ["text"] },
];
