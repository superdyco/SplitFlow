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
