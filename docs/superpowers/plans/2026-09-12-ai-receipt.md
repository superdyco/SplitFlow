# AI 辨識收據（第一階段）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支出表單拍了收據之後，按一下就由 OpenAI 讀出金額、幣別、日期、時間、店名、分類並填進表單；每次呼叫扣 1 點，每個正式帳號第一次用時送 3 點；後台可以換金鑰與模型、調整點數、看每一次的結果。

**Architecture:** 照片不先上傳，直接以 base64 送進 callable `readReceipt`。函式在 transaction 裡扣點並寫一筆 `use`（`readResult: "pending"`），呼叫 OpenAI Responses API（結構化輸出），再把結果補回那一筆。點數與紀錄在 `aiCredits/{uid}` 與它的 `aiLedger` 子集合，rules 全擋寫入。金鑰與模型在 `config/ai`，只有函式讀得到；模型只能是程式裡白名單上的一個。

**Tech Stack:** Cloud Functions v2 + firebase-admin + `openai` 7.x（TypeScript, vitest）、Vue 3 + Firebase JS SDK 12、Flutter + Riverpod 2 + FlutterFire、`@firebase/rules-unit-testing`。

**Spec:** `docs/superpowers/specs/2026-09-11-ai-receipt-design.md`

## Global Constraints

- callable region 一律 `asia-east1`。
- 每一個給使用者看的錯誤訊息都是中文，用 `HttpsError` 丟；兩個平台的錯誤訊息規則會原樣顯示中文訊息。
- 模型白名單：`gpt-5.6-luna`（預設）、`gpt-5.6-terra`、`gpt-5.6-sol`。
- 免費點數 3；調整點數範圍 −100～+100、不能是 0。
- `readResult` 只有這些值：`pending`、`read`、`unreadable`、`not_receipt`、`ai_error`、`timeout`。
- 分類只有 `food`、`transport`、`stay`、`ticket`、`shopping`、`other`。
- 支出名稱最多 60 字。
- 敘述、註解、UI 文字用中文；commit message 用英文，照 repo 慣例，結尾加 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
- 這台 PowerShell 下多行 commit message 用 `git commit -F <檔案>`。各 Task 的 `git commit -F <msg>` 指的是：把該行註解裡的英文訊息，加上空一行與 `Co-Authored-By` 那一行，寫進 scratchpad 的暫存檔，再用 `-F` 指向它。
- **`functions/` 的測試不在 CI 裡**（根目錄的 vitest 只抓 `tests/**`，CI 也沒有進 `functions/`）。functions 的測試一律在本機 `cd functions && npm test`，每個 Task 的測試步驟都要實際跑過。
- 這台沒有 Dart。Flutter 的改動只能靠 CI（推 main 觸發）驗證，CI 綠之前不得宣稱 Flutter 測過。
- rules 測試要 JDK 21：在 Git Bash 先 `export JAVA_HOME="/c/Program Files/Android/openjdk/jdk-21.0.8"; export PATH="$JAVA_HOME/bin:$PATH"`，再 `npm run test:rules`。

## 與 spec 的差異

1. **後台「測試目前的設定」不用樣本圖片，改用一段收據文字。** repo 裡沒有能產生圖片的工具，塞一張手工 base64 圖進程式碼也沒辦法審。文字版一樣走同一個模型、同一份結構化輸出、同一把金鑰，驗得到「金鑰有效、模型可用、帳戶有錢、格式對」；看圖這一段交給上線前的手動測試（Task 15）。
2. **照片接受 JPEG 與 PNG，不是只收 JPEG。** 網頁版一律轉成 JPEG，但 Flutter 的 `image_picker` 從相簿選 PNG 時不保證會轉檔。只收 `FF D8` 的話，那種照片會被擋成「格式不對」，而使用者什麼都沒做錯。依檔頭決定送給 OpenAI 的 MIME。
3. **Flutter 沒有「沒網路」這個按鈕狀態。** App 裡沒有連線偵測的套件，為了一顆按鈕加一個原生相依不划算。離線時呼叫會失敗成 `unavailable`（連不上伺服器），請求根本沒到函式，所以**不會扣點**，錯誤訊息照樣會講清楚。網頁版照 spec 做（`navigator.onLine` 加上 online／offline 事件）。
4. **跨使用者的點數紀錄，翻頁游標存完整路徑。** collection group 查詢用文件 ID 當第二排序鍵時，`startAfter` 要的是完整的文件路徑，不是 ID。`paging.ts` 的 `Cursor.id` 本來就是字串，這裡放 `doc.ref.path`。

## File Map

| 檔案 | 動作 | 責任 |
|---|---|---|
| `functions/src/ai/models.ts` | 新增 | 模型白名單、預設模型、金鑰末四碼 |
| `functions/src/ai/credits.ts` | 新增 | 扣點、調整點數、點數紀錄的組裝（純函式） |
| `functions/src/ai/receipt.ts` | 新增 | 照片檢查、結構化輸出的 schema 與指令、回傳內容的檢查與整理 |
| `functions/src/ai/usage.ts` | 新增 | `stats/ai/days` 的區間加總 |
| `functions/src/ai/*.test.ts` | 新增 | 上面四支的 vitest |
| `functions/src/ai/openai.ts` | 新增 | 呼叫 OpenAI、把錯誤分成 `timeout`／`ai_error` |
| `functions/src/ai/config.ts` | 新增 | 讀 `config/ai`，instance 內快取 60 秒 |
| `functions/src/amount.ts` | 修改 | 匯出支援的幣別清單 |
| `functions/src/index.ts` | 修改 | `readReceipt` callable；`deleteAccount` 刪點數 |
| `functions/src/admin/audit.ts` | 修改 | `view.ai`、`act.setAiConfig`、`act.adjustCredits`、`config` |
| `functions/src/admin.ts` | 修改 | `adminAiConfig`、`adminSetAiConfig`、`adminTestAiConfig`、`adminAiUsage`、`adminAdjustCredits`；`adminUser` 多回 AI 點數 |
| `functions/package.json` | 修改 | 加 `openai` |
| `firestore.rules` | 修改 | `aiCredits`、`aiLedger`、`config` |
| `firestore.indexes.json` | 修改 | `aiLedger` 的 collection group 索引 |
| `tests/firestore.rules.test.mjs` | 修改 | |
| `src/utils/aiReceipt.ts` | 新增 | 按鈕狀態、把結果套進表單、分帳要不要切回平分（純函式） |
| `tests/aiReceipt.test.ts` | 新增 | |
| `src/services/aiService.ts` | 新增 | 呼叫 `readReceipt`、讀餘額 |
| `src/composables/useReceipt.ts` | 修改 | 公開 `pending` |
| `src/components/expense/AiReceiptButton.vue` | 新增 | 按鈕與結果那一行 |
| `src/pages/ExpenseFormPage.vue` | 修改 | 接上按鈕、套用結果 |
| `src/pages/ProfilePage.vue` | 修改 | 「AI 辨識點數」 |
| `src/services/adminService.ts` | 修改 | 後台的型別與呼叫 |
| `src/utils/aiLedger.ts` | 新增 | 點數紀錄的類型與結果標籤（含「沒有回來」） |
| `tests/aiLedger.test.ts` | 新增 | |
| `src/pages/admin/AdminAiPage.vue` | 新增 | 「AI 設定」頁 |
| `src/pages/admin/AdminConsole.vue` | 修改 | 加分頁 |
| `src/pages/admin/AdminUsersPage.vue` | 修改 | 點數、調整、紀錄 |
| `src/pages/admin/AdminAuditPage.vue` | 修改 | 三個新動作的中文名稱 |
| `flutter_app/lib/domain/ai_receipt.dart` | 新增 | 網頁版 `aiReceipt.ts` 的 Dart 版 |
| `flutter_app/test/ai_receipt_test.dart` | 新增 | |
| `flutter_app/lib/data/ai_repository.dart` | 新增 | 呼叫 `readReceipt`、讀餘額 |
| `flutter_app/lib/state/providers.dart` | 修改 | `aiRepositoryProvider`、`aiCreditsProvider` |
| `flutter_app/lib/ui/expense_form_page.dart` | 修改 | 按鈕、套用結果、換幣別抽成方法 |
| `flutter_app/lib/ui/profile_page.dart` | 修改 | 「AI 辨識點數」 |
| `public/privacy.html` | 修改 | 收據照片、OpenAI |
| `todo.md` | 修改 | 這次做了什麼、隱私政策還過時的地方 |

---

### Task 1: 模型白名單 `ai/models.ts`

**Files:**
- Create: `functions/src/ai/models.ts`
- Test: `functions/src/ai/models.test.ts`

**Interfaces:**
- Produces（Task 5、8 使用）:
  - `interface AiModel { id: string; label: string; note: string }`
  - `AI_MODELS: readonly AiModel[]`、`DEFAULT_MODEL: "gpt-5.6-luna"`
  - `isAllowedModel(value: unknown): value is string`
  - `resolveModel(value: unknown): string` —— 不在白名單就回預設
  - `keyTail(apiKey: string): string` —— 末四碼

- [ ] **Step 1: 寫失敗的測試**

`functions/src/ai/models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AI_MODELS, DEFAULT_MODEL, isAllowedModel, keyTail, resolveModel } from "./models.js";

describe("AI_MODELS", () => {
  it("預設模型在白名單裡，而且排第一", () => {
    expect(AI_MODELS[0].id).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe("gpt-5.6-luna");
  });

  it("每一個都有顯示名稱與說明", () => {
    for (const model of AI_MODELS) {
      expect(model.label).not.toBe("");
      expect(model.note).not.toBe("");
    }
  });
});

describe("isAllowedModel", () => {
  it("白名單上的才算", () => {
    expect(isAllowedModel("gpt-5.6-terra")).toBe(true);
    expect(isAllowedModel("gpt-4o")).toBe(false);
    expect(isAllowedModel("")).toBe(false);
    expect(isAllowedModel(undefined)).toBe(false);
  });
});

describe("resolveModel", () => {
  it("白名單上的照用", () => {
    expect(resolveModel("gpt-5.6-sol")).toBe("gpt-5.6-sol");
  });

  it("不在白名單上（例如白名單改過）就退回預設 —— 不能讓一個舊名字把全站辨識弄壞", () => {
    expect(resolveModel("gpt-5.5")).toBe(DEFAULT_MODEL);
    expect(resolveModel(null)).toBe(DEFAULT_MODEL);
  });
});

describe("keyTail", () => {
  it("只留末四碼", () => {
    expect(keyTail("sk-proj-abcdefgh1234")).toBe("1234");
  });

  it("太短的金鑰不回任何字元 —— 短到四碼就等於整把", () => {
    expect(keyTail("abcd")).toBe("");
    expect(keyTail("")).toBe("");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd functions && npx vitest run src/ai/models.test.ts`
Expected: FAIL，找不到 `./models.js`。

- [ ] **Step 3: 實作**

`functions/src/ai/models.ts`:

```ts
/**
 * 能拿來讀收據的模型。
 *
 * **為什麼寫死在程式裡**（照 Codex 的做法）：OpenAI 的模型清單 API 只回名稱，
 * 不說哪個模型能看圖、支援結構化輸出。讓後台自由輸入的話，選到一個不能看圖
 * 的模型，全站辨識就壞了，而且壞的方式是每一張都扣點、每一張都失敗。
 *
 * 新模型出來要改這裡、重新部署；在這張表裡切換則不用。
 */
export interface AiModel {
  id: string;
  label: string;
  note: string;
}

export const AI_MODELS: readonly AiModel[] = [
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "預設。最便宜，文字辨識跟 Terra 只差一點" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "Luna 讀不準時的備案，貴 10 倍" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", note: "最準，再貴 2.5 倍" }
];

export const DEFAULT_MODEL = "gpt-5.6-luna";

export function isAllowedModel(value: unknown): value is string {
  return typeof value === "string" && AI_MODELS.some(model => model.id === value);
}

export function resolveModel(value: unknown): string {
  return isAllowedModel(value) ? value : DEFAULT_MODEL;
}

/** 後台顯示用。短到四碼的金鑰不顯示 —— 那等於整把。 */
export function keyTail(apiKey: string): string {
  return apiKey.length > 4 ? apiKey.slice(-4) : "";
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd functions && npx vitest run src/ai/models.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/models.ts functions/src/ai/models.test.ts
git commit -F <msg>   # "Add the AI model whitelist for receipt reading"
```

---

### Task 2: 點數的純函式 `ai/credits.ts`

**Files:**
- Create: `functions/src/ai/credits.ts`
- Test: `functions/src/ai/credits.test.ts`

**Interfaces:**
- Produces（Task 6、8 使用）:
  - `FREE_CREDITS = 3`、`ADJUST_LIMIT = 100`
  - `READ_RESULTS`、`type ReadResult`、`type FinalResult = Exclude<ReadResult, "pending">`
  - `interface CreditsDoc { balance?: unknown; freeGranted?: unknown }`
  - `planUse(doc: CreditsDoc | null): { ok: false } | { ok: true; grantFree: boolean; balanceAfter: number }`
  - `parseAdjust(value: unknown): number | null`
  - `planAdjust(doc: CreditsDoc | null, delta: number): { delta: number; balanceAfter: number; created: boolean }` —— `delta` 是實際變動量（減到 0 為止）
  - `ledgerFree({ uid, at })`、`ledgerUse({ uid, at, balanceAfter, model })`、`ledgerAdjust({ uid, at, delta, balanceAfter, adminUid, adminEmail, reason })`、`ledgerResult({ readResult, inputTokens, outputTokens })`
  - `isFailure(result: unknown): boolean` —— `read` 以外都算失敗（含 `pending`）

- [ ] **Step 1: 寫失敗的測試**

`functions/src/ai/credits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FREE_CREDITS,
  isFailure,
  ledgerAdjust,
  ledgerFree,
  ledgerResult,
  ledgerUse,
  parseAdjust,
  planAdjust,
  planUse
} from "./credits.js";

const AT = new Date("2026-09-12T03:00:00Z");

describe("planUse", () => {
  it("文件不存在：先送 3 點再扣 1，剩 2", () => {
    expect(planUse(null)).toEqual({ ok: true, grantFree: true, balanceAfter: FREE_CREDITS - 1 });
  });

  it("有餘額：扣 1", () => {
    expect(planUse({ balance: 1, freeGranted: true })).toEqual({ ok: true, grantFree: false, balanceAfter: 0 });
  });

  it("餘額 0：拒絕", () => {
    expect(planUse({ balance: 0, freeGranted: true })).toEqual({ ok: false });
  });

  it("文件存在但沒有送過（管理者先建的也算送過）—— 不再送", () => {
    expect(planUse({ balance: 5, freeGranted: true })).toEqual({ ok: true, grantFree: false, balanceAfter: 4 });
  });

  it("餘額欄位壞掉（不是數字）當作 0，不能變成無限點數", () => {
    expect(planUse({ balance: "9999", freeGranted: true })).toEqual({ ok: false });
  });
});

describe("parseAdjust", () => {
  it("−100 到 +100 的非零整數", () => {
    expect(parseAdjust(5)).toBe(5);
    expect(parseAdjust(-100)).toBe(-100);
    expect(parseAdjust(100)).toBe(100);
  });

  it("0、超出範圍、小數、字串都不行", () => {
    expect(parseAdjust(0)).toBeNull();
    expect(parseAdjust(101)).toBeNull();
    expect(parseAdjust(-101)).toBeNull();
    expect(parseAdjust(1.5)).toBeNull();
    expect(parseAdjust("5")).toBeNull();
  });
});

describe("planAdjust", () => {
  it("加點", () => {
    expect(planAdjust({ balance: 2, freeGranted: true }, 3)).toEqual({ delta: 3, balanceAfter: 5, created: false });
  });

  it("減到 0 為止，紀錄寫實際扣掉的量", () => {
    expect(planAdjust({ balance: 2, freeGranted: true }, -5)).toEqual({ delta: -2, balanceAfter: 0, created: false });
  });

  it("文件不存在：輸入幾點就是幾點，不另外送 3 點", () => {
    expect(planAdjust(null, 5)).toEqual({ delta: 5, balanceAfter: 5, created: true });
  });

  it("文件不存在又是減點：當作 0，實際變動 0", () => {
    expect(planAdjust(null, -3)).toEqual({ delta: 0, balanceAfter: 0, created: true });
  });
});

describe("點數紀錄", () => {
  it("free", () => {
    expect(ledgerFree({ uid: "u1", at: AT })).toEqual({
      type: "free", uid: "u1", delta: FREE_CREDITS, balanceAfter: FREE_CREDITS, at: AT
    });
  });

  it("use 先寫 pending，模型也先記下來", () => {
    expect(ledgerUse({ uid: "u1", at: AT, balanceAfter: 2, model: "gpt-5.6-luna" })).toEqual({
      type: "use", uid: "u1", delta: -1, balanceAfter: 2, at: AT,
      readResult: "pending", model: "gpt-5.6-luna", inputTokens: null, outputTokens: null
    });
  });

  it("adjust 帶著誰調的與理由", () => {
    expect(
      ledgerAdjust({ uid: "u1", at: AT, delta: -2, balanceAfter: 0, adminUid: "a1", adminEmail: "a@x.com", reason: "重複扣點" })
    ).toEqual({
      type: "adjust", uid: "u1", delta: -2, balanceAfter: 0, at: AT,
      adminUid: "a1", adminEmail: "a@x.com", reason: "重複扣點"
    });
  });

  it("結果只補三個欄位；token 沒有就是 null", () => {
    expect(ledgerResult({ readResult: "timeout", inputTokens: undefined, outputTokens: undefined })).toEqual({
      readResult: "timeout", inputTokens: null, outputTokens: null
    });
  });
});

describe("isFailure", () => {
  it("只有 read 算成功；pending（沒有回來）也算失敗", () => {
    expect(isFailure("read")).toBe(false);
    for (const result of ["pending", "unreadable", "not_receipt", "ai_error", "timeout"]) {
      expect(isFailure(result)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd functions && npx vitest run src/ai/credits.test.ts`
Expected: FAIL，找不到 `./credits.js`。

- [ ] **Step 3: 實作**

`functions/src/ai/credits.ts`:

