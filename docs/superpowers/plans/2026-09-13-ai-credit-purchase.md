# AI 點數儲值（第二階段）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手機 App 用 Apple／Google 的應用程式內購買儲值 AI 辨識點數（NT$30＝30 點、NT$60＝66 點、NT$100＝120 點），伺服器驗證過才加點，商店退款時扣回；網頁不賣，點數用完只顯示提示。

**Architecture:** App 用 `in_app_purchase` 付款，把交易識別送進 callable `purchaseCredits`；函式向 App Store Server API／Google Play Developer API 查這筆交易，確認之後在 transaction 裡建立 `aiPurchases/{id}`、加點、寫一筆 `purchase` 到 `aiLedger`，回覆之後 App 才結束交易。退款走蘋果的 App Store Server Notifications V2（HTTPS 函式）與 Google 的即時開發者通知（Pub/Sub 函式），扣到 0 為止。購買監聽在 App 一啟動就開始，接得住上次沒完成、商店重送的交易。

**Tech Stack:** Cloud Functions v2 + firebase-admin + `@apple/app-store-server-library` 3.x + `@googleapis/androidpublisher` 41.x（TypeScript, vitest）、Flutter + Riverpod 2 + `in_app_purchase` 3.3、Vue 3（後台與提示）、`@firebase/rules-unit-testing`。

**Spec:** `docs/superpowers/specs/2026-09-13-ai-credit-purchase-design.md`

## Global Constraints

- callable／函式 region 一律 `asia-east1`。
- bundle ID 與 Android 套件名稱都是 `com.dyco.splitflow`。
- 商品 ID：`ai_credits_30`（30 點）、`ai_credits_60`（66 點）、`ai_credits_100`（120 點）。**點數對照只存在 `functions/src/purchase/products.ts`**；Flutter 那份只拿來顯示，伺服器不看它。
- 購買紀錄文件 ID：iOS `ios_{transactionId}`、Android `android_{orderId}`。
- `aiLedger` 新類型：`purchase`（加點）、`revoke`（商店退款扣回）。
- `purchaseCredits` 回傳 `{ status: "credited" | "already" | "pending" | "other-account", credits: number, creditsLeft: number | null }`。**`other-account` 不是錯誤**：App 收到它也要結束交易，否則那筆交易會永遠重送、iOS 上同一個商品再也買不了。
- 秘密值用 Firebase functions secrets：`APPSTORE_ISSUER_ID`、`APPSTORE_KEY_ID`、`APPSTORE_PRIVATE_KEY`（`.p8` 全文）、`APPSTORE_APP_APPLE_ID`。Google 不用金鑰，授權 Cloud Functions 的執行服務帳戶。
- Google 即時開發者通知的 Pub/Sub 主題名稱：`play-billing`。
- 敘述、註解、UI 文字用中文；commit message 用英文，結尾加 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。多行訊息用多個 `-m`。
- **`functions/` 的測試不在 CI 裡**，一律本機 `cd functions && npm test`。
- 這台沒有 Dart。Flutter 只能靠 CI（推 main 觸發 iOS Build Check：analyze、test、不簽章 build），CI 綠之前不得宣稱 Flutter 測過。
- **真的買一次**要等使用者辦好 Apple Developer Program 與 Play Console（spec 第 10 節）。在那之前，這份計畫能驗證到的是：純函式測試、rules 測試、型別檢查、建置、CI。

## 與 spec 的差異

1. **iOS 的 `autoConsume` 必須是 true。** `in_app_purchase_storekit` 的 `buyConsumable` 裡寫著 `assert(autoConsume, 'On iOS, we should always auto consume')`。iOS 的「消耗」其實就是 `completePurchase` 結束交易，所以 spec 要的「伺服器加完點才結束」照樣成立 —— 只是參數要依平台傳：`autoConsume: Platform.isIOS`。Android 維持 false，由伺服器消耗。
2. **Android 的營收只能用標價近似。** Google 的 `purchases.products.get` 不回價格與幣別。Android 的購買紀錄寫商品表的台幣標價，`priceSource: "list"`；iOS 用交易上的實際價格與幣別，`priceSource: "store"`。後台營收照幣別分開加總，不做換算。
3. **蘋果的驗證器在正式環境要 App 的數字 ID。** `SignedDataVerifier` 的 `appAppleId` 在 production 必填，所以多一個 secret `APPSTORE_APP_APPLE_ID`（App Store Connect 上 App 資訊裡的 Apple ID）。
4. **Android 的測試購買用 `purchaseType === 0` 判斷。** Google 沒有 environment 欄位；`purchaseType` 0 是授權測試帳號的購買，記成 `sandbox`，不算營收。
5. **購買監聽放在 `main.dart`，不是只在儲值頁。** 商店會在 App 下次啟動時重送沒結束的交易；只在儲值頁聽的話，使用者不打開那一頁就永遠補不到點。
6. **Android 在伺服器消耗之後，App 的 `completePurchase` 失敗就忽略。** 伺服器的 `consume` 已經包含確認；App 再確認一次可能被 Google 回「商品不存在」。iOS 的 `completePurchase` 失敗則照常往外丟，因為那代表交易沒結束。
7. **刪除帳號不刪 `aiPurchases`。** 那是金流紀錄，而且之後的退款通知要靠它對回來；`aiCredits` 與 `aiLedger` 照第一階段刪掉。帳號刪掉之後才來的退款：購買紀錄改成 `refunded`，沒有點數可扣。

## File Map

| 檔案 | 動作 | 責任 |
|---|---|---|
| `functions/src/purchase/products.ts` | 新增 | 商品表、bundle ID／套件名稱 |
| `functions/src/purchase/decide.ts` | 新增 | 交易檢查、冪等判斷、退款扣點（純函式） |
| `functions/src/purchase/*.test.ts` | 新增 | 上面兩支的 vitest |
| `functions/src/ai/credits.ts` | 修改 | 匯出 `balanceOf`；`ledgerPurchase`、`ledgerRevoke` |
| `functions/src/ai/credits.test.ts` | 修改 | |
| `functions/src/purchase/stores.ts` | 新增 | secrets、蘋果 API 與驗證器、Google Play API |
| `functions/certs/AppleRootCA-G3.cer` | 新增 | 蘋果根憑證（驗證簽章用） |
| `functions/src/index.ts` | 修改 | `purchaseCredits`、`appStoreNotifications`、`onPlayNotification` |
| `functions/package.json` | 修改 | 兩個商店套件 |
| `firestore.rules`、`tests/firestore.rules.test.mjs` | 修改 | `aiPurchases` 全擋 |
| `firestore.indexes.json` | 修改 | 營收查詢的複合索引 |
| `functions/src/ai/usage.ts`、`usage.test.ts` | 修改 | `sumPurchases` |
| `functions/src/admin.ts` | 修改 | 使用報告篩選、用量摘要多營收 |
| `src/utils/aiLedger.ts`、`tests/aiLedger.test.ts` | 修改 | 「儲值」「退款扣回」標籤 |
| `src/services/adminService.ts`、`src/pages/admin/AdminAiPage.vue` | 修改 | 篩選與營收 |
| `src/components/expense/AiReceiptButton.vue` | 修改 | 點數用完的提示（網頁不放連結） |
| `flutter_app/pubspec.yaml` | 修改 | `in_app_purchase` |
| `flutter_app/lib/domain/credit_store.dart`、`test/credit_store_test.dart` | 新增 | 方案顯示、購買結果文案（純 Dart） |
| `flutter_app/lib/data/credit_purchase_repository.dart` | 新增 | 包 `in_app_purchase` 與 `purchaseCredits` |
| `flutter_app/lib/state/purchase_listener.dart` | 新增 | App 層級的購買監聽 |
| `flutter_app/lib/state/providers.dart`、`lib/main.dart` | 修改 | provider、啟動監聽 |
| `flutter_app/lib/ui/credit_store_page.dart` | 新增 | 儲值頁 |
| `flutter_app/lib/ui/profile_page.dart`、`lib/ui/expense_form_page.dart` | 修改 | 入口與「去儲值」 |
| `todo.md` | 修改 | |

---

### Task 1: 商品表 `purchase/products.ts`

**Files:**
- Create: `functions/src/purchase/products.ts`
- Test: `functions/src/purchase/products.test.ts`

**Interfaces:**
- Produces（Task 2、4 使用）:
  - `BUNDLE_ID = "com.dyco.splitflow"`、`PACKAGE_NAME = "com.dyco.splitflow"`
  - `interface CreditPack { productId: string; credits: number; bonus: number; listPriceTwd: number }`
  - `CREDIT_PACKS: readonly CreditPack[]`、`packFor(productId: unknown): CreditPack | null`

- [ ] **Step 1: 寫失敗的測試**

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗** —— `cd functions && npx vitest run src/purchase/products.test.ts`，Expected: FAIL，找不到 `./products.js`。

- [ ] **Step 3: 實作**

```ts
/**
 * 儲值方案。**點數對照只在這裡。**
 *
 * App 送來的只有商品 ID 與交易識別；加幾點由這張表決定。Flutter 那邊有一份
 * 顯示用的副本（`lib/domain/credit_store.dart`），伺服器不看它 —— App 說買了
 * 幾點都不算數。
 *
 * 加送的點數不寫進商店的商品名稱：之後要改加送數量，改這裡就好，不必重送審核。
 */
export const BUNDLE_ID = "com.dyco.splitflow";
export const PACKAGE_NAME = "com.dyco.splitflow";

export interface CreditPack {
  productId: string;
  credits: number;
  bonus: number;
  /** 台灣的標價。Android 的營收只能用它近似（Google 不回價格）。 */
  listPriceTwd: number;
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  { productId: "ai_credits_30", credits: 30, bonus: 0, listPriceTwd: 30 },
  { productId: "ai_credits_60", credits: 66, bonus: 6, listPriceTwd: 60 },
  { productId: "ai_credits_100", credits: 120, bonus: 20, listPriceTwd: 100 }
];

export function packFor(productId: unknown): CreditPack | null {
  if (typeof productId !== "string") return null;
  return CREDIT_PACKS.find(pack => pack.productId === productId) ?? null;
}
```

- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit** —— `git add functions/src/purchase/products.ts functions/src/purchase/products.test.ts`，訊息 "Add the AI credit packs"。

---

### Task 2: 購買判斷的純函式 `purchase/decide.ts`

**Files:**
- Modify: `functions/src/ai/credits.ts`、`functions/src/ai/credits.test.ts`
- Create: `functions/src/purchase/decide.ts`
- Test: `functions/src/purchase/decide.test.ts`

**Interfaces:**
- Produces（Task 4 使用）:
  - credits.ts：`export function balanceOf(doc: CreditsDoc | null): number`（原本的私有函式改成匯出）、`ledgerPurchase({ uid, at, delta, balanceAfter, purchaseId, productId })`、`ledgerRevoke({ uid, at, delta, balanceAfter, purchaseId })`
  - decide.ts：
    - `type Platform = "ios" | "android"`、`parsePlatform(value: unknown): Platform | null`
    - `purchaseDocId(platform: Platform, storeId: string): string`
    - `interface VerifiedPurchase { storeId: string; environment: "production" | "sandbox"; price: number | null; currency: string | null; priceSource: "store" | "list" }`
    - `checkAppleTransaction(tx: AppleTransaction | null, expect: { bundleId: string; productId: string }): { ok: true; purchase: VerifiedPurchase } | { ok: false; problem: "missing" | "bundle" | "product" | "revoked" }`
    - `checkPlayPurchase(p: PlayPurchase | null, expect: { productId: string; listPriceTwd: number }): { ok: true; purchase: VerifiedPurchase; consumed: boolean } | { ok: false; problem: "missing" | "product" | "pending" | "canceled" }`
    - `planCredit(existing: { uid?: unknown } | null, uid: string): { kind: "credit" } | { kind: "already" } | { kind: "other-account" }`
    - `planRevoke(purchase: { status?: unknown; credits?: unknown } | null, credits: CreditsDoc | null): { kind: "skip" } | { kind: "revoke"; delta: number; balanceAfter: number }`

- [ ] **Step 1: credits.ts 的測試（加在最後）**

```ts
describe("儲值與退款的紀錄", () => {
  it("purchase 帶著購買紀錄與商品", () => {
    expect(
      ledgerPurchase({ uid: "u1", at: AT, delta: 66, balanceAfter: 68, purchaseId: "ios_1", productId: "ai_credits_60" })
    ).toEqual({
      type: "purchase", uid: "u1", delta: 66, balanceAfter: 68, at: AT, purchaseId: "ios_1", productId: "ai_credits_60"
    });
  });

  it("revoke 的變動是負的", () => {
    expect(ledgerRevoke({ uid: "u1", at: AT, delta: -20, balanceAfter: 0, purchaseId: "android_GPA.1" })).toEqual({
      type: "revoke", uid: "u1", delta: -20, balanceAfter: 0, at: AT, purchaseId: "android_GPA.1"
    });
  });
});
```

import 加上 `ledgerPurchase, ledgerRevoke`。

- [ ] **Step 2: decide.ts 的測試**

```ts
import { describe, expect, it } from "vitest";
import { checkAppleTransaction, checkPlayPurchase, parsePlatform, planCredit, planRevoke, purchaseDocId } from "./decide.js";

const APPLE_OK = {
  transactionId: "2000000123",
  bundleId: "com.dyco.splitflow",
  productId: "ai_credits_60",
  environment: "Production",
  price: 60000,
  currency: "TWD"
};

const PLAY_OK = { orderId: "GPA.1234-5678", productId: "ai_credits_60", purchaseState: 0, consumptionState: 0, purchaseType: undefined };

describe("parsePlatform / purchaseDocId", () => {
  it("只認 ios 與 android", () => {
    expect(parsePlatform("ios")).toBe("ios");
    expect(parsePlatform("web")).toBeNull();
  });

  it("文件 ID 帶平台前綴；斜線換掉，免得被當成路徑", () => {
    expect(purchaseDocId("ios", "2000000123")).toBe("ios_2000000123");
    expect(purchaseDocId("android", "a/b")).toBe("android_a_b");
  });
});

describe("checkAppleTransaction", () => {
  const expect_ = { bundleId: "com.dyco.splitflow", productId: "ai_credits_60" };

  it("合格：價格從千分之一單位換回來", () => {
    expect(checkAppleTransaction(APPLE_OK, expect_)).toEqual({
      ok: true,
      purchase: { storeId: "2000000123", environment: "production", price: 60, currency: "TWD", priceSource: "store" }
    });
  });

  it("sandbox 記成 sandbox", () => {
    const result = checkAppleTransaction({ ...APPLE_OK, environment: "Sandbox" }, expect_);
    expect(result.ok && result.purchase.environment).toBe("sandbox");
  });

  it("別的 App 的交易、商品對不上、已被撤銷、查不到都擋", () => {
    expect(checkAppleTransaction({ ...APPLE_OK, bundleId: "com.other" }, expect_)).toEqual({ ok: false, problem: "bundle" });
    expect(checkAppleTransaction({ ...APPLE_OK, productId: "ai_credits_100" }, expect_)).toEqual({ ok: false, problem: "product" });
    expect(checkAppleTransaction({ ...APPLE_OK, revocationDate: 1 }, expect_)).toEqual({ ok: false, problem: "revoked" });
    expect(checkAppleTransaction(null, expect_)).toEqual({ ok: false, problem: "missing" });
  });
});

describe("checkPlayPurchase", () => {
  const expect_ = { productId: "ai_credits_60", listPriceTwd: 60 };

  it("合格：價格用台幣標價，來源寫 list", () => {
    expect(checkPlayPurchase(PLAY_OK, expect_)).toEqual({
      ok: true,
      consumed: false,
      purchase: { storeId: "GPA.1234-5678", environment: "production", price: 60, currency: "TWD", priceSource: "list" }
    });
  });

  it("授權測試帳號的購買（purchaseType 0）記成 sandbox", () => {
    const result = checkPlayPurchase({ ...PLAY_OK, purchaseType: 0 }, expect_);
    expect(result.ok && result.purchase.environment).toBe("sandbox");
  });

  it("已經消耗過的照樣合格，只是標出來（重送時不必再消耗）", () => {
    const result = checkPlayPurchase({ ...PLAY_OK, consumptionState: 1 }, expect_);
    expect(result.ok && result.consumed).toBe(true);
  });

  it("待處理、已取消、商品對不上、查不到", () => {
    expect(checkPlayPurchase({ ...PLAY_OK, purchaseState: 2 }, expect_)).toEqual({ ok: false, problem: "pending" });
    expect(checkPlayPurchase({ ...PLAY_OK, purchaseState: 1 }, expect_)).toEqual({ ok: false, problem: "canceled" });
    expect(checkPlayPurchase({ ...PLAY_OK, productId: "ai_credits_30" }, expect_)).toEqual({ ok: false, problem: "product" });
    expect(checkPlayPurchase(null, expect_)).toEqual({ ok: false, problem: "missing" });
  });
});

describe("planCredit", () => {
  it("沒有紀錄：加點", () => {
    expect(planCredit(null, "u1")).toEqual({ kind: "credit" });
  });

  it("同一個帳號重送：之前加過了，不重加", () => {
    expect(planCredit({ uid: "u1" }, "u1")).toEqual({ kind: "already" });
  });

  it("另一個帳號送來：點數跟著第一次送來的帳號", () => {
    expect(planCredit({ uid: "u1" }, "u2")).toEqual({ kind: "other-account" });
  });
});

describe("planRevoke", () => {
  it("扣回買的點數", () => {
    expect(planRevoke({ status: "credited", credits: 66 }, { balance: 100 })).toEqual({
      kind: "revoke", delta: -66, balanceAfter: 34
    });
  });

  it("扣到 0 為止：用掉的扣不回來", () => {
    expect(planRevoke({ status: "credited", credits: 120 }, { balance: 20 })).toEqual({
      kind: "revoke", delta: -20, balanceAfter: 0
    });
  });

  it("帳號已經刪了（沒有點數文件）：照樣標成退款，變動 0", () => {
    expect(planRevoke({ status: "credited", credits: 30 }, null)).toEqual({ kind: "revoke", delta: 0, balanceAfter: 0 });
  });

  it("已經退過、或找不到購買紀錄：跳過 —— 通知可能重送", () => {
    expect(planRevoke({ status: "refunded", credits: 30 }, { balance: 30 })).toEqual({ kind: "skip" });
    expect(planRevoke(null, { balance: 30 })).toEqual({ kind: "skip" });
  });
});
```

- [ ] **Step 3: 跑測試確認失敗** —— `cd functions && npx vitest run src/purchase/decide.test.ts src/ai/credits.test.ts`

- [ ] **Step 4: credits.ts**

把 `function balanceOf` 改成 `export function balanceOf`，檔案最後加：

```ts
/** 儲值加點。帶著購買紀錄的 ID，退款時對得回來。 */
export function ledgerPurchase(input: {
  uid: string;
  at: Date;
  delta: number;
  balanceAfter: number;
  purchaseId: string;
  productId: string;
}) {
  return {
    type: "purchase",
    uid: input.uid,
    delta: input.delta,
    balanceAfter: input.balanceAfter,
    at: input.at,
    purchaseId: input.purchaseId,
    productId: input.productId
  };
}

/** 商店退款扣回。變動是實際扣掉的量（扣到 0 為止）。 */
export function ledgerRevoke(input: { uid: string; at: Date; delta: number; balanceAfter: number; purchaseId: string }) {
  return {
    type: "revoke",
    uid: input.uid,
    delta: input.delta,
    balanceAfter: input.balanceAfter,
    at: input.at,
    purchaseId: input.purchaseId
  };
}
```

- [ ] **Step 5: decide.ts**

