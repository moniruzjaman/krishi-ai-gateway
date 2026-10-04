# Krishi AI Gateway

Shared AI gateway for every app under `krishiai.live` (Cloudflare Worker at `api.krishiai.live`).

## POST /v1/chat

Auth (one of):
- `Authorization: Bearer <Supabase access token>` — preferred. Checks app membership and daily quota in Supabase, logs usage per user/app.
- `X-Krishi-Token: <token>` — legacy clients; uses the built-in chain, no per-user quota.

```json
{ "message": "ধানে ব্লাস্ট রোগ হলে কী করব?", "language": "bn", "app": "cabi", "task": "chat",
  "image": { "mime": "image/jpeg", "data": "<base64>" } }
```
`app` defaults to `krishiai`; `task` defaults to `chat` (`diagnosis` when an image is attached).

Response: `{ reply, model, provider, tier, fallback }`.

## Fallback chain

The chain comes from Supabase (`ai_routes` → `ai_models` → `ai_providers`, via the `ai_prepare` RPC) so models can be
re-ordered or swapped without redeploying. Per-app chains override the default chain. If Supabase is unreachable the
built-in `DEFAULT_CHAIN` (src/providers.ts) is used. Order: Gemini → Groq → Gemini Flash-Lite → OpenRouter free →
Hugging Face → offline rule-based answers. Providers that return 429 are skipped for 60 s.

Paid providers (Anthropic, xAI) are inactive in the database **and** ignored by the Worker unless
`ALLOW_PAID_PROVIDERS="true"`.

## Security notes
- Only allow-listed provider hosts and secret names can be used, regardless of what the database says.
- The Worker calls Supabase as the signed-in user (RLS applies); no service-role key is stored here.

## Secrets
`npx wrangler secret put <NAME>` for: `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`,
`SUPABASE_ANON_KEY` (publishable key), `KRISHI_API_TOKEN`. Optional paid: `ANTHROPIC_API_KEY`, `XAI_API_KEY`.
`GET /v1/status` (with `X-Krishi-Token`) shows which are configured.
