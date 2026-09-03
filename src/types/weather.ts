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

/**
 * 每一組的中文名。
 *
 * 加這個是因為 14px 的圖示分不出「雷雨」與「毛毛雨」—— 在小尺寸下，
 * 兩個字比任何圖示都好認。圖示負責一眼掃到，文字負責講清楚。
 */
export const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: "晴",
  cloudy: "多雲",
  overcast: "陰",
  fog: "霧",
  drizzle: "毛毛雨",
  rain: "雨",
  snow: "雪",
  thunder: "雷雨"
};

/**
 * 圖示的顏色。**只有三種，不是八種。**
 *
 * 顏色講「哪一類」，形狀與文字講「哪一個」。八種顏色會讓一個小圖示變成
 * 調色盤，而且藍色系彼此根本分不出來 —— 分辨毛毛雨與大雨本來就該靠文字。
 *
 * 藍色是這個 app 唯一的非暖色，刻意只加這一個：天氣是少數「藍色代表水」
 * 比品牌一致性更有用的地方，但那不是把調色盤打開的理由。
 */
export function weatherColor(kind: WeatherKind): string {
  switch (kind) {
    case "clear":
      return "var(--color-primary)";
    case "thunder":
      return "var(--color-primary-dark)";
    case "drizzle":
    case "rain":
    case "snow":
      return "var(--color-weather-wet)";
    default:
      return "var(--color-muted)";
  }
}
