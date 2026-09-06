/**
 * 管理後台的伺服器端。
 *
 * 為什麼後台的資料一律走 callable，而不是在規則層替管理者開一條路：
 *
 *   1. 規則層做不到後台要的事 —— 跨使用者的列表查詢、count 聚合、把單筆
 *      支出擋在伺服器內只回加總、把每一次檢視寫進日誌。
 *   2. 開了那條路就永遠在那裡，而它保護的是**全部**使用者的資料。
 *      現在 `match /users/{uid}` 是 `allow read: if isSelf(uid)`，一行都不用動。
 *
 * 管理者身分是 custom claim，只寫得進有 service account 的地方
 * （`scripts/set-admin.mjs`）。系統裡沒有任何一條路讓登入中的帳號把自己
 * 升成管理者。
 */
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

import { DENIED_CODE, DENIED_MESSAGE, isAdmin } from "./admin/guard.js";
import { dayKeys, parseRange, type Range } from "./admin/range.js";
import { auditEntry, type AdminAction, type TargetType } from "./admin/audit.js";
import { latestDoc, series, sumRecent, type DailyDoc } from "./admin/aggregate.js";

const REGION = "asia-east1";

/**
 * **不要在模組頂層呼叫 getFirestore()。**
 *
 * `index.ts` 的 `initializeApp()` 寫在它的函式體裡，而 import 是被提升的 ——
 * 這個檔案的模組體會先跑完，`initializeApp()` 才輪到。頂層取 Firestore 的話
 * 部署上去就是「app 尚未初始化」，而且是每一支函式都掛，不是這一支。
 */
let cached: Firestore | null = null;
function db(): Firestore {
  if (!cached) cached = getFirestore();
  return cached;
}

interface Caller {
  uid: string;
  email: string;
  ip: string;
  userAgent: string;
}

/**
 * 驗管理者身分。不是的話丟 not-found 並留下紀錄。
 *
 * 丟 `not-found` 而不是 `permission-denied`：後者等於告訴對方「這支函式是
 * 真的，只是你不夠格」，那就把一份原本不該被知道存在的介面清單交出去了。
 * 前端的路由守衛用同一個原則。
 */
async function requireAdmin(request: CallableRequest, action: AdminAction): Promise<Caller> {
  const ip = request.rawRequest.ip ?? "";
  const userAgent = request.rawRequest.get("user-agent") ?? "";

  if (!isAdmin(request.auth?.token)) {
    /*
      被擋下來的存取是唯一一種不是管理者做的動作，但它正是最該留下來的
      那一種。這裡是 await 的 —— 記不下來就不該當作沒發生，寧可讓這次
      呼叫變成一個內部錯誤。
    */
    await writeAudit({
      action: "denied.access",
      adminUid: request.auth?.uid ?? "",
      adminEmail: (request.auth?.token.email as string | undefined) ?? "",
      targetType: "route",
      targetId: action,
      targetLabel: action,
      ip,
      userAgent,
      result: "error"
    });
    throw new HttpsError(DENIED_CODE, DENIED_MESSAGE);
  }

  return {
    uid: request.auth!.uid,
    email: (request.auth!.token.email as string | undefined) ?? "",
    ip,
    userAgent
  };
}

interface AuditArgs {
  action: AdminAction;
  adminUid: string;
  adminEmail: string;
  targetType: TargetType;
  targetId: string;
  targetLabel: string;
  reason?: unknown;
  ip: string;
  userAgent: string;
  result?: "ok" | "error";
}

/**
 * 寫一筆稽核日誌。
 *
 * 呼叫端一律 await 它再回傳資料，不要背景寫 —— 允許「看得到但沒紀錄」
 * 等於承認這份日誌可以有缺口，而一份有缺口的稽核日誌不比沒有好多少。
 */
async function writeAudit(args: AuditArgs): Promise<void> {
  const built = auditEntry({ ...args, at: new Date() });

  if (!built.ok) {
    // 理由缺漏是呼叫端的 bug，不是使用者的錯。讓它變成明確的失敗，
    // 而不是一筆沒有理由的處置紀錄。
    logger.error("稽核日誌組不出來", { problem: built.problem, action: args.action });
    throw new HttpsError("invalid-argument", "這個動作需要填寫理由");
  }

  await db().collection("adminLogs").add(built.entry);
}

/** 一次 count 聚合。比把文件讀回來數便宜一個數量級。 */
async function countOf(query: FirebaseFirestore.Query): Promise<number> {
  const snap = await query.count().get();
  return snap.data().count;
}

/**
 * 讀區間內的每日彙總。
 *
 * 現在還沒有排程在寫它們，所以正常情況會回空陣列 —— 那不是錯誤，是
 * 「資料還在累積」。呼叫端靠 `coverage` 知道差別，不要讓畫面把空的當成 0。
 */
async function readDaily(keys: string[]): Promise<DailyDoc[]> {
  const snap = await db()
    .collection("stats")
    .doc("daily")
    .collection("days")
    .where("date", ">=", keys[0])
    .where("date", "<=", keys[keys.length - 1])
    .get();

  return snap.docs.map(doc => doc.data() as DailyDoc);
}

/**
 * 儀表板的總覽。
 *
 * 累計的四個數字用即時 count 聚合，時間序列讀每日彙總。分開的理由：
 * count 聚合便宜到可以每次打開都算（每 1000 筆索引項目才算一次讀取），
 * 而「每天的活躍人數」不是 count 算得出來的，那需要有人每天記一筆。
 */
export const adminOverview = onCall({ region: REGION }, async request => {
  await requireAdmin(request, "export.stats");

  const range = parseRange((request.data as { range?: unknown } | undefined)?.range ?? "30d");
  if (!range) throw new HttpsError("invalid-argument", "不認得的時間區間");

  const keys = dayKeys(range, new Date());
  const tasks = db().collection("tasks");

  const [users, active, archived, deleted, expenses, daily] = await Promise.all([
    countOf(db().collection("users")),
    countOf(tasks.where("status", "==", "active")),
    countOf(tasks.where("status", "==", "archived")),
    countOf(tasks.where("status", "==", "deleted")),
    countOf(db().collectionGroup("expenses")),
    readDaily(keys)
  ]);

  const week = keys.slice(-7);
  const newUsers = sumRecent(daily, week, doc => doc.users.new);
  const newTasks = sumRecent(daily, week, doc => doc.tasks.new);
  const newExpenses = sumRecent(daily, week, doc => doc.expenses.new);
  const latest = latestDoc(daily);

  return {
    range,
    // 累計的部分是現在這一刻算的，時間序列則是到昨天為止。畫面要說得出
    // 這個差別，不然「使用者總數」跟折線圖的最後一點看起來會對不上。
    countedAt: new Date().toISOString(),
    through: keys[keys.length - 1],
    totals: {
      users,
      tasksActive: active,
      tasksArchived: archived,
      tasksDeleted: deleted,
      expenses
    },
    weekly: {
      users: newUsers.total,
      tasks: newTasks.total,
      expenses: newExpenses.total,
      missingDays: newUsers.missing.length
    },
    dau: series(daily, keys, doc => doc.dau),
    platforms: latest?.platforms ?? null,
    /*
      有幾天真的有資料。畫面拿它決定要不要畫那條線 —— 排程還沒上線時
      這裡是 0，那時候該說「累積中」，而不是畫一條貼在底部的直線。
    */
    coverage: { expected: keys.length, present: daily.length }
  };
});
