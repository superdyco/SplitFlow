/**
 * 誰該收到「有人新增支出」的通知。
 *
 * **排除的是 createdBy 不是 paidBy。** 小明幫阿華記一筆阿華付的錢，阿華
 * 應該收到通知 —— 有人替他登了一筆帳，那正是他需要知道的。
 *
 * 兩種人不需要在這裡判斷，自然就被排除：
 *
 *   - **虛擬成員**：合成 id 會留在回傳值裡，但他沒有帳號就沒有 token 文件，
 *     查 token 那一步會是空的
 *   - **已被移除的成員**：觸發當下他已經不在 memberIds 裡
 */
export function recipientIds(memberIds: string[], createdBy: string): string[] {
  const seen = new Set<string>();

  // 逐項檢查而不是直接 filter：`memberIds` 是從 Firestore 讀來的，欄位型別
  // 沒有保證。這支函式在雲端跑，丟例外只會變成一則沒有人看得到的錯誤日誌，
  // 而那一整批通知就這樣不見了 —— 寧可跳過壞掉的那幾筆，把其餘的送出去。
  for (const uid of memberIds ?? []) {
    if (typeof uid !== "string" || uid === "") continue;
    if (uid === createdBy) continue;
    // 同一個 id 出現兩次時只留一個，不然那個人會收到兩則一樣的通知。
    seen.add(uid);
  }

  return [...seen];
}
