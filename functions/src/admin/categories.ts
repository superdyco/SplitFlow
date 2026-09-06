/**
 * 支出分類。**這是第二份副本**（網頁版 `src/types/expense.ts` 是第一份）。
 *
 * 沒有更好的辦法：函式部署時只上傳 `functions/` 目錄，import 上層的 `src/`
 * 會在部署後找不到檔案。同一個理由 `amount.ts` 已經解釋過一次。
 *
 * 這裡只需要鍵與順序，不需要標籤與圖示 —— 那些是畫面的事，而畫面那份已經
 * 有了。少複製一份就少一個會走鐘的地方。
 */
export const EXPENSE_CATEGORIES = [
  "food",
  "transport",
  "stay",
  "ticket",
  "shopping",
  "other"
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