```ts
/**
 * 儲值的判斷：商店回來的交易合不合格、要不要加點、退款要扣多少。
 *
 * 抽成純函式的理由跟 `canLeaveTask` 一樣：這是錢，每一條都值得被單獨測到。
 * 呼叫商店與寫 Firestore 在 `index.ts`，這裡只回答問題。
 */
import { balanceOf, type CreditsDoc } from "../ai/credits.js";

export type Platform = "ios" | "android";

export function parsePlatform(value: unknown): Platform | null {
  return value === "ios" || value === "android" ? value : null;
}

/** 文件 ID 用商店的識別，天生冪等：同一筆交易只會有一份紀錄。 */
export function purchaseDocId(platform: Platform, storeId: string): string {
  return `${platform}_${storeId.replace(/\//g, "_")}`;
}

export interface VerifiedPurchase {
  storeId: string;
  environment: "production" | "sandbox";
  price: number | null;
  currency: string | null;
  /** store：商店回報的實際價格；list：商品表的標價（Google 不回價格）。 */
  priceSource: "store" | "list";
}

/** App Store Server API 解出來的交易裡，這裡用得到的欄位。 */
export interface AppleTransaction {
  transactionId?: string;
  bundleId?: string;
  productId?: string;
  revocationDate?: number;
  environment?: string;
  /** 千分之一單位。 */
  price?: number;
  currency?: string;
}

export function checkAppleTransaction(
  tx: AppleTransaction | null,
  expect: { bundleId: string; productId: string }
): { ok: true; purchase: VerifiedPurchase } | { ok: false; problem: "missing" | "bundle" | "product" | "revoked" } {
  if (!tx || !tx.transactionId) return { ok: false, problem: "missing" };
  if (tx.bundleId !== expect.bundleId) return { ok: false, problem: "bundle" };
  if (tx.productId !== expect.productId) return { ok: false, problem: "product" };
  // 已經退款或被撤銷的交易不加點 —— 不然退了款再送一次就能拿回點數。
  if (tx.revocationDate) return { ok: false, problem: "revoked" };

  return {
    ok: true,
    purchase: {
      storeId: tx.transactionId,
      environment: tx.environment === "Sandbox" ? "sandbox" : "production",
      price: typeof tx.price === "number" ? tx.price / 1000 : null,
      currency: typeof tx.currency === "string" ? tx.currency : null,
      priceSource: "store"
    }
  };
}

/** Google Play `purchases.products.get` 回來的欄位。 */
export interface PlayPurchase {
  orderId?: string | null;
  productId?: string | null;
  /** 0 已購買、1 已取消、2 待處理。 */
  purchaseState?: number | null;
  /** 0 未消耗、1 已消耗。 */
  consumptionState?: number | null;
  /** 0 是授權測試帳號的購買；正式購買沒有這個欄位。 */
  purchaseType?: number | null;
}

export function checkPlayPurchase(
  p: PlayPurchase | null,
  expect: { productId: string; listPriceTwd: number }
):
  | { ok: true; purchase: VerifiedPurchase; consumed: boolean }
  | { ok: false; problem: "missing" | "product" | "pending" | "canceled" } {
  if (!p || !p.orderId) return { ok: false, problem: "missing" };
  if (p.productId && p.productId !== expect.productId) return { ok: false, problem: "product" };
  if (p.purchaseState === 2) return { ok: false, problem: "pending" };
  if (p.purchaseState !== 0) return { ok: false, problem: "canceled" };

  return {
    ok: true,
    consumed: p.consumptionState === 1,
    purchase: {
      storeId: p.orderId,
      environment: p.purchaseType === 0 ? "sandbox" : "production",
      price: expect.listPriceTwd,
      currency: "TWD",
      priceSource: "list"
    }
  };
}

export function planCredit(
  existing: { uid?: unknown } | null,
  uid: string
): { kind: "credit" } | { kind: "already" } | { kind: "other-account" } {
  if (!existing) return { kind: "credit" };
  return existing.uid === uid ? { kind: "already" } : { kind: "other-account" };
}

/**
 * 商店退款：扣回買的點數，**扣到 0 為止**。
 *
 * 買了 120 點、用掉 100 點再退款，只扣得回 20 點 —— 這是 spec 接受的漏洞：
 * 金額小，後台看得到。沒有點數文件（帳號已刪）時變動是 0，但購買紀錄照樣標成退款。
 */
export function planRevoke(
  purchase: { status?: unknown; credits?: unknown } | null,
  credits: CreditsDoc | null
): { kind: "skip" } | { kind: "revoke"; delta: number; balanceAfter: number } {
  if (!purchase || purchase.status !== "credited") return { kind: "skip" };
  const bought =
    typeof purchase.credits === "number" && Number.isInteger(purchase.credits) && purchase.credits > 0
      ? purchase.credits
      : 0;
  const before = balanceOf(credits);
  const balanceAfter = Math.max(0, before - bought);
  return { kind: "revoke", delta: balanceAfter - before, balanceAfter };
}
```

- [ ] **Step 6: 跑測試確認通過** —— `cd functions && npm test`，全部 PASS。
- [ ] **Step 7: Commit** —— credits.ts、credits.test.ts、decide.ts、decide.test.ts，訊息 "Add pure rules for verifying and refunding credit purchases"。

---

### Task 3: 商店的呼叫 `purchase/stores.ts`

**Files:**
- Modify: `functions/package.json`
- Create: `functions/certs/AppleRootCA-G3.cer`
- Create: `functions/src/purchase/stores.ts`

**Interfaces:**
- Consumes: `BUNDLE_ID`、`PACKAGE_NAME`（Task 1）；`AppleTransaction`、`PlayPurchase`（Task 2）
- Produces（Task 4 使用）:
  - `APPLE_SECRETS`（四個 `defineSecret`，給函式的 `secrets` 選項）
  - `fetchAppleTransaction(transactionId: string): Promise<AppleTransaction | null>` —— 先查 production，404 再查 sandbox
  - `verifyAppleNotification(signedPayload: string): Promise<{ notificationType: string | null; transaction: AppleTransaction | null }>`
  - `fetchPlayPurchase(productId: string, token: string): Promise<PlayPurchase | null>`
  - `consumePlayPurchase(productId: string, token: string): Promise<void>`

這支會打網路，不寫單元測試；判斷都在 Task 2 的純函式裡，這裡只有「呼叫、解開、交出去」。

已從套件的型別定義確認過的名稱（3.1.0／41.0.0）：
- `AppStoreServerAPIClient(encodedKey, keyId, issuerId, bundleId, environment)`、`getTransactionInfo(transactionId)` 回 `{ signedTransactionInfo }`
- `SignedDataVerifier(appleRootCertificates, enableOnlineChecks, environment, bundleId, appAppleId?)` —— `appAppleId` 在 sandbox 省略、production 必填；`verifyAndDecodeTransaction`、`verifyAndDecodeNotification`
- `Environment.PRODUCTION = "Production"`、`Environment.SANDBOX = "Sandbox"`；`APIException` 有 `httpStatusCode`
- 通知解開後 `notificationType` 有 `"REFUND"`，交易在 `data.signedTransactionInfo`
- `@googleapis/androidpublisher` 匯出 `androidpublisher` 與 `auth`；`purchases.products.get／consume` 的參數是 `{ packageName, productId, token }`

- [ ] **Step 1: 裝套件、放根憑證**

```bash
cd functions && npm install @apple/app-store-server-library@^3.1.0 @googleapis/androidpublisher@^41.0.0
mkdir -p certs && curl -fsSL -o certs/AppleRootCA-G3.cer https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
```

Expected: `certs/AppleRootCA-G3.cer` 是幾百 bytes 的 DER 檔（不是 HTML）。有 openssl 的話 `openssl x509 -inform der -in certs/AppleRootCA-G3.cer -noout -subject` 要印出 `Apple Root CA - G3`。`firebase.json` 的 functions 沒有自訂忽略清單，`certs/` 會跟著部署。

- [ ] **Step 2: 寫 `stores.ts`**

```ts
/**
 * 呼叫 App Store 與 Google Play。**只有這支 import 商店的套件。**
 *
 * 判斷一律交給 `decide.ts`：這裡只負責查到、解開簽章、把欄位交出去。
 */
import { readFileSync } from "node:fs";
import { defineSecret } from "firebase-functions/params";
import { APIException, AppStoreServerAPIClient, Environment, SignedDataVerifier } from "@apple/app-store-server-library";
import { androidpublisher, auth } from "@googleapis/androidpublisher";
import { BUNDLE_ID, PACKAGE_NAME } from "./products.js";
import type { AppleTransaction, PlayPurchase } from "./decide.js";

export const APPSTORE_ISSUER_ID = defineSecret("APPSTORE_ISSUER_ID");
export const APPSTORE_KEY_ID = defineSecret("APPSTORE_KEY_ID");
/** App Store Connect 下載的 `.p8` 全文。 */
export const APPSTORE_PRIVATE_KEY = defineSecret("APPSTORE_PRIVATE_KEY");
/** App Store Connect 上 App 資訊裡的 Apple ID（數字）。正式環境驗證簽章時必填。 */
export const APPSTORE_APP_APPLE_ID = defineSecret("APPSTORE_APP_APPLE_ID");

export const APPLE_SECRETS = [APPSTORE_ISSUER_ID, APPSTORE_KEY_ID, APPSTORE_PRIVATE_KEY, APPSTORE_APP_APPLE_ID];

/** 正式環境先查：絕大多數交易在那裡。查不到再查 sandbox（TestFlight、審核人員）。 */
const APPLE_ENVIRONMENTS = [Environment.PRODUCTION, Environment.SANDBOX];

let rootCerts: Buffer[] | null = null;

function appleRootCerts(): Buffer[] {
  // 編譯後這支在 lib/purchase/，憑證在 functions/certs/。
  rootCerts ??= [readFileSync(new URL("../../certs/AppleRootCA-G3.cer", import.meta.url))];
  return rootCerts;
}

function appleClient(environment: Environment): AppStoreServerAPIClient {
  return new AppStoreServerAPIClient(
    APPSTORE_PRIVATE_KEY.value(),
    APPSTORE_KEY_ID.value(),
    APPSTORE_ISSUER_ID.value(),
    BUNDLE_ID,
    environment
  );
}

function appleVerifier(environment: Environment): SignedDataVerifier {
  const appAppleId = environment === Environment.PRODUCTION ? Number(APPSTORE_APP_APPLE_ID.value()) : undefined;
  // enableOnlineChecks：檢查憑證有沒有被撤銷。多一趟網路，但這是錢。
  return new SignedDataVerifier(appleRootCerts(), true, environment, BUNDLE_ID, appAppleId);
}

/**
 * 用交易 ID 向蘋果查這筆交易。**不相信 App 送來的簽章資料** —— 從蘋果那裡重新拿一份。
 *
 * 404 代表這個環境沒有這筆交易，換下一個環境；其他錯誤（金鑰錯、蘋果掛了）照常丟，
 * 讓 App 不結束交易、下次重送。
 */
export async function fetchAppleTransaction(transactionId: string): Promise<AppleTransaction | null> {
  for (const environment of APPLE_ENVIRONMENTS) {
    try {
      const info = await appleClient(environment).getTransactionInfo(transactionId);
      if (!info.signedTransactionInfo) continue;
      const decoded = await appleVerifier(environment).verifyAndDecodeTransaction(info.signedTransactionInfo);
      return decoded as AppleTransaction;
    } catch (err) {
      if (err instanceof APIException && err.httpStatusCode === 404) continue;
      throw err;
    }
  }
  return null;
}

/**
 * 驗證 App Store Server Notifications V2 的簽章，解出通知類型與交易。
 *
 * 通知可能來自正式或沙盒環境，驗證器要指定環境：正式環境驗不過就換沙盒。
 * 兩個都驗不過就丟出最後一個錯誤 —— 那是偽造或損毀的通知。
 */
export async function verifyAppleNotification(
  signedPayload: string
): Promise<{ notificationType: string | null; transaction: AppleTransaction | null }> {
  let lastError: unknown = null;
  for (const environment of APPLE_ENVIRONMENTS) {
    try {
      const verifier = appleVerifier(environment);
      const decoded = await verifier.verifyAndDecodeNotification(signedPayload);
      const signed = decoded.data?.signedTransactionInfo;
      const transaction = signed ? ((await verifier.verifyAndDecodeTransaction(signed)) as AppleTransaction) : null;
      return {
        notificationType: typeof decoded.notificationType === "string" ? decoded.notificationType : null,
        transaction
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** Google 用 Cloud Functions 的執行服務帳戶授權（Play Console 裡邀請它），不需要金鑰檔。 */
function makePlayClient() {
  return androidpublisher({
    version: "v3",
    auth: new auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/androidpublisher"] })
  });
}

let playClient: ReturnType<typeof makePlayClient> | null = null;

function play() {
  playClient ??= makePlayClient();
  return playClient;
}

/**
 * 查這筆 Android 購買。token 不存在、或不屬於這個 App（400／404／410）當作查不到；
 * 其他錯誤照常丟，讓 App 不結束交易、下次重送。
 */
export async function fetchPlayPurchase(productId: string, token: string): Promise<PlayPurchase | null> {
  try {
    const response = await play().purchases.products.get({ packageName: PACKAGE_NAME, productId, token });
    return response.data as PlayPurchase;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 400 || code === 404 || code === 410) return null;
    throw err;
  }
}

/** 消耗。同時也確認了這筆購買 —— 三天內沒確認，Google 會自動退款。 */
export async function consumePlayPurchase(productId: string, token: string): Promise<void> {
  await play().purchases.products.consume({ packageName: PACKAGE_NAME, productId, token });
}
```

- [ ] **Step 3: 型別檢查** —— `cd functions && npm run build`。`as AppleTransaction`、`as PlayPurchase` 若被 TypeScript 判定不相容，改成先 `as unknown as …`；**不要**為了過型別改 `decide.ts` 的欄位名稱，那些名稱照商店的文件。
- [ ] **Step 4: Commit** —— package.json、package-lock.json、certs/AppleRootCA-G3.cer、src/purchase/stores.ts，訊息 "Add App Store and Google Play clients for credit purchases"。

---

### Task 4: `purchaseCredits` 與兩個退款通知

**Files:**
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: Task 1–3
- Produces（Task 9 呼叫）:
  - callable `purchaseCredits`：請求 `{ platform: "ios" | "android", productId, purchaseId, verificationData }`，回傳見 Global Constraints
  - HTTPS `appStoreNotifications`（填到 App Store Connect）
  - Pub/Sub `onPlayNotification`（主題 `play-billing`）

- [ ] **Step 1: import**

```ts
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
```

（第一行取代原本的 `import { HttpsError, onCall } …`。）credits 那一行加上 `balanceOf, ledgerPurchase, ledgerRevoke`。另外加：

```ts
import { BUNDLE_ID, PACKAGE_NAME, packFor } from "./purchase/products.js";
import {
  checkAppleTransaction,
  checkPlayPurchase,
  parsePlatform,
  planCredit,
  planRevoke,
  purchaseDocId,
  type VerifiedPurchase
} from "./purchase/decide.js";
import {
  APPLE_SECRETS,
  consumePlayPurchase,
  fetchAppleTransaction,
  fetchPlayPurchase,
  verifyAppleNotification
} from "./purchase/stores.js";
```

- [ ] **Step 2: `purchaseCredits`（放在 `readReceipt` 後面）**

```ts
/**
 * 儲值。App 付款完成之後把交易識別送來，**這裡向商店查過才加點**。
 *
 * 冪等：購買紀錄的文件 ID 就是商店的交易識別，同一筆重送不會重複加點。App 在
 * 收到回覆之前不結束交易，斷線的話商店下次會重送 —— 所以重送是常態，不是例外。
 *
 * 判斷都在 `purchase/decide.ts`，這裡只負責查商店、照答案寫回去。
 */
export const purchaseCredits = onCall(
  { region: REGION, secrets: APPLE_SECRETS, timeoutSeconds: 60 },
  async request => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "請先登入");
    // 訪客帳號登出就刪除，買的點數會跟著消失。
    if (request.auth?.token.firebase?.sign_in_provider === "anonymous") {
      throw new HttpsError("failed-precondition", "綁定帳號才能儲值");
    }

    const data = (request.data ?? {}) as {
      platform?: unknown;
      productId?: unknown;
      purchaseId?: unknown;
      verificationData?: unknown;
    };
    const platform = parsePlatform(data.platform);
    const pack = packFor(data.productId);
    if (!platform || !pack) throw new HttpsError("invalid-argument", "不認得的儲值方案");

    const rejected = () =>
      new HttpsError("failed-precondition", "這筆購買驗證不過，沒有加點。如果已經付款，請跟我們聯絡。");

    let verified: VerifiedPurchase;
    let token = "";
    let consumed = false;

    if (platform === "ios") {
      if (typeof data.purchaseId !== "string" || !data.purchaseId) {
        throw new HttpsError("invalid-argument", "缺少交易資料");
      }
      const check = checkAppleTransaction(await fetchAppleTransaction(data.purchaseId), {
        bundleId: BUNDLE_ID,
        productId: pack.productId
      });
      if (!check.ok) {
        logger.warn("App Store 交易驗證不過", { uid, purchaseId: data.purchaseId, problem: check.problem });
        throw rejected();
      }
      verified = check.purchase;
    } else {
      token = typeof data.verificationData === "string" ? data.verificationData : "";
      if (!token) throw new HttpsError("invalid-argument", "缺少交易資料");
      const check = checkPlayPurchase(await fetchPlayPurchase(pack.productId, token), {
        productId: pack.productId,
        listPriceTwd: pack.listPriceTwd
      });
      if (!check.ok) {
        // 待處理（例如超商繳費）不是錯誤：不加點，App 也不結束交易，付完商店會再通知。
        if (check.problem === "pending") return { status: "pending", credits: 0, creditsLeft: null };
        logger.warn("Google Play 購買驗證不過", { uid, problem: check.problem });
        throw rejected();
      }
      verified = check.purchase;
      consumed = check.consumed;
    }

    const purchaseId = purchaseDocId(platform, verified.storeId);
    const purchaseRef = db.collection("aiPurchases").doc(purchaseId);
    const creditsRef = db.collection("aiCredits").doc(uid);

    const outcome = await db.runTransaction(async tx => {
      const [purchaseSnap, creditsSnap] = await Promise.all([tx.get(purchaseRef), tx.get(creditsRef)]);
      const plan = planCredit(purchaseSnap.exists ? (purchaseSnap.data() ?? {}) : null, uid);
      const before = balanceOf(creditsSnap.exists ? (creditsSnap.data() ?? {}) : null);

      if (plan.kind === "already") return { status: "already" as const, creditsLeft: before };
      // 不是錯誤：App 要結束這筆交易，不然它會永遠重送、iOS 上同一個商品再也買不了。
      if (plan.kind === "other-account") return { status: "other-account" as const, creditsLeft: null };

      const now = new Date();
      const balanceAfter = before + pack.credits;
      tx.set(purchaseRef, {
        uid,
        platform,
        productId: pack.productId,
        credits: pack.credits,
        storeId: verified.storeId,
        purchaseToken: token || null,
        price: verified.price,
        currency: verified.currency,
        priceSource: verified.priceSource,
        environment: verified.environment,
        status: "credited",
        creditedAt: now,
        refundedAt: null
      });
      // freeGranted：第一次就用買的，之後第一次辨識不會再多送 3 點。
      tx.set(
        creditsRef,
        { balance: balanceAfter, freeGranted: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.set(
        creditsRef.collection("aiLedger").doc(),
        ledgerPurchase({ uid, at: now, delta: pack.credits, balanceAfter, purchaseId, productId: pack.productId })
      );
      return { status: "credited" as const, creditsLeft: balanceAfter };
    });

    /*
      Android：加完點才消耗。重送（already）時也補一次 —— 上次可能加了點卻沒消耗成功，
      而三天內沒消耗 Google 會自動退款。消耗失敗不影響已經加的點數，記一筆等下次重送。
    */
    if (platform === "android" && outcome.status !== "other-account" && !consumed) {
      try {
        await consumePlayPurchase(pack.productId, token);
      } catch (err) {
        logger.error("Google Play 消耗失敗，下次重送會再試", { uid, purchaseId, err: String(err) });
      }
    }

    logger.info("儲值", { uid, purchaseId, status: outcome.status });
    return { status: outcome.status, credits: pack.credits, creditsLeft: outcome.creditsLeft };
  }
);

/**
 * 商店退款：扣回買的點數（扣到 0 為止），購買紀錄改成 refunded。
 *
 * 通知可能重送，`planRevoke` 對已退款的紀錄會跳過。帳號刪掉之後才來的退款：
 * 沒有點數可扣，但購買紀錄照樣標成退款（`aiPurchases` 不隨刪帳號刪除）。
 */
async function revokePurchase(purchaseId: string, source: string): Promise<void> {
  const purchaseRef = db.collection("aiPurchases").doc(purchaseId);

  const plan = await db.runTransaction(async tx => {
    const purchaseSnap = await tx.get(purchaseRef);
    const purchase = purchaseSnap.exists ? (purchaseSnap.data() ?? null) : null;
    const uid = typeof purchase?.uid === "string" ? purchase.uid : null;
    const creditsRef = uid ? db.collection("aiCredits").doc(uid) : null;
    // transaction 要先讀完再寫，所以點數文件也在這裡讀。
    const creditsSnap = creditsRef ? await tx.get(creditsRef) : null;

    const decision = planRevoke(purchase, creditsSnap?.exists ? (creditsSnap.data() ?? {}) : null);
    if (decision.kind === "skip") return decision;

    const now = new Date();
    tx.update(purchaseRef, { status: "refunded", refundedAt: now });
    if (uid && creditsRef && creditsSnap?.exists) {
      tx.set(
        creditsRef,
        { balance: decision.balanceAfter, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.set(
        creditsRef.collection("aiLedger").doc(),
        ledgerRevoke({ uid, at: now, delta: decision.delta, balanceAfter: decision.balanceAfter, purchaseId })
      );
    }
    return decision;
  });

  logger.info("商店退款", { purchaseId, source, plan });
}

/**
 * App Store Server Notifications V2。網址填在 App Store Connect（正式與沙盒兩個欄位都填這支）。
 *
 * 簽章驗不過回 400。其他類型一律 200 —— 回非 200 蘋果會一直重送，而消耗型商品
 * 本來就只會收到退款相關的通知。
 */
export const appStoreNotifications = onRequest({ region: REGION, secrets: APPLE_SECRETS }, async (req, res) => {
  const signedPayload = (req.body as { signedPayload?: unknown } | undefined)?.signedPayload;
  if (req.method !== "POST" || typeof signedPayload !== "string") {
    res.status(400).send("bad request");
    return;
  }

  let decoded: Awaited<ReturnType<typeof verifyAppleNotification>>;
  try {
    decoded = await verifyAppleNotification(signedPayload);
  } catch (err) {
    logger.warn("App Store 通知驗證不過", { err: String(err) });
    res.status(400).send("invalid");
    return;
  }

  if (decoded.notificationType === "REFUND" && decoded.transaction?.transactionId) {
    await revokePurchase(purchaseDocId("ios", decoded.transaction.transactionId), "app-store");
  }
  res.status(200).send("ok");
});

/**
 * Google Play 即時開發者通知（Pub/Sub 主題 `play-billing`）。只處理一次性商品的作廢購買。
 * 部署時 Firebase 會自動建立主題；Google 那邊的發布權限要手動給（計畫 Task 11）。
 */
export const onPlayNotification = onMessagePublished({ topic: "play-billing", region: REGION }, async event => {
  let message: {
    packageName?: string;
    testNotification?: unknown;
    voidedPurchaseNotification?: { orderId?: string; productType?: number };
  };
  try {
    message = event.data.message.json;
  } catch (err) {
    logger.warn("Play 通知不是 JSON", { err: String(err) });
    return;
  }

  if (message?.packageName !== PACKAGE_NAME) return;
  if (message.testNotification) {
    logger.info("Play 測試通知");
    return;
  }

  const voided = message.voidedPurchaseNotification;
  // productType 2 是一次性商品；1 是訂閱，我們沒有。
  if (voided?.productType === 2 && voided.orderId) {
    await revokePurchase(purchaseDocId("android", voided.orderId), "google-play");
  }
});
```

- [ ] **Step 3: 型別檢查與測試** —— `cd functions && npm run build && npm test`。
- [ ] **Step 4: Commit** —— `functions/src/index.ts`，訊息 "Add purchaseCredits and store refund notifications"。**先不部署**：secrets 還沒設，部署會失敗（Task 11）。

---

### Task 5: rules

**Files:**
- Modify: `firestore.rules`
- Test: `tests/firestore.rules.test.mjs`

- [ ] **Step 1: 寫測試（加在 `await testEnv.cleanup();` 前面）**

```js
  // ---------------------------------------------------------------- 儲值紀錄

  await test("儲值紀錄誰都讀不到、寫不進去 —— 包含買的人自己", async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), "aiPurchases", "ios_1"), { uid: MEMBER, credits: 30, status: "credited" });
    });
    await assertFails(getDoc(doc(as(MEMBER), "aiPurchases", "ios_1")));
    await assertFails(
      setDoc(doc(as(MEMBER), "aiPurchases", "ios_2"), { uid: MEMBER, credits: 120, status: "credited" })
    );
  });
