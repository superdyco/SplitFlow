import { describe, expect, it } from "vitest";
import { MIN_SAMPLES, percentile, type PerfSample } from "./perf.js";
import {
  BUCKET_MS,
  OVERFLOW,
  bucketCeiling,
  bucketOf,
  samplesIn,
  histogramOf,
  mergeDays,
  percentileOf,
  summarizeDays,
  perfDoc,
  PERF_VERSION,
  missingDays,
  type PerfDayPage
} from "./histogram.js";

function sample(overrides: Partial<PerfSample> = {}): PerfSample {
  return { page: "tasks", total: 1000, slowest: "query", cold: false, ...overrides };
}

describe("bucketOf", () => {
  it("每 100 毫秒一桶，桶號從 0 開始", () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(99)).toBe(0);
    expect(bucketOf(100)).toBe(1);
    expect(bucketOf(250)).toBe(2);
  });

  /*
    超過上限的通通進同一個桶。60 秒以上的載入不是效能問題是壞掉了 ——
    分辨 61 秒跟 400 秒沒有意義，但把它們算進樣本數有。
  */
  it("超過上限的都進溢位桶", () => {
    expect(bucketOf(60_000)).toBe(OVERFLOW);
    expect(bucketOf(999_999)).toBe(OVERFLOW);
  });

  // 樣本是前端送上來的，壞掉的數字不該讓整份彙總噴錯。
  it("負數與 NaN 落在第 0 桶", () => {
    expect(bucketOf(-1)).toBe(0);
    expect(bucketOf(Number.NaN)).toBe(0);
  });
});

describe("bucketCeiling", () => {
  /*
    回上界不是下界。桶化一定有誤差，而誤差的方向要選 ——
    高估自己的載入時間是安全的，低估會讓一個真的在變慢的頁面看起來沒事。
  */
  it("是桶的上界，不是下界", () => {
    expect(bucketCeiling(0)).toBe(100);
    expect(bucketCeiling(9)).toBe(1000);
  });
});

describe("histogramOf", () => {
  it("冷啟動與熱啟動分開存", () => {
    const days = histogramOf([
      sample({ cold: true, total: 3000 }),
      sample({ cold: false, total: 600 })
    ]);
    expect(days[0].cold).toEqual({ "30": 1 });
    expect(days[0].warm).toEqual({ "6": 1 });
  });

  it("每一頁各自一份", () => {
    const days = histogramOf([sample({ page: "tasks" }), sample({ page: "task" })]);
    expect(days.map(d => d.page).sort()).toEqual(["task", "tasks"]);
  });

  it("同一桶的樣本累加", () => {
    const days = histogramOf([sample({ total: 1000 }), sample({ total: 1050 })]);
    expect(days[0].warm).toEqual({ "10": 2 });
  });

  it("最慢的那一段照樣計數，空字串不算一類", () => {
    const days = histogramOf([
      sample({ slowest: "query" }),
      sample({ slowest: "query" }),
      sample({ slowest: "" })
    ]);
    expect(days[0].slowest).toEqual({ query: 2 });
  });
});

describe("mergeDays", () => {
  it("同一頁跨天的桶相加", () => {
    const a: PerfDayPage = { page: "tasks", cold: { "5": 1 }, warm: { "10": 2 }, slowest: { query: 3 } };
    const b: PerfDayPage = { page: "tasks", cold: { "5": 2 }, warm: { "11": 1 }, slowest: { auth: 1 } };
    const merged = mergeDays([a, b]);
    expect(merged).toEqual([
      { page: "tasks", cold: { "5": 3 }, warm: { "10": 2, "11": 1 }, slowest: { query: 3, auth: 1 } }
    ]);
  });

  it("不同頁不會被合在一起", () => {
    const merged = mergeDays([
      { page: "tasks", cold: {}, warm: { "1": 1 }, slowest: {} },
      { page: "task", cold: {}, warm: { "1": 1 }, slowest: {} }
    ]);
    expect(merged).toHaveLength(2);
  });

  it("沒有東西可合就是空陣列", () => {
    expect(mergeDays([])).toEqual([]);
  });
});

describe("samplesIn", () => {
  it("是桶裡所有樣本的總數", () => {
    expect(samplesIn({ "1": 2, "50": 3 })).toBe(5);
  });

  it("空的是 0", () => {
    expect(samplesIn({})).toBe(0);
  });
});

