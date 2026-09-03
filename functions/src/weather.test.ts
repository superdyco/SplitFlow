import { describe, expect, it } from "vitest";
import { readWeather, weatherUrl } from "./weather.js";

/**
 * 真實回應的片段。**這是實際打過 API 抄回來的**（2026-08-20，曼谷），
 * 不是照文件寫的 —— 參數名一度被記成 `weathercode`，實際上是 `weather_code`。
 */
const RESPONSE = {
  timezone: "Asia/Bangkok",
  daily: {
    time: ["2026-08-20"],
    weather_code: [95],
    temperature_2m_max: [29.6],
    temperature_2m_min: [25.0]
  },
  hourly: {
    time: ["2026-08-20T18:00", "2026-08-20T19:00", "2026-08-20T20:00"],
    temperature_2m: [25.5, 26.5, 26.3],
    weather_code: [81, 53, 3]
  }
};

describe("weatherUrl", () => {
  const at = { lat: 13.75, lng: 100.5, date: "2026-08-20" };

  it("過去的日期走 archive —— 它涵蓋 1940 年到今天，沒有邊界要煩惱", () => {
    const url = weatherUrl({ ...at, today: "2026-09-03" });
    expect(url).toContain("archive-api.open-meteo.com");
  });

  it("今天走 forecast —— archive 只給到目前為止，早上記帳會拿到不完整的高溫", () => {
    const url = weatherUrl({ ...at, date: "2026-09-03", today: "2026-09-03" });
    expect(url).toContain("api.open-meteo.com/v1/forecast");
  });

  it("未來走 forecast —— archive 直接回 400", () => {
    const url = weatherUrl({ ...at, date: "2026-09-10", today: "2026-09-03" });
    expect(url).toContain("api.open-meteo.com/v1/forecast");
  });

  it("一定要帶 timezone=auto", () => {
    // 不帶的話回的是 UTC，曼谷的 19:05 會對到當地凌晨兩點的溫度，
    // 而畫面上完全看不出來。
    expect(weatherUrl({ ...at, today: "2026-09-03" })).toContain("timezone=auto");
  });

  it("日期同時當成起訖，只查那一天", () => {
    const url = weatherUrl({ ...at, today: "2026-09-03" });
    expect(url).toContain("start_date=2026-08-20");
    expect(url).toContain("end_date=2026-08-20");
  });

  it("同時要 daily 與 hourly —— 有沒有填時間是呼叫端之後才決定的", () => {
    const url = weatherUrl({ ...at, today: "2026-09-03" });
    expect(url).toContain("daily=");
    expect(url).toContain("hourly=");
  });
});

describe("readWeather", () => {
  it("沒有時間就只給當日高低，exact 是 null", () => {
    expect(readWeather(RESPONSE, "")).toEqual({
      code: 95,
      high: 30,
      low: 25,
      exact: null
    });
  });

  it("有時間就取那個小時的實測值", () => {
    const result = readWeather(RESPONSE, "19:05");
    expect(result?.exact).toBe(27); // 26.5 四捨五入
  });

  it("code 仍然用當日的，不用那小時的", () => {
    // 19:00 那小時是 53（毛毛雨），但那天有雷雨（95）。
    // 圖示要講「那天是什麼樣子」，不是「那一刻剛好在下什麼」。
    expect(readWeather(RESPONSE, "19:05")?.code).toBe(95);
  });

  it("時間對不到任何一個小時就退回沒有 exact，不是丟例外", () => {
    expect(readWeather(RESPONSE, "03:00")?.exact).toBeNull();
  });

  it("錯誤回應回 null —— 不丟例外，缺席是正常狀態", () => {
    expect(readWeather({ error: true, reason: "out of range" }, "")).toBeNull();
  });

  it("欄位缺漏也回 null", () => {
    expect(readWeather({ daily: { time: [] } }, "")).toBeNull();
    expect(readWeather({}, "")).toBeNull();
    expect(readWeather(null, "")).toBeNull();
  });
});