```

- [ ] **Step 2: 跑 rules 測試** —— JDK 21 後 `npm run test:rules`。Expected：這條已經 ok（沒有規則就是全擋），它是防回歸，寫出來是為了之後有人加規則時會紅。

- [ ] **Step 3: 規則（`match /config/{document=**}` 那一段後面）**

```
    /*
      儲值紀錄。**沒有任何登入身分讀得到、寫得進去，包含買的人自己。**

      它是金流紀錄：App 用不到它（餘額在 aiCredits），能寫的話就能自己造一筆
      「已加點」的紀錄。寫入只有 purchaseCredits 與退款通知（Admin SDK）。
    */
    match /aiPurchases/{purchaseId} {
      allow read, write: if false;
    }
```

- [ ] **Step 4: 再跑一次 rules 測試**，全部 ok。
- [ ] **Step 5: Commit** —— `firestore.rules`、`tests/firestore.rules.test.mjs`，訊息 "Lock credit purchase records to server writes"。

---

### Task 6: 後台的伺服器端（使用報告篩選、營收）

**Files:**
- Modify: `functions/src/ai/usage.ts`、`functions/src/ai/usage.test.ts`
- Modify: `functions/src/admin.ts`
- Modify: `firestore.indexes.json`

**Interfaces:**
- Produces（Task 7 使用）:
  - `interface PurchaseDoc { status?: unknown; credits?: unknown; price?: unknown; currency?: unknown }`
  - `sumPurchases(docs: PurchaseDoc[]): { count: number; refunded: number; credits: number; revenue: Record<string, number> }`
  - `adminAiUsage` 的篩選多 `purchase`、`revoke`；回傳多 `purchases`（上面那個形狀，只算 production）

- [ ] **Step 1: 寫失敗的測試（`usage.test.ts` 最後）**

```ts
describe("sumPurchases", () => {
  it("退款的不算營收與點數，但算進筆數與退款數；幣別分開加總", () => {
    expect(
      sumPurchases([
        { status: "credited", credits: 66, price: 60, currency: "TWD" },
        { status: "credited", credits: 120, price: 100, currency: "TWD" },
        { status: "refunded", credits: 30, price: 30, currency: "TWD" },
        { status: "credited", credits: 30, price: 0.99, currency: "USD" }
      ])
    ).toEqual({ count: 4, refunded: 1, credits: 216, revenue: { TWD: 160, USD: 0.99 } });
  });

  it("價格或幣別缺漏的照樣算筆數與點數，不進營收", () => {
    expect(sumPurchases([{ status: "credited", credits: 30, price: null, currency: null }])).toEqual({
      count: 1, refunded: 0, credits: 30, revenue: {}
    });
  });
});
```

import 加 `sumPurchases`。

- [ ] **Step 2: 跑測試確認失敗**

- [ ] **Step 3: `usage.ts` 最後加**

```ts
export interface PurchaseDoc {
  status?: unknown;
  credits?: unknown;
  price?: unknown;
  currency?: unknown;
}