```ts
/**
 * AI 辨識點數的規則。寫入在 `index.ts`（扣點）與 `admin.ts`（調整）。
 *
 * 規則只有一條：**呼叫 AI 就扣 1 點**。不退點、沒有每日上限。讀不出來、
 * 不是收據、AI 出錯、逾時都照扣，結果全部記在 `aiLedger`；使用者申訴時，
 * 管理者看紀錄手動補。每個帳號只有 3 點，被刷也刷不出 3 張以上的費用。
 */

export const FREE_CREDITS = 3;
export const ADJUST_LIMIT = 100;

export const READ_RESULTS = ["pending", "read", "unreadable", "not_receipt", "ai_error", "timeout"] as const;
export type ReadResult = (typeof READ_RESULTS)[number];
export type FinalResult = Exclude<ReadResult, "pending">;

export interface CreditsDoc {
  balance?: unknown;
  freeGranted?: unknown;
}

/** 壞掉的餘額當作 0。反過來當成很多，就是一個無限點數的洞。 */
function balanceOf(doc: CreditsDoc | null): number {
  const value = doc?.balance;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * 這次辨識能不能扣點。
 *
 * 免費點數看的是「文件存不存在」，不是 `freeGranted`：管理者先幫還沒用過的人
 * 調整點數時，文件就建好了，那時輸入幾點就是幾點（spec 的決定）。
 */
export function planUse(
  doc: CreditsDoc | null
): { ok: false } | { ok: true; grantFree: boolean; balanceAfter: number } {
  const grantFree = doc === null;
  const before = grantFree ? FREE_CREDITS : balanceOf(doc);
  if (before <= 0) return { ok: false };
  return { ok: true, grantFree, balanceAfter: before - 1 };
}

export function parseAdjust(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value === 0) return null;
  return Math.abs(value) <= ADJUST_LIMIT ? value : null;
}

/** 減到 0 為止。紀錄寫實際變動的量，不是輸入的量 —— 對帳要加得起來。 */
export function planAdjust(
  doc: CreditsDoc | null,
  delta: number
): { delta: number; balanceAfter: number; created: boolean } {
  const before = balanceOf(doc);
  const balanceAfter = Math.max(0, before + delta);
  return { delta: balanceAfter - before, balanceAfter, created: doc === null };
}

export function ledgerFree(input: { uid: string; at: Date }) {
  return { type: "free", uid: input.uid, delta: FREE_CREDITS, balanceAfter: FREE_CREDITS, at: input.at };
}

/**
 * 扣點當下就寫，結果先是 `pending`。
 *
 * 一直停在 pending 代表函式在呼叫 AI 之後當掉了 —— 扣了點卻沒有結果。
 * 後台看得到這種紀錄，申訴時一眼就知道不是使用者的問題。
 */
export function ledgerUse(input: { uid: string; at: Date; balanceAfter: number; model: string }) {
  return {
    type: "use",
    uid: input.uid,
    delta: -1,
    balanceAfter: input.balanceAfter,
    at: input.at,
    readResult: "pending" as ReadResult,
    model: input.model,
    inputTokens: null as number | null,
    outputTokens: null as number | null
  };
}

export function ledgerAdjust(input: {
  uid: string;
  at: Date;
  delta: number;
  balanceAfter: number;
  adminUid: string;
  adminEmail: string;
  reason: string;
}) {
  return {
    type: "adjust",
    uid: input.uid,
    delta: input.delta,
    balanceAfter: input.balanceAfter,
    at: input.at,
    adminUid: input.adminUid,
    adminEmail: input.adminEmail,
    reason: input.reason
  };
}

export function ledgerResult(input: {
  readResult: FinalResult;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}) {
  return {
    readResult: input.readResult,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null
  };
}

export function isFailure(result: unknown): boolean {
  return result !== "read";
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd functions && npx vitest run src/ai/credits.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/credits.ts functions/src/ai/credits.test.ts
git commit -F <msg>   # "Add pure rules for AI credits and the ledger"
```

---

### Task 3: 收據的純函式 `ai/receipt.ts`

**Files:**
- Modify: `functions/src/amount.ts`
- Create: `functions/src/ai/receipt.ts`
- Test: `functions/src/ai/receipt.test.ts`

**Interfaces:**
- Consumes: `minorUnits`（`amount.ts`）
- Produces（Task 5、6 使用）:
  - `SUPPORTED_CURRENCIES: readonly string[]`（在 `amount.ts`）
  - `MAX_IMAGE_BYTES = 2 * 1024 * 1024`
  - `decodeImage(value: unknown): { ok: true; base64: string; mime: "image/jpeg" | "image/png" } | { ok: false }`
  - `RECEIPT_SCHEMA`（給 `text.format` 用的 JSON schema 物件）、`RECEIPT_INSTRUCTIONS: string`
  - `interface ReceiptFields { amount: string | null; currency: string | null; currencySupported: boolean; date: string | null; time: string | null; title: string | null; category: string | null }`
  - `parseOutput(text: string): unknown` —— JSON 解不開回 null
  - `cleanReceipt(raw: unknown): { readResult: "read" | "unreadable" | "not_receipt"; fields: ReceiptFields }`

- [ ] **Step 1: 匯出支援的幣別**

`functions/src/amount.ts`，在 `minorUnits` 上面加：

```ts
/** 支援的 20 種幣別。AI 讀到清單外的幣別時，畫面要改用任務的主要幣別。 */
export const SUPPORTED_CURRENCIES: readonly string[] = Object.keys(MINOR_UNITS);
```

- [ ] **Step 2: 寫失敗的測試**

`functions/src/ai/receipt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SUPPORTED_CURRENCIES } from "../amount.js";
import { MAX_IMAGE_BYTES, RECEIPT_SCHEMA, cleanReceipt, decodeImage, parseOutput } from "./receipt.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");

function raw(overrides: Record<string, unknown> = {}) {
  return {
    is_receipt: true,
    amount: 1280,
    currency: "JPY",
    date: "2026-09-10",
    time: "19:05",
    merchant: "  すき家 渋谷店  ",
    category: "food",
    ...overrides
  };
}

describe("SUPPORTED_CURRENCIES", () => {
  it("20 種，含 TWD 與 JPY", () => {
    expect(SUPPORTED_CURRENCIES).toHaveLength(20);
    expect(SUPPORTED_CURRENCIES).toContain("TWD");
    expect(SUPPORTED_CURRENCIES).toContain("JPY");
  });
});

describe("decodeImage", () => {
  it("JPEG 與 PNG 都收，MIME 看檔頭", () => {
    expect(decodeImage(JPEG)).toEqual({ ok: true, base64: JPEG, mime: "image/jpeg" });
    expect(decodeImage(PNG)).toEqual({ ok: true, base64: PNG, mime: "image/png" });
  });

  it("不是圖片、空字串、不是字串都擋", () => {
    expect(decodeImage(Buffer.from("hello").toString("base64"))).toEqual({ ok: false });
    expect(decodeImage("")).toEqual({ ok: false });
    expect(decodeImage(123)).toEqual({ ok: false });
  });

  it("超過 2 MB 擋 —— 跟收據上傳的上限一樣", () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    big[0] = 0xff;
    big[1] = 0xd8;
    expect(decodeImage(big.toString("base64"))).toEqual({ ok: false });
  });
});

describe("RECEIPT_SCHEMA", () => {
  it("strict 模式要求：每個欄位都在 required、不准多欄位", () => {
    expect(RECEIPT_SCHEMA.additionalProperties).toBe(false);
    expect([...RECEIPT_SCHEMA.required].sort()).toEqual(Object.keys(RECEIPT_SCHEMA.properties).sort());
  });
});

describe("parseOutput", () => {
  it("解得開就回物件，解不開回 null", () => {
    expect(parseOutput('{"a":1}')).toEqual({ a: 1 });
    expect(parseOutput("not json")).toBeNull();
  });
});

describe("cleanReceipt", () => {
  it("全部合格：金額照幣別整理成表單能用的字串，店名去頭尾空白", () => {
    expect(cleanReceipt(raw())).toEqual({
      readResult: "read",
      fields: {
        amount: "1280",
        currency: "JPY",
        currencySupported: true,
        date: "2026-09-10",
        time: "19:05",
        title: "すき家 渋谷店",
        category: "food"
      }
    });
  });

  it("有小數的幣別補到兩位", () => {
    expect(cleanReceipt(raw({ amount: 12.5, currency: "USD" })).fields.amount).toBe("12.50");
  });

  it("沒有小數的幣別四捨五入", () => {
    expect(cleanReceipt(raw({ amount: 1280.6, currency: "JPY" })).fields.amount).toBe("1281");
  });

  it("不支援的幣別：金額照收據上的數字，標成不支援", () => {
    const { fields } = cleanReceipt(raw({ amount: 40000, currency: "KHR" }));
    expect(fields.amount).toBe("40000");
    expect(fields.currency).toBe("KHR");
    expect(fields.currencySupported).toBe(false);
  });

  it("沒有幣別：金額照數字，不算支援", () => {
    const { fields } = cleanReceipt(raw({ currency: null, amount: 85 }));
    expect(fields.currency).toBeNull();
    expect(fields.currencySupported).toBe(false);
    expect(fields.amount).toBe("85");
  });

  it("金額不是大於 0 的數字：算沒讀出來，其他欄位照樣回", () => {
    for (const amount of [0, -5, null, "1280", Number.NaN]) {
      const result = cleanReceipt(raw({ amount }));
      expect(result.readResult).toBe("unreadable");
      expect(result.fields.amount).toBeNull();
      expect(result.fields.title).toBe("すき家 渋谷店");
    }
  });

  it("AI 說不是收據：not_receipt，金額一律不填", () => {
    const result = cleanReceipt(raw({ is_receipt: false }));
    expect(result.readResult).toBe("not_receipt");
    expect(result.fields.amount).toBeNull();
  });

  it("幣別要三個大寫字母", () => {
    expect(cleanReceipt(raw({ currency: "jpy" })).fields.currency).toBeNull();
    expect(cleanReceipt(raw({ currency: "YEN" })).fields.currency).toBe("YEN");
    expect(cleanReceipt(raw({ currency: "¥" })).fields.currency).toBeNull();
  });

  it("日期要是真的日期", () => {
    expect(cleanReceipt(raw({ date: "2026-02-30" })).fields.date).toBeNull();
    expect(cleanReceipt(raw({ date: "2026/09/10" })).fields.date).toBeNull();
  });

  it("時間 00:00–23:59", () => {
    expect(cleanReceipt(raw({ time: "24:00" })).fields.time).toBeNull();
    expect(cleanReceipt(raw({ time: "7:05" })).fields.time).toBeNull();
    expect(cleanReceipt(raw({ time: "00:00" })).fields.time).toBe("00:00");
  });

  it("店名超過 60 字截短，空白當作沒有", () => {
    expect(cleanReceipt(raw({ merchant: "字".repeat(70) })).fields.title).toBe("字".repeat(60));
    expect(cleanReceipt(raw({ merchant: "   " })).fields.title).toBeNull();
  });

  it("分類不在六類裡當作沒有", () => {
    expect(cleanReceipt(raw({ category: "drinks" })).fields.category).toBeNull();
  });

  it("整個不是物件：沒讀出來，全部 null", () => {
    expect(cleanReceipt(null)).toEqual({
      readResult: "unreadable",
      fields: {
        amount: null,
        currency: null,
        currencySupported: false,
        date: null,
        time: null,
        title: null,
        category: null
      }
    });
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd functions && npx vitest run src/ai/receipt.test.ts`
Expected: FAIL，找不到 `./receipt.js`。

- [ ] **Step 4: 實作**

`functions/src/ai/receipt.ts`:

```ts
/**
 * 收據辨識的輸入檢查、給 AI 的格式與指令、以及回來之後的整理。
 *
 * **AI 回來的東西一律再檢查一次。** 結構化輸出保證的是形狀，不是內容：
 * 它照樣可能回「2026-02-30」、回小寫的幣別、回一個負的金額。這些值會直接
 * 填進使用者的表單，填錯的代價是一筆錯的帳。
 */
import { minorUnits, SUPPORTED_CURRENCIES } from "../amount.js";

/** 跟收據上傳的 `MAX_UPLOAD_BYTES` 一樣。壓縮後正常是 200–400 KB。 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const CATEGORIES = ["food", "transport", "stay", "ticket", "shopping", "other"];
const TITLE_MAX = 60;

/**
 * 收 JPEG 與 PNG。網頁版一律轉成 JPEG，但 Flutter 的 image_picker 從相簿選
 * PNG 時不保證轉檔 —— 只收 JPEG 的話，那張照片會被擋下，而使用者什麼都沒做錯。
 */
export function decodeImage(
  value: unknown
): { ok: true; base64: string; mime: "image/jpeg" | "image/png" } | { ok: false } {
  if (typeof value !== "string" || !value) return { ok: false };
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return { ok: false };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { ok: true, base64: value, mime: "image/jpeg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ok: true, base64: value, mime: "image/png" };
  }
  return { ok: false };
}

const nullable = (type: string) => ({ type: [type, "null"] });

/** strict 模式：每個欄位都要列在 required，可以沒有的用 null 表示。 */
export const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    is_receipt: { type: "boolean" },
    amount: nullable("number"),
    currency: nullable("string"),
    date: nullable("string"),
    time: nullable("string"),
    merchant: nullable("string"),
    category: { type: ["string", "null"], enum: [...CATEGORIES, null] }
  },
  required: ["is_receipt", "amount", "currency", "date", "time", "merchant", "category"],
  additionalProperties: false
} as const;

export const RECEIPT_INSTRUCTIONS = [
  "你會看到一張消費收據的照片。把下面這些欄位讀出來，讀不到的一律回 null，不要猜。",
  "- is_receipt：這張照片是不是消費收據或發票。不是的話其他欄位全部回 null。",
  "- amount：最後實際支付的總額（含稅、服務費、小費），不是小計。只回數字。",
  "- currency：ISO 4217 三碼大寫代碼。收據上沒寫明時，從貨幣符號、語言、店家所在國家推斷；不確定就回 null。",
  "- date：YYYY-MM-DD。time：HH:MM，24 小時制。",
  "- merchant：店名，照收據上印的寫，不要翻譯。",
  "- category：從 food、transport、stay、ticket、shopping、other 挑最接近的一個。"
].join("\n");

export interface ReceiptFields {
  amount: string | null;
  currency: string | null;
  currencySupported: boolean;
  date: string | null;
  time: string | null;
  title: string | null;
  category: string | null;
}

export function parseOutput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function realDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : null;
}

function clock(value: unknown): string | null {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function title(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // 用 Array.from 數字元，不然表情符號會被切成半個。
  return Array.from(trimmed).slice(0, TITLE_MAX).join("");
}

/**
 * 金額照幣別整理成表單直接能用的字串（日圓 `1280`、美元 `12.50`）。
 * 不支援的幣別照收據上的數字 —— 換成主要幣別、依它的小數位整理，是畫面的事，
 * 函式不知道這個任務的主要幣別是什麼。
 */
function amountText(value: number, currency: string | null, supported: boolean): string {
  if (!supported || !currency) return String(value);
  return value.toFixed(minorUnits(currency));
}

export function cleanReceipt(raw: unknown): {
  readResult: "read" | "unreadable" | "not_receipt";
  fields: ReceiptFields;
} {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const currency =
    typeof data.currency === "string" && /^[A-Z]{3}$/.test(data.currency) ? data.currency : null;
  const currencySupported = currency !== null && SUPPORTED_CURRENCIES.includes(currency);
  const amount =
    typeof data.amount === "number" && Number.isFinite(data.amount) && data.amount > 0 ? data.amount : null;
  const notReceipt = data.is_receipt === false;

  const fields: ReceiptFields = {
    amount: amount !== null && !notReceipt ? amountText(amount, currency, currencySupported) : null,
    currency,
    currencySupported,
    date: realDate(data.date),
    time: clock(data.time),
    title: title(data.merchant),
    category: typeof data.category === "string" && CATEGORIES.includes(data.category) ? data.category : null
  };

  const readResult = notReceipt ? "not_receipt" : fields.amount !== null ? "read" : "unreadable";
  return { readResult, fields };
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd functions && npx vitest run src/ai/receipt.test.ts src/amount.test.ts`
Expected: PASS（`amount.test.ts` 不受影響）。

- [ ] **Step 6: Commit**

```bash
git add functions/src/amount.ts functions/src/ai/receipt.ts functions/src/ai/receipt.test.ts
git commit -F <msg>   # "Add input checks, output schema and clean-up for receipt reading"
```

---

### Task 4: 用量統計的純函式 `ai/usage.ts`

**Files:**
- Create: `functions/src/ai/usage.ts`
- Test: `functions/src/ai/usage.test.ts`

**Interfaces:**
- Consumes: `FinalResult`（Task 2）
- Produces（Task 6、8 使用）:
  - `AI_STATS = ["calls", "reads", "failures", "inputTokens", "outputTokens"] as const`、`type AiTotals`
  - `interface AiDayDoc { date: string } & Partial<AiTotals>`
  - `statIncrements(input: { readResult: FinalResult; inputTokens?: number; outputTokens?: number }): Partial<AiTotals>`
  - `sumAiDays(docs: AiDayDoc[], keys: string[]): { totals: AiTotals; recordedDays: number }`

- [ ] **Step 1: 寫失敗的測試**

`functions/src/ai/usage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { statIncrements, sumAiDays } from "./usage.js";

describe("statIncrements", () => {
  it("讀出：calls 與 reads 各 +1，token 照加", () => {
    expect(statIncrements({ readResult: "read", inputTokens: 2400, outputTokens: 80 })).toEqual({
      calls: 1, reads: 1, inputTokens: 2400, outputTokens: 80
    });
  });

  it("失敗：calls 與 failures 各 +1；沒有 token 就不帶那兩個欄位", () => {
    expect(statIncrements({ readResult: "timeout" })).toEqual({ calls: 1, failures: 1 });
  });
});

describe("sumAiDays", () => {
  const keys = ["2026-09-10", "2026-09-11", "2026-09-12"];

  it("只加區間內的天數，缺的欄位當 0", () => {
    const result = sumAiDays(
      [
        { date: "2026-09-09", calls: 99 },
        { date: "2026-09-10", calls: 2, reads: 1, failures: 1, inputTokens: 100, outputTokens: 10 },
        { date: "2026-09-12", calls: 1, reads: 1 }
      ],
      keys
    );
    expect(result).toEqual({
      totals: { calls: 3, reads: 2, failures: 1, inputTokens: 100, outputTokens: 10 },
      recordedDays: 2
    });
  });

  it("一筆都沒有：recordedDays 是 0 —— 畫面要說得出「還沒開始記」", () => {
    expect(sumAiDays([], keys).recordedDays).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd functions && npx vitest run src/ai/usage.test.ts`
Expected: FAIL，找不到 `./usage.js`。

- [ ] **Step 3: 實作**

`functions/src/ai/usage.ts`:

