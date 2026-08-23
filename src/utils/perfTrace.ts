/**
 * 一次操作的耗時分段。
 *
 * 目的很具體：手機上「進我的任務很卡」要能回答**卡在哪一段**。
 * 等驗證、等頁面的 JS chunk 下載、等 Firestore 查詢、查完之後畫面才長出來 ——
 * 這四件事的處置完全不同（改守衛、改打包、加索引、改渲染），
 * 只知道「總共 3.2 秒」等於什麼都不知道。
 *
 * 用 performance.now() 而不是 Date.now()：手機睡醒之後會校時，使用者也可能
 * 自己調時間，Date.now() 的差值會跳好幾秒甚至變成負的。
 *
 * 純函式模組，不 import firebase 也不 import vue，所以測得動。
 * 寫進 Firestore 是 `services/perfService.ts` 的事。
 */

/** 同一時間只追一件事。導航是循序的，多開一個 trace 只會讓歸屬變得沒把握。 */
let active: PerfTrace | null = null;
/** 上一個分段的結束時間（performance.now()）。 */
let lastAt = 0;

/**
 * 超過這個時間還沒收尾的 trace 直接作廢。
 *
 * 導航會被守衛改道、會被使用者中途按返回打斷，那時 trace 就留在那裡沒人收。
 * 沒有這個上限的話，下一次進頁面會撿到一個起點在十分鐘前的 trace，
 * 然後回報一個「載入花了 600 秒」的假資料 —— 比沒有資料更糟。
 */
const MAX_TRACE_MS = 60_000;

export interface PerfPhase {
  name: string;
  ms: number;
}

export type PerfDetailValue = string | number | boolean;

export interface PerfTrace {
  /** 追的是哪一件事，例如 "tasks"。收尾時要對得起來才算數。 */
  name: string;
  /**
   * 開始追的時候距離這個分頁開始載入多久（performance.now()）。
   *
   * 冷啟動的關鍵數字：這一段是 HTML + JS bundle + firebase 初始化，
   * 完全發生在任何一個分段之前，看分段是看不到的。
   */
  sinceStart: number;
  phases: PerfPhase[];
  detail: Record<string, PerfDetailValue>;
  /** 各分段加總，也就是從 startTrace 到 finishTrace 的時間。 */
  total: number;
}

function now(): number {
  return performance.now();
}

function round(ms: number): number {
  return Math.round(ms);
}

/**
 * 開始追一件事。已經有一個沒收尾的就直接蓋掉 —— 那個註定是被打斷的導航。
 */
export function startTrace(name: string): void {
  active = { name, sinceStart: round(now()), phases: [], detail: {}, total: 0 };
  lastAt = now();
}

/**
 * 收掉上一個分段，記在 `name` 底下。
 *
 * 沒有 active trace 時是 no-op —— 呼叫點（守衛、頁面的 load）在沒被追蹤的
 * 情境下照樣會執行，讓它們各自去判斷「現在有沒有在追」只會把條件散得到處都是。
 *
 * 同名會累加而不是新增一筆：寫進 Firestore 時分段是一個 map，重複的 key
 * 本來就存不下兩份，累加至少是個說得通的數字。
 */
export function markPhase(name: string): void {
  if (!active) return;
  const at = now();
  const ms = round(at - lastAt);
  lastAt = at;

  const existing = active.phases.find(phase => phase.name === name);
  if (existing) existing.ms += ms;
  else active.phases.push({ name, ms });
}

/**
 * 掛一個情境值上去。
 *
 * 分段只講「多久」，答不出「為什麼」。同樣是查詢 800ms，命中離線快取
 * 跟真的連了一趟伺服器是兩個完全不同的故事，要靠這裡的 fromCache 才分得出來。
 */
export function traceDetail(key: string, value: PerfDetailValue): void {
  if (!active) return;
  active.detail[key] = value;
}

/**
 * 收尾並取回結果。名字對不上、或這個 trace 已經放太久，一律回 null。
 *
 * 回 null 代表「這次不要回報」，呼叫端不需要分辨是哪一種 —— 兩種都是
 * 拿不到可信的數字，硬報上去只會污染統計。
 */
export function finishTrace(name: string): PerfTrace | null {
  const trace = active;
  active = null;
  if (!trace || trace.name !== name) return null;

  const total = round(now()) - trace.sinceStart;
  if (total > MAX_TRACE_MS) return null;

  trace.total = total;
  return trace;
}

/** 測試與除錯用。正式流程不該需要問這個。 */
export function activeTraceName(): string | null {
  return active?.name ?? null;
}

/** 分段攤平成 Firestore 存得下的 map：{ auth: 2, chunk: 410, query: 780 }。 */
export function phaseMap(trace: PerfTrace): Record<string, number> {
  const map: Record<string, number> = {};
  for (const phase of trace.phases) map[phase.name] = phase.ms;
  return map;
}

/**
 * 最慢的那一段。回報時單獨存一欄，因為「哪一段最慢」是唯一真正要看的結論，
 * 存成欄位才能直接在 Console 裡 group by，不用把每一筆撈出來自己比。
 */
export function slowestPhase(trace: PerfTrace): string {
  let worst = "";
  let ms = -1;
  for (const phase of trace.phases) {
    if (phase.ms > ms) {
      ms = phase.ms;
      worst = phase.name;
    }
  }
  return worst;
}