/**
 * 區間內的儲值加總。呼叫端只傳 production 的紀錄 —— 測試購買不是營收。
 *
 * 幣別分開加總，不換算：換算要匯率，而那個匯率每天在變，換出來的數字會讓人以為
 * 比實際精確。Android 的價格是商品表的標價（Google 不回價格），iOS 是交易上的實際價格。
 */
export function sumPurchases(docs: PurchaseDoc[]): {
  count: number;
  refunded: number;
  credits: number;
  revenue: Record<string, number>;
} {
  const revenue: Record<string, number> = {};
  let refunded = 0;
  let credits = 0;
  for (const doc of docs) {
    if (doc.status === "refunded") {
      refunded += 1;
      continue;
    }
    if (typeof doc.credits === "number") credits += doc.credits;
    if (typeof doc.price === "number" && typeof doc.currency === "string") {
      // 用整數分再轉回來，免得 0.1 + 0.2 這種浮點誤差出現在營收上。
      revenue[doc.currency] = Math.round(((revenue[doc.currency] ?? 0) + doc.price) * 100) / 100;
    }
  }
  return { count: docs.length, refunded, credits, revenue };
}
```

- [ ] **Step 4: `admin.ts`**

import 從 `./ai/usage.js` 多拿 `sumPurchases, type PurchaseDoc`；從 `./admin/range.js` 的 import 確認有 `dayBounds`（已經有）。

篩選：

```ts
type AiLedgerFilter = "all" | "use" | "adjust" | "free" | "purchase" | "revoke";

