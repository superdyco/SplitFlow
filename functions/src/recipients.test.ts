import { describe, expect, it } from "vitest";
import { recipientIds } from "./recipients.js";

describe("recipientIds", () => {
  it("排除記帳的人自己", () => {
    expect(recipientIds(["amma", "ming", "hua"], "ming")).toEqual(["amma", "hua"]);
  });

  // 小明幫阿華記一筆阿華付的錢 —— 阿華要收到通知，有人替他登了一筆帳。
  it("不排除付款人", () => {
    expect(recipientIds(["hua", "ming"], "ming")).toEqual(["hua"]);
  });

  it("只有自己一個成員時沒有收件人", () => {
    expect(recipientIds(["ming"], "ming")).toEqual([]);
  });

  it("記帳的人不在名單裡時全部都收（理論上不會發生，但不該當掉）", () => {
    expect(recipientIds(["amma", "hua"], "已離開的人")).toEqual(["amma", "hua"]);
  });

  it("空名單回空陣列", () => {
    expect(recipientIds([], "ming")).toEqual([]);
  });

  // 虛擬成員的合成 id 會留在結果裡，但他沒有 token 文件，
  // 查 token 那一步自然就空了 —— 這裡不特別判斷。
  it("虛擬成員留在名單裡，由查 token 那一步過濾", () => {
    expect(recipientIds(["v_k3n8x2p9qz1m4w7t6r0a", "ming"], "ming")).toEqual([
      "v_k3n8x2p9qz1m4w7t6r0a"
    ]);
  });

  // 下面兩條防的是同一件事：memberIds 是從 Firestore 讀來的陣列，
  // 而 Firestore 的欄位型別沒有保證。函式在雲端跑，丟例外只會變成一則
  // 沒有人看得到的錯誤日誌，而那一整批通知就這樣不見了。
  it("重複的 id 只留一個 —— 同一個人不該收到兩則", () => {
    expect(recipientIds(["amma", "amma", "ming"], "ming")).toEqual(["amma"]);
  });

  it("空字串與 null 不是收件人", () => {
    const messy = ["amma", "", null, undefined, "ming"] as unknown as string[];
    expect(recipientIds(messy, "ming")).toEqual(["amma"]);
  });
});
