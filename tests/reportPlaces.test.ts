import { describe, expect, it } from "vitest";
import { visiblePlaces } from "@/utils/reportPlaces";
import { NO_PLACE_LABEL, type PlaceTotal } from "@/utils/placeTotals";

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

describe("visiblePlaces", () => {
  it("最多顯示 8 個，其餘回報成 hiddenCount", () => {
    const many = Array.from({ length: 11 }, (_, index) =>
      place({ name: `地點${index}`, total: 1000 - index })
    );
    const result = visiblePlaces(many);

    expect(result.rows).toHaveLength(8);
    expect(result.hiddenCount).toBe(3);
  });

  // 報告頁的「還有 N 個地點」按下去就是拿 Infinity 再算一次。
  it("上限放寬時全部顯示，hiddenCount 歸零", () => {
    const many = Array.from({ length: 11 }, (_, index) =>
      place({ name: `地點${index}`, total: 1000 - index })
    );
    const result = visiblePlaces(many, Infinity);

    expect(result.rows).toHaveLength(11);
    expect(result.hiddenCount).toBe(0);
  });

  it("沒有超過上限時 hiddenCount 是 0", () => {
    expect(visiblePlaces([place()]).hiddenCount).toBe(0);
  });

  it("金額最大的地點長條滿格", () => {
    const result = visiblePlaces([place({ total: 8000 }), place({ name: "廟", total: 2000 })]);

    expect(result.rows[0].bar).toBe(1);
    expect(result.rows[1].bar).toBe(0.25);
  });

  // 「未指定地點」不是目的地，是把剩下的錢交代清楚的那一列。
  // 畫長條會讓人以為那是個花很多錢的地方。
  it("未指定地點不畫長條", () => {
    const result = visiblePlaces([
      place({ total: 5000 }),
      place({ name: NO_PLACE_LABEL, placeId: null, lat: null, lng: null, total: 3000 })
    ]);

    expect(result.rows[1].bar).toBeNull();
  });

  // placeTotals 把「未指定地點」固定排最後，但它的金額可能是全場最大。
  // 拿它當基準的話，真正的地點全部都不會滿格。
  it("未指定地點金額最大時，不影響其他地點的長條基準", () => {
    const result = visiblePlaces([
      place({ name: "大皇宮", total: 4000 }),
      place({ name: NO_PLACE_LABEL, placeId: null, lat: null, lng: null, total: 90000 })
    ]);

    expect(result.rows[0].bar).toBe(1);
  });

  // 基準取「顯示出來的」最大值：被收起來的那些使用者看不到，
  // 拿看不到的東西當基準會讓第一列莫名其妙不滿格。
  it("基準只看顯示出來的那幾個", () => {
    const rows = [place({ name: "A", total: 100 }), place({ name: "B", total: 50 })];

    expect(visiblePlaces(rows, 1).rows[0].bar).toBe(1);
  });

  it("全部都是未指定地點時不會除以零", () => {
    const result = visiblePlaces([
      place({ name: NO_PLACE_LABEL, placeId: null, lat: null, lng: null, total: 500 })
    ]);

    expect(result.rows[0].bar).toBeNull();
  });

  it("空陣列不會爆", () => {
    expect(visiblePlaces([])).toEqual({ rows: [], hiddenCount: 0 });
  });
});