```ts
/**
 * AI 用量的每日統計，一天一份 `stats/ai/days/{YYYY-MM-DD}`。
 *
 * 做法跟訪客統計（`stats/guests/days`）一樣：當下用 increment 記，
 * 不放進每日彙總那份會在凌晨被整份覆寫的文件。
 */
import type { FinalResult } from "./credits.js";

export const AI_STATS = ["calls", "reads", "failures", "inputTokens", "outputTokens"] as const;
export type AiTotals = Record<(typeof AI_STATS)[number], number>;
export type AiDayDoc = { date: string } & Partial<AiTotals>;

/** 這次辨識要加哪些數字。沒有的欄位不帶，increment(0) 只是多寫一個欄位。 */
export function statIncrements(input: {
  readResult: FinalResult;
  inputTokens?: number;
  outputTokens?: number;
}): Partial<AiTotals> {
  const out: Partial<AiTotals> = { calls: 1 };
  if (input.readResult === "read") out.reads = 1;
  else out.failures = 1;
  if (input.inputTokens) out.inputTokens = input.inputTokens;
  if (input.outputTokens) out.outputTokens = input.outputTokens;
  return out;
}

export function sumAiDays(
  docs: AiDayDoc[],
  keys: string[]
): { totals: AiTotals; recordedDays: number } {
  const wanted = new Set(keys);
  const totals: AiTotals = { calls: 0, reads: 0, failures: 0, inputTokens: 0, outputTokens: 0 };
  let recordedDays = 0;
  for (const doc of docs) {
    if (!wanted.has(doc.date)) continue;
    recordedDays += 1;
    for (const key of AI_STATS) totals[key] += doc[key] ?? 0;
  }
  return { totals, recordedDays };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd functions && npx vitest run src/ai/usage.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/usage.ts functions/src/ai/usage.test.ts
git commit -F <msg>   # "Add daily AI usage counters"
```

---

### Task 5: OpenAI 與設定 `ai/openai.ts`、`ai/config.ts`

**Files:**
- Modify: `functions/package.json`（`openai`）
- Create: `functions/src/ai/openai.ts`
- Create: `functions/src/ai/config.ts`

**Interfaces:**
- Consumes: `RECEIPT_SCHEMA`、`RECEIPT_INSTRUCTIONS`（Task 3）、`FinalResult`（Task 2）
- Produces（Task 6、8 使用）:
  - `readReceiptImage(input: { apiKey: string; model: string; base64: string; mime: string }): Promise<ModelOutput>`
  - `readReceiptText(input: { apiKey: string; model: string; text: string }): Promise<ModelOutput>` —— 後台測試用
  - `interface ModelOutput { text: string; inputTokens?: number; outputTokens?: number }`
  - `classifyAiError(err: unknown): "timeout" | "ai_error"`
  - `verifyModel(apiKey: string, model: string): Promise<string | null>` —— 驗過回 null，否則回中文原因
  - `SAMPLE_RECEIPT_TEXT: string`
  - `interface AiConfig { apiKey: string; model: string; keyTail: string; updatedAt: Date | null; updatedBy: string }`
  - `loadAiConfig(db: Firestore, options?: { fresh?: boolean }): Promise<AiConfig | null>`、`forgetAiConfig(): void`、`AI_CONFIG_PATH = "config/ai"`

這兩支會打網路或 Firestore，不寫單元測試；Task 6、8 部署後的手動驗證（Task 15）會實際走過。

- [ ] **Step 1: 裝套件**

Run: `cd functions && npm install openai@^7.15.0`
Expected: `functions/package.json` 的 dependencies 多一行 `"openai": "^7.15.0"`，`functions/package-lock.json` 跟著更新。7.x 要求 Node 22，跟 `engines.node` 一致。

- [ ] **Step 2: 寫 `ai/openai.ts`**

```ts
/**
 * 呼叫 OpenAI。只有這支 import `openai`。
 *
 * **不重試**（maxRetries: 0）：每一次呼叫都花錢，而使用者正盯著「辨識中…」。
 * 失敗了就照規則扣點、回報，要不要再按一次由他決定。
 */
import OpenAI from "openai";
import { RECEIPT_INSTRUCTIONS, RECEIPT_SCHEMA } from "./receipt.js";

const TIMEOUT_MS = 30_000;

export interface ModelOutput {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

function client(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
}

const FORMAT = {
  format: { type: "json_schema" as const, name: "receipt", schema: RECEIPT_SCHEMA, strict: true }
};

async function run(apiKey: string, model: string, content: unknown[]): Promise<ModelOutput> {
  const response = await client(apiKey).responses.create({
    model,
    input: [{ role: "user", content }],
    text: FORMAT
  } as Parameters<OpenAI["responses"]["create"]>[0]);
  return {
    text: response.output_text ?? "",
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens
  };
}

export function readReceiptImage(input: {
  apiKey: string;
  model: string;
  base64: string;
  mime: string;
}): Promise<ModelOutput> {
  return run(input.apiKey, input.model, [
    { type: "input_text", text: RECEIPT_INSTRUCTIONS },
    // high：收據上的字很小，縮成低解析度就讀不出金額了。長邊 1600px 約兩千多個 token。
    { type: "input_image", image_url: `data:${input.mime};base64,${input.base64}`, detail: "high" }
  ]);
}

/** 後台「測試目前的設定」用：同一個模型、同一份格式，只是把照片換成文字。 */
export function readReceiptText(input: { apiKey: string; model: string; text: string }): Promise<ModelOutput> {
  return run(input.apiKey, input.model, [
    { type: "input_text", text: `${RECEIPT_INSTRUCTIONS}\n\n以下是收據上的文字：\n${input.text}` }
  ]);
}

export const SAMPLE_RECEIPT_TEXT = [
  "セブン-イレブン 新宿西口店",
  "2026年9月10日(木) 19:05",
  "おにぎり 鮭       ¥160",
  "緑茶 500ml        ¥140",
  "小計              ¥300",
  "消費税(8%)         ¥24",
  "合計              ¥324"
].join("\n");

export function classifyAiError(err: unknown): "timeout" | "ai_error" {
  return err instanceof OpenAI.APIConnectionTimeoutError ? "timeout" : "ai_error";
}

/**
 * 存設定之前驗一次：金鑰對不對、這把金鑰用不用得了這個模型。
 *
 * 查詢單一模型不產生 token 費用。驗不到的是「帳戶沒錢」—— 那要真的呼叫一次，
 * 見後台的「測試目前的設定」。
 */
export async function verifyModel(apiKey: string, model: string): Promise<string | null> {
  try {
    await client(apiKey).models.retrieve(model);
    return null;
  } catch (err) {
    if (err instanceof OpenAI.AuthenticationError) return "金鑰無效或已被撤銷";
    if (err instanceof OpenAI.NotFoundError || err instanceof OpenAI.PermissionDeniedError) {
      return `這把金鑰用不了 ${model}`;
    }
    if (err instanceof OpenAI.APIConnectionTimeoutError) return "OpenAI 太久沒有回應，請稍後再試";
    return `驗證失敗：${err instanceof Error ? err.message : String(err)}`;
  }
}
```

**實作時修正**：`as Parameters<OpenAI["responses"]["create"]>[0]` 會落在串流與非串流參數的聯集上，回傳型別跟著變成聯集，build 報 `output_text`／`usage` 不存在。實際採用 `as OpenAI.Responses.ResponseCreateParamsNonStreaming`。**不要**為了過型別改掉任何欄位名稱 —— 欄位名稱照 OpenAI 官方文件（`input_text`、`input_image`、`image_url`、`detail`、`text.format`）。

- [ ] **Step 3: 寫 `ai/config.ts`**

```ts
/**
 * AI 設定：`config/ai`。rules 對所有登入身分關閉，只有函式讀得到完整金鑰。
 *
 * 同一個 instance 裡快取 60 秒，免得每張收據都多一次 Firestore 讀取。
 * 後台換了金鑰，最慢一分鐘生效（換設定的那個 instance 會立刻清掉自己的快取）。
 */
import type { Firestore } from "firebase-admin/firestore";

export const AI_CONFIG_PATH = "config/ai";
const TTL_MS = 60_000;

export interface AiConfig {
  apiKey: string;
  model: string;
  keyTail: string;
  updatedAt: Date | null;
  updatedBy: string;
}

let cached: { at: number; value: AiConfig | null } | null = null;

export function forgetAiConfig(): void {
  cached = null;
}

export async function loadAiConfig(db: Firestore, options: { fresh?: boolean } = {}): Promise<AiConfig | null> {
  if (!options.fresh && cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const snap = await db.doc(AI_CONFIG_PATH).get();
  const data = snap.data();
  const value: AiConfig | null =
    data && typeof data.apiKey === "string" && data.apiKey
      ? {
          apiKey: data.apiKey,
          model: typeof data.model === "string" ? data.model : "",
          keyTail: typeof data.keyTail === "string" ? data.keyTail : "",
          updatedAt: typeof data.updatedAt?.toDate === "function" ? data.updatedAt.toDate() : null,
          updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : ""
        }
      : null;

  cached = { at: Date.now(), value };
  return value;
}
```

- [ ] **Step 4: 型別檢查**

Run: `cd functions && npm run build`
Expected: 沒有錯誤。

- [ ] **Step 5: Commit**

```bash
git add functions/package.json functions/package-lock.json functions/src/ai/openai.ts functions/src/ai/config.ts
git commit -F <msg>   # "Add the OpenAI client wrapper and the cached AI config reader"
```

---

### Task 6: `readReceipt` callable 與刪除帳號

**Files:**
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: Task 1–5 全部；`dayKeyOf`（`admin/range.ts`）
- Produces（Task 10、13 呼叫）: callable `readReceipt`
  - 請求 `{ image: string }`（base64，不帶 `data:` 前綴）
  - 回傳 `{ readResult: "read" | "unreadable" | "not_receipt"; fields: ReceiptFields; creditsLeft: number }`
  - 錯誤：`unauthenticated`「請先登入」、`failed-precondition`「綁定帳號就能用 AI 辨識」、`invalid-argument`「照片格式不對，請重新拍一張」、`failed-precondition`「AI 辨識還沒有設定好」、`resource-exhausted`「AI 辨識點數用完了」、`unavailable`「AI 辨識暫時無法使用。」

- [ ] **Step 1: import**

`functions/src/index.ts` 的 import 區加：

```ts
import { dayKeyOf } from "./admin/range.js";
import { ledgerFree, ledgerResult, ledgerUse, planUse, type FinalResult } from "./ai/credits.js";
import { cleanReceipt, decodeImage, parseOutput, type ReceiptFields } from "./ai/receipt.js";
import { statIncrements } from "./ai/usage.js";
import { resolveModel } from "./ai/models.js";
import { classifyAiError, readReceiptImage } from "./ai/openai.js";
import { loadAiConfig } from "./ai/config.js";
```

- [ ] **Step 2: 記用量的小工具**

放在 `lookupWeather` 前面：

```ts
/**
 * 記一次 AI 用量。**不會丟例外** —— 這是旁支，記不上只是少一筆統計，
 * 不該讓使用者拿不到辨識結果。
 */
async function recordAiUsage(increments: Record<string, number>): Promise<void> {
  const day = dayKeyOf(new Date());
  const data: Record<string, unknown> = { date: day };
  for (const [key, value] of Object.entries(increments)) data[key] = FieldValue.increment(value);
  try {
    await db.collection("stats").doc("ai").collection("days").doc(day).set(data, { merge: true });
  } catch (err) {
    logger.warn("AI 用量沒記上", { day, err: String(err) });
  }
}
```

- [ ] **Step 3: callable**

放在 `lookupWeather` 後面：

```ts
/**
 * 讀一張收據。**呼叫 AI 就扣 1 點**，不管讀不讀得出來（見 `ai/credits.ts`）。
 *
 * 呼叫 AI 之前被擋下的（沒登入、訪客、照片不對、還沒設定、沒點數）不扣 ——
 * 那些沒有花到錢。
 *
 * maxInstances 限的是同時跑幾個，不是總量；總量靠每人只有 3 點，最後一道防線
 * 是 OpenAI 那邊設的用量上限。
 */
export const readReceipt = onCall(
  { region: REGION, timeoutSeconds: 60, maxInstances: 10 },
  async request => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "請先登入");
    if (request.auth?.token.firebase?.sign_in_provider === "anonymous") {
      throw new HttpsError("failed-precondition", "綁定帳號就能用 AI 辨識");
    }

    const image = decodeImage((request.data as { image?: unknown } | undefined)?.image);
    if (!image.ok) throw new HttpsError("invalid-argument", "照片格式不對，請重新拍一張");

    const config = await loadAiConfig(db);
    if (!config) throw new HttpsError("failed-precondition", "AI 辨識還沒有設定好");
    const model = resolveModel(config.model);

    const creditsRef = db.collection("aiCredits").doc(uid);
    const useRef = creditsRef.collection("aiLedger").doc();

    // 扣點與寫 use 在同一個 transaction：只剩 1 點時同時按兩次，第二次會看到 0。
    const balanceAfter = await db.runTransaction(async tx => {
      const snap = await tx.get(creditsRef);
      const plan = planUse(snap.exists ? (snap.data() ?? {}) : null);
      if (!plan.ok) throw new HttpsError("resource-exhausted", "AI 辨識點數用完了");

      const now = Date.now();
      if (plan.grantFree) {
        tx.set(creditsRef.collection("aiLedger").doc(), ledgerFree({ uid, at: new Date(now) }));
      }
      // use 晚 1 毫秒：跟 free 同一毫秒的話，由新到舊的列表裡兩筆的順序是亂的。
      tx.set(useRef, ledgerUse({ uid, at: new Date(now + 1), balanceAfter: plan.balanceAfter, model }));
      tx.set(
        creditsRef,
        { balance: plan.balanceAfter, freeGranted: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      return plan.balanceAfter;
    });

    let readResult: FinalResult;
    let fields: ReceiptFields | null = null;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      const output = await readReceiptImage({ apiKey: config.apiKey, model, base64: image.base64, mime: image.mime });
      inputTokens = output.inputTokens;
      outputTokens = output.outputTokens;
      const cleaned = cleanReceipt(parseOutput(output.text));
      readResult = cleaned.readResult;
      fields = cleaned.fields;
    } catch (err) {
      readResult = classifyAiError(err);
      logger.warn("AI 辨識失敗", { uid, model, readResult, err: String(err) });
    }

    try {
      await useRef.update(ledgerResult({ readResult, inputTokens, outputTokens }));
    } catch (err) {
      // 補不上的話那一筆會停在 pending，後台會顯示「沒有回來」—— 申訴時看得出來。
      logger.error("點數紀錄沒補上結果", { uid, entry: useRef.path, err: String(err) });
    }
    await recordAiUsage(statIncrements({ readResult, inputTokens, outputTokens }) as Record<string, number>);

    if (readResult === "ai_error" || readResult === "timeout" || !fields) {
      throw new HttpsError("unavailable", "AI 辨識暫時無法使用。");
    }

    return { readResult, fields, creditsLeft: balanceAfter };
  }
);
```

- [ ] **Step 4: 刪除帳號時一併刪點數**

`deleteAccount` 裡，`favorites` 那一行後面加：

```ts
  // 點數與點數紀錄是這個人的資料，跟收藏、推播 token 同一類。
  await db.recursiveDelete(db.collection("aiCredits").doc(uid));
```

- [ ] **Step 5: 型別檢查與全部 functions 測試**

Run: `cd functions && npm run build && npm test`
Expected: build 沒有錯誤；測試全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add functions/src/index.ts
git commit -F <msg>   # "Add readReceipt: charge one credit per AI call and record the result"
```

---

### Task 7: rules、索引、rules 測試

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`
- Test: `tests/firestore.rules.test.mjs`

- [ ] **Step 1: 寫失敗的 rules 測試**

`tests/firestore.rules.test.mjs`，在最後的 `await testEnv.cleanup();` 前面加：

```js
  // ---------------------------------------------------------------- AI 點數

  async function seedCredits(uid = MEMBER) {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, "aiCredits", uid), { balance: 2, freeGranted: true });
      await setDoc(doc(db, "aiCredits", uid, "aiLedger", "l1"), { type: "free", uid, delta: 3, balanceAfter: 3 });
      await setDoc(doc(db, "config", "ai"), { apiKey: "sk-test-1234", model: "gpt-5.6-luna" });
    });
  }

  await test("本人讀得到自己的 AI 點數", async () => {
    await seedCredits();
    await assertSucceeds(getDoc(doc(as(MEMBER), "aiCredits", MEMBER)));
  });

  await test("別人讀不到我的 AI 點數", async () => {
    await seedCredits();
    await assertFails(getDoc(doc(as(OTHER), "aiCredits", MEMBER)));
  });

  await test("本人也改不了自己的點數 —— 只有函式能動", async () => {
    await seedCredits();
    await assertFails(setDoc(doc(as(MEMBER), "aiCredits", MEMBER), { balance: 9999, freeGranted: true }));
  });

  await test("沒有點數文件的人也建不出一份", async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(as(MEMBER), "aiCredits", MEMBER), { balance: 3, freeGranted: true }));
  });

  await test("本人讀得到自己的點數紀錄，別人讀不到", async () => {
    await seedCredits();
    await assertSucceeds(getDoc(doc(as(MEMBER), "aiCredits", MEMBER, "aiLedger", "l1")));
    await assertFails(getDoc(doc(as(OTHER), "aiCredits", MEMBER, "aiLedger", "l1")));
  });

  await test("點數紀錄誰都寫不進去", async () => {
    await seedCredits();
    await assertFails(
      setDoc(doc(as(MEMBER), "aiCredits", MEMBER, "aiLedger", "l2"), { type: "adjust", uid: MEMBER, delta: 100 })
    );
  });

  await test("AI 設定（含金鑰）誰都讀不到、寫不進去", async () => {
    await seedCredits();
    await assertFails(getDoc(doc(as(MEMBER), "config", "ai")));
    await assertFails(setDoc(doc(as(MEMBER), "config", "ai"), { apiKey: "sk-mine" }));
  });

  // users/{uid} 的 create 沒有限制欄位 —— 點數不放在那裡正是為了這個。
  await test("個人檔案多帶 aiCredits 也不會變成點數", async () => {
    await testEnv.clearFirestore();
    await setDoc(doc(as(MEMBER), "users", MEMBER), {
      uid: MEMBER,
      nickname: "小明",
      aiCredits: 9999,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const snap = await getDoc(doc(ctx.firestore(), "aiCredits", MEMBER));
      if (snap.exists()) throw new Error("aiCredits 不該因為個人檔案而出現");
    });
  });
```

- [ ] **Step 2: 跑 rules 測試確認新的失敗**

Run（Git Bash，先設 JDK 21）: `npm run test:rules`
Expected: 「本人讀得到自己的 AI 點數」與「本人讀得到自己的點數紀錄，別人讀不到」FAIL（目前沒有規則，預設全擋）；其他新測試已經 ok（預設就是擋）—— 那些是防回歸，不是這次才讓它通過。

- [ ] **Step 3: 寫規則**

`firestore.rules`，在 `match /stats/{document=**}` 那一段後面加：

