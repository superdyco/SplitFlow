import { describe, expect, it } from "vitest";
import { expenseNotification } from "./message.js";

describe("expenseNotification", () => {
  const base = {
    taskName: "曼谷旅行",
    author: "小明",
    expenseTitle: "晚餐",
    amount: 120000,
    currency: "TWD"
  };

  it("標題是任務名稱", () => {
    expect(expenseNotification(base).title).toBe("曼谷旅行");
  });

  // 金額寫法跟 App 內一致（幣別 + 金額），不要為了通知另外發明格式。
  it("內文有記帳的人、項目與金額", () => {
    expect(expenseNotification(base).body).toBe("小明新增「晚餐」TWD 1,200.00");
  });

  it("零小數幣別不會多出小數點", () => {
    expect(expenseNotification({ ...base, amount: 1200, currency: "JPY" }).body).toBe(
      "小明新增「晚餐」JPY 1,200"
    );
  });

  // 記帳的人可能已經被移除，member 文件查不到暱稱。
  it("查不到暱稱時用代稱，不要出現空白或 uid", () => {
    expect(expenseNotification({ ...base, author: "" }).body).toBe(
      "有人新增「晚餐」TWD 1,200.00"
    );
  });

  it("沒有任務名稱時用代稱", () => {
    expect(expenseNotification({ ...base, taskName: "" }).title).toBe("分帳更新");
  });

  // 支出名稱是使用者打的字，什麼都可能。這幾條防的是「通知變成空的引號」
  // 或「長到系統自己截掉，金額被吃掉」—— 金額是這則通知最重要的資訊。
  it("沒有支出名稱時不要留一對空引號", () => {
    expect(expenseNotification({ ...base, expenseTitle: "" }).body).toBe(
      "小明新增一筆支出 TWD 1,200.00"
    );
  });

  it("支出名稱過長時截斷，金額仍然完整", () => {
    const body = expenseNotification({ ...base, expenseTitle: "晚".repeat(60) }).body;
    expect(body).toContain("TWD 1,200.00");
    expect(body).toContain("…");
    expect(body.length).toBeLessThan(80);
  });

  it("剛好在上限內的名稱不加刪節號", () => {
    const title = "晚".repeat(30);
    expect(expenseNotification({ ...base, expenseTitle: title }).body).toBe(
      `小明新增「${title}」TWD 1,200.00`
    );
  });

  it("暱稱過長時也截斷", () => {
    const body = expenseNotification({ ...base, author: "小".repeat(40) }).body;
    expect(body).toContain("TWD 1,200.00");
    expect(body).toContain("…");
  });
});
