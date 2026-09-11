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

    戳記開始收之前的日子是 null，不是三個 0。
  */
  platforms: { web: number; android: number; ios: number } | null;
  /** 建立任務後 7 天內記了 3 筆以上支出。來自每日彙總，排程還沒跑時是 null。 */
  cohort: { matured: number; retained: number } | null;
  /** 最活躍的任務。這一份不靠每日彙總 —— 排程還沒跑就已經有東西看。 */
  topTasks: Array<{
    id: string;
    name: string;
    status: string;
    ownerName: string;
    memberCount: number;
    expenseCount: number;
    currency: string;
    updatedAt: string | null;
  }>;
  coverage: { expected: number; present: number };
  /**
   * 訪客的來去。**當下記的**，所以算到今天，跟上面到昨天為止的序列不同。
   *
   * 標成可能不存在：前端與 functions 分開部署，舊版的 adminOverview 不會回這個欄位。
   */
  guests?: {
    totals: { started: number; bound: number; merged: number; left: number };
    /** 區間內有紀錄的天數。0 代表還沒開始記，不是「沒有訪客」。 */
    recordedDays: number;
  };
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
  /** 標成可能不存在：前端與 functions 分開部署，舊版的 adminUser 不會回它。 */
  ai?: {
    /** null 代表還沒用過，第一次辨識時才會送 3 點。 */
    balance: number | null;
    calls: number;
    reads: number;
    ledger: AiLedgerRow[];
  };
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

/* ------------------------------------------------------------------ 公開報告 */

/**
 * 篩選裡**沒有「被檢舉」**。設計稿上有，但 app 裡沒有任何地方讓使用者檢舉
 * 報告 —— 那要先做一個面向使用者的功能，不是後台加一個分頁就有的。
 */
export type ReportFilter = "listed" | "linked" | "revoked" | "all";

export interface AdminReportRow {
  taskId: string;
  reportId: string;
  taskName: string;
  currency: string;
  total: number;
  days: number | null;
  memberCount: number;
  expenseCount: number;
  active: boolean;
  listed: boolean;
  hasMap: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AdminReportsResult {
  rows: AdminReportRow[];
  /** taskId → 擁有者暱稱。報告文件裡刻意沒有任何人的資訊。 */
  owners: Record<string, string>;
  cursor: string | null;
}

export async function fetchReports(params: {
  filter?: ReportFilter;
  cursor?: string | null;
}): Promise<AdminReportsResult> {
  const result = await callable<typeof params, AdminReportsResult>("adminReports")(params);
  return result.data;
}

/* ------------------------------------------------------------------ 系統健康 */

export interface PerfPageSummary {
  page: string;
  count: number;
  p50: number;
  p75: number;
  p95: number;
  /** 樣本不足時是 null —— 三筆算出來的中位數不是統計是巧合。 */
  coldP50: number | null;
  warmP50: number | null;
  coldCount: number;
  slowest: Array<{ phase: string; count: number }>;
}

export interface AdminHealth {
  range: AdminRange;
  days: { from: string; to: string };
  pages: PerfPageSummary[];
  total: number;
  /**
   * 區間裡沒有彙總文件的那幾天。排程失敗的那天不會有。
   *
   * 不是空陣列的時候畫面**必須說出來** —— 少一天的後果是「近 30 天的 p95」
   * 默默變成「近 29 天的」，一個看起來完全正常、只是不是你以為的那個區間的數字。
   */
  missingDays: string[];
  /**
   * 桶寬（毫秒）。數字是從每日直方圖算出來的，所以有這麼大的誤差，
   * 而且方向固定是高估。畫面要標出來 —— 一個看起來精確到毫秒的數字，
   * 如果實際上不是，那個精確度本身就是誤導。
   */
  bucketMs: number;
  /** 這一頁少了什麼。由後端說，做好了才會消失。 */
  missing: string[];
}

export async function fetchHealth(range: AdminRange): Promise<AdminHealth> {
  const result = await callable<{ range: AdminRange }, AdminHealth>("adminHealth")({ range });
  return result.data;
}

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

export async function adjustCredits(
  uid: string,
  delta: number,
  reason: string
): Promise<{ balance: number; delta: number }> {
  const result = await callable<{ uid: string; delta: number; reason: string }, { balance: number; delta: number }>(
    "adminAdjustCredits"
  )({ uid, delta, reason });
  return result.data;
}
