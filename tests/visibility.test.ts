import { beforeEach, describe, expect, it } from "vitest";
import { backgroundContext, noteHidden, noteVisible, resetVisibility } from "../src/utils/visibility";

beforeEach(() => resetVisibility());

describe("背景時間", () => {
  it("沒進過背景時兩個數字都是 0，不是負的也不是 undefined", () => {
    expect(backgroundContext(5_000)).toEqual({ hiddenMs: 0, sinceVisibleMs: 0 });
  });

  it("量的是最近一次在背景待多久", () => {
    noteHidden(1_000);
    noteVisible(61_000);
    expect(backgroundContext(61_500).hiddenMs).toBe(60_000);
  });

  it("回到前景之後過了多久也要知道 —— 卡住的是回來後第一個動作還是第十個", () => {
    noteHidden(1_000);
    noteVisible(31_000);
    expect(backgroundContext(31_800).sinceVisibleMs).toBe(800);
  });

  it("重複的 hidden 只認第一次，不然量到的會比實際短", () => {
    noteHidden(1_000);
    // iOS 會同時發 visibilitychange 與 pagehide。
    noteHidden(1_050);
    noteVisible(61_000);
    expect(backgroundContext(61_000).hiddenMs).toBe(60_000);
  });

  it("重複的 visible 不會把時間洗掉", () => {
    noteHidden(1_000);
    noteVisible(61_000);
    noteVisible(61_100);
    expect(backgroundContext(61_100)).toEqual({ hiddenMs: 60_000, sinceVisibleMs: 100 });
  });

  it("沒進過背景就收到 visible，什麼都不該發生", () => {
    noteVisible(9_000);
    expect(backgroundContext(9_500)).toEqual({ hiddenMs: 0, sinceVisibleMs: 0 });
  });

  it("進出好幾次，留的是最近那一次", () => {
    noteHidden(1_000);
    noteVisible(4_000);
    noteHidden(10_000);
    noteVisible(130_000);

    expect(backgroundContext(130_000).hiddenMs).toBe(120_000);
  });

  it("還在背景裡的時候問，回報的是上一次的紀錄 —— 這一次還沒結束", () => {
    noteHidden(1_000);
    noteVisible(4_000);
    noteHidden(10_000);

    expect(backgroundContext(70_000).hiddenMs).toBe(3_000);
  });
});
