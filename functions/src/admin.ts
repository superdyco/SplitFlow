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
import {
  AggregateField,
  FieldPath,
  FieldValue,
  getFirestore,
  Timestamp,
  type Firestore
} from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
/*
  v1 只為了一件事：「帳號被建立」的觸發器。v2 對應的是 blocking function
  （beforeUserCreated），那要把專案升級到 Identity Platform —— 為了數人頭
  不值得。v1 的 onCreate 在建立之後才跑，擋不到任何東西，正好是這裡要的。
*/
import * as functionsV1 from "firebase-functions/v1";
import { logger } from "firebase-functions";

import { DENIED_CODE, DENIED_MESSAGE, isAdmin } from "./admin/guard.js";
import { dayBounds, dayKeyOf, dayKeys, latestCompletedDay, parseRange, TIME_ZONE } from "./admin/range.js";
import {
  auditEntry,
  disableEffectiveAt,
  parseAuditFilter,
  type AdminAction,
  type TargetType
} from "./admin/audit.js";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./admin/categories.js";
import { decodeCursor, encodeCursor, parseLimit } from "./admin/paging.js";
import { type PerfSample } from "./admin/perf.js";
import {
  BUCKET_MS,
  histogramOf,
  missingDays,
  perfDoc,
  summarizeDays,
  type PerfDayPage,
  type PerfDoc
} from "./admin/histogram.js";
import { categorySlices, parseTaskFilter } from "./admin/tasks.js";
import {
  classifySearch,
  FILTER_BLIND_SPOT,
  listPlan,
  parseFilter,
  prefixEnd
} from "./admin/users.js";
import {
  dailyDoc,
  DAU_SINCE,
  latestDoc,
  series,
  sumRecent,
  type DailyCounts,
  type DailyDoc
} from "./admin/aggregate.js";
import {
  guestKeys,
  isAnonymousRecord,
  isBinding,
  sumGuests,
  type GuestDayDoc,
  type GuestEvent
} from "./admin/guests.js";
import { GUEST_PROVIDER } from "./guestMerge.js";
import { ledgerAdjust, parseAdjust, planAdjust } from "./ai/credits.js";
import { AI_MODELS, isAllowedModel, keyTail, resolveModel } from "./ai/models.js";
import { cleanReceipt, parseOutput } from "./ai/receipt.js";
import { sumAiDays, type AiDayDoc } from "./ai/usage.js";
import { readReceiptText, SAMPLE_RECEIPT_TEXT, verifyModel } from "./ai/openai.js";
import { AI_CONFIG_PATH, forgetAiConfig, loadAiConfig } from "./ai/config.js";

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

