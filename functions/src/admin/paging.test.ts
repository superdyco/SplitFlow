import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  DEFAULT_LIMIT,
  encodeCursor,
  MAX_LIMIT,
  parseLimit
} from "./paging.js";

describe("游標", () => {
  it("編碼再解碼要拿回同一份", () => {
    const cursor = { value: 1_757_000_000_000, id: "uid_kim" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  /*
    只帶時間的話，同一毫秒註冊的兩個人會在翻頁邊界互相蓋掉，其中一個永遠
    出不來。批次匯入很容易造出同一毫秒的一批人。
  */
  it("同一個時間、不同的 id，是兩個不同的游標", () => {
    const a = encodeCursor({ value: 1_757_000_000_000, id: "uid_a" });
    const b = encodeCursor({ value: 1_757_000_000_000, id: "uid_b" });
    expect(a).not.toBe(b);
  });

  it("解不開一律回 null —— 不能默默從頭開始", () => {
    expect(decodeCursor("這不是 base64")).toBeNull();
    expect(decodeCursor(Buffer.from("{}", "utf8").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('{"value":"x","id":"a"}').toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('{"value":1}').toString("base64url"))).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(42)).toBeNull();
  });

  it("NaN 與 Infinity 不是有效的游標", () => {
    expect(decodeCursor(Buffer.from('{"value":null,"id":"a"}').toString("base64url"))).toBeNull();
  });
});

describe("parseLimit", () => {
  it("沒給或不合理的值用預設", () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(parseLimit(0)).toBe(DEFAULT_LIMIT);
    expect(parseLimit(-5)).toBe(DEFAULT_LIMIT);
    expect(parseLimit(2.5)).toBe(DEFAULT_LIMIT);
    expect(parseLimit("50")).toBe(DEFAULT_LIMIT);
  });

  // 沒有上限的話，limit: 100000 就是「把整個集合撈出來」。
  it("超過上限的夾到上限", () => {
    expect(parseLimit(1000)).toBe(MAX_LIMIT);
  });

  it("合理的值照用", () => {
    expect(parseLimit(10)).toBe(10);
  });
});