```
    /*
      AI 辨識點數與點數紀錄。**本人只能讀，任何人都不能寫** —— 包含本人。

      點數會花掉真的錢。它刻意不放在 users/{uid}：那份文件的 create 沒有限制
      欄位，取暱稱那一步就能寫進 aiCredits: 9999。放在這裡、寫入全擋，就只有
      雲端函式（Admin SDK 繞過規則）動得了。
    */
    match /aiCredits/{uid} {
      allow read: if isSelf(uid);
      allow write: if false;

      match /aiLedger/{entryId} {
        allow read: if isSelf(uid);
        allow write: if false;
      }
    }

    /*
      系統設定，目前只有 config/ai（OpenAI 金鑰）。沒有任何登入身分讀得到，
      包含管理者 —— 後台讀寫一律走 callable，回給畫面的只有金鑰末四碼。
      沒有這一段也是預設全擋，寫出來是為了讓下一個人不必猜。
    */
    match /config/{document=**} {
      allow read, write: if false;
    }
```

- [ ] **Step 4: 跑 rules 測試確認通過**

Run: `npm run test:rules`
Expected: 全部 ok，`0 failed`。

- [ ] **Step 5: 索引**

`firestore.indexes.json`：

在 `indexes` 陣列最後加：

```json
    {
      "//": "後台 AI 使用報告的「只看某一種類型」：跨所有使用者的點數紀錄，type 等值加上時間由新到舊。",
      "collectionGroup": "aiLedger",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "at", "order": "DESCENDING" }
      ]
    }
```

在 `fieldOverrides` 陣列最後加：

```json
    {
      "//": "後台 AI 使用報告的「全部」：跨所有使用者照時間由新到舊。collection group 範圍的單欄位索引要自己開；使用者詳情只查自己那一份，collection 範圍的兩個照舊留著。",
      "collectionGroup": "aiLedger",
      "fieldPath": "at",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "DESCENDING", "queryScope": "COLLECTION" },
        { "order": "DESCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
```

Run: `node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8'))"`
Expected: 沒有輸出（JSON 合法）。

- [ ] **Step 6: Commit**

```bash
git add firestore.rules firestore.indexes.json tests/firestore.rules.test.mjs
git commit -F <msg>   # "Lock AI credits and config to server writes; add ledger indexes"
```

---

### Task 8: 後台的伺服器端

**Files:**
- Modify: `functions/src/admin/audit.ts`
- Test: `functions/src/admin/audit.test.ts`
- Modify: `functions/src/admin.ts`

**Interfaces:**
- Consumes: Task 1–5；`requireAdmin`、`writeAudit`、`adminAction`、`nicknamesOf`、`iso`、`countOf`、`guestKeys`、`dayKeys`、`parseRange`、`decodeCursor`、`encodeCursor`、`parseLimit`（都已在 `admin.ts` 或它 import 的模組裡）；`GUEST_PROVIDER`（`guestMerge.ts`）
- Produces（Task 11 呼叫）:
  - `adminAiConfig()` → `{ configured: boolean; keyTail: string; model: string; models: AiModel[]; updatedAt: string | null; updatedBy: string }`（寫一筆 `view.ai`）
  - `adminSetAiConfig({ apiKey?: string; model: string; reason: string })` → `{ ok: true; keyTail: string; model: string }`
  - `adminTestAiConfig()` → `{ ok: true; model; readResult; fields; inputTokens; outputTokens; ms } | { ok: false; model; error: string; ms }`
  - `adminAiUsage({ range, type?: "all" | "use" | "adjust" | "free", cursor? })` → `{ range; days: { from; to }; totals: AiTotals; recordedDays: number; rows: AiLedgerRow[]; cursor: string | null }`
  - `adminAdjustCredits({ uid, delta, reason })` → `{ ok: true; balance: number; delta: number }`
  - `adminUser` 的回傳多一個 `ai: { balance: number | null; calls: number; reads: number; ledger: AiLedgerRow[] }`
  - `AiLedgerRow = { id; uid; nickname; type; delta; balanceAfter; at: string | null; readResult: string | null; model: string | null; inputTokens: number | null; outputTokens: number | null; adminEmail: string | null; reason: string | null }`

- [ ] **Step 1: 稽核日誌的新動作 —— 先寫測試**

`functions/src/admin/audit.test.ts` 最後加：

```ts
describe("AI 相關的動作", () => {
  const base = {
    adminUid: "a1",
    adminEmail: "a@example.com",
    targetType: "config" as const,
    targetId: "ai",
    targetLabel: "AI 設定",
    ip: "",
    userAgent: "",
    at: new Date("2026-09-12T00:00:00Z")
  };

  it("換 AI 設定與調整點數都是處置，都要理由", () => {
    for (const action of ["act.setAiConfig", "act.adjustCredits"] as const) {
      expect(kindOf(action)).toBe("act");
      expect(auditEntry({ ...base, action, reason: " " })).toEqual({ ok: false, problem: "reason-required" });
    }
  });

  it("看 AI 設定頁是檢視，不帶理由", () => {
    expect(kindOf("view.ai")).toBe("view");
    const built = auditEntry({ ...base, action: "view.ai", reason: "順便看看" });
    expect(built.ok && built.entry.reason).toBeNull();
  });
});
```

如果 `audit.test.ts` 開頭沒有 import `kindOf`，補上。

Run: `cd functions && npx vitest run src/admin/audit.test.ts`
Expected: FAIL（型別上不認得新的 action；vitest 不做型別檢查的話，`kindOf("act.setAiConfig")` 會回 `view` 而失敗）。

- [ ] **Step 2: 改 `audit.ts`**

```ts
export const VIEW_ACTIONS = ["view.user", "view.task", "view.report", "view.ai", "export.stats"] as const;

/** 會改到東西的動作。這些才需要理由。 */
export const ACT_ACTIONS = [
  "act.revokeReport",
  "act.disableUser",
  "act.archiveTask",
  "act.setAiConfig",
  "act.adjustCredits"
] as const;

export type TargetType = "user" | "task" | "report" | "route" | "config";
```

Run: `cd functions && npx vitest run src/admin/audit.test.ts`
Expected: PASS。

- [ ] **Step 3: `admin.ts` 的 import**

```ts
import { GUEST_PROVIDER } from "./guestMerge.js";
import { ledgerAdjust, parseAdjust, planAdjust } from "./ai/credits.js";
import { AI_MODELS, isAllowedModel, keyTail, resolveModel } from "./ai/models.js";
import { cleanReceipt, parseOutput } from "./ai/receipt.js";
import { sumAiDays, type AiDayDoc } from "./ai/usage.js";
import { readReceiptText, SAMPLE_RECEIPT_TEXT, verifyModel } from "./ai/openai.js";
import { AI_CONFIG_PATH, forgetAiConfig, loadAiConfig } from "./ai/config.js";
```

`guests.js` 的 import 已經有 `guestKeys`；`range.js` 的已經有 `dayKeys`、`parseRange`。

- [ ] **Step 4: 點數紀錄的一列**

放在檔案最後，新開一個區塊 `/* ---- AI */`：

```ts
/* ------------------------------------------------------------------ AI */

interface AiLedgerRow {
  id: string;
  uid: string;
  nickname: string;
  type: string;
  delta: number;
  balanceAfter: number;
  at: string | null;
  readResult: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  adminEmail: string | null;
  reason: string | null;
}

function toLedgerRow(doc: FirebaseFirestore.DocumentSnapshot, names: Record<string, string>): AiLedgerRow {
  const uid = (doc.get("uid") as string) ?? "";
  return {
    id: doc.id,
    uid,
    nickname: names[uid] ?? "",
    type: (doc.get("type") as string) ?? "",
    delta: (doc.get("delta") as number) ?? 0,
    balanceAfter: (doc.get("balanceAfter") as number) ?? 0,
    at: iso(doc.get("at")),
    readResult: (doc.get("readResult") as string) ?? null,
    model: (doc.get("model") as string) ?? null,
    inputTokens: (doc.get("inputTokens") as number) ?? null,
    outputTokens: (doc.get("outputTokens") as number) ?? null,
    adminEmail: (doc.get("adminEmail") as string) ?? null,
    reason: (doc.get("reason") as string) ?? null
  };
}

const AI_CONFIG_LABEL = "AI 設定";
```

- [ ] **Step 5: `adminAiConfig`**

```ts
/**
 * AI 設定頁的狀態。**不回完整金鑰**，只有末四碼。
 *
 * 打開這一頁寫一筆 view.ai：這一頁看得到全站的使用紀錄（誰在什麼時候用了幾次），
 * 跟看某個使用者的詳情同一類。
 */
export const adminAiConfig = onCall({ region: REGION }, async request => {
  const caller = await requireAdmin(request, "view.ai");
  const config = await loadAiConfig(db(), { fresh: true });

  await writeAudit({
    action: "view.ai",
    adminUid: caller.uid,
    adminEmail: caller.email,
    targetType: "config",
    targetId: "ai",
    targetLabel: AI_CONFIG_LABEL,
    ip: caller.ip,
    userAgent: caller.userAgent
  });

  return {
    configured: config !== null,
    keyTail: config?.keyTail ?? "",
    model: resolveModel(config?.model),
    models: AI_MODELS,
    updatedAt: config?.updatedAt ? config.updatedAt.toISOString() : null,
    updatedBy: config?.updatedBy ?? ""
  };
});
```

- [ ] **Step 6: `adminSetAiConfig`**

```ts
/**
 * 換金鑰或模型。**先驗再存**：貼錯一個字就讓全站辨識停擺，是最容易發生的事故。
 *
 * 金鑰留空代表只換模型，沿用舊金鑰。
 */
export const adminSetAiConfig = onCall({ region: REGION }, async request => {
  const data = (request.data ?? {}) as { apiKey?: unknown; model?: unknown };
  const typed = typeof data.apiKey === "string" ? data.apiKey.trim() : "";
  if (!isAllowedModel(data.model)) throw new HttpsError("invalid-argument", "不在清單上的模型");
  const model = data.model;

  return adminAction(request, "act.setAiConfig", "config", "ai", async () => {
    const current = await loadAiConfig(db(), { fresh: true });
    const apiKey = typed || current?.apiKey || "";
    if (!apiKey) throw new HttpsError("invalid-argument", "請貼上 OpenAI 的 API 金鑰");

    const problem = await verifyModel(apiKey, model);
    if (problem) throw new HttpsError("failed-precondition", `${problem}，設定沒有存。`);

    const tail = keyTail(apiKey);
    await db()
      .doc(AI_CONFIG_PATH)
      .set({
        apiKey,
        model,
        keyTail: tail,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: (request.auth?.token.email as string | undefined) ?? request.auth?.uid ?? ""
      });
    // 只清得到這個 instance 的快取；其他 instance 最慢一分鐘後自己過期。
    forgetAiConfig();

    return { label: AI_CONFIG_LABEL, notify: null, extra: { keyTail: tail, model } };
  });
});
```

- [ ] **Step 7: `adminTestAiConfig`**

```ts
/**
 * 用現在的設定實際跑一次。只有真的呼叫才抓得到「帳戶沒錢」。
 *
 * 用一段收據文字而不是照片（見計畫的「與 spec 的差異」）。不扣任何人的點數、
 * 不寫點數紀錄、不進用量統計 —— 這是管理者在檢查設定，不是有人在用。
 */
export const adminTestAiConfig = onCall({ region: REGION, timeoutSeconds: 60 }, async request => {
  await requireAdmin(request, "view.ai");
  const config = await loadAiConfig(db(), { fresh: true });
  if (!config) throw new HttpsError("failed-precondition", "還沒有設定金鑰");

  const model = resolveModel(config.model);
  const started = Date.now();
  try {
    const output = await readReceiptText({ apiKey: config.apiKey, model, text: SAMPLE_RECEIPT_TEXT });
    const cleaned = cleanReceipt(parseOutput(output.text));
    return {
      ok: true,
      model,
      readResult: cleaned.readResult,
      fields: cleaned.fields,
      inputTokens: output.inputTokens ?? null,
      outputTokens: output.outputTokens ?? null,
      ms: Date.now() - started
    };
  } catch (err) {
    return { ok: false, model, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
  }
});
```

- [ ] **Step 8: `adminAiUsage`**

```ts
type AiLedgerFilter = "all" | "use" | "adjust" | "free";

function parseLedgerFilter(value: unknown): AiLedgerFilter | null {
  return value === "all" || value === "use" || value === "adjust" || value === "free" ? value : null;
}

/**
 * 用量摘要＋跨所有使用者的點數紀錄。**不寫日誌**：打開頁面時 adminAiConfig
 * 已經記過一筆，翻頁也記的話日誌會被這一頁淹掉。
 *
 * 游標的第二個值存**完整路徑**：collection group 查詢用文件 ID 排序時，
 * startAfter 要的是路徑，只給 ID 會被拒絕。
 */
export const adminAiUsage = onCall({ region: REGION }, async request => {
  await requireAdmin(request, "view.ai");

  const data = (request.data ?? {}) as { range?: unknown; type?: unknown; cursor?: unknown; limit?: unknown };
  const range = parseRange(data.range ?? "30d");
  if (!range) throw new HttpsError("invalid-argument", "不認得的區間");
  const filter = parseLedgerFilter(data.type ?? "all");
  if (!filter) throw new HttpsError("invalid-argument", "不認得的篩選");

  // 跟訪客統計一樣算到今天：這些是當下記的，不用等凌晨的排程。
  const keys = guestKeys(dayKeys(range, new Date()).length, new Date());
  const daysSnap = await db()
    .collection("stats")
    .doc("ai")
    .collection("days")
    .where("date", ">=", keys[0])
    .where("date", "<=", keys[keys.length - 1])
    .get();
  const summary = sumAiDays(daysSnap.docs.map(doc => doc.data() as AiDayDoc), keys);

  const limit = parseLimit(data.limit);
  let query: FirebaseFirestore.Query = db().collectionGroup("aiLedger");
  if (filter !== "all") query = query.where("type", "==", filter);
  query = query.orderBy("at", "desc").orderBy(FieldPath.documentId(), "desc");

  if (data.cursor !== undefined && data.cursor !== null) {
    const cursor = decodeCursor(data.cursor);
    if (!cursor) throw new HttpsError("invalid-argument", "翻頁位置不正確，請重新整理");
    query = query.startAfter(new Date(cursor.value), cursor.id);
  }

  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs.slice(0, limit);
  const hasMore = snap.docs.length > limit;
  const names = await nicknamesOf(docs.map(doc => (doc.get("uid") as string) ?? ""));

  const last = docs[docs.length - 1];
  const lastAt = last?.get("at");

  return {
    range,
    days: { from: keys[0], to: keys[keys.length - 1] },
    totals: summary.totals,
    recordedDays: summary.recordedDays,
    rows: docs.map(doc => toLedgerRow(doc, names)),
    cursor:
      hasMore && last && lastAt instanceof Timestamp
        ? encodeCursor({ value: lastAt.toMillis(), id: last.ref.path })
        : null
  };
});
```

- [ ] **Step 9: `adminAdjustCredits`**

```ts
/**
 * 調整某個人的點數。申訴的補償就是走這裡。
 *
 * 減到 0 為止，紀錄寫實際扣掉的量。訪客不能調 —— 訪客本來就不能用，調了只會
 * 讓人以為壞了。還沒用過的人：輸入幾點就是幾點，之後不會再送免費 3 點。
 */
export const adminAdjustCredits = onCall({ region: REGION }, async request => {
  const data = (request.data ?? {}) as { uid?: unknown; delta?: unknown; reason?: unknown };
  const uid = data.uid;
  if (typeof uid !== "string" || !uid) throw new HttpsError("invalid-argument", "缺少 uid");
  const delta = parseAdjust(data.delta);
  if (delta === null) throw new HttpsError("invalid-argument", "調整的點數要是 −100 到 +100 之間、不能是 0");

  return adminAction(request, "act.adjustCredits", "user", uid, async () => {
    const user = await db().collection("users").doc(uid).get();
    if (!user.exists) throw new HttpsError("not-found", "找不到這個帳號");
    if (user.get("provider") === GUEST_PROVIDER) {
      throw new HttpsError("failed-precondition", "訪客不能調整點數 —— 訪客本來就不能用 AI 辨識");
    }

    const creditsRef = db().collection("aiCredits").doc(uid);
    const reason = typeof data.reason === "string" ? data.reason.trim() : "";
    const result = await db().runTransaction(async tx => {
      const snap = await tx.get(creditsRef);
      const plan = planAdjust(snap.exists ? (snap.data() ?? {}) : null, delta);
      tx.set(
        creditsRef,
        { balance: plan.balanceAfter, freeGranted: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.set(
        creditsRef.collection("aiLedger").doc(),
        ledgerAdjust({
          uid,
          at: new Date(),
          delta: plan.delta,
          balanceAfter: plan.balanceAfter,
          adminUid: request.auth?.uid ?? "",
          adminEmail: (request.auth?.token.email as string | undefined) ?? "",
          reason
        })
      );
      return plan;
    });

    const nickname = (user.get("nickname") as string) ?? "";
    return {
      label: nickname || (user.get("email") as string) || uid,
      notify: null,
      extra: { balance: result.balanceAfter, delta: result.delta }
    };
  });
});
```

- [ ] **Step 10: `adminUser` 多回 AI 點數**

`adminUser` 的 `Promise.all` 前面加：

```ts
  const creditsRef = db().collection("aiCredits").doc(uid);
  const ledgerRef = creditsRef.collection("aiLedger");
```

`Promise.all` 的陣列最後加四項（解構也跟著加 `creditsSnap, aiCalls, aiReads, ledgerSnap`）：

```ts
    creditsRef.get(),
    countOf(ledgerRef.where("type", "==", "use")),
    countOf(ledgerRef.where("readResult", "==", "read")),
    // 最近 20 筆就夠回答申訴：「上禮拜那三次是不是都失敗」。
    ledgerRef.orderBy("at", "desc").limit(20).get()
```

回傳物件最後加：

```ts
    ai: {
      // null 代表還沒用過：第一次辨識時才會送 3 點，畫面要講清楚這件事。
      balance: creditsSnap.exists ? ((creditsSnap.get("balance") as number) ?? 0) : null,
      calls: aiCalls,
      reads: aiReads,
      ledger: ledgerSnap.docs.map(doc => toLedgerRow(doc, { [uid]: profile.nickname }))
    }
```

- [ ] **Step 11: 型別檢查與全部 functions 測試**

Run: `cd functions && npm run build && npm test`
Expected: build 沒有錯誤；測試全部 PASS。

- [ ] **Step 12: Commit**

```bash
git add functions/src/admin/audit.ts functions/src/admin/audit.test.ts functions/src/admin.ts
git commit -F <msg>   # "Add admin callables for AI config, usage, credit adjustments"
```

---

### Task 9: 網頁的純函式 `utils/aiReceipt.ts`

**Files:**
- Create: `src/utils/aiReceipt.ts`
- Test: `tests/aiReceipt.test.ts`

