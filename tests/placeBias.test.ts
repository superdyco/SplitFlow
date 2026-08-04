import { describe, expect, it } from "vitest";
import { BIAS_RADIUS_M, biasFromPlaces, locationBias } from "@/utils/placeBias";
import type { ExpensePlace } from "@/types/expense";

function place(overrides: Partial<ExpensePlace> = {}): ExpensePlace {
  return {
    name: "某間店",
    address: null,
    lat: 13.7563,
    lng: 100.5018,
    placeId: "p1",
    ...overrides
  };
}

/** 沒有座標的地點：使用者只打了名字、沒從建議清單選。 */
const textOnly = place({ lat: null, lng: null, placeId: null });

describe("biasFromPlaces", () => {
  it("拿最前面那個有座標的 —— 呼叫端會由新到舊傳進來", () => {
    expect(biasFromPlaces([place({ lat: 35.68, lng: 139.76 }), place()])).toEqual({
      lat: 35.68,
      lng: 139.76
    });
  });

  it("跳過沒有地點的支出", () => {
    expect(biasFromPlaces([null, null, place()])).toEqual({ lat: 13.7563, lng: 100.5018 });
  });

  it("跳過只有名字、沒有座標的地點", () => {
    expect(biasFromPlaces([textOnly, place()])).toEqual({ lat: 13.7563, lng: 100.5018 });
  });

  it("整趟都沒有座標就回傳 null，讓搜尋退回原本的全球結果", () => {
    expect(biasFromPlaces([null, textOnly])).toBeNull();
  });

  it("空清單也是 null —— 第一筆支出本來就沒有東西可以參考", () => {
    expect(biasFromPlaces([])).toBeNull();
  });

  it("經緯度是 0 仍然是有效座標，不能被當成沒有值", () => {
    expect(biasFromPlaces([place({ lat: 0, lng: 0 })])).toEqual({ lat: 0, lng: 0 });
  });
});

describe("locationBias", () => {
  it("沒有中心點就不要送這個欄位", () => {
    expect(locationBias(null)).toBeUndefined();
  });

  it("有中心點就包成 Places API 要的圓形範圍", () => {
    expect(locationBias({ lat: 13.7563, lng: 100.5018 })).toEqual({
      circle: {
        center: { latitude: 13.7563, longitude: 100.5018 },
        radius: BIAS_RADIUS_M
      }
    });
  });

  it("半徑要涵蓋一整座城市，但不能超過 Places API 的 50km 上限", () => {
    expect(BIAS_RADIUS_M).toBeGreaterThan(5000);
    expect(BIAS_RADIUS_M).toBeLessThanOrEqual(50000);
  });
});