function parseLedgerFilter(value: unknown): AiLedgerFilter | null {
  return value === "all" ||
    value === "use" ||
    value === "adjust" ||
    value === "free" ||
    value === "purchase" ||
    value === "revoke"
    ? value
    : null;
}
```

`adminAiUsage` 裡，`summary` 算完之後加：

```ts
  /*
    區間內的儲值。只算 production：TestFlight、審核人員、授權測試帳號的購買都是
    sandbox，混進來營收就是假的。creditedAt 用區間第一天的台北時間 00:00 當起點。
  */
  const purchasesSnap = await db()
    .collection("aiPurchases")
    .where("environment", "==", "production")
    .where("creditedAt", ">=", dayBounds(keys[0]).start)
    .get();
  const purchases = sumPurchases(purchasesSnap.docs.map(doc => doc.data() as PurchaseDoc));
```

回傳物件加上 `purchases,`。

- [ ] **Step 5: 索引**

`firestore.indexes.json` 的 `indexes` 最後加：

```json
    {
      "//": "後台 AI 設定頁的營收：environment 等值加上 creditedAt 範圍。",
      "collectionGroup": "aiPurchases",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "environment", "order": "ASCENDING" },
        { "fieldPath": "creditedAt", "order": "ASCENDING" }
      ]
    }
```

使用報告的 `type` 篩選沿用第一階段的 `(type, at DESC)` collection group 索引，`purchase`／`revoke` 只是新的值，不用加索引。

- [ ] **Step 6: 型別檢查與測試** —— `cd functions && npm run build && npm test`；`node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8'))"`。
- [ ] **Step 7: Commit** —— usage.ts、usage.test.ts、admin.ts、firestore.indexes.json，訊息 "Show credit purchases in the admin AI usage"。

---

### Task 7: 網頁（後台與點數用完的提示）

**Files:**
- Modify: `src/utils/aiLedger.ts`、`tests/aiLedger.test.ts`
- Modify: `src/services/adminService.ts`
- Modify: `src/pages/admin/AdminAiPage.vue`
- Modify: `src/components/expense/AiReceiptButton.vue`

- [ ] **Step 1: 標籤測試**

`tests/aiLedger.test.ts` 的「三種類型」改成：

```ts
  it("五種類型", () => {
    expect(ledgerTypeLabel("use")).toBe("辨識");
    expect(ledgerTypeLabel("adjust")).toBe("調整");
    expect(ledgerTypeLabel("free")).toBe("免費");
    expect(ledgerTypeLabel("purchase")).toBe("儲值");
    expect(ledgerTypeLabel("revoke")).toBe("退款扣回");
  });

  it("不認得的照原文 —— 之後新增的類型在畫面更新前也看得到", () => {
    expect(ledgerTypeLabel("gift")).toBe("gift");
  });
```

（原本那條用 `purchase` 當「不認得」的例子，現在它認得了，換成 `gift`。）

- [ ] **Step 2: 跑測試確認失敗** —— `npx vitest run tests/aiLedger.test.ts`

- [ ] **Step 3: `aiLedger.ts`**

```ts
const TYPE_LABELS: Record<string, string> = {
  use: "辨識",
  adjust: "調整",
  free: "免費",
  purchase: "儲值",
  revoke: "退款扣回"
};
```

- [ ] **Step 4: `adminService.ts`**

```ts
export type AiLedgerFilter = "all" | "use" | "adjust" | "free" | "purchase" | "revoke";
```

`AdminAiUsage` 加（標成可能不存在：舊版函式不會回）：

```ts
  /** 區間內的儲值，只算正式購買。營收照幣別分開，不換算。 */
  purchases?: { count: number; refunded: number; credits: number; revenue: Record<string, number> };
```

- [ ] **Step 5: `AdminAiPage.vue`**

`FILTERS` 加兩個：

```ts
  { value: "purchase", label: "儲值" },
  { value: "revoke", label: "退款" }
```

「用量」卡片裡 `<p class="tiny">{{ usage.days.from }} 至 …` 的前面加：

```vue
          <div v-if="usage.purchases" class="counts">
            <div><span class="label">儲值筆數</span><strong>{{ num(usage.purchases.count) }}</strong></div>
            <div><span class="label">其中退款</span><strong>{{ num(usage.purchases.refunded) }}</strong></div>
            <div><span class="label">賣出點數</span><strong>{{ num(usage.purchases.credits) }}</strong></div>
            <div>
              <span class="label">營收</span>
              <strong>
                <template v-if="Object.keys(usage.purchases.revenue).length">
                  <span v-for="(amount, code) in usage.purchases.revenue" :key="code">{{ code }} {{ amount }} </span>
                </template>
                <template v-else>—</template>
              </strong>
            </div>
          </div>
          <p v-if="usage.purchases" class="tiny">
            營收只算正式購買（不含測試帳號）；Android 的金額是商品標價，Google 不回實際價格。
          </p>
```

- [ ] **Step 6: `AiReceiptButton.vue` —— 點數用完的提示**

script 加：

```ts
/**
 * 點數用完了。網頁不賣點數（spec 的決定），所以只講去哪裡買，**不放連結** ——
 * 也不寫商店名稱，那是 App 裡的事。
 *
 * 兩種情況：按鈕本來就是「點數用完了」，或按下去才被函式告知沒點數
 * （另一台裝置剛好用掉最後一點）。
 */
const outOfCredits = ref(false);
```

`run()` 的 catch 裡、`error.value = …` 之前加：

```ts
    outOfCredits.value = (err as { code?: string }).code === "functions/resource-exhausted";
```

template 最後（`warning` 那一行之後）加：

```vue
    <span v-if="button.kind === 'empty' || outOfCredits" class="tiny">點數用完了，可以到手機 App 儲值。</span>
```

- [ ] **Step 7: 型別檢查、測試、建置** —— `npx vue-tsc --noEmit && npm test && npm run build`
- [ ] **Step 8: Commit** —— 上面四個檔案加 `tests/aiLedger.test.ts`，訊息 "Show purchases in the admin console and an out-of-credits hint on the web"。

---

### Task 8: Flutter 的純函式 `domain/credit_store.dart`

**Files:**
- Modify: `flutter_app/pubspec.yaml`
- Create: `flutter_app/lib/domain/credit_store.dart`
- Test: `flutter_app/test/credit_store_test.dart`

**Interfaces:**
- Produces（Task 9、10 使用）:
  - `class CreditPackInfo { final String productId; final int credits; final int bonus; }`、`const creditPacks`、`CreditPackInfo? packInfo(String productId)`、`String bonusLabel(CreditPackInfo pack)`
  - `enum PurchaseResultStatus { credited, already, pending, otherAccount }`
  - `class PurchaseResult { status; credits; creditsLeft }`、`PurchaseResult.fromMap(Map)`
  - `bool shouldComplete(PurchaseResultStatus status)` —— 待處理以外都要結束交易
  - `String purchaseMessage(PurchaseResult result)`

- [ ] **Step 1: `pubspec.yaml`**

`cloud_functions` 那一行下面加：

```yaml
  # AI 點數儲值。iOS 走 StoreKit 2、Android 走 Play Billing。加點一律由
  # purchaseCredits 在伺服器驗證之後才做（見 functions/src/purchase/）。
  in_app_purchase: ^3.3.0
```

- [ ] **Step 2: 測試**

```dart
import 'package:test/test.dart';
import 'package:splitflow/domain/credit_store.dart';

void main() {
  group('creditPacks', () {
    test('三個方案：30／66／120 點，順序就是畫面的順序', () {
      expect(creditPacks.map((p) => p.credits).toList(), [30, 66, 120]);
      expect(creditPacks.map((p) => p.productId).toList(),
          ['ai_credits_30', 'ai_credits_60', 'ai_credits_100']);
    });

    test('加送標籤：沒送就是空字串', () {
      expect(bonusLabel(packInfo('ai_credits_30')!), '');
      expect(bonusLabel(packInfo('ai_credits_100')!), '送 20 點');
    });

    test('不認得的商品 ID 回 null', () {
      expect(packInfo('ai_credits_999'), isNull);
    });
  });

  group('PurchaseResult', () {
    test('callable 回來的 Map 讀得起來', () {
      final r = PurchaseResult.fromMap(<Object?, Object?>{
        'status': 'credited',
        'credits': 66,
        'creditsLeft': 70,
      });
      expect(r.status, PurchaseResultStatus.credited);
      expect(r.credits, 66);
      expect(r.creditsLeft, 70);
    });

    test('other-account 對應 otherAccount；不認得的狀態當成 pending（不結束交易，下次再試）', () {
      expect(PurchaseResult.fromMap({'status': 'other-account'}).status, PurchaseResultStatus.otherAccount);
      expect(PurchaseResult.fromMap({'status': '???'}).status, PurchaseResultStatus.pending);
    });
  });

  group('shouldComplete', () {
    test('只有待處理不結束交易', () {
      expect(shouldComplete(PurchaseResultStatus.credited), true);
      expect(shouldComplete(PurchaseResultStatus.already), true);
      // 另一個帳號也要結束，不然那筆交易會永遠重送、同一個商品再也買不了。
      expect(shouldComplete(PurchaseResultStatus.otherAccount), true);
      expect(shouldComplete(PurchaseResultStatus.pending), false);
    });
  });

  group('purchaseMessage', () {
    test('四種結果的文案', () {
      expect(purchaseMessage(const PurchaseResult(PurchaseResultStatus.credited, 66, 70)), '已加 66 點，現在有 70 點');
      expect(purchaseMessage(const PurchaseResult(PurchaseResultStatus.already, 66, 70)), '這筆購買之前已經加過了，現在有 70 點');
      expect(purchaseMessage(const PurchaseResult(PurchaseResultStatus.pending, 0, null)), '付款處理中，完成後會自動加點');
      expect(purchaseMessage(const PurchaseResult(PurchaseResultStatus.otherAccount, 0, null)), '這筆購買已經加到另一個帳號了');
    });
  });
}
```

- [ ] **Step 3: 實作**