**Interfaces:**
- Consumes: `minorUnits`（`src/utils/currency.ts`）
- Produces（Task 10 使用；Task 12 的 Dart 版一比一照搬）:
  - `FREE_CREDITS = 3`
  - `interface AiReceiptFields { amount: string | null; currency: string | null; currencySupported: boolean; date: string | null; time: string | null; title: string | null; category: string | null }`
  - `interface AiReadResult { readResult: "read" | "unreadable" | "not_receipt"; fields: AiReceiptFields; creditsLeft: number }`
  - `aiButtonState(input: { guest: boolean; online: boolean; balance: number | null; busy: boolean }): { kind: "ready" | "guest" | "empty" | "offline" | "busy"; label: string; disabled: boolean }`
  - `aiPatch(fields: AiReceiptFields, ctx: { baseCurrency: string; currentCurrency: string }): AiPatch`
  - `interface AiPatch { amount?: string; currency?: string; date?: string; time?: string; title?: string; category?: string; filled: string[]; warning: string | null }`
  - `splitAfterAi(input: { mode: "even" | "custom"; customAmounts: Record<string, string>; changed: boolean }): { memberIds: string[] | null } | null` —— null 代表不動分帳
  - `aiMessage(input: { readResult: string; filled: string[]; creditsLeft: number; splitReset: boolean }): string`
  - `GUEST_AI_NOTICE = "綁定帳號就能用 AI 辨識"`

- [ ] **Step 1: 寫失敗的測試**

`tests/aiReceipt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aiButtonState, aiMessage, aiPatch, splitAfterAi, type AiReceiptFields } from "@/utils/aiReceipt";

function fields(overrides: Partial<AiReceiptFields> = {}): AiReceiptFields {
  return {
    amount: "1280",
    currency: "JPY",
    currencySupported: true,
    date: "2026-09-10",
    time: "19:05",
    title: "すき家",
    category: "food",
    ...overrides
  };
}

describe("aiButtonState", () => {
  const base = { guest: false, online: true, balance: 2, busy: false };

  it("正常：顯示剩幾點", () => {
    expect(aiButtonState(base)).toEqual({ kind: "ready", label: "用 AI 讀收據（剩 2 點）", disabled: false });
  });

  it("還沒用過（沒有點數文件）顯示 3 點", () => {
    expect(aiButtonState({ ...base, balance: null }).label).toBe("用 AI 讀收據（剩 3 點）");
  });

  it("訪客：按鈕照樣按得下去（按下去才提示綁定）", () => {
    expect(aiButtonState({ ...base, guest: true })).toEqual({ kind: "guest", label: "用 AI 讀收據", disabled: false });
  });

  it("點數用完、沒網路都停用", () => {
    expect(aiButtonState({ ...base, balance: 0 })).toEqual({ kind: "empty", label: "AI 點數用完了", disabled: true });
    expect(aiButtonState({ ...base, online: false })).toEqual({ kind: "offline", label: "需要網路", disabled: true });
  });

  it("辨識中優先於一切", () => {
    expect(aiButtonState({ ...base, busy: true, online: false })).toEqual({ kind: "busy", label: "辨識中…", disabled: true });
  });
});

describe("aiPatch", () => {
  const ctx = { baseCurrency: "TWD", currentCurrency: "TWD" };

  it("讀到的欄位全部蓋掉，照固定順序列出", () => {
    expect(aiPatch(fields(), ctx)).toEqual({
      amount: "1280",
      currency: "JPY",
      date: "2026-09-10",
      time: "19:05",
      title: "すき家",
      category: "food",
      filled: ["金額", "幣別", "日期", "時間", "支出名稱", "分類"],
      warning: null
    });
  });

  it("沒讀到的欄位不動", () => {
    const patch = aiPatch(fields({ time: null, category: null, title: null }), ctx);
    expect(patch).not.toHaveProperty("time");
    expect(patch).not.toHaveProperty("category");
    expect(patch.filled).toEqual(["金額", "幣別", "日期"]);
  });

  it("不支援的幣別：幣別改用主要幣別，金額依主要幣別的小數位整理，並警告", () => {
    const patch = aiPatch(fields({ amount: "40000", currency: "KHR", currencySupported: false }), ctx);
    expect(patch.currency).toBe("TWD");
    expect(patch.amount).toBe("40000.00");
    expect(patch.warning).toBe("收據上是 KHR 40000，目前不支援這個幣別，已改用 TWD —— 金額請自己換算後再存");
    expect(patch.filled).toContain("金額");
    expect(patch.filled).not.toContain("幣別");
  });

  it("主要幣別是日圓時 12.5 變 13", () => {
    const patch = aiPatch(fields({ amount: "12.5", currency: "KHR", currencySupported: false }), {
      baseCurrency: "JPY",
      currentCurrency: "JPY"
    });
    expect(patch.amount).toBe("13");
  });

  it("沒讀到幣別：金額依表單現在的幣別整理", () => {
    const patch = aiPatch(fields({ amount: "85", currency: null, currencySupported: false }), ctx);
    expect(patch).not.toHaveProperty("currency");
    expect(patch.amount).toBe("85.00");
    expect(patch.warning).toBeNull();
  });

  it("不支援的幣別又沒讀出金額：警告不提金額", () => {
    const patch = aiPatch(fields({ amount: null, currency: "KHR", currencySupported: false }), ctx);
    expect(patch.warning).toBe("收據上的幣別是 KHR，目前不支援，已改用 TWD");
  });
});

describe("splitAfterAi", () => {
  it("自訂分帳而且金額或幣別變了：切回平分，給原本有填金額的人", () => {
    expect(
      splitAfterAi({ mode: "custom", customAmounts: { a: "300", b: " 0 ", c: "", d: "12.5" }, changed: true })
    ).toEqual({ memberIds: ["a", "d"] });
  });

  it("自訂但沒有任何人有金額：切回平分，分攤的人不動", () => {
    expect(splitAfterAi({ mode: "custom", customAmounts: { a: "" }, changed: true })).toEqual({ memberIds: null });
  });

  it("自訂但都沒變：不動", () => {
    expect(splitAfterAi({ mode: "custom", customAmounts: { a: "300" }, changed: false })).toBeNull();
  });

  it("本來就是平分：不動", () => {
    expect(splitAfterAi({ mode: "even", customAmounts: {}, changed: true })).toBeNull();
  });
});

describe("aiMessage", () => {
  it("讀出", () => {
    expect(aiMessage({ readResult: "read", filled: ["金額", "幣別"], creditsLeft: 2, splitReset: false })).toBe(
      "AI 已填入：金額、幣別（剩 2 點）"
    );
  });

  it("讀出而且分帳改回平分", () => {
    expect(aiMessage({ readResult: "read", filled: ["金額"], creditsLeft: 0, splitReset: true })).toBe(
      "AI 已填入：金額（剩 0 點）。分帳已改回平分"
    );
  });

  it("沒讀出金額，但有其他欄位", () => {
    expect(aiMessage({ readResult: "unreadable", filled: ["日期"], creditsLeft: 1, splitReset: false })).toBe(
      "沒有讀出金額（已扣 1 點），其他有讀到的欄位已填入"
    );
  });

  it("什麼都沒讀到（包含不是收據）", () => {
    expect(aiMessage({ readResult: "not_receipt", filled: [], creditsLeft: 1, splitReset: false })).toBe(
      "沒有讀出金額（已扣 1 點）"
    );
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/aiReceipt.test.ts`
Expected: FAIL，找不到 `@/utils/aiReceipt`。

- [ ] **Step 3: 實作**

`src/utils/aiReceipt.ts`:

```ts
/**
 * AI 讀收據在畫面這一側的規則：按鈕長什麼樣、結果怎麼套進表單、分帳要不要
 * 切回平分、提示那一行怎麼寫。
 *
 * Flutter 的 `lib/domain/ai_receipt.dart` 是同一套規則，改一邊要改另一邊；
 * 測試案例也是一比一照搬的。
 */
import { minorUnits } from "@/utils/currency";

/** 還沒用過的人第一次辨識時會拿到的點數。跟 functions 的 FREE_CREDITS 一樣。 */
export const FREE_CREDITS = 3;

export const GUEST_AI_NOTICE = "綁定帳號就能用 AI 辨識";

export interface AiReceiptFields {
  amount: string | null;
  currency: string | null;
  currencySupported: boolean;
  date: string | null;
  time: string | null;
  title: string | null;
  category: string | null;
}

export interface AiReadResult {
  readResult: "read" | "unreadable" | "not_receipt";
  fields: AiReceiptFields;
  creditsLeft: number;
}

export function aiButtonState(input: { guest: boolean; online: boolean; balance: number | null; busy: boolean }): {
  kind: "ready" | "guest" | "empty" | "offline" | "busy";
  label: string;
  disabled: boolean;
} {
  if (input.busy) return { kind: "busy", label: "辨識中…", disabled: true };
  // 訪客照樣按得下去：按下去才告訴他要綁定。停用的按鈕不會說明自己為什麼停用。
  if (input.guest) return { kind: "guest", label: "用 AI 讀收據", disabled: false };
  if (!input.online) return { kind: "offline", label: "需要網路", disabled: true };
  const balance = input.balance ?? FREE_CREDITS;
  if (balance <= 0) return { kind: "empty", label: "AI 點數用完了", disabled: true };
  return { kind: "ready", label: `用 AI 讀收據（剩 ${balance} 點）`, disabled: false };
}

export interface AiPatch {
  amount?: string;
  currency?: string;
  date?: string;
  time?: string;
  title?: string;
  category?: string;
  /** 「AI 已填入：…」那一行，照表單上的順序。 */
  filled: string[];
  warning: string | null;
}

function roundTo(text: string, currency: string): string | undefined {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value.toFixed(minorUnits(currency)) : undefined;
}

/**
 * 讀到的欄位全部蓋掉（使用者的決定），沒讀到的不動。
 *
 * 幣別不在支援清單裡時改用主要幣別，金額照收據上的數字、依主要幣別的小數位
 * 整理。**這樣存下來的金額是錯的幣別**，所以警告不會自己消失。
 */
export function aiPatch(
  fields: AiReceiptFields,
  ctx: { baseCurrency: string; currentCurrency: string }
): AiPatch {
  const patch: AiPatch = { filled: [], warning: null };
  const unsupported = fields.currency !== null && !fields.currencySupported;
  const currency = fields.currency && fields.currencySupported ? fields.currency : unsupported ? ctx.baseCurrency : null;

  if (fields.amount !== null) {
    // 支援的幣別函式已經整理好了；其他情況照最後會用的那個幣別整理。
    const amount = fields.currencySupported ? fields.amount : roundTo(fields.amount, currency ?? ctx.currentCurrency);
    if (amount !== undefined) {
      patch.amount = amount;
      patch.filled.push("金額");
    }
  }
  if (currency !== null) {
    patch.currency = currency;
    if (!unsupported) patch.filled.push("幣別");
  }
  if (fields.date !== null) {
    patch.date = fields.date;
    patch.filled.push("日期");
  }
  if (fields.time !== null) {
    patch.time = fields.time;
    patch.filled.push("時間");
  }
  if (fields.title !== null) {
    patch.title = fields.title;
    patch.filled.push("支出名稱");
  }
  if (fields.category !== null) {
    patch.category = fields.category;
    patch.filled.push("分類");
  }

  if (unsupported) {
    patch.warning =
      fields.amount !== null
        ? `收據上是 ${fields.currency} ${fields.amount}，目前不支援這個幣別，已改用 ${ctx.baseCurrency} —— 金額請自己換算後再存`
        : `收據上的幣別是 ${fields.currency}，目前不支援，已改用 ${ctx.baseCurrency}`;
  }
  return patch;
}

/**
 * 自訂分帳遇上 AI 改了金額或幣別：切回平分。
 *
 * 不切的話各人金額加總對不上新的總額，儲存按不下去，而使用者看不出原因。
 * 平分給原本有填金額的那幾個人；一個都沒有就不動分攤的人。
 */
export function splitAfterAi(input: {
  mode: "even" | "custom";
  customAmounts: Record<string, string>;
  changed: boolean;
}): { memberIds: string[] | null } | null {
  if (input.mode !== "custom" || !input.changed) return null;
  const ids = Object.entries(input.customAmounts)
    .filter(([, value]) => Number(value.trim()) > 0)
    .map(([id]) => id);
  return { memberIds: ids.length ? ids : null };
}

export function aiMessage(input: {
  readResult: string;
  filled: string[];
  creditsLeft: number;
  splitReset: boolean;
}): string {
  const base =
    input.readResult === "read"
      ? `AI 已填入：${input.filled.join("、")}（剩 ${input.creditsLeft} 點）`
      : input.filled.length
        ? "沒有讀出金額（已扣 1 點），其他有讀到的欄位已填入"
        : "沒有讀出金額（已扣 1 點）";
  return input.splitReset ? `${base}。分帳已改回平分` : base;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/aiReceipt.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/utils/aiReceipt.ts tests/aiReceipt.test.ts
git commit -F <msg>   # "Add web-side rules for applying AI receipt results"
```

---

### Task 10: 網頁的表單與個人頁

**Files:**
- Create: `src/services/aiService.ts`
- Modify: `src/composables/useReceipt.ts`
- Create: `src/components/expense/AiReceiptButton.vue`
- Modify: `src/pages/ExpenseFormPage.vue`
- Modify: `src/pages/ProfilePage.vue`

**Interfaces:**
- Consumes: callable `readReceipt`（Task 6）；Task 9 全部
- Produces: `readReceipt(blob: Blob): Promise<AiReadResult>`、`getAiCredits(uid: string): Promise<number | null>`（null = 還沒用過）

- [ ] **Step 1: `aiService.ts`**

```ts
import { doc, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app, db } from "@/firebase/config";
import type { AiReadResult } from "@/utils/aiReceipt";

/** base64，不帶 `data:image/jpeg;base64,` 前綴 —— 函式要的是純資料。 */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("讀不到這張照片"));
    reader.readAsDataURL(blob);
  });
}

/**
 * 讀一張收據。**呼叫就扣 1 點**，失敗也扣（見 functions 的 `ai/credits.ts`）。
 *
 * 錯誤原樣往外丟：函式的訊息都是中文，交給 `firebaseErrorMessage` 顯示。
 */
export async function readReceipt(blob: Blob): Promise<AiReadResult> {
  // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
  const call = httpsCallable<{ image: string }, AiReadResult>(getFunctions(app, "asia-east1"), "readReceipt");
  const result = await call({ image: await toBase64(blob) });
  return result.data;
}

/** 剩幾點。null 代表還沒用過 —— 第一次辨識時才會送 3 點。 */
export async function getAiCredits(uid: string): Promise<number | null> {
  const snap = await getDoc(doc(db, "aiCredits", uid));
  if (!snap.exists()) return null;
  const balance = snap.get("balance");
  return typeof balance === "number" ? balance : 0;
}
```

- [ ] **Step 2: `useReceipt` 公開 `pending`**

`src/composables/useReceipt.ts` 最後的 `return` 加上 `pending`：

```ts
  return { receipt, pending, previewUrl, state, busy, error, pickFile, clear, loadExisting, retry, commit };
```

在 `pending` 的宣告註解後補一句：

```ts
  /** 使用者這次新選的照片，還沒送出。AI 讀收據也用這一張 —— 已存好的照片在雲端，不在這台裝置上。 */
```

- [ ] **Step 3: `AiReceiptButton.vue`**

```vue
<script setup lang="ts">
/**
 * 「用 AI 讀收據」按鈕與它下面那一行。
 *
 * 只在剛拍或剛選了一張照片時出現（由母元件決定）。讀到的結果交給母元件套進
 * 表單 —— 這個元件不知道表單長什麼樣，它只負責「讀」與「講結果」。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { getAiCredits, readReceipt } from "@/services/aiService";
import { aiButtonState, GUEST_AI_NOTICE, type AiReadResult } from "@/utils/aiReceipt";
import { firebaseErrorMessage } from "@/utils/firestore";

const props = defineProps<{
  blob: Blob;
  uid: string;
  guest: boolean;
  /** 套進表單之後，母元件算出來的那一行。 */
  note: string | null;
  /** 幣別不支援時的警告。不會自己消失。 */
  warning: string | null;
}>();

const emit = defineEmits<{ (e: "result", result: AiReadResult): void }>();

const balance = ref<number | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const guestNotice = ref(false);
const online = ref(navigator.onLine);

function syncOnline() {
  online.value = navigator.onLine;
}

onMounted(async () => {
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
  if (props.guest) return;
  try {
    balance.value = await getAiCredits(props.uid);
  } catch {
    // 讀不到餘額不擋按鈕：真的沒點數時函式會說。
  }
});

onUnmounted(() => {
  window.removeEventListener("online", syncOnline);
  window.removeEventListener("offline", syncOnline);
});

const button = computed(() =>
  aiButtonState({ guest: props.guest, online: online.value, balance: balance.value, busy: busy.value })
);

async function run() {
  error.value = null;
  if (props.guest) {
    guestNotice.value = true;
    return;
  }
  busy.value = true;
  try {
    const result = await readReceipt(props.blob);
    balance.value = result.creditsLeft;
    emit("result", result);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
    // AI 出錯也扣了 1 點，餘額要重讀。
    balance.value = await getAiCredits(props.uid).catch(() => balance.value);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="ai">
    <button type="button" class="btn btn-sm" :disabled="button.disabled" @click="run">
      ✨ {{ button.label }}
    </button>
    <span v-if="guestNotice" class="tiny">
      {{ GUEST_AI_NOTICE }}，<RouterLink to="/profile">到個人設定綁定</RouterLink>。
    </span>
    <span v-else-if="error" class="tiny warn">{{ error }}</span>
    <span v-else-if="note" class="tiny">{{ note }}</span>
    <span v-if="warning" class="tiny warn">{{ warning }}</span>
  </div>
</template>

<style scoped>
.ai {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

.warn {
  color: var(--color-danger);
}
</style>
```

- [ ] **Step 4: 接進 `ExpenseFormPage.vue`**

import 區加：

```ts
import AiReceiptButton from "@/components/expense/AiReceiptButton.vue";
import { aiMessage, aiPatch, splitAfterAi, type AiReadResult } from "@/utils/aiReceipt";
import { isGuest } from "@/utils/guest";
```

`const receiptState = useReceipt();` 後面加：

```ts
/** AI 讀完之後那一行，以及幣別不支援的警告。換一張照片就清掉。 */
const aiNote = ref<string | null>(null);
const aiWarning = ref<string | null>(null);
const guest = isGuest(authStore.user);
```

`setSplitMode` 後面加：

