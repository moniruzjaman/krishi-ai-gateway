import { Env } from "../index";
import { corsHeaders, errorResponse } from "../utils";

export async function handleWeather(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") ?? "");
  const lon = parseFloat(url.searchParams.get("lon") ?? "");
  if (isNaN(lat) || isNaN(lon)) return errorResponse("lat and lon required", 400);

  const gridLat = Math.round(lat * 10) / 10;
  const gridLon = Math.round(lon * 10) / 10;
  const cacheKey = `weather:${gridLat}:${gridLon}`;

  if (env.KRISHI_KV) {
    const cached = await env.KRISHI_KV.get(cacheKey, "text");
    if (cached) return new Response(cached, { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" } });
  }

  const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,precipitation_probability_max,et0_fao_evapotranspiration&timezone=Asia%2FDhaka&forecast_days=7`;
  const res = await fetch(meteoUrl);
  if (!res.ok) return errorResponse("Weather fetch failed", 502);
  const meteo: any = await res.json();

  const daily = meteo.daily.time.map((date: string, i: number) => ({
    date,
    temp_max: meteo.daily.temperature_2m_max[i],
    temp_min: meteo.daily.temperature_2m_min[i],
    rain_mm: meteo.daily.precipitation_sum[i],
    rain_prob: meteo.daily.precipitation_probability_max[i],
    wind_max: meteo.daily.wind_speed_10m_max[i],
    et0: meteo.daily.et0_fao_evapotranspiration[i],
  }));

  const pest_risk = daily.map((d: any) => ({
    date: d.date,
    blast: d.temp_max >= 25 && d.rain_mm >= 2 ? "HIGH" : d.rain_prob >= 40 ? "MEDIUM" : "LOW",
    brown_planthopper: d.temp_min >= 24 && d.rain_mm < 5 ? "HIGH" : "LOW",
    late_blight: d.temp_max < 25 && d.rain_mm >= 5 ? "HIGH" : "LOW",
    spray_safe: d.wind_max <= 20 && d.rain_mm < 5,
  }));

  const advisory = d => {
    if (d.rain_mm > 20) return "⚠️ ভারী বৃষ্টি — সেচ বন্ধ রাখুন";
    if (d.rain_mm < 2) return "💧 বৃষ্টি কম — সেচ দিন";
    return "✅ আবহাওয়া স্বাভাবিক";
  };

  const body = JSON.stringify({ daily, pest_risk, agri_advisory: advisory(daily[0]) });
  if (env.KRISHI_KV) await env.KRISHI_KV.put(cacheKey, body, { expirationTtl: 1800 });

  return new Response(body, { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" } });
}