/** 任務列表加上擁有者暱稱。任務文件裡只有 uid。 */
async function withOwners(snap: FirebaseFirestore.QuerySnapshot) {
  const rows = snap.docs.map(doc => ({
    id: doc.id,
    name: (doc.get("name") as string) ?? "",
    status: (doc.get("status") as string) ?? "active",
    ownerId: (doc.get("ownerId") as string) ?? "",
    memberCount: (doc.get("memberCount") as number) ?? 0,
    expenseCount: (doc.get("expenseCount") as number) ?? 0,
    currency: (doc.get("defaultCurrency") as string) ?? "",
    updatedAt: iso(doc.get("updatedAt"))
  }));
  const names = await nicknamesOf(rows.map(row => row.ownerId));
  return rows.map(row => ({ ...row, ownerName: names[row.ownerId] ?? "" }));
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

/* ------------------------------------------------------------------ 訪客 */

/**
 * 訪客的來去，一天一份 `stats/guests/days/{YYYY-MM-DD}`。
 *
 * **為什麼不放進每日彙總那份文件**：`aggregateDaily` 是整份 `set()` 覆寫，
 * 同一份文件裡當天記的次數會在凌晨四點被洗掉。
 *
 * **為什麼是當下記而不是事後數**：訪客登出就刪文件（見 `deleteAccount`），
 * 凌晨的排程掃 users 的時候他已經不在了 —— 當天來、當天走的人在任何事後統計
 * 裡都像沒來過。只記次數，不記是誰。
 */
async function readGuests(keys: string[]): Promise<GuestDayDoc[]> {
  const snap = await db()
    .collection("stats")
    .doc("guests")
    .collection("days")
    .where("date", ">=", keys[0])
    .where("date", "<=", keys[keys.length - 1])
    .get();

  return snap.docs.map(doc => doc.data() as GuestDayDoc);
}

/**
 * 記一次訪客事件。**不會丟例外** —— 這是旁支，記不上只是少一筆統計，
 * 不該讓使用者的刪除或合併因此失敗。
 */
export async function recordGuestEvent(event: GuestEvent, at: Date = new Date()): Promise<void> {
  const day = dayKeyOf(at);
  try {
    await db()
      .collection("stats")
      .doc("guests")
      .collection("days")
      .doc(day)
      .set({ date: day, [event]: FieldValue.increment(1) }, { merge: true });
  } catch (err) {
    logger.warn("訪客統計沒記上", { event, day, err: String(err) });
  }
}

/**
 * 有人按了「免登入立即試用」。
 *
 * 用 Auth 的觸發器而不是 users 文件：還沒取暱稱就走掉的人沒有 users 文件，
 * 而那正是最想知道有多少的一群。匿名帳號沒有任何供應商。
 */
export const onGuestCreated = functionsV1
  .region(REGION)
  .auth.user()
  .onCreate(async user => {
    if (!isAnonymousRecord(user.providerData.map(info => info.providerId))) return;
    await recordGuestEvent("started", new Date(user.metadata.creationTime));
  });

/**
 * 訪客綁定了正式帳號：前端綁定成功後會把 provider 從 anonymous 改掉。
 *
 * 每一次 users 更新都會叫醒它（包括一天一次的 lastSeenAt 戳記），所以第一行
 * 就要判斷完走人。合併不走這裡 —— 合併掉的訪客文件是被刪掉的。
 */
export const onGuestBound = onDocumentUpdated(
  { document: "users/{uid}", region: REGION },
  async event => {
    if (!isBinding(event.data?.before.get("provider"), event.data?.after.get("provider"))) return;
    await recordGuestEvent("bound");
  }
);

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
  // 訪客是當下記的，所以同樣長度、但算到今天 —— 不然今天來的人要等明天才看得到。
  const guestDays = guestKeys(keys.length, new Date());
  const tasks = db().collection("tasks");

  const [users, active, archived, deleted, expenses, daily, busiest, guestDocs] = await Promise.all([
    countOf(db().collection("users")),
    countOf(tasks.where("status", "==", "active")),
    countOf(tasks.where("status", "==", "archived")),
    countOf(tasks.where("status", "==", "deleted")),
    countOf(db().collectionGroup("expenses")),
    readDaily(keys),
    /*
      最活躍的任務。這一份**不需要每日彙總** —— expenseCount 一直都在任務
      文件上，所以排程還沒跑、資料還在累積的時候，這張表就已經有東西看了。

      濾掉已刪除的：軟刪除的任務前端一律不顯示，後台的「最活躍」也不該把
      使用者已經丟掉的東西排在第一名。
    */
    tasks
      .where("status", "in", ["active", "archived"])
      .orderBy("expenseCount", "desc")
      .limit(5)
      .get(),
    readGuests(guestDays)
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
      「建立任務後 7 天內記了 3 筆以上支出」。來自每日彙總，所以排程還沒跑
      的時候是 null —— 畫面要說「累積中」，不要顯示 0%。
    */
    cohort: latest?.cohort ?? null,
    topTasks: await withOwners(busiest),
    /*
      有幾天真的有資料。畫面拿它決定要不要畫那條線 —— 排程還沒上線時
      這裡是 0，那時候該說「累積中」，而不是畫一條貼在底部的直線。
    */
    coverage: { expected: keys.length, present: daily.length },
    guests: sumGuests(guestDocs, guestDays)
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

  const [
    usersTotal,
    usersNew,
    tasksActive,
    tasksArchived,
    tasksDeleted,
    tasksNew,
    expensesTotal,
    expensesNew
  ] = await Promise.all([
    countOf(users),
    countOf(inDay(users, "createdAt")),
    countOf(tasks.where("status", "==", "active")),
    countOf(tasks.where("status", "==", "archived")),
    countOf(tasks.where("status", "==", "deleted")),
    countOf(inDay(tasks, "createdAt")),
    countOf(expenses),
    countOf(inDay(expenses, "createdAt"))
  ]);

  /*
    活躍人數與裝置分佈只有 lastSeenAt 開始收之後才算得出來。

    之前的日子**不查也不寫 0**：那四個查詢一定回 0，而 0 在折線圖上是一個
    真的點，會被讀成「那天沒有人來」。null 才說得出「那天沒有人在數」。
    順便省掉補算舊日期時的四趟查詢。
  */
  const measured = day >= DAU_SINCE;
  const seenThatDay = (platform: string) =>
    countOf(inDay(users.where("lastPlatform", "==", platform), "lastSeenAt"));

  const [dau, platforms] = measured
    ? await Promise.all([
        countOf(inDay(users, "lastSeenAt")),
        Promise.all([seenThatDay("web"), seenThatDay("android"), seenThatDay("ios")]).then(
          ([web, android, ios]) => ({ web, android, ios })
        )
      ])
    : [null, null];

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
    platforms,
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
  /*
    timeoutSeconds 是明寫的。預設 60 秒，而這支現在多了一段「讀當天一千筆
    perf 樣本」—— 加上原本的 count 聚合與 cohort 的逐一計數，60 秒開始不夠寬。
    逾時的排程會重試，而重試也逾時的話那天就永遠沒有文件，然後那個洞會以
    「近 30 天」少一天的形式出現在畫面上。
  */
  {
    schedule: "0 4 * * *",
    timeZone: TIME_ZONE,
    region: REGION,
    retryCount: 3,
    timeoutSeconds: 300
  },
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

    const pages = await rollUpPerf(day);

    logger.info("每日彙總完成", {
      day,
      ms: Date.now() - startedAt,
      dau: counts.dau,
      perfPages: pages.length
    });
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

    /*
      效能的直方圖一起補。**這一份補得回來而且是真的** —— perf 樣本從 2026-06
      就一直在寫，只是規則寫著 allow read: if false，沒有人讀得到。它跟 dau
      不一樣，不需要任何警語。
    */
    await rollUpPerf(day);
  }

  return {
    days,
    // 呼叫端要把這件事講給使用者聽，不要讓補出來的 0 被當成「那天沒有人來」。
    /*
      補出來的 dau 是 null 不是 0（見 DAU_SINCE），所以圖上會是斷的而不是
      一條假線。這句話留著，因為呼叫端仍然該知道那幾天缺的是什麼。
    */
    warning: `${DAU_SINCE} 之前的活躍人數與平台分佈補不回來，那幾天會是空的`
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

  const creditsRef = db().collection("aiCredits").doc(uid);
  const ledgerRef = creditsRef.collection("aiLedger");

  const [tasksSnap, taskCount, ownedCount, expenseCount, authRecord, creditsSnap, aiCalls, aiReads, ledgerSnap] =
    await Promise.all([
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
      .catch(() => null),
    creditsRef.get(),
    countOf(ledgerRef.where("type", "==", "use")),
    countOf(ledgerRef.where("readResult", "==", "read")),
    // 最近 20 筆就夠回答申訴：「上禮拜那三次是不是都失敗」。
    ledgerRef.orderBy("at", "desc").limit(20).get()
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
    tasks,
    ai: {
      // null 代表還沒用過：第一次辨識時才會送 3 點，畫面要講清楚這件事。
      balance: creditsSnap.exists ? ((creditsSnap.get("balance") as number) ?? 0) : null,
      calls: aiCalls,
      reads: aiReads,
      ledger: ledgerSnap.docs.map(doc => toLedgerRow(doc, { [uid]: profile.nickname }))
    }
  };
});

/* ------------------------------------------------------------------ 稽核日誌 */

/**
 * 稽核日誌列表。
 *
 * **這一支自己不寫日誌。** 跟其他列表同一條規則（列表是瀏覽，詳情才記），
 * 但這裡還多一個理由：讀日誌會寫日誌的話，翻幾頁就把真正該被看見的那幾筆
 * 推到後面去了。
 *
 * 日誌本身在規則層對所有登入身分關閉（`allow read, write: if false`），
 * 只有這支函式讀得到 —— 包含管理者本人也不能繞過它去改。
 */
export const adminAudit = onCall({ region: REGION }, async request => {
  await requireAdmin(request, "view.report");

  const data = (request.data ?? {}) as { filter?: unknown; cursor?: unknown; limit?: unknown };

  const filter = parseAuditFilter(data.filter ?? "all");
  if (!filter) throw new HttpsError("invalid-argument", "不認得的篩選");

  const limit = parseLimit(data.limit);
  let query: FirebaseFirestore.Query = db().collection("adminLogs");

  /*
    等值過濾，不是 action 的前綴過濾。Firestore 要求範圍欄位必須是第一個
    排序欄位，用前綴的話就得照 action 排 —— 而這份日誌唯一有意義的排序
    是時間由新到舊。kind 就是為了換回這件事才存的。

    「被擋下的存取」歸在 act 裡一起看：它不是管理者做的，但跟處置一樣是
    「有人動了什麼」而不是「有人看了什麼」。
  */
  if (filter === "act") query = query.where("kind", "in", ["act", "denied"]);
  else if (filter === "view") query = query.where("kind", "==", "view");

  query = query.orderBy("at", "desc").orderBy(FieldPath.documentId(), "desc");

  if (data.cursor !== undefined && data.cursor !== null) {
    const cursor = decodeCursor(data.cursor);
    if (!cursor) throw new HttpsError("invalid-argument", "翻頁位置不正確，請重新整理");
    query = query.startAfter(new Date(cursor.value), cursor.id);
  }

  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs.slice(0, limit);
  const hasMore = snap.docs.length > limit;

  const last = docs[docs.length - 1];
  const lastAt = last?.get("at");

  return {
    rows: docs.map(doc => ({
      id: doc.id,
      at: iso(doc.get("at")),
      adminUid: (doc.get("adminUid") as string) ?? "",
      adminEmail: (doc.get("adminEmail") as string) ?? "",
      action: (doc.get("action") as string) ?? "",
      // kind 是後來才加的欄位，這之前寫進去的那幾筆沒有它 —— 直接讀會拿到
      // undefined。同一個坑 virtual 與 listed 都踩過。
      kind: (doc.get("kind") as string) ?? "view",
      targetType: (doc.get("targetType") as string) ?? "",
      targetId: (doc.get("targetId") as string) ?? "",
      targetLabel: (doc.get("targetLabel") as string) ?? "",
      reason: (doc.get("reason") as string) ?? null,
      ip: (doc.get("ip") as string) ?? "",
      result: (doc.get("result") as string) ?? "ok"
    })),
    cursor:
      hasMore && last && lastAt instanceof Timestamp
        ? encodeCursor({ value: lastAt.toMillis(), id: last.id })
        : null,
    /*
      這個月各做了幾次。放在同一支裡是因為它們是同一個問題的兩半：
      「最近發生了什麼」與「總共發生了多少」。分兩支就是兩次往返。
    */
    monthly: await monthlyCounts()
  };
});

/** 本月各類動作的次數。用 count 聚合，不是把日誌讀回來數。 */
async function monthlyCounts(): Promise<{ views: number; acts: number; denied: number }> {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), 1);
  const logs = db().collection("adminLogs");
  const of = (kind: string) =>
    countOf(logs.where("kind", "==", kind).where("at", ">=", since));

  const [views, acts, denied] = await Promise.all([of("view"), of("act"), of("denied")]);
  return { views, acts, denied };
}