```ts
/**
 * 把 AI 讀到的套進表單。讀到的全部蓋掉，沒讀到的不動。
 *
 * 幣別換了的話 `watch(currency)` 會自己查匯率；日期、時間換了的話天氣的
 * watch 會自己重查 —— 跟使用者手動改是同一條路。
 */
function applyAi(result: AiReadResult) {
  const patch = aiPatch(result.fields, { baseCurrency: baseCurrency.value, currentCurrency: currency.value });
  const changed =
    (patch.amount !== undefined && patch.amount !== amount.value) ||
    (patch.currency !== undefined && patch.currency !== currency.value);
  const split = splitAfterAi({ mode: splitMode.value, customAmounts: customAmounts.value, changed });

  if (patch.title !== undefined) title.value = patch.title;
  if (patch.category !== undefined) category.value = patch.category as ExpenseCategory;
  if (patch.date !== undefined) date.value = patch.date;
  if (patch.time !== undefined) time.value = patch.time;
  if (patch.currency !== undefined) currency.value = patch.currency;
  if (patch.amount !== undefined) amount.value = patch.amount;

  if (split) {
    splitMode.value = "even";
    if (split.memberIds) {
      const keep = new Set(split.memberIds);
      splitMemberIds.value = selectableMembers.value.map(member => member.uid).filter(id => keep.has(id));
    }
    customAmounts.value = {};
  }

  aiNote.value = aiMessage({
    readResult: result.readResult,
    filled: patch.filled,
    creditsLeft: result.creditsLeft,
    splitReset: split !== null
  });
  aiWarning.value = patch.warning;
}

watch(receiptState.pending, () => {
  aiNote.value = null;
  aiWarning.value = null;
});
```

template 裡 `<ReceiptField ... />` 的正下方加：

```vue
          <!--
            只在剛拍或剛選了一張照片時出現。已經存好的收據在雲端、不在這台裝置上，
            要辨識就重新拍一張（spec 的決定）。
          -->
          <AiReceiptButton
            v-if="receiptState.pending.value"
            :blob="receiptState.pending.value"
            :uid="uid"
            :guest="guest"
            :note="aiNote"
            :warning="aiWarning"
            @result="applyAi"
          />
```

- [ ] **Step 5: 個人頁**

`src/pages/ProfilePage.vue` import 區加 `import { getAiCredits } from "@/services/aiService";`、`import { FREE_CREDITS } from "@/utils/aiReceipt";`。

script 裡加：

```ts
/** AI 辨識點數。null 是還沒讀到；讀到「還沒用過」時顯示第一次會拿到的 3 點。 */
const aiCredits = ref<number | null>(null);

onMounted(async () => {
  if (!authStore.user || guest.value) return;
  try {
    aiCredits.value = (await getAiCredits(authStore.user.uid)) ?? FREE_CREDITS;
  } catch {
    // 讀不到就不顯示那一行，不擋個人頁。
  }
});
```

（檔案裡已經有 `onMounted` 的 import；如果已經有一個 `onMounted`，把上面的內容併進去，不要開第二個。）

第一張卡片裡「登入方式」那一段後面加：

```vue
        <div v-if="!guest && aiCredits !== null" class="spread">
          <span class="muted">AI 辨識點數</span>
          <strong>{{ aiCredits }}</strong>
        </div>
```

- [ ] **Step 6: 型別檢查、測試、建置**

Run: `npx vue-tsc --noEmit && npm test && npm run build`
Expected: 全部通過；`check-chunks` 沒有報循環相依。

- [ ] **Step 7: Commit**

```bash
git add src/services/aiService.ts src/composables/useReceipt.ts src/components/expense/AiReceiptButton.vue src/pages/ExpenseFormPage.vue src/pages/ProfilePage.vue
git commit -F <msg>   # "Add the AI receipt button to the web expense form and profile"
```

---

### Task 11: 網頁後台

**Files:**
- Modify: `src/services/adminService.ts`
- Create: `src/utils/aiLedger.ts`
- Test: `tests/aiLedger.test.ts`
- Create: `src/pages/admin/AdminAiPage.vue`
- Modify: `src/pages/admin/AdminConsole.vue`
- Modify: `src/pages/admin/AdminUsersPage.vue`
- Modify: `src/pages/admin/AdminAuditPage.vue`

**Interfaces:**
- Consumes: Task 8 的五支 callable 與 `adminUser.ai`
- Produces: `ledgerTypeLabel(type: string): string`、`ledgerResultLabel(row: { type: string; readResult: string | null; at: string | null }, now: Date): string`

- [ ] **Step 1: 點數紀錄的標籤 —— 先寫測試**

`tests/aiLedger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ledgerResultLabel, ledgerTypeLabel } from "@/utils/aiLedger";

const NOW = new Date("2026-09-12T10:00:00Z");

describe("ledgerTypeLabel", () => {
  it("三種類型", () => {
    expect(ledgerTypeLabel("use")).toBe("辨識");
    expect(ledgerTypeLabel("adjust")).toBe("調整");
    expect(ledgerTypeLabel("free")).toBe("免費");
  });

  it("不認得的照原文 —— 第二階段的 purchase 在畫面更新前也看得到", () => {
    expect(ledgerTypeLabel("purchase")).toBe("purchase");
  });
});

describe("ledgerResultLabel", () => {
  const use = (readResult: string | null, at = "2026-09-12T09:59:30Z") => ({ type: "use", readResult, at });

  it("辨識的結果", () => {
    expect(ledgerResultLabel(use("read"), NOW)).toBe("讀出");
    expect(ledgerResultLabel(use("unreadable"), NOW)).toBe("讀不出金額");
    expect(ledgerResultLabel(use("not_receipt"), NOW)).toBe("不是收據");
    expect(ledgerResultLabel(use("ai_error"), NOW)).toBe("AI 出錯");
    expect(ledgerResultLabel(use("timeout"), NOW)).toBe("逾時");
  });

  it("pending 一分鐘內是「辨識中」，超過就是「沒有回來」—— 扣了點卻沒有結果", () => {
    expect(ledgerResultLabel(use("pending"), NOW)).toBe("辨識中");
    expect(ledgerResultLabel(use("pending", "2026-09-12T09:58:00Z"), NOW)).toBe("沒有回來");
  });

  it("不是辨識的紀錄沒有結果", () => {
    expect(ledgerResultLabel({ type: "adjust", readResult: null, at: null }, NOW)).toBe("");
  });
});
```

Run: `npx vitest run tests/aiLedger.test.ts`
Expected: FAIL，找不到 `@/utils/aiLedger`。

- [ ] **Step 2: 實作 `src/utils/aiLedger.ts`**

```ts
/** 後台點數紀錄的顯示文字。AI 設定頁與使用者詳情共用。 */

const TYPE_LABELS: Record<string, string> = { use: "辨識", adjust: "調整", free: "免費" };

const RESULT_LABELS: Record<string, string> = {
  read: "讀出",
  unreadable: "讀不出金額",
  not_receipt: "不是收據",
  ai_error: "AI 出錯",
  timeout: "逾時"
};

/** 函式最長跑 60 秒；pending 超過一分鐘就不會回來了。 */
const PENDING_GRACE_MS = 60_000;

export function ledgerTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/**
 * 一直停在 pending 代表函式在呼叫 AI 之後當掉了：扣了點卻沒有結果。
 * 申訴時要一眼看得出來，所以跟一般的失敗分開講。
 */
export function ledgerResultLabel(
  row: { type: string; readResult: string | null; at: string | null },
  now: Date
): string {
  if (row.type !== "use") return "";
  if (row.readResult === "pending") {
    const at = row.at ? Date.parse(row.at) : 0;
    return now.getTime() - at > PENDING_GRACE_MS ? "沒有回來" : "辨識中";
  }
  return row.readResult ? (RESULT_LABELS[row.readResult] ?? row.readResult) : "";
}
```

Run: `npx vitest run tests/aiLedger.test.ts`
Expected: PASS。

- [ ] **Step 3: `adminService.ts`**

在「系統健康」那一段後面加：

```ts
/* ------------------------------------------------------------------ AI */

export interface AiModelOption {
  id: string;
  label: string;
  note: string;
}

export interface AdminAiConfig {
  configured: boolean;
  keyTail: string;
  model: string;
  models: AiModelOption[];
  updatedAt: string | null;
  updatedBy: string;
}

export interface AiLedgerRow {
  id: string;
  uid: string;
  nickname: string;
  type: string;
  delta: number;
  balanceAfter: number;
  at: string | null;
  readResult: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  adminEmail: string | null;
  reason: string | null;
}

export type AiLedgerFilter = "all" | "use" | "adjust" | "free";

export interface AdminAiUsage {
  range: AdminRange;
  days: { from: string; to: string };
  totals: { calls: number; reads: number; failures: number; inputTokens: number; outputTokens: number };
  /** 0 代表還沒開始記，不是「沒有人用」。 */
  recordedDays: number;
  rows: AiLedgerRow[];
  cursor: string | null;
}

export type AiTestResult =
  | {
      ok: true;
      model: string;
      readResult: string;
      fields: Record<string, unknown>;
      inputTokens: number | null;
      outputTokens: number | null;
      ms: number;
    }
  | { ok: false; model: string; error: string; ms: number };

/** 會在稽核日誌留下一筆 view.ai。 */
export async function fetchAiConfig(): Promise<AdminAiConfig> {
  return (await callable<Record<string, never>, AdminAiConfig>("adminAiConfig")({})).data;
}

/** 金鑰留空代表只換模型。後端會先驗再存，驗不過會丟中文訊息。 */
export async function setAiConfig(params: { apiKey?: string; model: string; reason: string }): Promise<void> {
  await callable<typeof params, unknown>("adminSetAiConfig")(params);
}

/** 實際跑一次，會花一點點錢。 */
export async function testAiConfig(): Promise<AiTestResult> {
  return (await callable<Record<string, never>, AiTestResult>("adminTestAiConfig")({})).data;
}

export async function fetchAiUsage(params: {
  range: AdminRange;
  type?: AiLedgerFilter;
  cursor?: string | null;
}): Promise<AdminAiUsage> {
  return (await callable<typeof params, AdminAiUsage>("adminAiUsage")(params)).data;
}

export async function adjustCredits(uid: string, delta: number, reason: string): Promise<{ balance: number; delta: number }> {
  const result = await callable<{ uid: string; delta: number; reason: string }, { balance: number; delta: number }>(
    "adminAdjustCredits"
  )({ uid, delta, reason });
  return result.data;
}
```

`AdminUserDetail` 多一個欄位（標成可能不存在 —— 前端與 functions 分開部署，舊版的 adminUser 不會回它）：

```ts
  ai?: {
    /** null 代表還沒用過，第一次辨識時才會送 3 點。 */
    balance: number | null;
    calls: number;
    reads: number;
    ledger: AiLedgerRow[];
  };
```

- [ ] **Step 4: 稽核日誌的中文名稱**

`src/pages/admin/AdminAuditPage.vue` 的 `ACTION_LABELS` 加三行：

```ts
  "view.ai": "檢視 AI 設定",
  "act.setAiConfig": "更換 AI 設定",
  "act.adjustCredits": "調整 AI 點數",
```

- [ ] **Step 5: 後台外框加分頁**

`src/pages/admin/AdminConsole.vue`：

```ts
import AdminAiPage from "@/pages/admin/AdminAiPage.vue";
```

`SECTIONS` 在 `health` 後面加 `{ id: "ai", label: "AI 設定", to: "/admin/ai" },`；`VIEWS` 加 `ai: AdminAiPage,`。

- [ ] **Step 6: `AdminAiPage.vue`**

```vue
<script setup lang="ts">
/**
 * AI 設定：金鑰、模型、測試、用量、跨使用者的點數紀錄。
 *
 * 金鑰只看得到末四碼 —— 完整的值只有雲端函式讀得到，連這一頁也拿不到。
 */
import { computed, onMounted, ref, watch } from "vue";
import {
  fetchAiConfig,
  fetchAiUsage,
  setAiConfig,
  testAiConfig,
  type AdminAiConfig,
  type AdminAiUsage,
  type AdminRange,
  type AiLedgerFilter,
  type AiTestResult
} from "@/services/adminService";
import LoadingState from "@/components/common/LoadingState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import { ledgerResultLabel, ledgerTypeLabel } from "@/utils/aiLedger";

const RANGES: Array<{ value: AdminRange; label: string }> = [
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" }
];

const FILTERS: Array<{ value: AiLedgerFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "use", label: "辨識" },
  { value: "adjust", label: "調整" },
  { value: "free", label: "免費" }
];

const config = ref<AdminAiConfig | null>(null);
const configError = ref<string | null>(null);

const model = ref("");
const apiKey = ref("");
const reason = ref("");
const saving = ref(false);
const saveError = ref<string | null>(null);
const saved = ref(false);

const testing = ref(false);
const testResult = ref<AiTestResult | null>(null);
const testError = ref<string | null>(null);

const range = ref<AdminRange>("30d");
const filter = ref<AiLedgerFilter>("all");
const usage = ref<AdminAiUsage | null>(null);
const usageError = ref<string | null>(null);
const usageLoading = ref(true);
/** Firestore 的游標是單向的，回上一頁只能靠自己記著來時路。 */
const trail = ref<Array<string | null>>([null]);
const page = ref(0);

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function loadConfig() {
  configError.value = null;
  try {
    config.value = await fetchAiConfig();
    model.value = config.value.model;
  } catch (err) {
    configError.value = message(err);
  }
}

async function loadUsage() {
  usageLoading.value = true;
  usageError.value = null;
  try {
    usage.value = await fetchAiUsage({ range: range.value, type: filter.value, cursor: trail.value[page.value] });
  } catch (err) {
    usageError.value = message(err);
  } finally {
    usageLoading.value = false;
  }
}

function resetUsage() {
  trail.value = [null];
  page.value = 0;
  void loadUsage();
}

onMounted(loadConfig);
watch([range, filter], resetUsage, { immediate: true });

function next() {
  const cursor = usage.value?.cursor;
  if (!cursor) return;
  trail.value = [...trail.value.slice(0, page.value + 1), cursor];
  page.value += 1;
  void loadUsage();
}

function prev() {
  if (page.value === 0) return;
  page.value -= 1;
  void loadUsage();
}

/** 沒設定過時一定要貼金鑰；設定過的話金鑰留空代表只換模型。 */
const canSave = computed(
  () =>
    !saving.value &&
    !!reason.value.trim() &&
    !!model.value &&
    (config.value?.configured ? apiKey.value.trim() !== "" || model.value !== config.value.model : apiKey.value.trim() !== "")
);

async function save() {
  saving.value = true;
  saveError.value = null;
  saved.value = false;
  try {
    await setAiConfig({ apiKey: apiKey.value.trim() || undefined, model: model.value, reason: reason.value.trim() });
    apiKey.value = "";
    reason.value = "";
    saved.value = true;
    await loadConfig();
  } catch (err) {
    saveError.value = message(err);
  } finally {
    saving.value = false;
  }
}

async function runTest() {
  testing.value = true;
  testError.value = null;
  testResult.value = null;
  try {
    testResult.value = await testAiConfig();
  } catch (err) {
    testError.value = message(err);
  } finally {
    testing.value = false;
  }
}

const now = new Date();
const day = (value: string | null) => (value ? value.slice(0, 16).replace("T", " ") : "—");
const num = (value: number) => value.toLocaleString("zh-TW");
</script>

<template>
  <main class="page">
    <section class="console">
      <header class="topbar">
        <h1 class="title">AI 設定</h1>
      </header>

      <ErrorState v-if="configError" :message="configError" />

      <div v-if="config" class="grid">
        <div class="card stack">
          <h2 class="card-head">金鑰與模型</h2>
          <p v-if="!config.configured" class="tiny warn">尚未設定。設定之前，所有人按「用 AI 讀收據」都會看到「AI 辨識還沒有設定好」。</p>
          <p v-else class="tiny">
            末四碼 ••••{{ config.keyTail || "????" }}，最後由 {{ config.updatedBy || "—" }} 於 {{ day(config.updatedAt) }} 更新。
          </p>

          <label class="field">
            <span class="label">模型</span>
            <select v-model="model" class="select">
              <option v-for="item in config.models" :key="item.id" :value="item.id">
                {{ item.label }} —— {{ item.note }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="label">{{ config.configured ? "新的 API 金鑰（只換模型就留空）" : "OpenAI API 金鑰" }}</span>
            <input v-model="apiKey" class="input" type="password" autocomplete="off" placeholder="sk-..." />
          </label>

          <label class="field">
            <span class="label">理由（必填，會寫進稽核日誌）</span>
            <textarea v-model="reason" class="input" rows="2" maxlength="500"></textarea>
          </label>

          <!-- 存之前後端會用新設定向 OpenAI 驗一次，驗不過就不存。 -->
          <button type="button" class="btn btn-primary" :disabled="!canSave" @click="save">
            {{ saving ? "驗證中..." : "驗證並儲存" }}
          </button>
          <p v-if="saveError" class="tiny warn">{{ saveError }}</p>
          <p v-else-if="saved" class="tiny">已儲存。其他伺服器最慢一分鐘後換成新設定。</p>
        </div>

        <div class="card stack">
          <h2 class="card-head">測試目前的設定</h2>
          <p class="tiny">
            用一段內建的收據文字實際跑一次。只有真的呼叫才看得出帳戶沒錢、金鑰被撤銷。
            每按一次花一點點錢，不扣任何人的點數。
          </p>
          <button type="button" class="btn" :disabled="testing || !config.configured" @click="runTest">
            {{ testing ? "測試中..." : "測試" }}
          </button>
          <p v-if="testError" class="tiny warn">{{ testError }}</p>
          <template v-else-if="testResult">
            <p v-if="!testResult.ok" class="tiny warn">
              失敗（{{ testResult.model }}，{{ testResult.ms }} ms）：{{ testResult.error }}
            </p>
            <div v-else class="tiny">
              <p>
                成功：{{ testResult.model }}，{{ testResult.ms }} ms，
                token {{ testResult.inputTokens ?? "—" }} / {{ testResult.outputTokens ?? "—" }}
              </p>
              <pre class="mono">{{ JSON.stringify(testResult.fields, null, 2) }}</pre>
            </div>
          </template>
        </div>
      </div>

      <div class="card stack">
        <div class="spread">
          <h2 class="card-head">用量</h2>
          <div class="seg" role="group" aria-label="時間區間">
            <button
              v-for="item in RANGES"
              :key="item.value"
              type="button"
              class="seg-item"
              :class="{ active: range === item.value }"
              @click="range = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <template v-if="usage">
          <p v-if="usage.recordedDays === 0" class="tiny">這段期間還沒有任何紀錄 —— 可能是還沒有人用，也可能是統計剛開始記。</p>
          <div class="counts">
            <div><span class="label">辨識</span><strong>{{ num(usage.totals.calls) }}</strong></div>
            <div><span class="label">讀出</span><strong>{{ num(usage.totals.reads) }}</strong></div>
            <div><span class="label">失敗</span><strong>{{ num(usage.totals.failures) }}</strong></div>
            <div>
              <span class="label">token（輸入／輸出）</span>
              <strong>{{ num(usage.totals.inputTokens) }} / {{ num(usage.totals.outputTokens) }}</strong>
            </div>
          </div>
          <p class="tiny">{{ usage.days.from }} 至 {{ usage.days.to }}（算到今天）</p>
        </template>
      </div>

      <div class="card stack">
        <div class="spread">
          <h2 class="card-head">使用報告</h2>
          <div class="seg" role="group" aria-label="類型">
            <button
              v-for="item in FILTERS"
              :key="item.value"
              type="button"
              class="seg-item"
              :class="{ active: filter === item.value }"
              @click="filter = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <LoadingState v-if="usageLoading" title="讀取中" message="正在整理點數紀錄" />
        <ErrorState v-else-if="usageError" :message="usageError" />
        <EmptyState v-else-if="!usage?.rows.length" title="沒有紀錄" message="還沒有人用過 AI 辨識。" />
        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>時間</th><th>使用者</th><th>類型</th><th>變動</th><th>餘額</th><th>結果</th><th>token</th><th>理由</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in usage.rows" :key="`${row.uid}/${row.id}`">
                <td class="num">{{ day(row.at) }}</td>
                <td>{{ row.nickname || row.uid }}</td>
                <td>{{ ledgerTypeLabel(row.type) }}</td>
                <td class="num">{{ row.delta > 0 ? `+${row.delta}` : row.delta }}</td>
                <td class="num">{{ row.balanceAfter }}</td>
                <td>{{ ledgerResultLabel(row, now) }}</td>
                <td class="num">{{ row.inputTokens !== null ? `${row.inputTokens} / ${row.outputTokens ?? "—"}` : "" }}</td>
                <td>{{ row.reason ?? "" }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="pager">
          <button type="button" class="btn btn-sm" :disabled="page === 0 || usageLoading" @click="prev">上一頁</button>
          <button type="button" class="btn btn-sm" :disabled="!usage?.cursor || usageLoading" @click="next">下一頁</button>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4);
}

.counts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
}

.counts div {
  display: flex;
  flex-direction: column;
}

.table-wrap {
  overflow-x: auto;
}

.pager {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

.mono {
  white-space: pre-wrap;
  font-size: var(--text-tiny);
}

.warn {
  color: var(--color-danger);
}
</style>
```

