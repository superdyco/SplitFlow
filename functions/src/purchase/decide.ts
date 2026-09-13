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