/* ------------------------------------------------------------------ 任務 */

interface TaskRow {
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

function toTaskRow(doc: FirebaseFirestore.DocumentSnapshot): TaskRow {
  return {
    id: doc.id,
    name: (doc.get("name") as string) ?? "",
    status: (doc.get("status") as string) ?? "active",
    ownerId: (doc.get("ownerId") as string) ?? "",
    memberCount: (doc.get("memberCount") as number) ?? 0,
    expenseCount: (doc.get("expenseCount") as number) ?? 0,
    currency: (doc.get("defaultCurrency") as string) ?? "",
    startDate: (doc.get("startDate") as string) ?? null,
    endDate: (doc.get("endDate") as string) ?? null,
    createdAt: iso(doc.get("createdAt")),
    updatedAt: iso(doc.get("updatedAt"))
  };
}

/** 一次把一批 uid 換成暱稱。列表要顯示擁有者是誰，而任務文件裡只有 uid。 */
async function nicknamesOf(uids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(uids.filter(Boolean))];
  if (unique.length === 0) return {};

  const docs = await db().getAll(...unique.map(uid => db().collection("users").doc(uid)));
  const names: Record<string, string> = {};
  for (const doc of docs) {
    if (doc.exists) names[doc.id] = (doc.get("nickname") as string) ?? "";
  }
  return names;
}

/** 任務列表。跟使用者列表一樣不寫日誌 —— 列表是瀏覽。 */
export const adminTasks = onCall({ region: REGION }, async request => {
  await requireAdmin(request, "view.task");

  const data = (request.data ?? {}) as {
    query?: unknown;
    filter?: unknown;
    cursor?: unknown;
    limit?: unknown;
  };

  const limit = parseLimit(data.limit);
  const raw = typeof data.query === "string" ? data.query.trim() : "";

  if (raw) {
    const rows = await searchTasks(raw, limit);
    const names = await nicknamesOf(rows.map(row => row.ownerId));
    return { rows, owners: names, cursor: null, searched: true };
  }

  const filter = parseTaskFilter(data.filter ?? "active");
  if (!filter) throw new HttpsError("invalid-argument", "不認得的篩選");

  let query: FirebaseFirestore.Query = db().collection("tasks");
  if (filter !== "all") query = query.where("status", "==", filter);
  query = query.orderBy("updatedAt", "desc").orderBy(FieldPath.documentId(), "desc");

  if (data.cursor !== undefined && data.cursor !== null) {
    const cursor = decodeCursor(data.cursor);
    if (!cursor) throw new HttpsError("invalid-argument", "翻頁位置不正確，請重新整理");
    query = query.startAfter(new Date(cursor.value), cursor.id);
  }

  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs.slice(0, limit);
  const hasMore = snap.docs.length > limit;
  const rows = docs.map(toTaskRow);

  const last = docs[docs.length - 1];
  const lastAt = last?.get("updatedAt");

  return {
    rows,
    owners: await nicknamesOf(rows.map(row => row.ownerId)),
    cursor:
      hasMore && last && lastAt instanceof Timestamp
        ? encodeCursor({ value: lastAt.toMillis(), id: last.id })
        : null,
    searched: false
  };
});

/**
 * 任務搜尋。
 *
 * 跟使用者那邊同一個限制：Firestore 沒有全文搜尋，所以是**名稱前綴**或
 * 完整 ID。搜「曼谷」找得到「曼谷五日」，搜「五日」找不到。
 */