class 名稱（`console`、`topbar`、`card-head`、`seg`、`table`、`spread`）照其他後台頁用的；如果 `.table` 或 `.counts` 在其他頁是 scoped 的，照 `AdminAuditPage.vue`／`AdminUsersPage.vue` 的寫法複製過來，不要另外發明一套樣式。

- [ ] **Step 7: 使用者詳情加 AI 點數**

`src/pages/admin/AdminUsersPage.vue`：

import 加 `adjustCredits`（從 `adminService`）與 `import { ledgerResultLabel, ledgerTypeLabel } from "@/utils/aiLedger";`。

script 裡加：

```ts
const adjustAmount = ref<number | null>(null);
const adjustReason = ref("");
const adjusting = ref(false);
const adjustError = ref<string | null>(null);

const canAdjust = computed(() => {
  const value = adjustAmount.value;
  return (
    !adjusting.value &&
    !!adjustReason.value.trim() &&
    typeof value === "number" &&
    Number.isInteger(value) &&
    value !== 0 &&
    Math.abs(value) <= 100
  );
});

async function confirmAdjust() {
  const uid = detail.value?.profile.uid;
  if (!uid || adjustAmount.value === null) return;
  adjusting.value = true;
  adjustError.value = null;
  try {
    await adjustCredits(uid, adjustAmount.value, adjustReason.value.trim());
    adjustAmount.value = null;
    adjustReason.value = "";
    await fetchUser(uid).then(next => (detail.value = next));
  } catch (err) {
    adjustError.value = err instanceof Error ? err.message : String(err);
  } finally {
    adjusting.value = false;
  }
}

const now = new Date();
```

（`computed` 要加進 vue 的 import。`select()` 換人時把 `adjustAmount`、`adjustReason`、`adjustError` 清掉 —— 上一個人打到一半的理由不能留給下一個人，理由跟 `AdminActionDialog` 的註解一樣。）

template 裡「參與的任務」那一段（`<div v-if="detail.tasks.length" class="tasks">`）前面加：

```vue
            <div v-if="detail.ai" class="tasks">
              <h3 class="card-head">AI 辨識</h3>
              <p class="tiny">
                <template v-if="detail.ai.balance === null">還沒用過（第一次辨識時會送 3 點）。</template>
                <template v-else>剩 {{ detail.ai.balance }} 點。</template>
                辨識 {{ detail.ai.calls }} 次，失敗 {{ detail.ai.calls - detail.ai.reads }} 次。
              </p>

              <div v-if="detail.profile.provider !== GUEST_PROVIDER_ID" class="adjust">
                <input
                  v-model.number="adjustAmount"
                  class="input"
                  type="number"
                  min="-100"
                  max="100"
                  step="1"
                  placeholder="例如 3 或 -1"
                />
                <input v-model="adjustReason" class="input grow" maxlength="500" placeholder="理由（必填，會寫進稽核日誌）" />
                <button type="button" class="btn btn-sm" :disabled="!canAdjust" @click="confirmAdjust">
                  {{ adjusting ? "調整中..." : "調整點數" }}
                </button>
              </div>
              <p v-else class="tiny">訪客不能用 AI 辨識，也不能調整點數。</p>
              <p v-if="adjustError" class="tiny warn">{{ adjustError }}</p>

              <ul v-if="detail.ai.ledger.length">
                <li v-for="row in detail.ai.ledger" :key="row.id">
                  <span class="tiny num">{{ row.at ? row.at.slice(0, 16).replace("T", " ") : "—" }}</span>
                  <span class="pill">{{ ledgerTypeLabel(row.type) }}</span>
                  <span class="num">{{ row.delta > 0 ? `+${row.delta}` : row.delta }}</span>
                  <span class="tiny">{{ ledgerResultLabel(row, now) || row.reason || "" }}</span>
                </li>
              </ul>
            </div>
```

style 加：

```css
.adjust {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.adjust .input[type="number"] {
  width: 120px;
}
```

- [ ] **Step 8: 型別檢查、測試、建置**

Run: `npx vue-tsc --noEmit && npm test && npm run build`
Expected: 全部通過。

- [ ] **Step 9: Commit**

```bash
git add src/services/adminService.ts src/utils/aiLedger.ts tests/aiLedger.test.ts src/pages/admin/AdminAiPage.vue src/pages/admin/AdminConsole.vue src/pages/admin/AdminUsersPage.vue src/pages/admin/AdminAuditPage.vue
git commit -F <msg>   # "Add the AI settings page and credit adjustments to the admin console"
```

---

### Task 12: Flutter 的純函式 `domain/ai_receipt.dart`

**Files:**
- Create: `flutter_app/lib/domain/ai_receipt.dart`
- Test: `flutter_app/test/ai_receipt_test.dart`

**Interfaces:**
- Consumes: `minorUnits`（`domain/currency.dart`）
- Produces（Task 13 使用）: 網頁版 `aiReceipt.ts` 的 Dart 版，名稱改成 Dart 慣例：
  - `freeCredits`、`guestAiNotice`
  - `AiReceiptFields.fromMap(Map)`、`AiReadResult.fromMap(Map)`
  - `AiButton aiButtonState({required bool guest, required bool online, required int? balance, required bool busy})`，`AiButton { AiButtonKind kind; String label; bool disabled }`
  - `AiPatch aiPatch(AiReceiptFields fields, {required String baseCurrency, required String currentCurrency})`
  - `SplitReset? splitAfterAi({required bool custom, required Map<String, String> customAmounts, required bool changed})`，`SplitReset { List<String>? memberIds }`
  - `String aiMessage({required String readResult, required List<String> filled, required int creditsLeft, required bool splitReset})`

- [ ] **Step 1: 寫測試**

`flutter_app/test/ai_receipt_test.dart`：

```dart
import 'package:test/test.dart';
import 'package:splitflow/domain/ai_receipt.dart';

/// `tests/aiReceipt.test.ts` 的 Dart 版，案例一比一照搬。
AiReceiptFields fields({
  String? amount = '1280',
  String? currency = 'JPY',
  bool currencySupported = true,
  String? date = '2026-09-10',
  String? time = '19:05',
  String? title = 'すき家',
  String? category = 'food',
}) =>
    AiReceiptFields(
      amount: amount,
      currency: currency,
      currencySupported: currencySupported,
      date: date,
      time: time,
      title: title,
      category: category,
    );

void main() {
  group('aiButtonState', () {
    test('正常：顯示剩幾點', () {
      final b = aiButtonState(guest: false, online: true, balance: 2, busy: false);
      expect(b.kind, AiButtonKind.ready);
      expect(b.label, '用 AI 讀收據（剩 2 點）');
      expect(b.disabled, false);
    });

    test('還沒用過顯示 3 點', () {
      expect(aiButtonState(guest: false, online: true, balance: null, busy: false).label, '用 AI 讀收據（剩 3 點）');
    });

    test('訪客按得下去', () {
      final b = aiButtonState(guest: true, online: true, balance: 2, busy: false);
      expect(b.kind, AiButtonKind.guest);
      expect(b.label, '用 AI 讀收據');
      expect(b.disabled, false);
    });

    test('點數用完、沒網路都停用', () {
      expect(aiButtonState(guest: false, online: true, balance: 0, busy: false).label, 'AI 點數用完了');
      expect(aiButtonState(guest: false, online: false, balance: 2, busy: false).label, '需要網路');
    });

    test('辨識中優先', () {
      final b = aiButtonState(guest: false, online: false, balance: 2, busy: true);
      expect(b.kind, AiButtonKind.busy);
      expect(b.label, '辨識中…');
      expect(b.disabled, true);
    });
  });

  group('aiPatch', () {
    test('讀到的全部蓋掉，照固定順序列出', () {
      final p = aiPatch(fields(), baseCurrency: 'TWD', currentCurrency: 'TWD');
      expect(p.amount, '1280');
      expect(p.currency, 'JPY');
      expect(p.filled, ['金額', '幣別', '日期', '時間', '支出名稱', '分類']);
      expect(p.warning, isNull);
    });

    test('沒讀到的不動', () {
      final p = aiPatch(fields(time: null, category: null, title: null), baseCurrency: 'TWD', currentCurrency: 'TWD');
      expect(p.time, isNull);
      expect(p.filled, ['金額', '幣別', '日期']);
    });

    test('不支援的幣別改用主要幣別並警告', () {
      final p = aiPatch(fields(amount: '40000', currency: 'KHR', currencySupported: false),
          baseCurrency: 'TWD', currentCurrency: 'TWD');
      expect(p.currency, 'TWD');
      expect(p.amount, '40000.00');
      expect(p.warning, '收據上是 KHR 40000，目前不支援這個幣別，已改用 TWD —— 金額請自己換算後再存');
      expect(p.filled.contains('幣別'), false);
    });

    test('主要幣別是日圓時 12.5 變 13', () {
      final p = aiPatch(fields(amount: '12.5', currency: 'KHR', currencySupported: false),
          baseCurrency: 'JPY', currentCurrency: 'JPY');
      expect(p.amount, '13');
    });

    test('沒讀到幣別：依表單現在的幣別整理', () {
      final p = aiPatch(fields(amount: '85', currency: null, currencySupported: false),
          baseCurrency: 'TWD', currentCurrency: 'TWD');
      expect(p.currency, isNull);
      expect(p.amount, '85.00');
    });

    test('不支援又沒讀出金額：警告不提金額', () {
      final p = aiPatch(fields(amount: null, currency: 'KHR', currencySupported: false),
          baseCurrency: 'TWD', currentCurrency: 'TWD');
      expect(p.warning, '收據上的幣別是 KHR，目前不支援，已改用 TWD');
    });
  });

  group('splitAfterAi', () {
    test('自訂而且變了：切回平分，給有填金額的人', () {
      final r = splitAfterAi(custom: true, customAmounts: {'a': '300', 'b': ' 0 ', 'c': '', 'd': '12.5'}, changed: true);
      expect(r?.memberIds, ['a', 'd']);
    });

    test('自訂但沒有人有金額：切回平分，分攤的人不動', () {
      final r = splitAfterAi(custom: true, customAmounts: {'a': ''}, changed: true);
      expect(r, isNotNull);
      expect(r!.memberIds, isNull);
    });

    test('沒變或本來就是平分：不動', () {
      expect(splitAfterAi(custom: true, customAmounts: {'a': '300'}, changed: false), isNull);
      expect(splitAfterAi(custom: false, customAmounts: const {}, changed: true), isNull);
    });
  });

  group('aiMessage', () {
    test('讀出', () {
      expect(aiMessage(readResult: 'read', filled: ['金額', '幣別'], creditsLeft: 2, splitReset: false),
          'AI 已填入：金額、幣別（剩 2 點）');
    });

    test('讀出而且分帳改回平分', () {
      expect(aiMessage(readResult: 'read', filled: ['金額'], creditsLeft: 0, splitReset: true),
          'AI 已填入：金額（剩 0 點）。分帳已改回平分');
    });

    test('沒讀出金額', () {
      expect(aiMessage(readResult: 'unreadable', filled: ['日期'], creditsLeft: 1, splitReset: false),
          '沒有讀出金額（已扣 1 點），其他有讀到的欄位已填入');
      expect(aiMessage(readResult: 'not_receipt', filled: [], creditsLeft: 1, splitReset: false),
          '沒有讀出金額（已扣 1 點）');
    });
  });

  group('fromMap', () {
    test('callable 回來的巢狀 Map 讀得起來', () {
      final r = AiReadResult.fromMap(<Object?, Object?>{
        'readResult': 'read',
        'creditsLeft': 2,
        'fields': <Object?, Object?>{
          'amount': '1280',
          'currency': 'JPY',
          'currencySupported': true,
          'date': null,
          'time': null,
          'title': 'すき家',
          'category': 'food',
        },
      });
      expect(r.creditsLeft, 2);
      expect(r.fields.amount, '1280');
      expect(r.fields.date, isNull);
    });
  });
}
```

- [ ] **Step 2: 實作**

`flutter_app/lib/domain/ai_receipt.dart`：

```dart
/// AI 讀收據在畫面這一側的規則。`src/utils/aiReceipt.ts` 的 Dart 版，
/// 規則與文案一字不差，改一邊要改另一邊。
///
/// 刻意不 import Firebase 或 Flutter：這一層要保持純 Dart，測試才跑得動。
library;

import 'currency.dart';

const int freeCredits = 3;
const String guestAiNotice = '綁定帳號就能用 AI 辨識';

class AiReceiptFields {
  final String? amount;
  final String? currency;
  final bool currencySupported;
  final String? date;
  final String? time;
  final String? title;
  final String? category;

  const AiReceiptFields({
    required this.amount,
    required this.currency,
    required this.currencySupported,
    required this.date,
    required this.time,
    required this.title,
    required this.category,
  });

  factory AiReceiptFields.fromMap(Map<dynamic, dynamic> map) {
    String? text(String key) => map[key] is String ? map[key] as String : null;
    return AiReceiptFields(
      amount: text('amount'),
      currency: text('currency'),
      currencySupported: map['currencySupported'] == true,
      date: text('date'),
      time: text('time'),
      title: text('title'),
      category: text('category'),
    );
  }
}

class AiReadResult {
  final String readResult;
  final AiReceiptFields fields;
  final int creditsLeft;

  const AiReadResult({required this.readResult, required this.fields, required this.creditsLeft});

  /// callable 回來的巢狀物件在 Dart 這邊是 `Map<Object?, Object?>`，不是
  /// `Map<String, dynamic>` —— 直接 cast 會丟例外。
  factory AiReadResult.fromMap(Map<dynamic, dynamic> map) => AiReadResult(
        readResult: (map['readResult'] as String?) ?? 'unreadable',
        fields: AiReceiptFields.fromMap((map['fields'] as Map?) ?? const {}),
        creditsLeft: (map['creditsLeft'] as num?)?.toInt() ?? 0,
      );
}

enum AiButtonKind { ready, guest, empty, offline, busy }

class AiButton {
  final AiButtonKind kind;
  final String label;
  final bool disabled;
  const AiButton(this.kind, this.label, this.disabled);
}

AiButton aiButtonState({
  required bool guest,
  required bool online,
  required int? balance,
  required bool busy,
}) {
  if (busy) return const AiButton(AiButtonKind.busy, '辨識中…', true);
  // 訪客照樣按得下去：按下去才告訴他要綁定。停用的按鈕不會說明自己為什麼停用。
  if (guest) return const AiButton(AiButtonKind.guest, '用 AI 讀收據', false);
  if (!online) return const AiButton(AiButtonKind.offline, '需要網路', true);
  final left = balance ?? freeCredits;
  if (left <= 0) return const AiButton(AiButtonKind.empty, 'AI 點數用完了', true);
  return AiButton(AiButtonKind.ready, '用 AI 讀收據（剩 $left 點）', false);
}

class AiPatch {
  String? amount;
  String? currency;
  String? date;
  String? time;
  String? title;
  String? category;
  final List<String> filled = [];
  String? warning;
}

String? _roundTo(String text, String currency) {
  final value = double.tryParse(text);
  if (value == null || !value.isFinite || value <= 0) return null;
  return value.toStringAsFixed(minorUnits(currency));
}

/// 讀到的全部蓋掉，沒讀到的不動。幣別不支援時改用主要幣別，警告不會自己消失。
AiPatch aiPatch(
  AiReceiptFields fields, {
  required String baseCurrency,
  required String currentCurrency,
}) {
  final patch = AiPatch();
  final unsupported = fields.currency != null && !fields.currencySupported;
  final currency = (fields.currency != null && fields.currencySupported)
      ? fields.currency
      : (unsupported ? baseCurrency : null);

  final amount = fields.amount;
  if (amount != null) {
    final value = fields.currencySupported ? amount : _roundTo(amount, currency ?? currentCurrency);
    if (value != null) {
      patch.amount = value;
      patch.filled.add('金額');
    }
  }
  if (currency != null) {
    patch.currency = currency;
    if (!unsupported) patch.filled.add('幣別');
  }
  if (fields.date != null) {
    patch.date = fields.date;
    patch.filled.add('日期');
  }
  if (fields.time != null) {
    patch.time = fields.time;
    patch.filled.add('時間');
  }
  if (fields.title != null) {
    patch.title = fields.title;
    patch.filled.add('支出名稱');
  }
  if (fields.category != null) {
    patch.category = fields.category;
    patch.filled.add('分類');
  }

  if (unsupported) {
    patch.warning = amount != null
        ? '收據上是 ${fields.currency} $amount，目前不支援這個幣別，已改用 $baseCurrency —— 金額請自己換算後再存'
        : '收據上的幣別是 ${fields.currency}，目前不支援，已改用 $baseCurrency';
  }
  return patch;
}

class SplitReset {
  /// null 代表分攤的人不動。
  final List<String>? memberIds;
  const SplitReset(this.memberIds);
}

/// 自訂分帳遇上 AI 改了金額或幣別：切回平分，給原本有填金額的那幾個人。
SplitReset? splitAfterAi({
  required bool custom,
  required Map<String, String> customAmounts,
  required bool changed,
}) {
  if (!custom || !changed) return null;
  final ids = [
    for (final entry in customAmounts.entries)
      if ((double.tryParse(entry.value.trim()) ?? 0) > 0) entry.key,
  ];
  return SplitReset(ids.isEmpty ? null : ids);
}

String aiMessage({
  required String readResult,
  required List<String> filled,
  required int creditsLeft,
  required bool splitReset,
}) {
  final base = readResult == 'read'
      ? 'AI 已填入：${filled.join('、')}（剩 $creditsLeft 點）'
      : (filled.isNotEmpty ? '沒有讀出金額（已扣 1 點），其他有讀到的欄位已填入' : '沒有讀出金額（已扣 1 點）');
  return splitReset ? '$base。分帳已改回平分' : base;
}
```

