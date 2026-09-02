import { describe, expect, it } from "vitest";
import { currentPlace, shouldSearchPlace } from "@/utils/placeSearch";
import type { ExpensePlace } from "@/types/expense";

const ramen: ExpensePlace = {
  name: "一蘭拉麵",
  address: "台北市中山區",
  lat: 25.05,
  lng: 121.52,
  placeId: "abc123"
};

describe("currentPlace", () => {
  it("沒打字就是沒有地點", () => {
    expect(currentPlace("", null)).toBeNull();
    expect(currentPlace("   ", null)).toBeNull();
  });

  it("只有空白也不算 —— 連選過建議都一樣", () => {
    // 選完再全部刪掉只剩空白，那就是把地點清掉了。
    expect(currentPlace("   ", ramen)).toBeNull();
  });

  it("只打了名字沒選建議，座標一律是 null", () => {
    expect(currentPlace("晚餐", null)).toEqual({
      name: "晚餐",
      address: null,
      lat: null,
      lng: null,
      placeId: null
    });
  });

  it("名字跟選過的建議一致，回那一份完整的", () => {
    expect(currentPlace("一蘭拉麵", ramen)).toBe(ramen);
  });

  it("前後空白不影響是否與選過的建議相符", () => {
    // 輸入框裡多一個空白不該讓座標消失。
    expect(currentPlace("  一蘭拉麵  ", ramen)).toBe(ramen);
  });

  it("名字被改過之後，座標要丟掉", () => {
    // 這是最重要的一條。改過的名字已經不是那個地點了 ——
    // 留著座標會存進一個名字對不上位置的地點，而畫面上看起來完全正常。
    expect(currentPlace("晚餐", ramen)).toEqual({
      name: "晚餐",
      address: null,
      lat: null,
      lng: null,
      placeId: null
    });
  });

  it("回傳的名字是 trim 過的", () => {
    expect(currentPlace("  晚餐  ", null)?.name).toBe("晚餐");
  });
});

describe("shouldSearchPlace", () => {
  it("兩個字以上才查", () => {
    expect(shouldSearchPlace("拉麵")).toBe(true);
    expect(shouldSearchPlace("一蘭拉麵")).toBe(true);
  });

  it("太短不查 —— 每打一個字打一次 API 太浪費，一兩個字也搜不出東西", () => {
    expect(shouldSearchPlace("")).toBe(false);
    expect(shouldSearchPlace("拉")).toBe(false);
  });

  it("只有空白不查", () => {
    expect(shouldSearchPlace("  ")).toBe(false);
    expect(shouldSearchPlace(" 拉 ")).toBe(false);
  });
});