async function searchTasks(raw: string, limit: number): Promise<TaskRow[]> {
  const tasks = db().collection("tasks");

  // 任務 ID 是 Firestore 自動產生的 20 字元。長度對得上就當成 ID 先試一次。
  if (/^[A-Za-z0-9]{20}$/.test(raw)) {
    const doc = await tasks.doc(raw).get();
    if (doc.exists) return [toTaskRow(doc)];
  }

  const snap = await tasks.orderBy("name").startAt(raw).endAt(prefixEnd(raw)).limit(limit).get();
  return snap.docs.map(toTaskRow);
}

/**
 * 任務詳情。**這裡會寫稽核日誌。**
 *
 * 金額是後端加總完才回傳的 —— **單筆支出的文件不離開伺服器**。這不是「前端
 * 不顯示」，是 callable 根本不回；前者只要有人開 DevTools 就破功了。
 */
export const adminTask = onCall({ region: REGION }, async request => {
  const caller = await requireAdmin(request, "view.task");

  const taskId = (request.data as { taskId?: unknown } | undefined)?.taskId;
  if (typeof taskId !== "string" || !taskId) {
    throw new HttpsError("invalid-argument", "缺少 taskId");
  }

  const taskDoc = await db().collection("tasks").doc(taskId).get();
  if (!taskDoc.exists) throw new HttpsError("not-found", "找不到這個任務");

  const task = toTaskRow(taskDoc);
  const expenses = taskDoc.ref.collection("expenses");

  const [membersSnap, totals, unconverted, receipts, owners] = await Promise.all([
    taskDoc.ref.collection("members").limit(50).get(),
    /*
      各分類的加總。sum 聚合跟 count 一樣是伺服器算完才回一個數字，
      支出文件本身不會被讀出來 —— 隱私邊界靠的就是這件事。
    */
    Promise.all(
      EXPENSE_CATEGORIES.map(category =>
        expenses
          .where("category", "==", category)
          .aggregate({ total: AggregateField.sum("baseAmount") })
          .get()
          .then(snap => [category, (snap.data().total as number) ?? 0] as const)
      )
    ),
    /*
      沒有換算過的舊資料。`baseAmount` 是後來才加的欄位，之前的支出是 null，
      而 sum 聚合會直接跳過非數值 —— 也就是總額會少算，而且不會有任何症狀。
      算出來讓畫面說得出「總額不含這 N 筆」。
    */
    countOf(expenses.where("baseAmount", "==", null)),
    countOf(expenses.where("receipt", "!=", null)),
    nicknamesOf([task.ownerId])
  ]);

  const amounts = Object.fromEntries(totals) as Record<ExpenseCategory, number>;
  const total = totals.reduce((sum, [, value]) => sum + value, 0);

  const members = membersSnap.docs.map(doc => ({
    uid: doc.id,
    nickname: (doc.get("nickname") as string) ?? "",
    role: (doc.get("role") as string) ?? "member",
    virtual: doc.get("virtual") === true,
    active: doc.get("active") !== false
  }));

  await writeAudit({
    action: "view.task",
    adminUid: caller.uid,
    adminEmail: caller.email,
    targetType: "task",
    targetId: taskId,
    targetLabel: task.name || taskId,
    ip: caller.ip,
    userAgent: caller.userAgent
  });

  return {
    task,
    ownerName: owners[task.ownerId] ?? "",
    members,
    money: {
      total,
      currency: task.currency,
      /* 每人平均。成員數是 0 的話回 null 而不是 0 —— 那是不可能發生的資料，
         但除以 0 得到的 Infinity 會被印在畫面上。 */
      perMember: task.memberCount > 0 ? Math.round(total / task.memberCount) : null,
      categories: categorySlices(amounts, EXPENSE_CATEGORIES),
      unconverted
    },
    /*
      收據只給張數。管理者看不到照片，連縮圖都沒有 —— 這個數字存在的意義
      正是讓那條線看得見：我們數得出來，但不給看。
    */
    receiptCount: receipts
  };
});

/* ------------------------------------------------------------------ 三個處置 */

/**
 * 通知被處置的人。
 *
 * 為什麼不跟 `onExpenseCreated` 共用發送邏輯：那一段是多人、要分批、還要
 * 清死 token，而且**沒有測試**。為了省下這裡的二十幾行去動它，換來的是
 * 「使用者每天在用的那個通知」有可能壞掉。這裡只送給一個人，簡單得多。
 *
 * 跟那邊一樣的原則：**寧可不推播，也不要讓例外冒出去。** 處置本身已經做完
 * 也寫進日誌了，通知沒送到不該讓整支函式失敗 —— 那會讓管理者以為處置沒生效
 * 而再按一次。
 */
async function notifyUser(uid: string, title: string, body: string): Promise<void> {
  try {
    const snap = await db().collection(`users/${uid}/tokens`).get();
    const tokens = snap.docs.map(doc => doc.id);
    if (tokens.length === 0) return;

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body }
    });

    // 死 token 不清會一直累積，每次都白送一次。
    const stale = response.responses
      .map((result, index) => {
        const code = result.error?.code;
        return !result.success &&
          (code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token")
          ? tokens[index]
          : null;
      })
      .filter((token): token is string => token !== null);

    await Promise.all(stale.map(token => db().doc(`users/${uid}/tokens/${token}`).delete()));
  } catch (err) {
    logger.warn("處置通知送不出去", { uid, err: String(err) });
  }
}

interface ActionOutcome {
  /** 寫進日誌的對象名稱。取當下的名字，之後改名了日誌才說得出當時動的是誰。 */
  label: string;
  /** 要通知誰。null 代表這次處置沒有明確的當事人。 */
  notify: { uid: string; title: string; body: string } | null;
  /** 回給前端的額外資訊，例如停用的生效時間。 */
  extra?: Record<string, unknown>;
}

/**
 * 三個處置共用的骨架。
 *
 * 抽出來不是為了少打字，是為了讓「驗身分 → 檢查理由 → 做事 → 寫日誌 →
 * 通知」這個順序**不可能被漏掉一步**。三支各寫一份的話，漏掉的那一份不會
 * 噴錯，只會安靜地留下一個沒有紀錄的處置。
 *
 * 理由的檢查在 `writeAudit` 裡（`auditEntry` 對 `act.*` 強制要求），所以
 * 一支處置就算忘了驗理由，也會在寫日誌那一步被擋下來 —— 而且是在做完事
 * 之前。順序是刻意的。
 */
