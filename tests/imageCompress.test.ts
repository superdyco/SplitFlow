import { describe, expect, it } from "vitest";
import { scaledSize } from "@/utils/imageCompress";

describe("scaledSize", () => {
  it("直式收據（最常見）以高度為長邊縮放", () => {
    expect(scaledSize(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("橫式照片以寬度為長邊縮放", () => {
    expect(scaledSize(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("已經比上限小的圖不放大 —— 放大只會變胖不會變清楚", () => {
    expect(scaledSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("長邊剛好等於上限就原樣保留", () => {
    expect(scaledSize(1600, 1200, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("正方形兩邊一起縮到上限", () => {
    expect(scaledSize(2000, 2000, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it("縮放後的邊長是整數，canvas 不吃小數", () => {
    const size = scaledSize(1000, 333, 800);
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });
});