describe("percentileOf", () => {
  // 回 NaN 的話畫面上會出現「NaN 秒」，那看起來像壞掉不像沒資料。
  it("空的回 0 不是 NaN", () => {
    expect(percentileOf({}, 50)).toBe(0);
  });

  /*
    這一條是整個做法成立的理由。

    百分位數不能跨天平均 —— 七個 p95 加起來除以七不是任何東西。所以存的是
    直方圖，而直方圖只有在「從桶算出來的答案跟從原始樣本算出來的一樣、
    只差一個桶寬」的時候才代表得了原始資料。這裡就是在證明那件事。
  */
  it("算出來的跟原始樣本一致，誤差不超過一個桶寬", () => {
    const totals: number[] = [];
    // 固定的偽亂數：測試不該每次跑都是不同的資料。
    let seed = 7;
    for (let i = 0; i < 500; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      totals.push(Math.floor((seed / 2147483648) * 8000));
    }

    const days = histogramOf(totals.map(total => sample({ total })));
    const buckets = days[0].warm;
    const sorted = [...totals].sort((a, b) => a - b);

    for (const p of [50, 75, 95, 99]) {
      const exact = percentile(sorted, p);
      const approx = percentileOf(buckets, p);
      expect(approx).toBeGreaterThanOrEqual(exact);
      expect(approx - exact).toBeLessThan(BUCKET_MS);
    }
  });
});

describe("summarizeDays", () => {
  function day(page: string, warm: Record<string, number>): PerfDayPage {
    return { page, cold: {}, warm, slowest: {} };
  }

  it("照樣本數由多到少", () => {
    const result = summarizeDays([day("task", { "10": 3 }), day("tasks", { "10": 5 })]);
    expect(result.map(r => r.page)).toEqual(["tasks", "task"]);
    expect(result[0].count).toBe(5);
  });

  it("冷熱各自算中位數", () => {
    const result = summarizeDays([
      { page: "tasks", cold: { "30": MIN_SAMPLES }, warm: { "6": MIN_SAMPLES }, slowest: {} }
    ]);
    expect(result[0].coldP50).toBe(bucketCeiling(30));
    expect(result[0].warmP50).toBe(bucketCeiling(6));
    expect(result[0].coldCount).toBe(MIN_SAMPLES);
  });

  /*
    三筆算出來的中位數不是統計是巧合。給 null 讓畫面說「樣本不足」，
    而不是給一個看起來很確定的數字。
  */
  it("樣本少於門檻就不給冷熱中位數", () => {
    const result = summarizeDays([
      { page: "tasks", cold: { "30": MIN_SAMPLES - 1 }, warm: {}, slowest: {} }
    ]);
    expect(result[0].coldP50).toBeNull();
    // 但總數與 p50 照算 —— 那是「這段期間發生了什麼」，不是統計推論。
    expect(result[0].count).toBe(MIN_SAMPLES - 1);
    expect(result[0].p50).toBe(bucketCeiling(30));
  });

  it("整頁的百分位數是冷熱合起來算的", () => {
    const result = summarizeDays([
      { page: "tasks", cold: { "90": 1 }, warm: { "10": 1 }, slowest: {} }
    ]);
    expect(result[0].count).toBe(2);
    expect(result[0].p50).toBe(bucketCeiling(10));
    expect(result[0].p95).toBe(bucketCeiling(90));
  });

  it("最慢的那一段照次數排", () => {
    const result = summarizeDays([
      { page: "tasks", cold: {}, warm: { "10": 3 }, slowest: { query: 2, auth: 1 } }
    ]);
    expect(result[0].slowest).toEqual([
      { phase: "query", count: 2 },
      { phase: "auth", count: 1 }
    ]);
  });

  it("完全沒有資料就是空陣列", () => {
    expect(summarizeDays([])).toEqual([]);
  });
});

describe("perfDoc", () => {
  const pages: PerfDayPage[] = [{ page: "tasks", cold: {}, warm: { "10": 1 }, slowest: {} }];

  it("帶著日期與版本 —— 桶寬改了要分得出舊文件", () => {
    const doc = perfDoc("2026-09-06", pages, new Date("2026-09-07T04:00:00Z"));
    expect(doc.date).toBe("2026-09-06");
    expect(doc.version).toBe(PERF_VERSION);
    expect(doc.pages).toEqual(pages);
  });
});

describe("missingDays", () => {
  const doc = (date: string) => perfDoc(date, [], new Date());

  /*
    排程會失敗，而少了一天的結果是「近 30 天的 p95」默默變成「近 29 天的」——
    一個看起來完全正常、只是不是你以為的那個區間的數字。畫面要說得出來。
  */
  it("列出區間裡沒有文件的那幾天", () => {
    expect(missingDays([doc("2026-09-01"), doc("2026-09-03")], [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03"
    ])).toEqual(["2026-09-02"]);
  });

  it("都齊了就是空陣列", () => {
    expect(missingDays([doc("2026-09-01")], ["2026-09-01"])).toEqual([]);
  });

  it("一份都沒有的時候整個區間都是缺的", () => {
    expect(missingDays([], ["2026-09-01", "2026-09-02"])).toHaveLength(2);
  });
});