```dart
/// 儲值頁的顯示資料與購買結果的文案。純 Dart，不 import 外掛。
///
/// **點數對照的正本在 `functions/src/purchase/products.ts`。** 這一份只拿來畫
/// 儲值頁 —— 伺服器不看它，App 說買了幾點都不算數。兩邊對不上的症狀是
/// 「頁面寫 66 點，實際加了 60 點」，所以改一邊要改另一邊。
library;

class CreditPackInfo {
  final String productId;
  final int credits;
  final int bonus;
  const CreditPackInfo(this.productId, this.credits, this.bonus);
}

const creditPacks = [
  CreditPackInfo('ai_credits_30', 30, 0),
  CreditPackInfo('ai_credits_60', 66, 6),
  CreditPackInfo('ai_credits_100', 120, 20),
];

CreditPackInfo? packInfo(String productId) {
  for (final pack in creditPacks) {
    if (pack.productId == productId) return pack;
  }
  return null;
}

String bonusLabel(CreditPackInfo pack) => pack.bonus > 0 ? '送 ${pack.bonus} 點' : '';

enum PurchaseResultStatus { credited, already, pending, otherAccount }

class PurchaseResult {
  final PurchaseResultStatus status;
  final int credits;
  final int? creditsLeft;
  const PurchaseResult(this.status, this.credits, this.creditsLeft);

  factory PurchaseResult.fromMap(Map<dynamic, dynamic> map) {
    final status = switch (map['status']) {
      'credited' => PurchaseResultStatus.credited,
      'already' => PurchaseResultStatus.already,
      'other-account' => PurchaseResultStatus.otherAccount,
      // 不認得的當成待處理：不結束交易，商店下次會重送，比吞掉一筆付款安全。
      _ => PurchaseResultStatus.pending,
    };
    return PurchaseResult(
      status,
      (map['credits'] as num?)?.toInt() ?? 0,
      (map['creditsLeft'] as num?)?.toInt(),
    );
  }
}

bool shouldComplete(PurchaseResultStatus status) => status != PurchaseResultStatus.pending;

String purchaseMessage(PurchaseResult result) => switch (result.status) {
      PurchaseResultStatus.credited => '已加 ${result.credits} 點，現在有 ${result.creditsLeft} 點',
      PurchaseResultStatus.already => '這筆購買之前已經加過了，現在有 ${result.creditsLeft} 點',
      PurchaseResultStatus.pending => '付款處理中，完成後會自動加點',
      PurchaseResultStatus.otherAccount => '這筆購買已經加到另一個帳號了',
    };
```

- [ ] **Step 4: Commit** —— pubspec.yaml、credit_store.dart、credit_store_test.dart，訊息 "Add credit pack display rules to the app"。（`pubspec.lock` 這台產生不了，交給 CI 的 `flutter pub get`；CI 綠之前不宣稱測過。）

---

### Task 9: Flutter 的購買流程（repository 與 App 層級的監聽）

**Files:**
- Create: `flutter_app/lib/data/credit_purchase_repository.dart`
- Create: `flutter_app/lib/state/purchase_listener.dart`
- Modify: `flutter_app/lib/state/providers.dart`
- Modify: `flutter_app/lib/main.dart`

- [ ] **Step 1: repository**

```dart
/// 儲值。付款交給 `in_app_purchase`，**加點交給伺服器**（`purchaseCredits`）。
library;

import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import '../domain/credit_store.dart';
import '../domain/debug_log.dart';

class CreditPurchaseRepository {
  final InAppPurchase _iap = InAppPurchase.instance;

  /// 商店重送的交易也從這裡來 —— 所以要在 App 一啟動就聽（見 PurchaseListener）。
  Stream<List<PurchaseDetails>> get updates => _iap.purchaseStream;

  Future<bool> available() => _iap.isAvailable();

  /// 照 `creditPacks` 的順序排。商店查不到的方案不顯示 —— 不畫假價格。
  Future<List<ProductDetails>> products() async {
    final response = await _iap.queryProductDetails({for (final p in creditPacks) p.productId});
    final byId = {for (final p in response.productDetails) p.id: p};
    return [
      for (final pack in creditPacks)
        if (byId[pack.productId] != null) byId[pack.productId]!,
    ];
  }

  Future<bool> buy(ProductDetails product) => _iap.buyConsumable(
        purchaseParam: PurchaseParam(productDetails: product),
        // iOS 的外掛規定一定要 true（原始碼裡有 assert），而 iOS 的「消耗」就是
        // completePurchase —— 我們等伺服器加完點才呼叫它。Android 不讓外掛自己
        // 消耗，由伺服器驗證加點之後消耗。
        autoConsume: Platform.isIOS,
      );

  Future<PurchaseResult> verify(PurchaseDetails details) async {
    // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
    final call = FirebaseFunctions.instanceFor(region: 'asia-east1').httpsCallable('purchaseCredits');
    final result = await call.call<Map<Object?, Object?>>({
      'platform': Platform.isIOS ? 'ios' : 'android',
      'productId': details.productID,
      // iOS 是交易 ID，Android 是 orderId。
      'purchaseId': details.purchaseID,
      // iOS 是簽章過的交易（JWS），Android 是 purchaseToken。
      'verificationData': details.verificationData.serverVerificationData,
    });
    return PurchaseResult.fromMap(result.data);
  }

  /// 結束交易。**只在伺服器回覆之後呼叫。**
  ///
  /// Android 的伺服器消耗已經包含確認，這裡再確認一次可能被 Google 回「商品不存在」
  /// —— 那不影響已經加的點數，記一筆就好。iOS 的失敗照常往外丟：那代表交易沒結束。
  Future<void> complete(PurchaseDetails details) async {
    if (!details.pendingCompletePurchase) return;
    try {
      await _iap.completePurchase(details);
    } catch (err) {
      if (Platform.isIOS) rethrow;
      logError('purchase-complete', err);
    }
  }
}
```

- [ ] **Step 2: 監聽**

`flutter_app/lib/state/purchase_listener.dart`：

```dart
/// App 層級的購買監聽。
///
/// **為什麼在 `main.dart` 啟動，不是在儲值頁**：付款完成、伺服器還沒回覆就斷線
/// 或關掉 App 的話，商店會在下次啟動時把那筆交易再送一次。只在儲值頁聽的話，
/// 使用者不打開那一頁，那筆錢就永遠補不到點。
library;

import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import '../data/error_text.dart';
import '../domain/credit_store.dart';
import '../domain/debug_log.dart';
import 'providers.dart';

/// 儲值頁顯示的那一行。null 是沒有要說的事。
class PurchaseNotice {
  final String message;
  final bool error;
  const PurchaseNotice(this.message, {this.error = false});
}

final purchaseNoticeProvider = StateProvider<PurchaseNotice?>((ref) => null);

class PurchaseListener {
  final Ref _ref;
  StreamSubscription<List<PurchaseDetails>>? _subscription;

  PurchaseListener(this._ref);

  void start() {
    _subscription ??= _ref.read(creditPurchaseRepositoryProvider).updates.listen(
          (list) async {
            for (final details in list) {
              await _handle(details);
            }
          },
          onError: (Object err) => logError('purchase-stream', err),
        );
  }

  void _say(PurchaseNotice? notice) => _ref.read(purchaseNoticeProvider.notifier).state = notice;

  Future<void> _handle(PurchaseDetails details) async {
    switch (details.status) {
      case PurchaseStatus.pending:
        _say(const PurchaseNotice('付款處理中，完成後會自動加點'));
        return;
      case PurchaseStatus.canceled:
        // 使用者自己取消，不是錯誤。清掉上一則，讓儲值頁的按鈕回到可按。
        _say(null);
        return;
      case PurchaseStatus.error:
        _say(PurchaseNotice(errorText(details.error), error: true));
        return;
      case PurchaseStatus.purchased:
      case PurchaseStatus.restored:
        // 消耗型商品理論上不會有 restored，但 StoreKit 2 有回報過；伺服器是冪等的，照買到處理。
        break;
    }

    // 啟動時登入狀態是非同步還原的，currentUser 可能還是 null —— 等第一個狀態出來。
    final user = await FirebaseAuth.instance.authStateChanges().first;
    if (user == null || user.isAnonymous) {
      // 不結束交易：登入正式帳號之後重開 App，商店會再送一次。
      _say(const PurchaseNotice('登入正式帳號之後會自動加點', error: true));
      return;
    }

    final repository = _ref.read(creditPurchaseRepositoryProvider);
    try {
      final result = await repository.verify(details);
      if (shouldComplete(result.status)) await repository.complete(details);
      _ref.invalidate(aiCreditsProvider);
      _say(PurchaseNotice(purchaseMessage(result), error: result.status == PurchaseResultStatus.otherAccount));
    } catch (err) {
      // 不結束交易：下次開 App 商店會重送，伺服器是冪等的。
      logError('purchase-verify', err);
      _say(PurchaseNotice('付款成功了，但點數還沒加上（${errorText(err)}）。重新打開 App 會自動再試一次。', error: true));
    }
  }
}
```

- [ ] **Step 3: providers**

`providers.dart` import `'../data/credit_purchase_repository.dart'` 與 `'purchase_listener.dart'`；repository 區加：

```dart
/// 儲值。付款交給商店，加點交給伺服器。
final creditPurchaseRepositoryProvider = Provider((ref) => CreditPurchaseRepository());

/// App 層級的購買監聽，`main.dart` 在 Firebase 初始化之後啟動。
final purchaseListenerProvider = Provider((ref) => PurchaseListener(ref));
```

（`purchase_listener.dart` 也 import `providers.dart` —— Dart 允許這種互相 import；如果 analyze 抱怨，把 `purchaseListenerProvider` 移到 `purchase_listener.dart` 裡定義。）

- [ ] **Step 4: `main.dart`**

`if (pendingTaskId != null) {` 那一段前面加：

```dart
  // 購買監聽要在畫面建好之前就開始：上次付款完成但沒加到點的交易，商店會在
  // 啟動時重送。Firebase 沒初始化成功就不聽 —— 那時也打不到 purchaseCredits。
  if (error == null) {
    container.read(purchaseListenerProvider).start();
  }
```

- [ ] **Step 5: Commit** —— 四個檔案，訊息 "Listen for credit purchases app-wide and verify them on the server"。

---

### Task 10: Flutter 的儲值頁與入口

**Files:**
- Create: `flutter_app/lib/ui/credit_store_page.dart`
- Modify: `flutter_app/lib/ui/profile_page.dart`
- Modify: `flutter_app/lib/ui/expense_form_page.dart`

