import { describe, expect, it } from "vitest";
import { CREDIT_PACKS, packFor } from "./products.js";

describe("CREDIT_PACKS", () => {
  it("三個方案：30／66／120 點", () => {
    expect(CREDIT_PACKS.map(pack => [pack.productId, pack.credits])).toEqual([
      ["ai_credits_30", 30],
      ["ai_credits_60", 66],
      ["ai_credits_100", 120]
    ]);
  });

  it("點數 = 標價 + 加送 —— 改加送數量時這條會提醒要一起改", () => {
    for (const pack of CREDIT_PACKS) expect(pack.credits).toBe(pack.listPriceTwd + pack.bonus);
  });
});

describe("packFor", () => {
  it("認得的商品 ID 回方案", () => {
    expect(packFor("ai_credits_60")?.credits).toBe(66);
  });

  it("不認得的、不是字串的都回 null —— App 送什麼都不能變成點數", () => {
    expect(packFor("ai_credits_999")).toBeNull();
    expect(packFor(undefined)).toBeNull();
    expect(packFor(60)).toBeNull();
  });
});
