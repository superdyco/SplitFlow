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

describe("currentPlace 與定位抓到的座標", () => {
  const here = { lat: 22.6119, lng: 120.2999 };

  it("只打名字時帶上定位的座標", () => {
    // 使用者按了定位、然後自己打了名字。座標仍然成立 ——
    // 他描述的就是他站的地方。
    const place = currentPlace("路邊攤", null, here);

    expect(place).toEqual({
      name: "路邊攤",
      address: null,
      lat: 22.6119,
      lng: 120.2999,
      placeId: null
    });
  });

  it("改掉建議的名字之後，座標換成定位的，不是留著建議的", () => {
    /*
      這是兩種座標的分界。

      從建議選來的座標是一句斷言：「這是那家店」。改了名字那句話就不成立，
      所以原本的規則是丟掉它 —— 那條沒有變。

      定位的座標是另一句話：「我在這」。改名字不會讓它變假。
    */
    const picked = {
      name: "星巴克",
      address: "某某路",
      lat: 25.03,
      lng: 121.56,
      placeId: "abc"
    };

    const place = currentPlace("麥當勞", picked, here);

    expect(place?.lat).toBe(22.6119);
    expect(place?.placeId).toBeNull();
  });

  it("選了建議就用建議的，定位的座標讓位", () => {
    // 選了店就是問那家店，比問你站的地方準。
    const picked = {
      name: "一蘭",
      address: null,
      lat: 35.6,
      lng: 139.7,
      placeId: "x"
    };

    expect(currentPlace("一蘭", picked, here)?.lat).toBe(35.6);
  });

  it("沒定位過就跟以前一樣，只有名字", () => {
    expect(currentPlace("路邊攤", null, null)?.lat).toBeNull();
  });

  it("欄位清空就是 null，定位過也一樣", () => {
    // 清空代表「這筆沒有地點」。定位過不該讓它變成有地點。
    expect(currentPlace("", null, here)).toBeNull();
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
