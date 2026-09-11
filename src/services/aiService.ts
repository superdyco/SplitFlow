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
