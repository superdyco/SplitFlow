import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import { bytesToBase64, exportJsonValue } from "../src/services/dataExportService";

describe("資料匯出", () => {
  it("Timestamp 與巢狀資料轉成 ISO 日期", () => {
    const value = exportJsonValue({
      at: Timestamp.fromDate(new Date("2026-08-30T12:34:56.000Z")),
      nested: [{ missing: undefined, ok: true }]
    });
    expect(value).toEqual({
      at: "2026-08-30T12:34:56.000Z",
      nested: [{ ok: true }]
    });
  });

  it("圖片 bytes 轉成標準 Base64", () => {
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("/9j/AA==");
  });
});
