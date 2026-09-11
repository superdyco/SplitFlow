import { describe, expect, it } from "vitest";
import { SUPPORTED_CURRENCIES } from "../amount.js";
import { MAX_IMAGE_BYTES, RECEIPT_SCHEMA, cleanReceipt, decodeImage, parseOutput } from "./receipt.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");

function raw(overrides: Record<string, unknown> = {}) {
  return {
    is_receipt: true,
    amount: 1280,
    currency: "JPY",
    date: "2026-09-10",
    time: "19:05",
    merchant: "  すき家 渋谷店  ",
    category: "food",
    ...overrides
  };
}

describe("SUPPORTED_CURRENCIES", () => {
  it("20 種，含 TWD 與 JPY", () => {
    expect(SUPPORTED_CURRENCIES).toHaveLength(20);
    expect(SUPPORTED_CURRENCIES).toContain("TWD");
    expect(SUPPORTED_CURRENCIES).toContain("JPY");
  });
});

describe("decodeImage", () => {
  it("JPEG 與 PNG 都收，MIME 看檔頭", () => {
    expect(decodeImage(JPEG)).toEqual({ ok: true, base64: JPEG, mime: "image/jpeg" });
    expect(decodeImage(PNG)).toEqual({ ok: true, base64: PNG, mime: "image/png" });
  });

  it("不是圖片、空字串、不是字串都擋", () => {
    expect(decodeImage(Buffer.from("hello").toString("base64"))).toEqual({ ok: false });
    expect(decodeImage("")).toEqual({ ok: false });
    expect(decodeImage(123)).toEqual({ ok: false });
  });

  it("超過 2 MB 擋 —— 跟收據上傳的上限一樣", () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    big[0] = 0xff;
    big[1] = 0xd8;
    expect(decodeImage(big.toString("base64"))).toEqual({ ok: false });
  });
});

describe("RECEIPT_SCHEMA", () => {
  it("strict 模式要求：每個欄位都在 required、不准多欄位", () => {
    expect(RECEIPT_SCHEMA.additionalProperties).toBe(false);
    expect([...RECEIPT_SCHEMA.required].sort()).toEqual(Object.keys(RECEIPT_SCHEMA.properties).sort());
  });
});

describe("parseOutput", () => {
  it("解得開就回物件，解不開回 null", () => {
    expect(parseOutput('{"a":1}')).toEqual({ a: 1 });
    expect(parseOutput("not json")).toBeNull();
  });
});

describe("cleanReceipt", () => {
  it("全部合格：金額照幣別整理成表單能用的字串，店名去頭尾空白", () => {
    expect(cleanReceipt(raw())).toEqual({
      readResult: "read",
      fields: {
        amount: "1280",
        currency: "JPY",
        currencySupported: true,
        date: "2026-09-10",
        time: "19:05",
        title: "すき家 渋谷店",
        category: "food"
      }
    });
  });

  it("有小數的幣別補到兩位", () => {
    expect(cleanReceipt(raw({ amount: 12.5, currency: "USD" })).fields.amount).toBe("12.50");
  });

  it("沒有小數的幣別四捨五入", () => {
    expect(cleanReceipt(raw({ amount: 1280.6, currency: "JPY" })).fields.amount).toBe("1281");
  });

  it("不支援的幣別：金額照收據上的數字，標成不支援", () => {
    const { fields } = cleanReceipt(raw({ amount: 40000, currency: "KHR" }));
    expect(fields.amount).toBe("40000");
    expect(fields.currency).toBe("KHR");
    expect(fields.currencySupported).toBe(false);
  });

  it("沒有幣別：金額照數字，不算支援", () => {
    const { fields } = cleanReceipt(raw({ currency: null, amount: 85 }));
    expect(fields.currency).toBeNull();
    expect(fields.currencySupported).toBe(false);
    expect(fields.amount).toBe("85");
  });

  it("金額不是大於 0 的數字：算沒讀出來，其他欄位照樣回", () => {
    for (const amount of [0, -5, null, "1280", Number.NaN]) {
      const result = cleanReceipt(raw({ amount }));
      expect(result.readResult).toBe("unreadable");
      expect(result.fields.amount).toBeNull();
      expect(result.fields.title).toBe("すき家 渋谷店");
    }
  });

  it("AI 說不是收據：not_receipt，金額一律不填", () => {
    const result = cleanReceipt(raw({ is_receipt: false }));
    expect(result.readResult).toBe("not_receipt");
    expect(result.fields.amount).toBeNull();
  });

  it("幣別要三個大寫字母", () => {
    expect(cleanReceipt(raw({ currency: "jpy" })).fields.currency).toBeNull();
    expect(cleanReceipt(raw({ currency: "YEN" })).fields.currency).toBe("YEN");
    expect(cleanReceipt(raw({ currency: "¥" })).fields.currency).toBeNull();
  });

  it("日期要是真的日期", () => {
    expect(cleanReceipt(raw({ date: "2026-02-30" })).fields.date).toBeNull();
    expect(cleanReceipt(raw({ date: "2026/09/10" })).fields.date).toBeNull();
  });

  it("時間 00:00–23:59", () => {
    expect(cleanReceipt(raw({ time: "24:00" })).fields.time).toBeNull();
    expect(cleanReceipt(raw({ time: "7:05" })).fields.time).toBeNull();
    expect(cleanReceipt(raw({ time: "00:00" })).fields.time).toBe("00:00");
  });

  it("店名超過 60 字截短，空白當作沒有", () => {
    expect(cleanReceipt(raw({ merchant: "字".repeat(70) })).fields.title).toBe("字".repeat(60));
    expect(cleanReceipt(raw({ merchant: "   " })).fields.title).toBeNull();
  });

  it("分類不在六類裡當作沒有", () => {
    expect(cleanReceipt(raw({ category: "drinks" })).fields.category).toBeNull();
  });

  it("整個不是物件：沒讀出來，全部 null", () => {
    expect(cleanReceipt(null)).toEqual({
      readResult: "unreadable",
      fields: {
        amount: null,
        currency: null,
        currencySupported: false,
        date: null,
        time: null,
        title: null,
        category: null
      }
    });
  });
});