- [ ] **Step 3: Commit（CI 驗）**

```bash
git add flutter_app/lib/domain/ai_receipt.dart flutter_app/test/ai_receipt_test.dart
git commit -F <msg>   # "Port the AI receipt rules to Dart"
```

這台沒有 Dart，測試等 Task 13 一起推上去讓 CI 跑。

---

### Task 13: Flutter 的表單與個人頁

**Files:**
- Create: `flutter_app/lib/data/ai_repository.dart`
- Modify: `flutter_app/lib/state/providers.dart`
- Modify: `flutter_app/lib/ui/expense_form_page.dart`
- Modify: `flutter_app/lib/ui/profile_page.dart`

**Interfaces:**
- Consumes: callable `readReceipt`（Task 6）、Task 12
- Produces: `AiRepository.readReceipt(File)`、`AiRepository.credits(String uid)`；`aiRepositoryProvider`、`aiCreditsProvider`（`FutureProvider<int?>`，沒登入或訪客是 null）

- [ ] **Step 1: `ai_repository.dart`**

```dart
/// AI 讀收據。辨識的邏輯一行都不在這裡 —— 在 `functions/src/ai/`，
/// 這裡只呼叫 callable 與讀餘額。跟 `weather_repository.dart` 同一個理由。
library;

import 'dart:convert';
import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';

import '../domain/ai_receipt.dart';
import 'firestore_refs.dart';

class AiRepository {
  /// **呼叫就扣 1 點**，失敗也扣。錯誤原樣往外丟：函式的訊息都是中文，
  /// 交給 `errorText` 顯示。
  Future<AiReadResult> readReceipt(File file) async {
    final bytes = await file.readAsBytes();
    // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
    final call = FirebaseFunctions.instanceFor(region: 'asia-east1').httpsCallable(
      'readReceipt',
      // 函式自己有 30 秒的 AI 逾時，這裡多留一點。
      options: HttpsCallableOptions(timeout: const Duration(seconds: 70)),
    );
    final result = await call.call<Map<Object?, Object?>>({'image': base64Encode(bytes)});
    return AiReadResult.fromMap(result.data);
  }

  /// 剩幾點。null 代表還沒用過 —— 第一次辨識時才會送 3 點。
  Future<int?> credits(String uid) async {
    final snap = await db.collection('aiCredits').doc(uid).get();
    if (!snap.exists) return null;
    final balance = snap.data()?['balance'];
    return balance is num ? balance.toInt() : 0;
  }
}
```

- [ ] **Step 2: providers**

`flutter_app/lib/state/providers.dart`：import `'../data/ai_repository.dart'`；repository 區加：

```dart
/// AI 讀收據與點數。
final aiRepositoryProvider = Provider((ref) => AiRepository());
```

登入區（`userProfileProvider` 後面）加：

```dart
/// 我的 AI 辨識點數。null：沒登入、訪客、或還沒用過（畫面把最後一種當 3 點）。
/// 辨識完要 `ref.invalidate` 它 —— 失敗也扣了點。
final aiCreditsProvider = FutureProvider<int?>((ref) async {
  final user = ref.watch(authStateProvider).value;
  if (user == null || user.isAnonymous) return null;
  return ref.watch(aiRepositoryProvider).credits(user.uid);
});
```

- [ ] **Step 3: 表單 —— 換幣別抽成方法**

`expense_form_page.dart` 的 `_lookupRate` 前面加：

```dart
  /// 換幣別。選單與 AI 共用 —— 兩條路要做的事一樣：清掉「更新於」、
  /// 換回主要幣別時匯率設 1。
  void _setCurrency(Task task, String value) {
    setState(() {
      _currency = value;
      _rateUpdatedAt = '';
      if (value == task.defaultCurrency) _rate.text = '1';
    });
  }
```

`CurrencyPicker` 的 `onChanged` 改成 `onChanged: (value) => _setCurrency(task, value),`。

- [ ] **Step 4: 表單 —— AI 的狀態與套用**

import 加 `'../domain/ai_receipt.dart'`。state 欄位加：

```dart
  /// AI 讀收據。換一張照片就全部清掉。
  bool _aiBusy = false;
  String? _aiNote;
  String? _aiWarning;
  String? _aiError;
  bool _aiGuestNotice = false;
```

`_lookupRate` 後面加：

```dart
  Future<void> _runAi(Task task) async {
    final user = ref.read(authStateProvider).value;
    if (user == null || user.isAnonymous) {
      setState(() => _aiGuestNotice = true);
      return;
    }
    final file = _receipt.file;
    if (file == null) return;

    setState(() {
      _aiBusy = true;
      _aiError = null;
    });
    try {
      final result = await ref.read(aiRepositoryProvider).readReceipt(file);
      if (!mounted) return;
      _applyAi(task, result);
    } catch (err) {
      if (mounted) setState(() => _aiError = errorText(err));
    } finally {
      // 成功或失敗都扣了點，餘額要重讀。
      ref.invalidate(aiCreditsProvider);
      if (mounted) setState(() => _aiBusy = false);
    }
  }

  /// 讀到的全部蓋掉，沒讀到的不動。幣別換了要主動查匯率 ——
  /// 這一頁原本只有按鈕會觸發 `_lookupRate`。
  void _applyAi(Task task, AiReadResult result) {
    final patch = aiPatch(result.fields, baseCurrency: task.defaultCurrency, currentCurrency: _currency);
    final changed = (patch.amount != null && patch.amount != _amount.text) ||
        (patch.currency != null && patch.currency != _currency);
    final split = splitAfterAi(
      custom: _splitMode == SplitMode.custom,
      customAmounts: {for (final e in _custom.entries) e.key: e.value.text},
      changed: changed,
    );

    setState(() {
      if (patch.title != null) _title.text = patch.title!;
      if (patch.category != null) _category = categoryFrom(patch.category);
      if (patch.date != null) _date = patch.date!;
      if (patch.time != null) _time = patch.time!;
      if (patch.amount != null) _amount.text = patch.amount!;
      if (split != null) {
        _splitMode = SplitMode.even;
        if (split.memberIds != null) {
          _splitWith
            ..clear()
            ..addAll(split.memberIds!);
        }
        for (final controller in _custom.values) {
          controller.clear();
        }
      }
      _aiNote = aiMessage(
        readResult: result.readResult,
        filled: patch.filled,
        creditsLeft: result.creditsLeft,
        splitReset: split != null,
      );
      _aiWarning = patch.warning;
    });

    final currency = patch.currency;
    if (currency != null && currency != _currency) {
      _setCurrency(task, currency);
      if (currency != task.defaultCurrency) _lookupRate(task);
    }
    if (patch.date != null || patch.time != null) _refreshWeather();
  }
```

- [ ] **Step 5: 表單 —— 畫面**

`ReceiptField` 的 `onChanged` 改成（換一張照片就清掉上一張的結果）：

```dart
                          onChanged: (value) => setState(() {
                            _receipt = value;
                            _aiNote = null;
                            _aiWarning = null;
                            _aiError = null;
                            _aiGuestNotice = false;
                          }),
```

收據那個 `_Field` 的正下方加：

```dart
                      // 只在剛拍或剛選了一張照片時出現。已存好的收據在雲端，
                      // 要辨識就重新拍一張（spec 的決定）。
                      //
                      // 沒有「沒網路」這個狀態（見計畫的「與 spec 的差異」）：
                      // 離線時呼叫到不了函式，不會扣點，錯誤訊息會講清楚。
                      if (_receipt.change == ReceiptChange.replaced && _receipt.file != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpace.x4),
                          child: Builder(builder: (context) {
                            final user = ref.watch(authStateProvider).value;
                            final button = aiButtonState(
                              guest: user?.isAnonymous ?? false,
                              online: true,
                              balance: ref.watch(aiCreditsProvider).value,
                              busy: _aiBusy,
                            );
                            return Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                OutlinedButton.icon(
                                  onPressed: button.disabled ? null : () => _runAi(task),
                                  icon: const Icon(Icons.auto_awesome_outlined, size: 18),
                                  label: Text(button.label),
                                ),
                                if (_aiGuestNotice)
                                  Text('$guestAiNotice，到個人設定綁定。', style: text.bodySmall)
                                else if (_aiError != null)
                                  Text(_aiError!, style: text.bodySmall?.copyWith(color: AppColors.danger))
                                else if (_aiNote != null)
                                  Text(_aiNote!, style: text.bodySmall),
                                if (_aiWarning != null)
                                  Text(_aiWarning!, style: text.bodySmall?.copyWith(color: AppColors.danger)),
                              ],
                            );
                          }),
                        ),
```

（`ref.watch(aiCreditsProvider)` 放在 `Builder` 裡是為了只有這一塊跟著餘額重建；如果 lint 抱怨在 build 以外 watch，改成在 `build()` 開頭 `final aiCredits = ref.watch(aiCreditsProvider).value;` 再傳進來 —— 照檔案裡「一律取一次，不要包在條件裡」那條註解，後者其實比較好，優先用後者。）

- [ ] **Step 6: 個人頁**

`profile_page.dart`：import `'../domain/ai_receipt.dart'`。「登入方式」那個 `LedgerRow` 後面、`LedgerCard` 的 children 裡加：

```dart
            if (!guest) ...[
              const LedgerDivider(),
              LedgerRow(
                title: 'AI 辨識點數',
                trailing: Text(
                  ref.watch(aiCreditsProvider).when(
                        // null 是還沒用過：第一次辨識時會拿到 3 點。
                        data: (value) => '${value ?? freeCredits}',
                        loading: () => '…',
                        error: (_, __) => '—',
                      ),
                  style: text.bodyMedium,
                ),
              ),
            ],
```

- [ ] **Step 7: 推上去讓 CI 跑 Flutter**

```bash
git add flutter_app/lib/data/ai_repository.dart flutter_app/lib/state/providers.dart flutter_app/lib/ui/expense_form_page.dart flutter_app/lib/ui/profile_page.dart
git commit -F <msg>   # "Add the AI receipt button to the app expense form and profile"
git push
```

Expected: GitHub Actions 的「iOS Build Check」（`flutter_app/**` 有變動時觸發，跑 `flutter analyze`、`flutter test`、不簽章的 iOS build）綠燈，`ai_receipt_test.dart` 的案例全部通過。紅的話照錯誤修，不要跳過；**CI 綠之前不得宣稱 Flutter 測過**。

---

### Task 14: 隱私政策與 todo

**Files:**
- Modify: `public/privacy.html`
- Modify: `todo.md`

- [ ] **Step 1: 隱私政策**

`public/privacy.html`「一、我們收集的資料」的表格，「地點資料」那一列後面加：

```html
            <tr>
              <td>收據照片</td>
              <td>你為某筆支出附上的收據照片</td>
              <td>你自行拍攝或從相簿選取；存放在 Firebase Storage，同一任務的成員看得到</td>
            </tr>
```

「四、我們使用的第三方服務」的清單，Google Maps 那一項後面加：

```html
        <li>
          <strong>OpenAI</strong>：只在你按下「用 AI 讀收據」時，那一張收據照片會傳送給 OpenAI
          辨識金額、幣別、日期與店名；我們不會送出其他任何資料，辨識結果只填進你的表單。
          參見 <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noopener">OpenAI 隱私政策</a>。
        </li>
```

頁面上如果有「最後更新」日期，改成部署當天。其他過時的地方（Facebook、Apple 登入、Open-Meteo、免登入試用）**這次不動**，記進 todo。

- [ ] **Step 2: todo**

`todo.md` 最後加：

```markdown
## 已完成：AI 辨識收據（第一階段）

規格與計畫在 `docs/superpowers/`（2026-09-11、2026-09-12）。支出表單拍了收據之後，
按一下由 OpenAI 讀出金額、幣別、日期、時間、店名、分類並填進表單。

- **呼叫 AI 就扣 1 點**，讀不出來也扣。每個正式帳號第一次用時送 3 點，用完就沒了。
  每一次的結果記在 `aiCredits/{uid}/aiLedger`，申訴時管理者照紀錄在後台手動補點。
- 點數不放在 `users/{uid}`（那份的 create 沒限制欄位），放在獨立集合、rules 全擋寫入。
- 金鑰與模型在後台維護（`config/ai`，只有函式讀得到）。模型只能從程式裡的白名單挑，
  存之前先向 OpenAI 驗一次。
- 已知取捨：扣點之後函式當掉的話，那一筆會停在 pending、點數不會自動退 ——
  後台會顯示「沒有回來」，靠申訴補。刪帳號重新註冊會再拿到 3 點，損失上限是 3 張收據。

## AI 辨識收據：之後

- 第二階段：購買點數，只在 App 內購買（Apple／Google），網頁版不賣。
- `adminReports` 的翻頁游標可能跟 AI 使用報告踩到同一個坑：collection group 查詢
  用文件 ID 排序時，`startAfter` 要完整路徑，它只給了 ID。還沒實際翻到第二頁驗證過。
- 隱私政策還有幾處過時：Facebook 登入早就關了、沒寫 Apple 登入、沒寫 Open-Meteo 天氣、
  沒寫免登入試用。
```

- [ ] **Step 3: Commit**

```bash
git add public/privacy.html todo.md
git commit -F <msg>   # "Mention receipt photos and OpenAI in the privacy policy; update todo"
```

---

### Task 15: 部署與手動驗證

這一段要使用者本人在場（OpenAI 帳號、正式專案的部署權限、兩台裝置）。

- [ ] **Step 1: 使用者準備 OpenAI**

- 申請 OpenAI 帳號、在 platform.openai.com 儲值（這跟 ChatGPT 訂閱是兩套，訂閱的額度用不到）。
- 產生一把 API 金鑰。
- 在 OpenAI 那邊設**用量上限**（每月金額上限）—— 這是最後一道防線。

- [ ] **Step 2: 部署**

順序：索引先（要時間建）、再規則與函式、最後網頁。

```bash
npm run deploy:rules        # firestore rules + indexes
npm run deploy:functions
npm run deploy              # 網頁（含 build、rules、storage）
```

Expected: 都成功。Firebase Console 的索引頁上，兩個 `aiLedger` 的索引狀態從「建立中」變成「已啟用」之後，才去開後台的使用報告。

- [ ] **Step 3: 後台設定**

- 到 `/admin/ai`：狀態顯示「尚未設定」。
- 模型選 Luna，貼上金鑰，填理由，按「驗證並儲存」。故意貼錯一個字先試一次 → 應該顯示「金鑰無效或已被撤銷，設定沒有存。」，狀態仍是尚未設定。
- 貼對的金鑰 → 已儲存，顯示末四碼。
- 按「測試」→ 成功，讀出 `JPY`、`324`、`2026-09-10`、`19:05`、店名 `セブン-イレブン 新宿西口店`。
- 稽核日誌裡看得到「檢視 AI 設定」「更換 AI 設定」各一筆，後者有理由。

- [ ] **Step 4: 網頁實測**

用一個正式帳號（不是訪客）：

1. 新增支出 → 拍一張**日文**收據 → 按鈕顯示「用 AI 讀收據（剩 3 點）」→ 按下 → 金額、幣別 JPY、日期、時間、店名、分類都填上，匯率自動查了，那一行寫「AI 已填入：…（剩 2 點）」。
2. 一張**泰文**收據 → 幣別 THB。
3. 一張**拍糊的** → 「沒有讀出金額（已扣 1 點）」，餘額變 0，按鈕變「AI 點數用完了」。
4. 編輯一筆**自訂分帳**的舊支出，換一張收據、按 AI（先在後台補點數）→ 分帳變回平分，那一行有「分帳已改回平分」，儲存按得下去。
5. 用一張不支援幣別的收據（例如柬埔寨瑞爾）→ 幣別變主要幣別，出現紅字警告，不會自己消失。
6. 開 DevTools 切成離線 → 按鈕變「需要網路」、停用。
7. 用訪客帳號 → 按鈕按得下去，按下去顯示「綁定帳號就能用 AI 辨識，到個人設定綁定。」，不扣點（後台查不到這個人的點數紀錄）。
8. 個人頁顯示「AI 辨識點數」。

- [ ] **Step 5: 後台核對**

- 使用者詳情：那個帳號「辨識 N 次，失敗 M 次」跟實測一致；紀錄裡有 free（+3）、每次 use（−1）與結果。
- 調整點數 +2（填理由）→ 餘額加 2，紀錄多一筆調整；調整 −10 → 只扣到 0，紀錄寫實際扣掉的量。
- 找一個訪客帳號 → 沒有調整點數的輸入框。
- AI 設定頁的用量與使用報告跟上面對得起來；篩「調整」只剩調整；翻到第二頁（紀錄超過 25 筆時）不出錯。

- [ ] **Step 6: App 實測**

重新 build App（`--dart-define` 照舊），重複 Step 4 的 1、3、4、7、8（App 沒有離線狀態，改成：開飛航模式按下去 → 顯示連不上伺服器的訊息，**後台查不到這一次的扣點**）。

- [ ] **Step 7: 模型比較**

同一批收據（至少日文、泰文各兩三張，含一張皺掉的熱感應紙）先用 Luna 跑、在後台切到 Terra 再跑一次，記在下面：

| 收據 | Luna：金額／幣別／日期 | Terra：金額／幣別／日期 |
|---|---|---|
| | | |

Luna 明顯較差才把預設換成 Terra（後台切換就好，不用改程式）。結果寫回這一節，然後 commit 這份計畫。

- [ ] **Step 8: 告訴使用者結果**

照實講：哪些驗過、哪些沒驗到（例如沒有第二台裝置、沒有不支援幣別的收據），CI 的 Flutter 結果。

---

## Spec 對照

| Spec 的段落 | Task |
|---|---|
| 1. 點數的資料與規則（存放位置、紀錄欄位、免費 3 點、扣點、刪帳號） | 2、6、7 |
| 2. `readReceipt`（設定、白名單、快取、輸入檢查、呼叫 OpenAI、回傳檢查、失敗、統計） | 1、3、4、5、6 |
| 3. 兩個平台的畫面（按鈕位置與狀態、套用、匯率、切回平分、不支援的幣別、個人頁） | 9、10、12、13 |
| 4. 後台（AI 設定頁、使用者詳情、稽核日誌、索引） | 7、8、11 |
| 5. 隱私政策、測試、上線前 | 14、15（測試分散在各 Task） |
