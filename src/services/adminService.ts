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

/** region 要跟函式一致，不然會打到 us-central1 然後找不到函式。 */
function callable<Req, Res>(name: string) {
  return httpsCallable<Req, Res>(getFunctions(app, "asia-east1"), name);
}

export async function fetchOverview(range: AdminRange): Promise<AdminOverview> {
  const result = await callable<{ range: AdminRange }, AdminOverview>("adminOverview")({ range });
  return result.data;
}

/* ------------------------------------------------------------------ 使用者 */

export type UserFilter = "all" | "active7" | "idle30";

export interface AdminUserRow {
  uid: string;
  nickname: string;
  email: string;
  provider: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  lastPlatform: string | null;
}

export interface AdminUsersResult {
  rows: AdminUserRow[];
  /** null 代表沒有下一頁了。 */
  cursor: string | null;
  /** 搜尋模式不分頁 —— 前綴比對本來就只會回一小把。 */
  searched: boolean;
  /** 篩選看不到誰。有值的時候要顯示出來。 */
  blindSpot: string | null;
}

export interface AdminUserTask {
  id: string;
  name: string;
  status: string;
  role: "owner" | "admin" | "member";
  memberCount: number;
  expenseCount: number;
  updatedAt: string | null;
}

export interface AdminUserDetail {
  profile: AdminUserRow;
  /** 來自 Firebase Auth，不是 Firestore。讀不到時是 null。 */
  disabled: boolean | null;
  lastSignInAt: string | null;
  counts: { tasks: number; owned: number; expenses: number };
  /** 只有前 10 個。 */
  tasks: AdminUserTask[];
}

export async function fetchUsers(params: {
  query?: string;
  filter?: UserFilter;
  cursor?: string | null;
}): Promise<AdminUsersResult> {
  const result = await callable<typeof params, AdminUsersResult>("adminUsers")(params);
  return result.data;
}

/**
 * 單一使用者的詳情。
 *
 * **這一支會在稽核日誌留下一筆。** 不是副作用是規格 —— 這個後台看得到全部
 * 使用者的資料，所以「看了誰」跟「動了什麼」一樣該留痕。
 */
export async function fetchUser(uid: string): Promise<AdminUserDetail> {
  const result = await callable<{ uid: string }, AdminUserDetail>("adminUser")({ uid });
  return result.data;
}

/* ------------------------------------------------------------------ 稽核日誌 */

export type AuditFilter = "all" | "act" | "view";

export interface AuditRow {
  id: string;
  at: string | null;
  adminUid: string;
  adminEmail: string;
  action: string;
  kind: "view" | "act" | "denied";
  targetType: string;
  targetId: string;
  targetLabel: string;
  reason: string | null;
  ip: string;
  result: string;
}

export interface AuditResult {
  rows: AuditRow[];
  cursor: string | null;
  monthly: { views: number; acts: number; denied: number };
}

export async function fetchAudit(params: {
  filter?: AuditFilter;
  cursor?: string | null;
}): Promise<AuditResult> {
  const result = await callable<typeof params, AuditResult>("adminAudit")(params);
  return result.data;
}

/* ------------------------------------------------------------------ 任務 */

export type TaskFilter = "active" | "archived" | "deleted" | "all";

export interface AdminTaskRow {
  id: string;
  name: string;
  status: string;
  ownerId: string;
  memberCount: number;
  expenseCount: number;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AdminTasksResult {
  rows: AdminTaskRow[];
  /** uid → 暱稱。任務文件裡只有 uid，列表要顯示名字。 */
  owners: Record<string, string>;
  cursor: string | null;
  searched: boolean;
}

export interface AdminTaskDetail {
  task: AdminTaskRow;
  ownerName: string;
  members: Array<{
    uid: string;
    nickname: string;
    role: string;
    virtual: boolean;
    active: boolean;
  }>;
  money: {
    total: number;
    currency: string;
    perMember: number | null;
    categories: Array<{ category: string; amount: number; percent: number }>;
    /** 沒有換算過的舊支出。總額不含這些 —— 畫面要說出來。 */
    unconverted: number;
  };
  /** 只有張數。管理者看不到照片，連縮圖都沒有。 */
  receiptCount: number;
}

export async function fetchTasks(params: {
  query?: string;
  filter?: TaskFilter;
  cursor?: string | null;
}): Promise<AdminTasksResult> {
  const result = await callable<typeof params, AdminTasksResult>("adminTasks")(params);
  return result.data;
}

/** 會在稽核日誌留下一筆。 */
export async function fetchTask(taskId: string): Promise<AdminTaskDetail> {
  const result = await callable<{ taskId: string }, AdminTaskDetail>("adminTask")({ taskId });
  return result.data;
}

/* ------------------------------------------------------------------ 三個處置 */

/**
 * 這三支是整個後台唯一會改到資料的地方。
 *
 * 三支都必填理由，三支都寫日誌，三支都通知當事人 —— 那三件事在後端的同一個
 * 包裝裡，不是各自記得做。
 */

export async function disableUser(
  uid: string,
  reason: string
): Promise<{ effectiveAt: string }> {
  const result = await callable<{ uid: string; reason: string }, { effectiveAt: string }>(
    "adminDisableUser"
  )({ uid, reason });
  return result.data;
}

export async function archiveTask(taskId: string, reason: string): Promise<void> {
  await callable<{ taskId: string; reason: string }, unknown>("adminArchiveTask")({
    taskId,
    reason
  });
}

export async function revokeReport(
  taskId: string,
  reportId: string,
  reason: string
): Promise<void> {
  await callable<{ taskId: string; reportId: string; reason: string }, unknown>(
    "adminRevokeReport"
  )({ taskId, reportId, reason });
}
