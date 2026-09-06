import { describe, expect, it } from "vitest";
import { dayBounds, dayKeyOf, dayKeys, latestCompletedDay, parseRange, shiftDay } from "./range.js";

/** UTC 時間，方便直接看出台北是幾點。 */
const at = (iso: string) => new Date(iso);

describe("dayKeyOf", () => {
  it("以台北時間算是哪一天", () => {
    expect(dayKeyOf(at("2026-09-06T04:02:00Z"))).toBe("2026-09-06"); // 台北 12:02
  });

  /*
    這一條是整支模組最容易錯的地方。UTC 的 2026-09-05 17:00 在台北已經是
    9 月 6 日凌晨一點 —— 用 UTC 算日期的話，排程每天都會挑到錯的那一天，
    而且錯的方式是「少算八小時的資料」，不會噴任何錯。
  */
  it("UTC 還是前一天，台北已經跨日", () => {
    expect(dayKeyOf(at("2026-09-05T16:00:00Z"))).toBe("2026-09-06");
    expect(dayKeyOf(at("2026-09-05T15:59:00Z"))).toBe("2026-09-05");
  });
});

describe("shiftDay", () => {
  it("往前跨月", () => {
    expect(shiftDay("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("往前跨年", () => {
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("閏年的二月有 29 天", () => {
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("平年沒有", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("往後推也對", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("latestCompletedDay", () => {
  /*
    排程 04:00 算的是前一天。把今天算進去的話，儀表板每天早上都會有一個
    空洞，而折線圖會把那個洞畫成掉到 0 —— 那是最糟的一種錯：它看起來
    像一個發現。
  */
  it("最新的一天是昨天，不是今天", () => {
    expect(latestCompletedDay(at("2026-09-06T04:02:00Z"))).toBe("2026-09-05");
  });

  it("台北的月初，昨天是上個月最後一天", () => {
    expect(latestCompletedDay(at("2026-09-01T02:00:00Z"))).toBe("2026-08-31");
  });
});

describe("dayKeys", () => {
  it("7 天回七個鍵，由舊到新，最後一個是昨天", () => {
    const keys = dayKeys("7d", at("2026-09-06T04:02:00Z"));
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe("2026-08-30");
    expect(keys[6]).toBe("2026-09-05");
  });

  it("30 天與 90 天的長度對", () => {
    expect(dayKeys("30d", at("2026-09-06T04:02:00Z"))).toHaveLength(30);
    expect(dayKeys("90d", at("2026-09-06T04:02:00Z"))).toHaveLength(90);
  });

  it("跨年也是連續的", () => {
    const keys = dayKeys("7d", at("2026-01-03T04:00:00Z"));
    expect(keys).toEqual([
      "2025-12-27",
      "2025-12-28",
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02"
    ]);
  });

  it("沒有重複的鍵", () => {
    const keys = dayKeys("90d", at("2026-09-06T04:02:00Z"));
    expect(new Set(keys).size).toBe(90);
  });
});

describe("parseRange", () => {
  it("認得三個合法值", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("30d")).toBe("30d");
    expect(parseRange("90d")).toBe("90d");
  });

  /*
    不預設成 30 天：送進來一個不認得的值代表前端有 bug，默默當成 30 天
    會讓那個 bug 永遠不被發現，而使用者看到的是一份不是他選的區間。
  */
  it("其他一律回 null，不給預設值", () => {
    expect(parseRange("365d")).toBeNull();
    expect(parseRange("")).toBeNull();
    expect(parseRange(30)).toBeNull();
    expect(parseRange(null)).toBeNull();
    expect(parseRange(undefined)).toBeNull();
  });
});

describe("dayBounds", () => {
  /*
    台北的一天從 UTC 的前一天 16:00 開始。直接拿 new Date("2026-09-05") 當
    起點會少算台北時間 00:00–08:00 那八小時，而且每天都少同一段 ——
    看起來就只是「數字比預期低一點」，不會有任何症狀。
  */
  it("台北的一天在 UTC 是前一天 16:00 到當天 16:00", () => {
    const { start, end } = dayBounds("2026-09-05");
    expect(start.toISOString()).toBe("2026-09-04T16:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-05T16:00:00.000Z");
  });

  it("剛好 24 小時", () => {
    const { start, end } = dayBounds("2026-09-05");
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
  });

  it("月底接得上下個月一號", () => {
    expect(dayBounds("2026-08-31").end.toISOString()).toBe(
      dayBounds("2026-09-01").start.toISOString()
    );
  });

  it("跨年也接得上", () => {
    expect(dayBounds("2025-12-31").end.toISOString()).toBe(
      dayBounds("2026-01-01").start.toISOString()
    );
  });

  it("每一天的結束就是下一天的開始，連續 60 天不漏也不疊", () => {
    let key = "2026-07-01";
    for (let i = 0; i < 60; i++) {
      const next = shiftDay(key, 1);
      expect(dayBounds(key).end.getTime()).toBe(dayBounds(next).start.getTime());
      key = next;
    }
  });
});
