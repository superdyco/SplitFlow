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
import { FieldPath, getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

import { DENIED_CODE, DENIED_MESSAGE, isAdmin } from "./admin/guard.js";
import { dayBounds, dayKeys, latestCompletedDay, parseRange, TIME_ZONE } from "./admin/range.js";
import { auditEntry, type AdminAction, type TargetType } from "./admin/audit.js";
import {
  classifySearch,
  decodeCursor,
  encodeCursor,
  FILTER_BLIND_SPOT,
  listPlan,
  parseFilter,
  parseLimit,
  prefixEnd
} from "./admin/users.js";
import {
  dailyDoc,
  latestDoc,
  series,
  sumRecent,
  type DailyCounts,
  type DailyDoc
} from "./admin/aggregate.js";

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

/* ------------------------------------------------------------------ 每日彙總 */

/** 建立後幾天內、記幾筆支出才算「真的在用」。改了要把 AGGREGATE_VERSION 加一。 */
const COHORT_DAYS = 7;
const COHORT_EXPENSES = 3;

/**
 * 算某一天的彙總。
 *
 * 全部用 `count()` 聚合，不是把文件讀回來數 —— 後者在使用者上萬之後就是
 * 每天一次全表掃描。count 每 1000 筆索引項目才算一次讀取。
 */
async function computeDaily(day: string): Promise<DailyCounts> {
  const { start, end } = dayBounds(day);
  const users = db().collection("users");
  const tasks = db().collection("tasks");
  const expenses = db().collectionGroup("expenses");

  const inDay = (query: FirebaseFirestore.Query, field: string) =>
    query.where(field, ">=", start).where(field, "<", end);

  const seenThatDay = (platform: string) =>
    countOf(inDay(users.where("lastPlatform", "==", platform), "lastSeenAt"));

  const [
    usersTotal,
    usersNew,
    tasksActive,
    tasksArchived,
    tasksDeleted,
    tasksNew,
    expensesTotal,
    expensesNew,
    dau,
    platformWeb,
    platformAndroid,
    platformIos
  ] = await Promise.all([
    countOf(users),
    countOf(inDay(users, "createdAt")),
    countOf(tasks.where("status", "==", "active")),
    countOf(tasks.where("status", "==", "archived")),
    countOf(tasks.where("status", "==", "deleted")),
    countOf(inDay(tasks, "createdAt")),
    countOf(expenses),
    countOf(inDay(expenses, "createdAt")),
    countOf(inDay(users, "lastSeenAt")),
    seenThatDay("web"),
    seenThatDay("android"),
    seenThatDay("ios")
  ]);

  const cohort = await computeCohort(day);

  return {
    usersTotal,
    usersNew,
    tasksActive,
    tasksArchived,
    tasksDeleted,
    tasksNew,
    expensesTotal,
    expensesNew,
    dau,
    platformWeb,
    platformAndroid,
    platformIos,
    ...cohort
  };
}

/**
 * 「建立任務之後有沒有真的在用」。
 *
 * 不能用 `task.expenseCount` —— 那是累計值，不是前七天的。所以挑出**當天剛好
 * 滿七天**的任務，一個一個去數它前七天的支出。
 *
 * 一天大概個位數的任務到期，所以逐一 count 是可以接受的；真的長到三位數時
 * 這裡會是第一個要改的地方。
 */
async function computeCohort(day: string): Promise<{ cohortMatured: number; cohortRetained: number }> {
  const born = dayBounds(shiftDays(day, -COHORT_DAYS));

  const snap = await db()
    .collection("tasks")
    .where("createdAt", ">=", born.start)
    .where("createdAt", "<", born.end)
    .select("createdAt")
    .get();

  let retained = 0;
  for (const task of snap.docs) {
    const createdAt = task.get("createdAt") as FirebaseFirestore.Timestamp | undefined;
    if (!createdAt) continue;
    const deadline = new Date(createdAt.toMillis() + COHORT_DAYS * 86_400_000);

    const count = await countOf(
      task.ref.collection("expenses").where("createdAt", "<=", deadline)
    );
    if (count >= COHORT_EXPENSES) retained += 1;
  }

  return { cohortMatured: snap.size, cohortRetained: retained };
}

/** 只在這裡用得到，所以不從 range.ts 再匯出一個名字幾乎一樣的東西。 */
function shiftDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/**
 * 每天 04:00 算前一天。
 *
 * 為什麼是前一天而不是今天：今天還沒過完。算一個進行中的日子會得到一個
 * 每小時都在變的數字，而它會被畫在折線圖的最後一點上，看起來像「今天掉了」。
 *
 * 04:00 是因為那時候幾乎沒有人在用，而 count 聚合雖然便宜也不是免費的。
 */
export const aggregateDaily = onSchedule(
  { schedule: "0 4 * * *", timeZone: TIME_ZONE, region: REGION, retryCount: 3 },
  async () => {
    const day = latestCompletedDay(new Date());
    const startedAt = Date.now();

    const counts = await computeDaily(day);

    /*
      文件 ID 就是日期，所以重跑同一天是覆蓋而不是長出第二筆。
      排程重試、手動補算都靠這個性質 —— 沒有它，一次失敗的重試會讓那天
      被算兩次。
    */
    await db()
      .collection("stats")
      .doc("daily")
      .collection("days")
      .doc(day)
      .set(dailyDoc(day, counts, new Date()));

    logger.info("每日彙總完成", { day, ms: Date.now() - startedAt, dau: counts.dau });
  }
);

/**
 * 手動補算一段日期。
 *
 * 為什麼需要：排程只從部署那天開始寫，在那之前沒有任何一天有文件。
 * users、tasks、expenses 的數字可以回推（createdAt 是歷史事實），所以補得回來。
 *
 * **但 dau 與平台分佈補不回來** —— lastSeenAt 在部署之前不存在，補算出來的
 * 那幾天一律是 0。那個 0 是假的，所以這支函式回傳時會講明白補了哪幾天，
 * 而畫面上那幾天應該被當成沒有資料。
 *
 * 一次最多 31 天，免得一支 callable 跑到逾時。
 */
export const adminBackfill = onCall({ region: REGION, timeoutSeconds: 540 }, async request => {
  await requireAdmin(request, "export.stats");

  const data = (request.data ?? {}) as { from?: unknown; to?: unknown };
  const from = typeof data.from === "string" ? data.from : "";
  const to = typeof data.to === "string" ? data.to : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new HttpsError("invalid-argument", "日期範圍不正確");
  }

  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDays(day, 1)) {
    days.push(day);
    if (days.length > 31) throw new HttpsError("invalid-argument", "一次最多補 31 天");
  }

  for (const day of days) {
    const counts = await computeDaily(day);
    await db()
      .collection("stats")
      .doc("daily")
      .collection("days")
      .doc(day)
      .set(dailyDoc(day, counts, new Date()));
  }

  return {
    days,
    // 呼叫端要把這件事講給使用者聽，不要讓補出來的 0 被當成「那天沒有人來」。
    warning: "活躍人數與平台分佈補不回來，這幾天的 dau 一律是 0"
  };
});

