import { describe, expect, it } from "vitest";
import { deleteAccountPrompt } from "@/utils/accountDeletion";

describe("deleteAccountPrompt", () => {
  it("沒有任何任務就不要求打字 —— 剛註冊完就想刪的人風險是零", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 0, ownedTaskCount: 0 });
    expect(prompt.requireText).toBeNull();
  });

  it("有任務就要打出自己的暱稱", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 3, ownedTaskCount: 1 });
    expect(prompt.requireText).toBe("小美");
  });

  it("講明帳目會留下，不然人會以為刪帳號就抽得回自己的錢", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 3, ownedTaskCount: 0 });
    expect(prompt.message).toContain("留");
  });

  it("有擁有的任務就說會轉給別人", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 3, ownedTaskCount: 2 });
    expect(prompt.message).toContain("2 個");
    expect(prompt.message).toContain("轉給");
  });

  it("沒有擁有任務就不要提轉移，那句話對他沒有意義", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 3, ownedTaskCount: 0 });
    expect(prompt.message).not.toContain("轉給");
  });

  it("一定要說無法復原", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 0, ownedTaskCount: 0 });
    expect(prompt.message).toContain("無法復原");
  });

  it("建議先匯出資料", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 2, ownedTaskCount: 0 });
    expect(prompt.message).toContain("匯出");
  });

  it("不提未結清餘額 —— 付款確認不是強制流程，那個數字不是事實", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 5, ownedTaskCount: 1 });
    expect(prompt.message).not.toContain("欠");
    expect(prompt.message).not.toContain("未結清");
  });
});
