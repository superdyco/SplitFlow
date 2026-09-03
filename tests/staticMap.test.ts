import { describe, expect, it } from "vitest";
import { mappablePlaces, MAX_MARKERS } from "@/services/staticMap";
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

  // 二十幾個地點的旅程很正常，那些不該從地圖上消失。
  it("一般規模的旅程一個標記都不截", () => {
    const many = Array.from({ length: 60 }, (_, index) => place({ name: `地點${index}` }));

    expect(mappablePlaces(many)).toHaveLength(60);
  });

  it("多到 URL 會爆掉才截，截掉的是金額最小的那些", () => {
    const many = Array.from({ length: MAX_MARKERS + 5 }, (_, index) =>
      place({ name: `地點${index}` })
    );
    const result = mappablePlaces(many);

    expect(result).toHaveLength(MAX_MARKERS);
    // 呼叫端已經照金額排好序，所以截掉的是金額最小的那些。
    expect(result[0].name).toBe("地點0");
  });

  // 上限的意義就是「網址塞得下」，所以直接量網址。
  it("塞到上限時網址仍在 Static Maps 的 16384 字元限制內", () => {
    const many = Array.from({ length: MAX_MARKERS }, () =>
      place({ lat: -123.456789, lng: -123.456789 })
    );
    const markers = `color:0xe8590c|${many.map(p => `${p.lat},${p.lng}`).join("|")}`;

    expect(`markers=${markers}`.length).toBeLessThan(16384 - 1384);
  });
});