/* ------------------------------------------------------------------ 使用者 */

/**
 * 列表回傳的一列。
 *
 * **只有 users 文件裡就有的東西。** 設計稿的列表上還有「參與幾個任務、記過
 * 幾筆支出」，那兩個數字在 users 文件裡沒有 —— 要每一列各發兩趟查詢，一頁
 * 25 個人就是 50 趟。它們搬到詳情面板去了，那裡一次只看一個人。
 */
interface UserRow {
  uid: string;
  nickname: string;
  email: string;
  provider: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  lastPlatform: string | null;
}

const iso = (value: unknown): string | null =>
  value instanceof Timestamp ? value.toDate().toISOString() : null;

function toRow(doc: FirebaseFirestore.DocumentSnapshot): UserRow {
  return {
    uid: doc.id,
    nickname: (doc.get("nickname") as string) ?? "",
    email: (doc.get("email") as string) ?? "",
    provider: (doc.get("provider") as string) ?? "unknown",
    createdAt: iso(doc.get("createdAt")),
    lastSeenAt: iso(doc.get("lastSeenAt")),
    lastPlatform: (doc.get("lastPlatform") as string) ?? null
  };
}

/**
 * 使用者列表。
 *
 * 不寫稽核日誌 —— 列表是瀏覽，詳情才是「看了某個人的資料」。全部都記的話，
 * 日誌會被翻頁塞滿，而真正該被看見的那幾筆會沉下去。
 */
export const adminUsers = onCall({ region: REGION }, async request => {
  await requireAdmin(request, "view.user");

  const data = (request.data ?? {}) as {
    query?: unknown;
    filter?: unknown;
    cursor?: unknown;
    limit?: unknown;
  };

  const search = typeof data.query === "string" ? classifySearch(data.query) : null;
  const limit = parseLimit(data.limit);

  if (search) {
    return { rows: await searchUsers(search, limit), cursor: null, searched: true, blindSpot: null };
  }

  const filter = parseFilter(data.filter ?? "all");
  if (!filter) throw new HttpsError("invalid-argument", "不認得的篩選");

  const plan = listPlan(filter);
  let query: FirebaseFirestore.Query = db().collection("users");

  if (plan.since) {
    const at = new Date(Date.now() - plan.since.daysAgo * 86_400_000);
    query = query.where(plan.field, plan.since.compare, at);
  }

  /*
    第二排序鍵是文件 ID。少了它，同一毫秒註冊的兩個人在翻頁邊界會互相蓋掉，
    其中一個永遠出不來 —— 而種子資料與批次匯入很容易造出同一毫秒的一批人。
  */
  query = query.orderBy(plan.field, plan.direction).orderBy(FieldPath.documentId(), plan.direction);

  if (data.cursor !== undefined && data.cursor !== null) {
    const cursor = decodeCursor(data.cursor);
    // 解不開就報錯，不要默默從頭開始 —— 那會讓使用者按下一頁看到第一頁，
    // 然後以為那就是全部。
    if (!cursor) throw new HttpsError("invalid-argument", "翻頁位置不正確，請重新整理");
    query = query.startAfter(new Date(cursor.value), cursor.id);
  }

  // 多抓一筆，用來判斷還有沒有下一頁。比再發一次 count 便宜。
  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs.slice(0, limit);
  const hasMore = snap.docs.length > limit;

  const last = docs[docs.length - 1];
  const lastValue = last?.get(plan.field);

  return {
    rows: docs.map(toRow),
    cursor:
      hasMore && last && lastValue instanceof Timestamp
        ? encodeCursor({ value: lastValue.toMillis(), id: last.id })
        : null,
    searched: false,
    /*
      範圍查詢只掃有那個欄位的文件。沒有 lastSeenAt 的帳號不會出現在任何
      一個活躍篩選裡，包含「30 天沒來」—— 而那正是最該被看到的一群。
    */
    blindSpot: plan.since ? FILTER_BLIND_SPOT : null
  };
});

