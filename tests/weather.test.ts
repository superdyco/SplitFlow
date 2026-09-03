import { describe, expect, it } from "vitest";
import { weatherKind } from "@/types/weather";

/**
 * WMO 有 28 個代碼，畫面上只需要分辨得出「那天大概是什麼樣子」，
 * 所以收成 8 組。分組錯了的症狀是「下雪的那天顯示太陽」——
 * 沒有任何錯誤訊息，只有一個看起來很正常的錯圖示。
 */
describe("weatherKind", () => {
  it("0 是晴", () => {
    expect(weatherKind(0)).toBe("clear");
  });

  it("1–2 是多雲，3 是陰", () => {
    expect(weatherKind(1)).toBe("cloudy");
    expect(weatherKind(2)).toBe("cloudy");
    expect(weatherKind(3)).toBe("overcast");
  });

  it("45、48 是霧", () => {
    expect(weatherKind(45)).toBe("fog");
    expect(weatherKind(48)).toBe("fog");
  });

  it("51–57 是毛毛雨", () => {
    expect(weatherKind(51)).toBe("drizzle");
    expect(weatherKind(55)).toBe("drizzle");
    expect(weatherKind(57)).toBe("drizzle");
  });

  it("61–67 與 80–82 是雨", () => {
    expect(weatherKind(61)).toBe("rain");
    expect(weatherKind(65)).toBe("rain");
    expect(weatherKind(80)).toBe("rain");
    expect(weatherKind(82)).toBe("rain");
  });

  it("71–77 與 85–86 是雪", () => {
    expect(weatherKind(71)).toBe("snow");
    expect(weatherKind(77)).toBe("snow");
    expect(weatherKind(85)).toBe("snow");
  });

  it("95–99 是雷", () => {
    expect(weatherKind(95)).toBe("thunder");
    expect(weatherKind(99)).toBe("thunder");
  });

  it("認不得的代碼退回陰天，不是晴天", () => {
    // 退回晴天的話，一個查錯的代碼會變成「那天天氣很好」——
    // 那是一句沒有根據的話。陰天是最中性的說法。
    expect(weatherKind(7)).toBe("overcast");
    expect(weatherKind(-1)).toBe("overcast");
  });
});