- [ ] **Step 1: 儲值頁**

```dart
/// 儲值 AI 辨識點數。
///
/// 價格一律用商店回傳的字串（`ProductDetails.price`），不寫死 NT$ —— 其他地區的
/// 使用者看到的是當地幣別。點數與加送標籤來自 `domain/credit_store.dart`。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import '../data/error_text.dart';
import '../domain/ai_receipt.dart';
import '../domain/credit_store.dart';
import '../state/providers.dart';
import '../state/purchase_listener.dart';
import 'ledger.dart';
import 'theme.dart';

class CreditStorePage extends ConsumerStatefulWidget {
  const CreditStorePage({super.key});

  @override
  ConsumerState<CreditStorePage> createState() => _CreditStorePageState();
}

class _CreditStorePageState extends ConsumerState<CreditStorePage> {
  List<ProductDetails>? _products;
  String? _loadError;
  /// 正在付款的商品。付款畫面是商店畫的，結果從 PurchaseListener 回來。
  String? _buying;

  @override
  void initState() {
    super.initState();
    // 進來時清掉上一次的訊息，免得看到上一回「已加 30 點」。
    WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(purchaseNoticeProvider.notifier).state = null);
    _load();
  }

  Future<void> _load() async {
    final repository = ref.read(creditPurchaseRepositoryProvider);
    try {
      if (!await repository.available()) {
        if (mounted) setState(() => _loadError = '目前無法儲值：這台裝置連不上商店。');
        return;
      }
      final products = await repository.products();
      if (!mounted) return;
      setState(() {
        _products = products;
        _loadError = products.isEmpty ? '目前無法儲值：商店沒有回傳方案，稍後再試。' : null;
      });
    } catch (err) {
      if (mounted) setState(() => _loadError = '目前無法儲值：${errorText(err)}');
    }
  }

  Future<void> _buy(ProductDetails product) async {
    setState(() => _buying = product.id);
    try {
      await ref.read(creditPurchaseRepositoryProvider).buy(product);
    } catch (err) {
      if (!mounted) return;
      setState(() => _buying = null);
      ref.read(purchaseNoticeProvider.notifier).state = PurchaseNotice(errorText(err), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final user = ref.watch(authStateProvider).value;
    final balance = ref.watch(aiCreditsProvider).value ?? freeCredits;
    final notice = ref.watch(purchaseNoticeProvider);

    // 監聽回報任何結果（成功、待處理、錯誤、取消）都代表這次付款結束了。
    ref.listen(purchaseNoticeProvider, (_, __) {
      if (_buying != null) setState(() => _buying = null);
    });

    return Scaffold(
      appBar: AppBar(title: const Text('儲值 AI 點數')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpace.x4),
        children: [
          if (user?.isAnonymous ?? false)
            Text('綁定帳號才能儲值 —— 訪客帳號登出就會刪除，買的點數會跟著消失。到個人設定綁定帳號。',
                style: text.bodyMedium)
          else ...[
            Text('現在有 $balance 點', style: text.titleLarge),
            const SizedBox(height: AppSpace.x2),
            Text('每讀一張收據用 1 點。點數跟著帳號走，網頁上也扣得到。', style: text.bodySmall),
            const SizedBox(height: AppSpace.x4),
            if (notice != null) ...[
              Text(notice.message,
                  style: text.bodyMedium?.copyWith(color: notice.error ? AppColors.danger : AppColors.ink)),
              const SizedBox(height: AppSpace.x3),
            ],
            if (_loadError != null)
              Text(_loadError!, style: text.bodyMedium?.copyWith(color: AppColors.danger))
            else if (_products == null)
              const Center(child: CircularProgressIndicator())
            else
              LedgerCard(
                children: [
                  for (var i = 0; i < _products!.length; i++) ...[
                    if (i > 0) const LedgerDivider(),
                    _PackRow(
                      product: _products![i],
                      busy: _buying != null,
                      buying: _buying == _products![i].id,
                      onBuy: () => _buy(_products![i]),
                    ),
                  ],
                ],
              ),
          ],
        ],
      ),
    );
  }
}

class _PackRow extends StatelessWidget {
  final ProductDetails product;
  final bool busy;
  final bool buying;
  final VoidCallback onBuy;

  const _PackRow({required this.product, required this.busy, required this.buying, required this.onBuy});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final pack = packInfo(product.id);
    final bonus = pack == null ? '' : bonusLabel(pack);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.x4, vertical: AppSpace.x3),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${pack?.credits ?? '?'} 點', style: figure(size: 22, weight: FontWeight.w700)),
                if (bonus.isNotEmpty) Text(bonus, style: text.bodySmall?.copyWith(color: AppColors.primaryDeep)),
              ],
            ),
          ),
          FilledButton(
            onPressed: busy ? null : onBuy,
            child: Text(buying ? '處理中…' : product.price),
          ),
        ],
      ),
    );
  }
}
```

（`figure()`、`AppColors.primaryDeep`、`LedgerCard`、`LedgerDivider` 都是既有的；analyze 抱怨找不到的話，照 `expense_form_page.dart` 與 `members_tab.dart` 的用法修正 import。）

- [ ] **Step 2: 個人頁入口**

`profile_page.dart` import `'credit_store_page.dart'`；「AI 辨識點數」那個 `LedgerRow` 加上：

```dart
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const CreditStorePage()),
                ),
```

- [ ] **Step 3: 表單的「去儲值」**

`expense_form_page.dart`：import `'package:cloud_functions/cloud_functions.dart'` 與 `'credit_store_page.dart'`。

state 加：

```dart
  /// 按下去才被函式告知沒點數（另一台裝置剛好用掉最後一點）。
  bool _aiOutOfCredits = false;
```

`_runAi` 的 catch 改成：

```dart
    } catch (err) {
      if (mounted) {
        setState(() {
          _aiError = errorText(err);
          _aiOutOfCredits = err is FirebaseFunctionsException && err.code == 'resource-exhausted';
        });
      }
    }
```

`ReceiptField` 的 `onChanged` 裡加 `_aiOutOfCredits = false;`。

AI 那個 `Column` 的 `OutlinedButton.icon(...)` 後面加：

```dart
                                // App 裡只連到自己的儲值頁，不導去任何外部付款（spec 的決定）。
                                if (button.kind == AiButtonKind.empty || _aiOutOfCredits)
                                  TextButton(
                                    onPressed: () => Navigator.of(context).push(
                                      MaterialPageRoute<void>(builder: (_) => const CreditStorePage()),
                                    ),
                                    child: const Text('去儲值'),
                                  ),
```

- [ ] **Step 4: 推上去讓 CI 跑**

```bash
git add flutter_app/lib/ui/credit_store_page.dart flutter_app/lib/ui/profile_page.dart flutter_app/lib/ui/expense_form_page.dart
git commit -m "Add the credit store page and its entry points in the app" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

Expected: iOS Build Check 綠（`flutter pub get` 解出 `in_app_purchase`、analyze、`credit_store_test.dart`、不簽章 build）。紅的照錯誤修，**不得跳過**。

---

### Task 11: todo、部署與真的買一次

- [ ] **Step 1: todo** —— `todo.md` 加一節「已完成：AI 點數儲值（程式碼）」，寫：方案與點數、驗證流程、退款扣到 0、`aiPurchases` 不隨刪帳號刪除、iOS `autoConsume` 的限制、Android 營收是標價近似；以及「還沒驗到的：真的在兩個商店各買一次」。

- [ ] **Step 2: 部署不需要商店帳號的部分**

```bash
npm run deploy:rules
```

`purchaseCredits` 等函式要等 secrets 設好才部署得上去（`defineSecret` 的值不存在時部署會失敗）—— 這一步留到 Step 3 之後。

- [ ] **Step 3: 使用者辦好帳號之後（spec 第 10 節）**

```bash
npx firebase functions:secrets:set APPSTORE_ISSUER_ID
npx firebase functions:secrets:set APPSTORE_KEY_ID
npx firebase functions:secrets:set APPSTORE_PRIVATE_KEY --data-file <下載的 .p8>
npx firebase functions:secrets:set APPSTORE_APP_APPLE_ID
npm run deploy:functions
npm run deploy
```

- 部署完成後 Firebase 會印出 `appStoreNotifications` 的網址，填到 App Store Connect →「App Store 伺服器通知」→ 正式與沙盒兩個欄位，版本選 V2。
- Play Console → 營利設定 → 即時開發者通知：主題填 `projects/splitflow-e39c0/topics/play-billing`，並在 Google Cloud Console 的 Pub/Sub 主題權限裡把 `google-play-developer-notifications@system.gserviceaccount.com` 設為「發布者」。按「傳送測試通知」，函式的 log 要看得到一筆 `testNotification`。
- Play Console → 使用者和權限：邀請 Cloud Functions 的執行服務帳戶（`<專案編號>-compute@developer.gserviceaccount.com`），給「查看財務資料」「管理訂單和訂閱」。

- [ ] **Step 4: 真的買一次**

照 spec 第 9 節的手動清單：兩個平台三個方案各買一次、斷線後重開 App 自動補點、同一筆重送不重複加點、另一個帳號送同一筆被拒、Android 待處理付款、兩邊各退款一次確認扣點、網頁看得到 App 買的點數、後台營收只算正式購買。結果記回這一節。

- [ ] **Step 5: 告訴使用者結果** —— 照實講哪些驗過、哪些沒驗到。

---

## Spec 對照

| Spec 的段落 | Task |
|---|---|
| 1. 商品 | 1、8 |
| 2. 購買流程 | 9、10 |
| 3. 伺服器 `purchaseCredits`（檢查、冪等加點、購買紀錄、紀錄類型） | 2、3、4、5 |
| 4. 退款 | 2、4 |
| 5. 商店的憑證 | 3、11 |
| 6. App 畫面、網頁提示 | 7、10 |
| 7. 後台 | 6、7 |
| 9. 測試 | 各 Task 的測試步驟、11 |
| 10. 上線前 | 11 |
