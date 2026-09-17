import type { Env } from "../utils";
import { corsHeadersFor, errorResponse } from "../utils";
import { checkRateLimit } from "../rateLimit";
import { calculatePestRisk, type DailyWeather } from "../pestRisk";

export async function handleWeather(request: Request, env: Env): Promise<Response> {
  const rateLimit = await checkRateLimit(request, env, "weather");
  if (!rateLimit.allowed) {
    return errorResponse(request, "Rate limit exceeded \u2014 try again in a minute", 429);
  }

  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") ?? "");
  const lon = parseFloat(url.searchParams.get("lon") ?? "");
  if (isNaN(lat) || isNaN(lon)) return errorResponse(request, "lat and lon required", 400);

  const gridLat = Math.round(lat * 10) / 10;
  const gridLon = Math.round(lon * 10) / 10;
  const cacheKey = `weather:${gridLat}:${gridLon}`;

  if (env.KRISHI_KV) {
    const cached = await env.KRISHI_KV.get(cacheKey, "text");
    if (cached) {
      return new Response(cached, {
        headers: { ...corsHeadersFor(request), "Content-Type": "application/json", "X-Cache": "HIT" },
      });
    }
  }

  const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,precipitation_probability_max,et0_fao_evapotranspiration&timezone=Asia%2FDhaka&forecast_days=7`;
  const res = await fetch(meteoUrl);
  if (!res.ok) return errorResponse(request, "Weather fetch failed", 502);

  const meteo: any = await res.json();
  const daily: DailyWeather[] = meteo.daily.time.map((date: string, i: number) => ({
    date,
    temp_max: meteo.daily.temperature_2m_max[i],
    temp_min: meteo.daily.temperature_2m_min[i],
    rain_mm: meteo.daily.precipitation_sum[i],
    rain_prob: meteo.daily.precipitation_probability_max[i],
    wind_max: meteo.daily.wind_speed_10m_max[i],
    et0: meteo.daily.et0_fao_evapotranspiration[i],
  }));

  const pest_risk = daily.map(calculatePestRisk);

  const advisory = (d: DailyWeather): string => {
    if (d.rain_mm > 20) return "\u26A0\uFE0F \u09AD\u09BE\u09B0\u09C0 \u09AC\u09C3\u09B7\u09CD\u099F\u09BF \u2014 \u09B8\u09C7\u099A \u09AC\u09A8\u09CD\u09A7 \u09B0\u09BE\u0996\u09C1\u09A8";
    if (d.rain_mm < 2) return "\u{1F4A7} \u09AC\u09C3\u09B7\u09CD\u099F\u09BF \u0995\u09AE \u2014 \u09B8\u09C7\u099A \u09A6\u09BF\u09A8";
    return "\u2705 \u0986\u09AC\u09B9\u09BE\u0993\u09AF\u09BC\u09BE \u09B8\u09CD\u09AC\u09BE\u09AD\u09BE\u09AC\u09BF\u0995";
  };

  const body = JSON.stringify({ daily, pest_risk, agri_advisory: advisory(daily[0]) });

  if (env.KRISHI_KV) await env.KRISHI_KV.put(cacheKey, body, { expirationTtl: 1800 });

  return new Response(body, {
    headers: { ...corsHeadersFor(request), "Content-Type": "application/json", "X-Cache": "MISS" },
  });
}
