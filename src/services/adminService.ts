import { getFunctions, httpsCallable } from "firebase/functions";
import { app, auth } from "@/firebase/config";

/**
 * 管理後台的用戶端。
 *
 * 這個檔案只有網頁版有。Flutter App 沒有 `/admin`，也沒有呼叫這些函式的
 * 程式碼 —— 手機上不存在這個後台。
 */

export type AdminRange = "7d" | "30d" | "90d";

export interface AdminOverview {
  range: AdminRange;
  /** 累計數字是這一刻算的。 */
  countedAt: string;
  /** 時間序列到這一天為止（昨天）。 */
  through: string;
  totals: {
    users: number;
    tasksActive: number;
    tasksArchived: number;
    tasksDeleted: number;
    expenses: number;
  };
  weekly: { users: number; tasks: number; expenses: number; missingDays: number };
  dau: Array<{ date: string; value: number | null }>;
  /*
    當天最後一次開啟在哪個平台。**沒有「兩者都用」** —— lastPlatform 只記
    最後一次，同一個人同一天先開網頁再開 App，第二次會蓋掉第一次。
  */
  platforms: { web: number; android: number; ios: number } | null;
  coverage: { expected: number; present: number };
}

/**
 * 這個帳號是不是平台管理者。
 *
 * 讀的是 token 上的 custom claim，不是 Firestore 的某份文件 —— 所以這裡
 * 不會有網路往返（除非 token 剛好過期要換發）。
 *
 * **claim 設定後不會立刻出現在已登入的 token 裡**，要重新登入或等最長
 * 一小時的換發。`scripts/set-admin.mjs` 的最後一行就是在講這件事。
 *
 * 任何失敗都回 false。這是一道權限判斷，「不確定」只能當成「不是」。
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    const token = await user.getIdTokenResult();
    // 跟後端的 isAdmin() 一樣用 === true。custom claim 是 JSON，
    // 手滑寫成 "false" 字串的話真值判斷會把它當成管理者。
    return token.claims.admin === true;
  } catch {
    return false;
  }
}

export async function fetchOverview(range: AdminRange): Promise<AdminOverview> {
  // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
  const call = httpsCallable<{ range: AdminRange }, AdminOverview>(
    getFunctions(app, "asia-east1"),
    "adminOverview"
  );
  const result = await call({ range });
  return result.data;
}
