# 結算結果一鍵複製成文字

日期：2026-08-03

## 背景

結算功能本身是完整的：`settleExpenses` 算出每人餘額與最少筆數的轉帳，歷史快照也能把某個時間點的結果凍結保存。但算完之後，**大家實際上是在 LINE 或其他群組裡對帳的**，而目前使用者只能盯著畫面自己打字轉述。

整個分帳流程的最後一哩是斷的。這份設計補上那一哩。

## 目標

在結算面板與歷史快照各放一顆複製按鈕，產生一段可以直接貼進聊天室的純文字。

## 範圍

**要做的：**

- `src/utils/settlementText.ts` —— 產生文字的純函式
- `src/composables/useCopy.ts` —— 複製到剪貼簿與「已複製」狀態
- `SettlementPanel` 與 `SettlementHistory` 各加一顆按鈕
- 兩個元件各加 `taskName` prop，由 `TaskPage` 傳入
- `tests/settlementText.test.ts`

**不做的：**

- `navigator.share`（系統分享選單）。專案既有的複製流程都是 `navigator.clipboard`，先保持一致。之後要加大約十行。
- 重構 `CreateTaskPage` 與 `TaskPage` 既有的兩處複製邏輯。它們也該用 `useCopy`，但那是獨立的整理工作，不混進這次範圍。
- 匯出成檔案、圖片、或結算報表。

## 文字格式

只列轉帳清單。貼進群組要的是「誰付誰多少」，多餘的數字反而讓人找不到重點，在手機上也佔太多行。

```
東京五日遊 · 結算
────────────────
小明 → 阿浩   TWD 1,250
小華 → 阿浩   TWD 800
小華 → 小明   TWD 340

12 筆支出 · 共 TWD 24,600
```

歷史快照多一個日期，並帶出快照的備註（若有）：

```
東京五日遊 · 結算（2026/03/05 21:14）
回國後結清
────────────────
小明 → 阿浩   TWD 1,250

12 筆支出 · 共 TWD 24,600
```

金額一律走既有的 `formatAmount(amount, currency)`，它輸出含千分位、不含幣別符號的字串，所以文字裡寫成 `TWD 1,250`。不另外實作格式化邏輯，避免出現跟畫面不一致的數字。

## 介面

```ts
import type { Transfer } from "@/types/settlement";

export interface SettlementTextInput {
  taskName: string;
  currency: string;
  transfers: Transfer[];
  /** uid 對暱稱。即時結算由成員列表組出來，快照用自己存的那份。 */
  memberNames: Record<string, string>;
  expenseCount: number;
  total: number;
  /** 缺匯率、沒被算進結算的支出筆數。快照沒有這個概念，省略或傳 0。 */
  unconvertedCount?: number;
  /** 還沒扣進轉帳金額的待確認付款筆數。快照省略或傳 0。 */
  pendingCount?: number;
  /** 快照才有，標在標題上。 */
  snapshotDate?: string;
  /** 快照的備註，空字串就不輸出。 */
  note?: string;
}

export function buildSettlementText(input: SettlementTextInput): string;
```

輸入刻意設計成中性結構，不直接吃 `Settlement` 或 `SettlementSnapshot`。兩者的欄位重疊但語意不同（快照有 `memberNames` 與 `note`，即時結算有 `unconverted` 與待確認付款），讓各自的呼叫端負責整理，函式本身就不必知道這兩種來源的差異。

這個模組不 import firebase、不 import vue，理由跟既有的 `utils/authError.ts` 一樣：純函式才測得動，不用為了跑一個字串測試去初始化整個 Firebase App。

## 邊界情況

| 情況 | 行為 |
|---|---|
| `transfers` 為空 | 轉帳區塊改成 `大家都已結清，不需要轉帳。` |
| `memberNames` 查不到 uid | 輸出 `已離開的成員`，與 `SettlementPanel` 的 `name()` 一致 |
| `unconvertedCount > 0` | 結尾加 `⚠ 有 N 筆支出還沒有匯率，未算入上面的金額` |
| `pendingCount > 0` | 結尾加 `⚠ 有 N 筆付款等待確認，還沒從上面的金額扣除` |
| `note` 為空字串或未傳 | 不輸出備註行 |
| 小數幣別（如 USD） | 交給 `formatAmount` 處理，函式本身不判斷位數 |

兩行警告是**正確性需求，不是選配**：

- 未換算的支出根本沒進結算，總額是偏低的。不講就是把不完整的數字散播出去。
- 待確認的付款尚未從轉帳金額扣除（面板上就標著「還沒算進餘額」）。不講的話，已經付過錢的人會在群組裡被要求再付一次。

## 元件整合

### `useCopy` composable

```ts
export function useCopy(resetMs?: number): {
  copied: Ref<boolean>;
  copy: (text: string) => Promise<void>;
  error: Ref<string | null>;
};
```

`copy` 成功後把 `copied` 設為 true，`resetMs`（預設 2000）之後自動歸位。`navigator.clipboard` 在非安全來源或使用者拒絕權限時會拋錯，這時設定 `error` 而不是讓例外往外冒 —— 複製失敗不該讓整個結算頁爆掉。

### `SettlementPanel`

新增 `taskName: string` prop。在「還需要的轉帳」標題列右側放按鈕，資料這樣組：

- `memberNames`：既有的 `memberNames` computed
- `unconvertedCount`：`settlement.unconverted.length`
- `pendingCount`：既有的 `pendingPayments` computed 的長度

### `SettlementHistory`

新增 `taskName: string` prop。每一則快照展開後放按鈕，資料取自快照本身：`memberNames`、`transfers`、`currency`、`total`、`expenseCount`、`note`，日期用既有的 `formatDateTime(snapshot.createdAt)`。

快照自帶 `memberNames` 是刻意的設計 —— 有人改暱稱或離開任務之後，複製出來的仍是結算當下的名字，不會被後來的變動改寫。這個性質不需要額外處理，用快照的資料就自動成立。

### `TaskPage`

兩個元件各多傳一個 `:task-name="taskState.task.value.name"`。

## 測試

`tests/settlementText.test.ts`，涵蓋：

- 多筆轉帳的完整輸出
- 空轉帳改輸出已結清訊息
- `memberNames` 缺 uid 時輸出「已離開的成員」
- `unconvertedCount > 0` 時附上警告行
- `pendingCount > 0` 時附上警告行
- 兩種警告同時存在
- 千分位（`24600` → `24,600`）
- 小數幣別的位數正確
- 快照模式輸出日期，有備註時輸出備註、空備註時不輸出

`useCopy` 與兩個元件不寫測試。專案目前沒有元件測試的基礎設施，為這顆按鈕單獨搭一套不划算；純函式已經涵蓋了所有會出錯的邏輯，剩下的是把值接對，靠型別檢查擋。

## 風險

低。新增的是純函式與兩顆按鈕，沒有動到結算演算法、Firestore 讀寫或權限規則。最壞情況是文字格式不理想，調整字串即可。

唯一需要留意的是 `navigator.clipboard` 的可用性 —— 它需要安全來源（HTTPS 或 localhost），正式站與開發環境都滿足，但錯誤處理仍要做好，不能假設一定成功。
