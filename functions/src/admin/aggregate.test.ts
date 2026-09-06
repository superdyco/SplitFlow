import { describe, expect, it } from "vitest";
import {
  AGGREGATE_VERSION,
  dailyDoc,
  latestDoc,
  retentionRate,
  series,
  sumRecent,
  type DailyCounts,
  type DailyDoc
} from "./aggregate.js";

const COUNTS: DailyCounts = {
  usersTotal: 1284,
  usersNew: 6,
  tasksActive: 216,
  tasksArchived: 431,
  tasksDeleted: 58,
  tasksNew: 3,
  expensesTotal: 47930,
  expensesNew: 284,
  dau: 402,
  platformWeb: 229,
  platformAndroid: 152,
  platformIos: 0,
  cohortMatured: 4,
  cohortRetained: 3
};

const COMPUTED_AT = new Date("2026-09-06T20:02:00Z");

/** 只設 date 跟要用到的欄位，其餘沿用上面那份。 */
function doc(date: string, overrides: Partial<DailyCounts> = {}): DailyDoc {
  return dailyDoc(date, { ...COUNTS, ...overrides }, COMPUTED_AT);
}

describe("dailyDoc", () => {
  it("把 count 結果攤成文件的形狀", () => {
    const d = doc("2026-09-05");
    expect(d.date).toBe("2026-09-05");
    expect(d.users).toEqual({ total: 1284, new: 6 });
    expect(d.tasks).toEqual({ active: 216, archived: 431, deleted: 58, new: 3 });
    expect(d.expenses).toEqual({ total: 47930, new: 284 });
    expect(d.platforms).toEqual({ web: 229, android: 152, ios: 0 });
    expect(d.cohort).toEqual({ matured: 4, retained: 3 });
  });

  /*
    改了「活躍」的門檻或「留存」算幾天之後，舊的那幾天是用舊定義算的。
    沒有這個欄位就分不出來，而折線圖會若無其事地把兩種定義畫成同一條線。
  */
  it("每一份都帶著彙總邏輯的版本", () => {
    expect(doc("2026-09-05").version).toBe(AGGREGATE_VERSION);
  });
});

describe("retentionRate", () => {
  it("四個到期、三個留下來是 0.75", () => {
    expect(retentionRate({ matured: 4, retained: 3 })).toBe(0.75);
  });

  /*
    0/0 是 NaN，畫面上會印成「NaN%」；先擋成 0 更糟 —— 那會在圖上畫出一條
    掉到谷底的線，而實際上那天只是沒有任何任務滿七天。
  */
  it("那天沒有任務到期時回 null，不回 0", () => {
    expect(retentionRate({ matured: 0, retained: 0 })).toBeNull();
  });
});

describe("sumRecent", () => {
  const keys = ["2026-09-03", "2026-09-04", "2026-09-05"];

  it("把區間裡的當日新增加起來", () => {
    const docs = [
      doc("2026-09-03", { usersNew: 5 }),
      doc("2026-09-04", { usersNew: 8 }),
      doc("2026-09-05", { usersNew: 6 })
    ];
    expect(sumRecent(docs, keys, d => d.users.new)).toEqual({ total: 19, missing: [] });
  });

  /*
    排程會失敗。少了 missing，某天沒跑成的結果就是「本週 +38」默默變成
    「本週 +31」—— 一個看起來完全正常、只是錯了的數字。
  */
  it("排程漏掉的那天要被指出來，不是默默少算", () => {
    const docs = [doc("2026-09-03", { usersNew: 5 }), doc("2026-09-05", { usersNew: 6 })];
    expect(sumRecent(docs, keys, d => d.users.new)).toEqual({
      total: 11,
      missing: ["2026-09-04"]
    });
  });

  it("一份都沒有的時候整段都是缺的", () => {
    expect(sumRecent([], keys, d => d.users.new)).toEqual({ total: 0, missing: keys });
  });

  it("區間外的文件不會被算進去", () => {
    const docs = [doc("2026-08-30", { usersNew: 999 }), doc("2026-09-04", { usersNew: 8 })];
    expect(sumRecent(docs, keys, d => d.users.new).total).toBe(8);
  });
});

describe("series", () => {
  const keys = ["2026-09-03", "2026-09-04", "2026-09-05"];

  /*
    把缺漏畫成 0，圖上就會出現一個插到底的 V 型，而那看起來像一次事故。
    null 讓折線在那裡斷開，斷開才是實話。
  */
  it("缺的那天是 null 不是 0", () => {
    const docs = [doc("2026-09-03", { dau: 118 }), doc("2026-09-05", { dau: 186 })];
    expect(series(docs, keys, d => d.dau)).toEqual([
      { date: "2026-09-03", value: 118 },
      { date: "2026-09-04", value: null },
      { date: "2026-09-05", value: 186 }
    ]);
  });

  it("順序照 keys 走，不照文件進來的順序", () => {
    const docs = [doc("2026-09-05", { dau: 186 }), doc("2026-09-03", { dau: 118 })];
    expect(series(docs, keys, d => d.dau).map(p => p.date)).toEqual(keys);
  });
});

describe("latestDoc", () => {
  /*
    最後一天有可能沒跑成，那時候該顯示前一天的累計值而不是空白 ——
    所以是找最新的一份，不是取陣列最後一個。
  */
  it("挑日期最新的那一份，不管進來的順序", () => {
    const docs = [doc("2026-09-04"), doc("2026-09-05"), doc("2026-09-03")];
    expect(latestDoc(docs)?.date).toBe("2026-09-05");
  });

  it("沒有文件時回 null", () => {
    expect(latestDoc([])).toBeNull();
  });
});