async function adminAction(
  request: CallableRequest,
  action: AdminAction,
  targetType: TargetType,
  targetId: string,
  run: () => Promise<ActionOutcome>
): Promise<Record<string, unknown>> {
  const caller = await requireAdmin(request, action);
  const reason = (request.data as { reason?: unknown } | undefined)?.reason;

  /*
    先驗理由再動手。auditEntry 是純函式，這裡先跑一次拿它的判斷 ——
    不先驗的話，理由沒填的情況會是「事情做完了、日誌寫不進去」，
    那正是最不該發生的組合。
  */
  const dryRun = auditEntry({
    action,
    adminUid: caller.uid,
    adminEmail: caller.email,
    targetType,
    targetId,
    targetLabel: "",
    reason,
    ip: caller.ip,
    userAgent: caller.userAgent,
    at: new Date()
  });
  if (!dryRun.ok) {
    throw new HttpsError(
      "invalid-argument",
      dryRun.problem === "reason-too-long" ? "理由太長了" : "這個動作需要填寫理由"
    );
  }

  const outcome = await run();

  await writeAudit({
    action,
    adminUid: caller.uid,
    adminEmail: caller.email,
    targetType,
    targetId,
    targetLabel: outcome.label,
    reason,
    ip: caller.ip,
    userAgent: caller.userAgent
  });

  if (outcome.notify) {
    await notifyUser(outcome.notify.uid, outcome.notify.title, outcome.notify.body);
  }

  return { ok: true, ...(outcome.extra ?? {}) };
}

/**
 * 撤下公開報告。
 *
 * 連結失效、從探索頁移除。**任務本身、支出與分攤完全不動**，成員照常使用。
 * 發布者可以修好之後自己重新分享 —— 這不是永久封鎖。
 */
export const adminRevokeReport = onCall({ region: REGION }, async request => {
  const data = (request.data ?? {}) as { taskId?: unknown; reportId?: unknown };
  const { taskId, reportId } = data;
  if (typeof taskId !== "string" || typeof reportId !== "string" || !taskId || !reportId) {
    throw new HttpsError("invalid-argument", "缺少報告位置");
  }

  return adminAction(request, "act.revokeReport", "report", `${taskId}/${reportId}`, async () => {
    const ref = db().collection("tasks").doc(taskId).collection("reports").doc(reportId);
    const doc = await ref.get();
    if (!doc.exists) throw new HttpsError("not-found", "找不到這份報告");

    await ref.update({ active: false, listed: false, updatedAt: new Date() });

    const task = await db().collection("tasks").doc(taskId).get();
    const name = (task.get("name") as string) ?? taskId;
    const ownerId = (task.get("ownerId") as string) ?? "";

    return {
      label: name,
      notify: ownerId
        ? {
            uid: ownerId,
            title: "旅費報告已停止分享",
            body: `「${name}」的公開報告被平台撤下。修正後可以重新分享。`
          }
        : null
    };
  });
});

/**
 * 停用帳號。
 *
 * **不是立刻生效。** `disabled` 擋的是換發新憑證，對方手上那張 ID token 最長
 * 還能用 1 小時，這段時間他仍然讀得到、也寫得進他已加入的任務。
 * `revokeRefreshTokens` 救不了這一小時 —— 它作廢的是 refresh token，不是
 * 已經發出去的 ID token。
 *
 * 回傳 `effectiveAt` 讓對話框說得出確切幾點，而不是一句會被忽略的「可能有
 * 延遲」。這個限制被接受了，但不能只活在文件裡。
 */
export const adminDisableUser = onCall({ region: REGION }, async request => {
  const uid = (request.data as { uid?: unknown } | undefined)?.uid;
  if (typeof uid !== "string" || !uid) throw new HttpsError("invalid-argument", "缺少 uid");

  return adminAction(request, "act.disableUser", "user", uid, async () => {
    const doc = await db().collection("users").doc(uid).get();
    if (!doc.exists) throw new HttpsError("not-found", "找不到這個帳號");

    const at = new Date();
    await getAuth().updateUser(uid, { disabled: true });
    await getAuth().revokeRefreshTokens(uid);

    const nickname = (doc.get("nickname") as string) ?? "";

    return {
      label: nickname || (doc.get("email") as string) || uid,
      /*
        停用的人收不到什麼好處，但他該知道發生了什麼、以及可以找誰。
        通知在停用之後才送 —— token 還在，這一則送得出去。
      */
      notify: {
        uid,
        title: "帳號已被停用",
        body: "你的帳號已被平台停用，暫時無法登入。已記錄的帳目都還在。"
      },
      extra: { effectiveAt: disableEffectiveAt(at).toISOString() }
    };
  });
});

/**
 * 強制封存任務。
 *
 * 封存後成員仍查得到帳，但不能再新增或修改。**擁有者可以自己解除封存** ——
 * 規則裡的 `changesStatusAsOwner` 刻意不檢查任務是否還在進行中，就是為了
 * 留這條路。
 */
export const adminArchiveTask = onCall({ region: REGION }, async request => {
  const taskId = (request.data as { taskId?: unknown } | undefined)?.taskId;
  if (typeof taskId !== "string" || !taskId) {
    throw new HttpsError("invalid-argument", "缺少 taskId");
  }

  return adminAction(request, "act.archiveTask", "task", taskId, async () => {
    const ref = db().collection("tasks").doc(taskId);
    const doc = await ref.get();
    if (!doc.exists) throw new HttpsError("not-found", "找不到這個任務");
    if (doc.get("status") === "archived") {
      throw new HttpsError("failed-precondition", "這個任務已經是封存狀態");
    }

    await ref.update({ status: "archived", updatedAt: new Date() });

    const name = (doc.get("name") as string) ?? taskId;
    const ownerId = (doc.get("ownerId") as string) ?? "";

    return {
      label: name,
      notify: ownerId
        ? {
            uid: ownerId,
            title: "任務已被封存",
            body: `「${name}」被平台封存，帳目仍可查詢。你可以自己解除封存。`
          }
        : null
    };
  });
});

/* ------------------------------------------------------------------ 公開報告 */

