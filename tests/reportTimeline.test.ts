import { describe, expect, it } from "vitest";
import { reportTimeline } from "@/utils/reportTimeline";
import type { Expense } from "@/types/expense";

/** 模擬 Firestore Timestamp：只要有 toDate 就夠了。 */
function at(day: number, hour = 12): Expense["createdAt"] {
  const value = new Date(2026, 2, day, hour);
  return { toDate: () => value } as Expense["createdAt"];
}

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "e1",
    title: "晚餐",
    category: "food",
    amount: 10000,
    currency: "TWD",
    rate: 1,
    baseAmount: 10000,
    paidBy: "u1",
    splitMode: "even",
    splits: { u1: 10000 },
    place: null,
    receipt: null,
    note: "",
    date: "2026-03-01",
    time: "",
    createdBy: "u1",
    createdAt: at(1),
    ...overrides
  } as Expense;
}

describe("reportTimeline", () => {
  it("一天一段，日期由早到晚", () => {
    const result = reportTimeline(
      [expense({ date: "2026-03-03" }), expense({ date: "2026-03-01" })],
      "TWD"
    );
    expect(result.map(day => day.date)).toEqual(["2026-03-01", "2026-03-03"]);
  });

  it("同一天照時間由早到晚排", () => {
    const result = reportTimeline(
      [
        expense({ id: "dinner", time: "19:30" }),
        expense({ id: "breakfast", time: "08:00" }),
        expense({ id: "lunch", time: "12:15" })
      ],
      "TWD"
    );
    expect(result[0].entries.map(entry => entry.time)).toEqual(["08:00", "12:15", "19:30"]);
  });

  it("沒記時間的排在當天最後，不會被猜到中間去", () => {
    const result = reportTimeline(
      [expense({ id: "unknown" }), expense({ id: "dinner", time: "19:30" })],
      "TWD"
    );
    expect(result[0].entries.map(entry => entry.time)).toEqual(["19:30", ""]);
  });

  it("都沒記時間時照記帳先後排，先記的在前", () => {
    const result = reportTimeline(
      [expense({ id: "second", createdAt: at(1, 20) }), expense({ id: "first", createdAt: at(1, 9) })],
      "TWD"
    );
    expect(result[0].entries.map(entry => entry.amount)).toHaveLength(2);
    // 兩筆金額一樣分不出來，改用名稱驗順序。
    const named = reportTimeline(
      [
        expense({ createdAt: at(1, 20), title: "宵夜" }),
        expense({ createdAt: at(1, 9), title: "早餐" })
      ],
      "TWD"
    );
    expect(named[0].entries.map(entry => entry.name)).toEqual(["早餐", "宵夜"]);
  });

  // 地點整區列在「去過的地方」了，時間軸再列一次就只是同一份資訊講兩遍。
  it("逐筆放的是支出名稱，不是地點", () => {
    const result = reportTimeline(
      [
        expense({
          title: "海南雞飯",
          place: { name: "天天海南雞飯", address: null, lat: null, lng: null, placeId: null }
        })
      ],
      "TWD"
    );

    expect(result[0].entries[0].name).toBe("海南雞飯");
    expect(result[0].entries[0].place).toBeUndefined();
  });

  it("每天有小計，加起來就是那天的花費", () => {
    const result = reportTimeline(
      [expense({ baseAmount: 12000 }), expense({ baseAmount: 3000 }), expense({ date: "2026-03-02", baseAmount: 500 })],
      "TWD"
    );
    expect(result[0].total).toBe(15000);
    expect(result[1].total).toBe(500);
  });

  it("缺匯率換算不出來的支出不進時間軸 —— 進去的話每日小計會跟總額對不起來", () => {
    const result = reportTimeline(
      [expense({ currency: "THB", baseAmount: null }), expense({ baseAmount: 3000 })],
      "TWD"
    );
    expect(result[0].entries).toHaveLength(1);
    expect(result[0].total).toBe(3000);
  });

  it("連日期都沒有的支出放不上時間軸", () => {
    const result = reportTimeline([expense({ date: null, createdAt: null })], "TWD");
    expect(result).toEqual([]);
  });

  it("Day 從任務起始日算起，含頭尾", () => {
    const result = reportTimeline(
      [expense({ date: "2026-03-01" }), expense({ date: "2026-03-05" })],
      "TWD",
      "2026-03-01"
    );
    expect(result.map(day => day.day)).toEqual([1, 5]);
  });

  it("沒有起始日就用最早的那天當 Day 1", () => {
    const result = reportTimeline(
      [expense({ date: "2026-03-03" }), expense({ date: "2026-03-04" })],
      "TWD"
    );
    expect(result.map(day => day.day)).toEqual([1, 2]);
  });

  it("支出早於起始日時改用那天當原點，不會出現 Day 0 或負數", () => {
    // 提前買的機票之類。
    const result = reportTimeline(
      [expense({ date: "2026-02-20" }), expense({ date: "2026-03-01" })],
      "TWD",
      "2026-03-01"
    );
    expect(result[0].day).toBe(1);
    expect(result[1].day).toBe(10);
  });

  describe("每天的天氣", () => {
    const sunny = { code: 0, high: 30, low: 22, exact: null };
    const stormy = { code: 95, high: 28, low: 21, exact: null };

    it("取當天第一筆有天氣的支出", () => {
      const days = reportTimeline(
        [
          expense({ date: "2026-03-01", time: "09:00", weather: stormy }),
          expense({ date: "2026-03-01", time: "18:00", weather: sunny })
        ],
        "TWD"
      );

      expect(days[0].weather).toEqual(stormy);
    });

    it("前面幾筆沒有天氣就往後找", () => {
      const days = reportTimeline(
        [
          expense({ date: "2026-03-01", time: "09:00" }),
          expense({ date: "2026-03-01", time: "18:00", weather: sunny })
        ],
        "TWD"
      );

      expect(days[0].weather).toEqual(sunny);
    });

    it("整天都沒有就是 null，不是硬湊一個", () => {
      const days = reportTimeline([expense({ date: "2026-03-01" })], "TWD");

      expect(days[0].weather).toBeNull();
    });

    it("每一天各自算，不會沿用前一天的", () => {
      const days = reportTimeline(
        [
          expense({ date: "2026-03-01", weather: stormy }),
          expense({ date: "2026-03-02" })
        ],
        "TWD"
      );

      expect(days[0].weather).toEqual(stormy);
      expect(days[1].weather).toBeNull();
    });
  });

  // 名稱是刻意放進來的（時間軸沒有它就只剩時間跟金額），但除此之外
  // 這份資料會寫進任何人拿到連結都讀得到的文件裡，多一個欄位就是多一次外洩。
  it("只放公開得起的欄位 —— 沒有 uid、沒有誰付的、沒有 id", () => {
    const [entry] = reportTimeline([expense({ title: "阿明的點心", time: "15:00" })], "TWD")[0].entries;
    expect(Object.keys(entry).sort()).toEqual(["amount", "category", "name", "time"]);
  });
});
