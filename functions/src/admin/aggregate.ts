/**
 * 每日彙總文件的組裝與讀取。
 *
 * 儀表板上那幾個數字是全表 count。使用者一千多、支出快五萬的時候還好，再大
 * 一個數量級，「打開儀表板」就變成一次全表掃描，而且是每次打開都掃。所以
 * 排程一天算一次寫成一份文件，儀表板讀 30 份文件。
 *
 * 這個檔案只做兩件跟資料庫無關的事：把 count 結果組成文件，以及把一疊文件
 * 讀成畫面要的數字。真正的查詢在 callable 裡。
 */

/**
 * 彙總邏輯的版本。**改了定義就要加一。**
 *
 * 「活躍」的門檻、「留存」算幾天，這些一定會改。改完之後舊的那幾天是用舊
 * 定義算的 —— 沒有這個欄位就分不出來，而折線圖會若無其事地把兩種定義畫成
 * 同一條線。那種錯誤沒有任何症狀，只是結論是錯的。
 */
export const AGGREGATE_VERSION = 2;

/**
 * `lastSeenAt` 開始有完整一天資料的第一天。**這一天之前的 dau 是 null，不是 0。**
 *
 * 那個欄位 2026-09-06 下午才上線，所以 09-06 只有大半天、更早的日子根本
 * 沒有任何樣本。兩者算出來都是 0，而 0 在折線圖上是一個真的點 ——
 * 它會被讀成「那天沒有人來」，而實際上是「那天還沒有人在數」。
 *
 * 為什麼要寫死一個日期而不是「count 是 0 就當成 null」：一個真的沒有人開啟
 * 的日子也會是 0。那種日子對這個 app 幾乎不可能發生，但用「幾乎不可能」
 * 當判斷條件，就是把一個歷史事實換成一個機率假設。這個日期是事實。
 */
export const DAU_SINCE = "2026-09-07";

export interface DailyCounts {
  usersTotal: number;
  usersNew: number;
  tasksActive: number;
  tasksArchived: number;
  tasksDeleted: number;
  tasksNew: number;
  expensesTotal: number;
  expensesNew: number;
  /** 當天有寫過 lastSeenAt 的帳號數。DAU_SINCE 之前是 null —— 那時候沒有人在數。 */
  dau: number | null;
  /*
    當天最後一次開啟是在哪個平台。

    這裡**不會有「兩者都用」**，而那不是漏掉的欄位，是資料形狀決定的：
    lastPlatform 只記最後一次，同一個人同一天先開網頁再開 App，第二次就把
    第一次蓋掉了。要算得出「兩者都用」得改成每天記一個集合，而那是為了
    一個沒有人在等的數字多一份寫入。
  */
  /** 跟 dau 同進退：算不出來的日子是 null，不是三個 0。 */
  platforms: { web: number; android: number; ios: number } | null;
  /** 當天剛好滿 7 天的任務數。 */
  cohortMatured: number;
  /** 其中前 7 天記了 3 筆以上支出的。 */
  cohortRetained: number;
}

export interface DailyDoc {
  date: string;
  users: { total: number; new: number };
  tasks: { active: number; archived: number; deleted: number; new: number };
  expenses: { total: number; new: number };
  dau: number | null;
  platforms: { web: number; android: number; ios: number } | null;
  cohort: { matured: number; retained: number };
  computedAt: Date;
  version: number;
}

export function dailyDoc(date: string, counts: DailyCounts, computedAt: Date): DailyDoc {
  return {
    date,
    users: { total: counts.usersTotal, new: counts.usersNew },
    tasks: {
      active: counts.tasksActive,
      archived: counts.tasksArchived,
      deleted: counts.tasksDeleted,
      new: counts.tasksNew
    },
    expenses: { total: counts.expensesTotal, new: counts.expensesNew },
    dau: counts.dau,
    platforms: counts.platforms,
    cohort: { matured: counts.cohortMatured, retained: counts.cohortRetained },
    computedAt,
    version: AGGREGATE_VERSION
  };
}

/**
 * 留存率。**沒有到期的任務時回 null，不回 0。**
 *
 * `0 / 0` 是 NaN，畫面上會印成「NaN%」；先擋成 0 更糟 —— 那會在圖上畫出一條
 * 掉到谷底的線，而實際上那天只是沒有任何任務滿七天。「沒有資料」跟「留存是
 * 零」是兩件完全不同的事，只有 null 說得出前者。
 */
export function retentionRate(cohort: { matured: number; retained: number }): number | null {
  if (cohort.matured <= 0) return null;
  return cohort.retained / cohort.matured;
}

/**
 * 一疊彙總文件裡，某個「當日新增」欄位的加總。
 *
 * 回傳裡帶著**缺哪幾天**，因為排程會失敗。少了這個，某天沒跑成的結果就是
 * 「本週 +38」默默變成「本週 +31」—— 一個看起來完全正常、只是錯了的數字。
 * 畫面拿到 missing 不是空陣列時要說一句「資料不完整」。
 */
export function sumRecent(
  docs: DailyDoc[],
  keys: string[],
  pick: (doc: DailyDoc) => number
): { total: number; missing: string[] } {
  const byDate = new Map(docs.map(doc => [doc.date, doc]));
  let total = 0;
  const missing: string[] = [];

  for (const key of keys) {
    const doc = byDate.get(key);
    if (!doc) {
      missing.push(key);
      continue;
    }
    total += pick(doc);
  }

  return { total, missing };
}

/**
 * 折線圖要的序列。缺的那天是 `null` 而不是 0。
 *
 * 跟上面同一個道理，但後果更明顯：把缺漏畫成 0，圖上就會出現一個插到底的
 * V 型，而那看起來像一次事故。null 讓折線在那裡斷開，斷開才是實話。
 */
export function series(
  docs: DailyDoc[],
  keys: string[],
  pick: (doc: DailyDoc) => number | null
): Array<{ date: string; value: number | null }> {
  const byDate = new Map(docs.map(doc => [doc.date, doc]));
  return keys.map(date => {
    const doc = byDate.get(date);
    // 兩種 null 在圖上是同一件事：那天沒有文件，或那天的值本來就不存在。
    return { date, value: doc ? pick(doc) : null };
  });
}

/**
 * 區間裡最新一份文件的累計值 —— 儀表板上那四塊磚。
 *
 * 特地找「最新的一份」而不是取陣列最後一個：最後一天有可能沒跑成，那時候
 * 該顯示前一天的累計值，而不是空白。
 */
export function latestDoc(docs: DailyDoc[]): DailyDoc | null {
  let latest: DailyDoc | null = null;
  for (const doc of docs) {
    if (!latest || doc.date > latest.date) latest = doc;
  }
  return latest;
}