/**
 * 公開報告的篩選。
 *
 * **沒有「被檢舉」這一項。** 設計稿上有，但 app 裡沒有任何地方讓使用者檢舉
 * 報告 —— 那要先做一個面向使用者的功能（按鈕、理由、寫進哪裡、誰看得到），
 * 不是後台加一個篩選就有的。畫成一個查不到東西的分頁，比沒有更糟。
 *
 * 換成資料答得出來的三個：出現在探索頁的、只給連結的、已撤下的。
 * `active` 與 `listed` 是兩件事 —— 前者是「拿到連結的人看不看得到」，
 * 後者是「陌生人找不找得到」。
 */
type ReportFilter = "listed" | "linked" | "revoked" | "all";

function parseReportFilter(value: unknown): ReportFilter | null {
  return value === "listed" || value === "linked" || value === "revoked" || value === "all"
    ? value
    : null;
}

export const adminReports = onCall({ region: REGION }, async request => {
  await requireAdmin(request, "view.report");

  const data = (request.data ?? {}) as { filter?: unknown; cursor?: unknown; limit?: unknown };
  const filter = parseReportFilter(data.filter ?? "listed");
  if (!filter) throw new HttpsError("invalid-argument", "不認得的篩選");

  const limit = parseLimit(data.limit);
  let query: FirebaseFirestore.Query = db().collectionGroup("reports");

  if (filter === "listed") query = query.where("active", "==", true).where("listed", "==", true);
  else if (filter === "linked") {
    query = query.where("active", "==", true).where("listed", "==", false);
  } else if (filter === "revoked") query = query.where("active", "==", false);

  query = query.orderBy("updatedAt", "desc").orderBy(FieldPath.documentId(), "desc");

  if (data.cursor !== undefined && data.cursor !== null) {
    const cursor = decodeCursor(data.cursor);
    if (!cursor) throw new HttpsError("invalid-argument", "翻頁位置不正確，請重新整理");
    query = query.startAfter(new Date(cursor.value), cursor.id);
  }

  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs.slice(0, limit);
  const hasMore = snap.docs.length > limit;

  const rows = docs.map(doc => ({
    // 報告文件裡沒有 taskId —— 它是子集合，所以從路徑拿。
    taskId: doc.ref.parent.parent?.id ?? "",
    reportId: doc.id,
    taskName: (doc.get("taskName") as string) ?? "",
    currency: (doc.get("currency") as string) ?? "",
    total: (doc.get("total") as number) ?? 0,
    days: (doc.get("days") as number) ?? null,
    memberCount: (doc.get("memberCount") as number) ?? 0,
    expenseCount: (doc.get("expenseCount") as number) ?? 0,
    active: doc.get("active") === true,
    // 這個功能之前產生的報告沒有 listed 欄位，補成 false —— 沒有人被迫在
    // 不知情的狀況下公開自己的旅程。規則那邊是同一個預設值。
    listed: doc.get("listed") === true,
    hasMap: !!doc.get("mapPath"),
    createdAt: iso(doc.get("createdAt")),
    updatedAt: iso(doc.get("updatedAt"))
  }));

  const last = docs[docs.length - 1];
  const lastAt = last?.get("updatedAt");

  return {
    rows,
    owners: await ownersOfTasks(rows.map(row => row.taskId)),
    cursor:
      hasMore && last && lastAt instanceof Timestamp
        ? encodeCursor({ value: lastAt.toMillis(), id: last.id })
        : null
  };
});