/**
 * 搜尋。
 *
 * Firestore 沒有全文搜尋，所以三種都是精確或前綴比對 ——
 * **搜「小美」找不到「陳小美」**。畫面上要寫清楚，不然使用者會以為
 * 那個人不存在。
 */
async function searchUsers(
  search: { kind: string; value: string },
  limit: number
): Promise<UserRow[]> {
  const users = db().collection("users");

  if (search.kind === "uid") {
    const doc = await users.doc(search.value).get();
    return doc.exists ? [toRow(doc)] : [];
  }

  if (search.kind === "email") {
    const snap = await users.where("email", "==", search.value).limit(limit).get();
    return snap.docs.map(toRow);
  }

  const snap = await users
    .orderBy("nickname")
    .startAt(search.value)
    .endAt(prefixEnd(search.value))
    .limit(limit)
    .get();
  return snap.docs.map(toRow);
}

/**
 * 單一使用者的詳情。**這裡會寫稽核日誌。**
 *
 * 日誌先寫再回資料，不是背景寫 —— 允許「看得到但沒紀錄」等於承認這份
 * 日誌可以有缺口。
 */
export const adminUser = onCall({ region: REGION }, async request => {
  const caller = await requireAdmin(request, "view.user");

  const uid = (request.data as { uid?: unknown } | undefined)?.uid;
  if (typeof uid !== "string" || !uid) throw new HttpsError("invalid-argument", "缺少 uid");

  const doc = await db().collection("users").doc(uid).get();
  if (!doc.exists) throw new HttpsError("not-found", "找不到這個帳號");

  const profile = toRow(doc);
  const memberOf = db().collection("tasks").where("memberIds", "array-contains", uid);

  const [tasksSnap, taskCount, ownedCount, expenseCount, authRecord] = await Promise.all([
    // 參與的任務只給前 10 個。完整清單不是後台要回答的問題。
    memberOf.orderBy("updatedAt", "desc").limit(10).get(),
    countOf(memberOf),
    // 「他自己建的有幾個」要獨立算。從上面那 10 筆數的話，任務超過 10 個的人
    // 會得到一個永遠不超過 10 的數字，而且看起來完全正常。
    countOf(db().collection("tasks").where("ownerId", "==", uid)),
    countOf(db().collectionGroup("expenses").where("createdBy", "==", uid)),
    /*
      停用狀態在 Firebase Auth，不在 Firestore —— 所以這裡多讀一次 Auth。
      也因為這樣，列表沒辦法用「已停用」篩選：Firestore 查詢看不到這個旗標。
    */
    getAuth()
      .getUser(uid)
      .catch(() => null)
  ]);

  const tasks = tasksSnap.docs.map(task => {
    const admins = (task.get("adminIds") as string[] | undefined) ?? [];
    return {
      id: task.id,
      name: (task.get("name") as string) ?? "",
      status: (task.get("status") as string) ?? "active",
      role: task.get("ownerId") === uid ? "owner" : admins.includes(uid) ? "admin" : "member",
      memberCount: (task.get("memberCount") as number) ?? 0,
      expenseCount: (task.get("expenseCount") as number) ?? 0,
      updatedAt: iso(task.get("updatedAt"))
    };
  });

  await writeAudit({
    action: "view.user",
    adminUid: caller.uid,
    adminEmail: caller.email,
    targetType: "user",
    targetId: uid,
    // 存當下的暱稱而不是指標：之後改名了，日誌要說得出當時看的是誰。
    targetLabel: profile.nickname || profile.email || uid,
    ip: caller.ip,
    userAgent: caller.userAgent
  });

  return {
    profile,
    disabled: authRecord?.disabled ?? null,
    lastSignInAt: authRecord?.metadata.lastSignInTime ?? null,
    counts: {
      tasks: taskCount,
      owned: ownedCount,
      expenses: expenseCount
    },
    tasks
  };
});
