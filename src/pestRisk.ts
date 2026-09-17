export interface DailyWeather {
  date: string;
  temp_max: number;
  temp_min: number;
  rain_mm: number;
  rain_prob: number;
  wind_max: number;
  et0: number;
}

export interface PestRisk {
  date: string;
  blast: "HIGH" | "MEDIUM" | "LOW";
  brown_planthopper: "HIGH" | "LOW";
  late_blight: "HIGH" | "LOW";
  spray_safe: boolean;
}

export function calculatePestRisk(d: DailyWeather): PestRisk {
  return {
    date: d.date,
    // Rice blast: thrives in warm, wet conditions
    blast: d.temp_max >= 25 && d.rain_mm >= 2 ? "HIGH" : d.rain_prob >= 40 ? "MEDIUM" : "LOW",
    // Brown planthopper: warm nights + dry conditions favor outbreaks
    brown_planthopper: d.temp_min >= 24 && d.rain_mm < 5 ? "HIGH" : "LOW",
    // Late blight (potato/tomato): cool + wet conditions
    late_blight: d.temp_max < 25 && d.rain_mm >= 5 ? "HIGH" : "LOW",
    // Safe to spray pesticide: low wind (drift risk) and dry (won't wash off)
    spray_safe: d.wind_max <= 20 && d.rain_mm < 5,
  };
}