/** taskId → 擁有者暱稱。報告文件裡沒有人的資訊（那是刻意的），要從任務繞一圈。 */
async function ownersOfTasks(taskIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(taskIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const tasks = await db().getAll(...unique.map(id => db().collection("tasks").doc(id)));
  const ownerIds = tasks.map(task => (task.get("ownerId") as string) ?? "");
  const names = await nicknamesOf(ownerIds);

  const out: Record<string, string> = {};
  tasks.forEach((task, index) => {
    out[task.id] = names[ownerIds[index]] ?? "";
  });
  return out;
}

/* ------------------------------------------------------------------ 系統健康 */

/**
 * 讀某一天的原始效能樣本。
 *
 * `mode == "prod"` 是必要的：dev 的數字跑在開發者的筆電上、vite 不打包，
 * 混進來會讓中位數變好看而且是假的。樣本自己就有這個欄位，濾掉就好。
 *
 * 只有排程與補算會走這裡 —— 一天大概一千筆，讀得動。畫面走的是彙總。
 */
async function readSamples(day: string): Promise<PerfSample[]> {
  const snap = await db()
    .collection("perf")
    .where("mode", "==", "prod")
    .where("day", "==", day)
    .get();

  return snap.docs.map(doc => ({
    page: (doc.get("page") as string) ?? "",
    total: (doc.get("total") as number) ?? 0,
    slowest: (doc.get("slowest") as string) ?? "",
    // detail.cold 是路由守衛寫的：這個文件第一次進這一頁才是 true。
    cold: doc.get("detail.cold") === true
  }));
}

/**
 * 把一天的樣本壓成直方圖存起來。
 *
 * **這是「更長的區間」能成立的那一步。** 原始樣本一天約一千筆，讀七天就是
 * 一支 callable 的極限；三十天三萬筆讀不動。但一天的分佈壓成稀疏的桶只有
 * 幾百個數字，讀九十份是九十次文件讀取 —— 這個量級跟區間長度幾乎無關。
 *
 * 文件 ID 就是日期，所以重跑同一天是覆蓋而不是長出第二筆。排程重試、
 * 手動補算都靠這個性質。
 *
 * **匯出是給 `scripts/backfill-perf.mjs` 用的。** 那支腳本要補的是同一件事，
 * 而「濾掉 dev 樣本」跟「cold 讀的是 detail.cold」這兩個細節一旦有第二份
 * 實作就會慢慢走鐘 —— 走鐘的結果是兩批文件用不同的定義算出來，混在一起算
 * 百分位數，而那不會噴錯只是錯的。同一個行為只留一份。
 */
export async function rollUpPerf(day: string): Promise<PerfDayPage[]> {
  const pages = histogramOf(await readSamples(day));

  await db()
    .collection("stats")
    .doc("perf")
    .collection("days")
    .doc(day)
    .set(perfDoc(day, pages, new Date()));

  return pages;
}

/** 區間裡的每日直方圖。缺的那幾天由 `missingDays` 認出來。 */
async function readPerfDays(keys: string[]): Promise<PerfDoc[]> {
  const snap = await db()
    .collection("stats")
    .doc("perf")
    .collection("days")
    .where("date", ">=", keys[0])
    .where("date", "<=", keys[keys.length - 1])
    .get();

  return snap.docs.map(doc => doc.data() as PerfDoc);
}

/**
 * 系統健康。
 *
 * **只有效能這一半。** 設計稿上還有一張 Cloud Functions 的呼叫數與失敗率表，
 * 那份資料 Firestore 裡沒有 —— 它在 Cloud Monitoring。要嘛接 Monitoring API
 * （多一組相依，還要給 runtime 的 service account monitoring.viewer），要嘛
 * 每支函式自己 increment 一份計數。後者看起來比較省事其實是錯的：函式掛掉
 * 或逾時的時候那行 increment 根本跑不到，而那正是「失敗率」最該抓到的東西。
 * 一個永遠漏掉最嚴重那類失敗的失敗率，比沒有更容易讓人做出錯誤結論。
 */
export const adminHealth = onCall({ region: REGION }, async request => {
  await requireAdmin(request, "export.stats");

  /*
    區間讀的是每日彙總，不是原始樣本。

    以前這裡寫死七天，理由是「三十天三萬筆讀不動」—— 那是對的，但解法不是
    不給選，而是先把每天的分佈壓成直方圖。現在排程一天寫一份，讀九十天就是
    九十次文件讀取。

    預設七天而不是三十天：這一頁的用途是「現在有沒有變慢」，而不是趨勢。
    但送進來一個不認得的值要噴錯 —— 那代表前端有 bug，默默當成七天會讓那個
    bug 永遠不被發現。
  */
  const range = parseRange((request.data as { range?: unknown } | undefined)?.range ?? "7d");
  if (!range) throw new HttpsError("invalid-argument", "不認得的時間區間");

  const keys = dayKeys(range, new Date());
  const docs = await readPerfDays(keys);
  const summaries = summarizeDays(docs.flatMap(doc => doc.pages ?? []));

  return {
    range,
    days: { from: keys[0], to: keys[keys.length - 1] },
    pages: summaries,
    total: summaries.reduce((sum, page) => sum + page.count, 0),
    /*
      少了一天的後果是「近 30 天的 p95」默默變成「近 29 天的」—— 一個看起來
      完全正常、只是不是你以為的那個區間的數字。畫面要說得出來。
    */
    missingDays: missingDays(docs, keys),
    /*
      數字是從桶算出來的，所以有一個桶寬的誤差，而且方向固定是高估。
      畫面要標出來 —— 一個看起來精確到毫秒的數字，如果實際上不是，那個
      精確度本身就是誤導。
    */
    bucketMs: BUCKET_MS,
    /*
      這一頁少了什麼，由後端說。前端寫死一句「Functions 資料還沒有」的話，
      等它做好了那句話會留在畫面上沒人記得拿掉。
    */
    missing: [
      "Cloud Functions 的呼叫數與失敗率還沒接 —— 那份資料在 Cloud Monitoring，不在 Firestore。"
    ]
  };
});

/* ------------------------------------------------------------------ AI */

interface AiLedgerRow {
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

function toLedgerRow(doc: FirebaseFirestore.DocumentSnapshot, names: Record<string, string>): AiLedgerRow {
  const uid = (doc.get("uid") as string) ?? "";
  return {
    id: doc.id,
    uid,
    nickname: names[uid] ?? "",
    type: (doc.get("type") as string) ?? "",
    delta: (doc.get("delta") as number) ?? 0,
    balanceAfter: (doc.get("balanceAfter") as number) ?? 0,
    at: iso(doc.get("at")),
    readResult: (doc.get("readResult") as string) ?? null,
    model: (doc.get("model") as string) ?? null,
    inputTokens: (doc.get("inputTokens") as number) ?? null,
    outputTokens: (doc.get("outputTokens") as number) ?? null,
    adminEmail: (doc.get("adminEmail") as string) ?? null,
    reason: (doc.get("reason") as string) ?? null
  };
}

const AI_CONFIG_LABEL = "AI 設定";

/**
 * AI 設定頁的狀態。**不回完整金鑰**，只有末四碼。
 *
 * 打開這一頁寫一筆 view.ai：這一頁看得到全站的使用紀錄（誰在什麼時候用了幾次），
 * 跟看某個使用者的詳情同一類。
 */
export const adminAiConfig = onCall({ region: REGION }, async request => {
  const caller = await requireAdmin(request, "view.ai");
  const config = await loadAiConfig(db(), { fresh: true });

  await writeAudit({
    action: "view.ai",
    adminUid: caller.uid,
    adminEmail: caller.email,
    targetType: "config",
    targetId: "ai",
    targetLabel: AI_CONFIG_LABEL,
    ip: caller.ip,
    userAgent: caller.userAgent
  });

  return {
    configured: config !== null,
    keyTail: config?.keyTail ?? "",
    model: resolveModel(config?.model),
    models: AI_MODELS,
    updatedAt: config?.updatedAt ? config.updatedAt.toISOString() : null,
    updatedBy: config?.updatedBy ?? ""
  };
});

/**
 * 換金鑰或模型。**先驗再存**：貼錯一個字就讓全站辨識停擺，是最容易發生的事故。
 *
 * 金鑰留空代表只換模型，沿用舊金鑰。
 */
export const adminSetAiConfig = onCall({ region: REGION }, async request => {
  const data = (request.data ?? {}) as { apiKey?: unknown; model?: unknown };
  const typed = typeof data.apiKey === "string" ? data.apiKey.trim() : "";
  if (!isAllowedModel(data.model)) throw new HttpsError("invalid-argument", "不在清單上的模型");
  const model = data.model;

  return adminAction(request, "act.setAiConfig", "config", "ai", async () => {
    const current = await loadAiConfig(db(), { fresh: true });
    const apiKey = typed || current?.apiKey || "";
    if (!apiKey) throw new HttpsError("invalid-argument", "請貼上 OpenAI 的 API 金鑰");

    const problem = await verifyModel(apiKey, model);
    if (problem) throw new HttpsError("failed-precondition", `${problem}，設定沒有存。`);

    const tail = keyTail(apiKey);
    await db()
      .doc(AI_CONFIG_PATH)
      .set({
        apiKey,
        model,
        keyTail: tail,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: (request.auth?.token.email as string | undefined) ?? request.auth?.uid ?? ""
      });
    // 只清得到這個 instance 的快取；其他 instance 最慢一分鐘後自己過期。
    forgetAiConfig();

    return { label: AI_CONFIG_LABEL, notify: null, extra: { keyTail: tail, model } };
  });
});

/**
 * 用現在的設定實際跑一次。只有真的呼叫才抓得到「帳戶沒錢」。
 *
 * 用一段收據文字而不是照片（見計畫的「與 spec 的差異」）。不扣任何人的點數、
 * 不寫點數紀錄、不進用量統計 —— 這是管理者在檢查設定，不是有人在用。
 */
export const adminTestAiConfig = onCall({ region: REGION, timeoutSeconds: 60 }, async request => {
  await requireAdmin(request, "view.ai");
  const config = await loadAiConfig(db(), { fresh: true });
  if (!config) throw new HttpsError("failed-precondition", "還沒有設定金鑰");

  const model = resolveModel(config.model);
  const started = Date.now();
  try {
    const output = await readReceiptText({ apiKey: config.apiKey, model, text: SAMPLE_RECEIPT_TEXT });
    const cleaned = cleanReceipt(parseOutput(output.text));
    return {
      ok: true,
      model,
      readResult: cleaned.readResult,
      fields: cleaned.fields,
      inputTokens: output.inputTokens ?? null,
      outputTokens: output.outputTokens ?? null,
      ms: Date.now() - started
    };
  } catch (err) {
    return { ok: false, model, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
  }
});

type AiLedgerFilter = "all" | "use" | "adjust" | "free";

function parseLedgerFilter(value: unknown): AiLedgerFilter | null {
  return value === "all" || value === "use" || value === "adjust" || value === "free" ? value : null;
}

/**
 * 用量摘要＋跨所有使用者的點數紀錄。**不寫日誌**：打開頁面時 adminAiConfig
 * 已經記過一筆，翻頁也記的話日誌會被這一頁淹掉。
 *
 * 游標的第二個值存**完整路徑**：collection group 查詢用文件 ID 排序時，
 * startAfter 要的是路徑，只給 ID 會被拒絕。
 */
export const adminAiUsage = onCall({ region: REGION }, async request => {
  await requireAdmin(request, "view.ai");

  const data = (request.data ?? {}) as { range?: unknown; type?: unknown; cursor?: unknown; limit?: unknown };
  const range = parseRange(data.range ?? "30d");
  if (!range) throw new HttpsError("invalid-argument", "不認得的區間");
  const filter = parseLedgerFilter(data.type ?? "all");
  if (!filter) throw new HttpsError("invalid-argument", "不認得的篩選");

  // 跟訪客統計一樣算到今天：這些是當下記的，不用等凌晨的排程。
  const now = new Date();
  const keys = guestKeys(dayKeys(range, now).length, now);
  const daysSnap = await db()
    .collection("stats")
    .doc("ai")
    .collection("days")
    .where("date", ">=", keys[0])
    .where("date", "<=", keys[keys.length - 1])
    .get();
  const summary = sumAiDays(daysSnap.docs.map(doc => doc.data() as AiDayDoc), keys);

  const limit = parseLimit(data.limit);
  let query: FirebaseFirestore.Query = db().collectionGroup("aiLedger");
  if (filter !== "all") query = query.where("type", "==", filter);
  query = query.orderBy("at", "desc").orderBy(FieldPath.documentId(), "desc");

  if (data.cursor !== undefined && data.cursor !== null) {
    const cursor = decodeCursor(data.cursor);
    if (!cursor) throw new HttpsError("invalid-argument", "翻頁位置不正確，請重新整理");
    query = query.startAfter(new Date(cursor.value), cursor.id);
  }

  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs.slice(0, limit);
  const hasMore = snap.docs.length > limit;
  const names = await nicknamesOf(docs.map(doc => (doc.get("uid") as string) ?? ""));

  const last = docs[docs.length - 1];
  const lastAt = last?.get("at");

  return {
    range,
    days: { from: keys[0], to: keys[keys.length - 1] },
    totals: summary.totals,
    recordedDays: summary.recordedDays,
    rows: docs.map(doc => toLedgerRow(doc, names)),
    cursor:
      hasMore && last && lastAt instanceof Timestamp
        ? encodeCursor({ value: lastAt.toMillis(), id: last.ref.path })
        : null
  };
});

/**
 * 調整某個人的點數。申訴的補償就是走這裡。
 *
 * 減到 0 為止，紀錄寫實際扣掉的量。訪客不能調 —— 訪客本來就不能用，調了只會
 * 讓人以為壞了。還沒用過的人：輸入幾點就是幾點，之後不會再送免費 3 點。
 */
export const adminAdjustCredits = onCall({ region: REGION }, async request => {
  const data = (request.data ?? {}) as { uid?: unknown; delta?: unknown; reason?: unknown };
  const uid = data.uid;
  if (typeof uid !== "string" || !uid) throw new HttpsError("invalid-argument", "缺少 uid");
  const delta = parseAdjust(data.delta);
  if (delta === null) throw new HttpsError("invalid-argument", "調整的點數要是 −100 到 +100 之間、不能是 0");

  return adminAction(request, "act.adjustCredits", "user", uid, async () => {
    const user = await db().collection("users").doc(uid).get();
    if (!user.exists) throw new HttpsError("not-found", "找不到這個帳號");
    if (user.get("provider") === GUEST_PROVIDER) {
      throw new HttpsError("failed-precondition", "訪客不能調整點數 —— 訪客本來就不能用 AI 辨識");
    }

    const creditsRef = db().collection("aiCredits").doc(uid);
    const reason = typeof data.reason === "string" ? data.reason.trim() : "";
    const result = await db().runTransaction(async tx => {
      const snap = await tx.get(creditsRef);
      const plan = planAdjust(snap.exists ? (snap.data() ?? {}) : null, delta);
      tx.set(
        creditsRef,
        { balance: plan.balanceAfter, freeGranted: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.set(
        creditsRef.collection("aiLedger").doc(),
        ledgerAdjust({
          uid,
          at: new Date(),
          delta: plan.delta,
          balanceAfter: plan.balanceAfter,
          adminUid: request.auth?.uid ?? "",
          adminEmail: (request.auth?.token.email as string | undefined) ?? "",
          reason
        })
      );
      return plan;
    });

    const nickname = (user.get("nickname") as string) ?? "";
    return {
      label: nickname || (user.get("email") as string) || uid,
      notify: null,
      extra: { balance: result.balanceAfter, delta: result.delta }
    };
  });
});
