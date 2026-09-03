/**
 * 支出上的天氣。`functions/src/weather.ts` 的 `WeatherResult` 在前端的對應型別。
 *
 * 兩邊各自宣告而不是共用：`functions/` 與 `src/` 是兩個獨立套件。
 * 形狀要對得上，改一邊要記得改另一邊 —— 這是這個切分的已知代價。
 */
export interface ExpenseWeather {
  /** WMO 天氣代碼 0–99。 */
  code: number;
  /** 當日最高溫，攝氏整數。 */
  high: number;
  /** 當日最低溫，攝氏整數。 */
  low: number;
  /** 那個小時的實測溫度。**只有支出填了時間才有。** */
  exact: number | null;
}

/** 畫面上分辨得出來的八種天氣。 */
export type WeatherKind =
  | "clear"
  | "cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

/**
 * WMO 的 28 個代碼收成 8 組。
 *
 * 認不得的一律當陰天。**方向很重要**：退回晴天的話，一個查錯的代碼會變成
 * 「那天天氣很好」，那是一句沒有根據的話；陰天是最中性的說法。
 */
export function weatherKind(code: number): WeatherKind {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95 && code <= 99) return "thunder";
  return "overcast";
}
