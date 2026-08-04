import { describe, expect, it } from "vitest";
import { mappablePlaces, reportMapPath } from "@/services/staticMap";
import type { PlaceTotal } from "@/utils/placeTotals";

function place(overrides: Partial<PlaceTotal> = {}): PlaceTotal {
  return {
    name: "大皇宮",
    placeId: "p_palace",
    lat: 13.75,
    lng: 100.49,
    total: 10000,
    expenseCount: 1,
    ...overrides
  };
}

describe("mappablePlaces", () => {
  it("排除沒有座標的地點 —— 純文字打的地點畫不到地圖上", () => {
    const result = mappablePlaces([
      place(),
      place({ name: "路邊攤", placeId: null, lat: null, lng: null }),
      place({ name: "未指定地點", placeId: null, lat: null, lng: null })
    ]);

    expect(result.map(item => item.name)).toEqual(["大皇宮"]);
  });

  it("一個座標都沒有時回傳空陣列 —— 呼叫端據此說明為什麼沒有地圖", () => {
    expect(mappablePlaces([place({ lat: null, lng: null })])).toEqual([]);
  });

  it("經緯度 0 要留著 —— 用 != null 而不是 truthy 判斷", () => {
    expect(mappablePlaces([place({ lat: 0, lng: 0 })])).toHaveLength(1);
  });

  it("最多 20 個標記，超過的截掉免得 URL 太長", () => {
    const many = Array.from({ length: 25 }, (_, index) => place({ name: `地點${index}` }));
    const result = mappablePlaces(many);

    expect(result).toHaveLength(20);
    // 呼叫端已經照金額排好序，所以截掉的是金額最小的那些。
    expect(result[0].name).toBe("地點0");
  });
});

describe("reportMapPath", () => {
  // 這個路徑必須跟 storage.rules 裡公開讀取的那條 match 對得起來，
  // 對不上的話圖傳得上去但公開頁面讀不到。
  it("對得上 storage.rules 的公開路徑", () => {
    expect(reportMapPath("t1", "r1")).toBe("tasks/t1/reports/r1/map.png");
  });
});
