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
