import { Timestamp, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db, localCacheMode } from "@/firebase/config";
import { logError } from "@/utils/debugLog";
import { isInstalledApp } from "@/utils/platform";
import { storageProbe } from "@/utils/storageProbe";
import { phaseMap, slowestPhase, type PerfTrace } from "@/utils/perfTrace";

/**
 * 把耗時分段寫進 Firestore，讓「手機上很卡」變成查得到的東西。
 *
 * 為什麼不是 console.log：卡的是使用者的手機，不是開著 devtools 的那台。
 * 為什麼不是診斷資訊那條路：那個要使用者主動複製貼上，而且只有當下那一次；
 * 這裡要的是「哪一段慢、在哪種網路下慢、是不是只有冷啟動慢」這種要靠
 * 累積很多次才看得出來的東西。
 *
 * 三個原則，順序就是重要性：
 *   1. 絕對不能拖慢被量測的頁面。所以不 await、排在 idle、失敗就算了。
 *   2. 絕對不能因為量測而壞掉。整個函式包在 try 裡，任何錯誤都吞掉。
 *   3. 不能無上限地寫。每次寫入都是錢，而且失控的迴圈會把配額吃光。
 */

/**
 * 取樣率。0 = 完全關閉，一筆都不寫。
 *
 * 2026-08-24 調查收尾後關掉過一次，2026-08-31 又打開：手機上進任務列表還是
 * 會卡。守衛已經在那裡了，所以要分辨的是兩種相反的情況 —— 1.5 秒的門檻在
 * 手機網路下誤觸發（守衛白切一次連線，反而更慢），還是守衛有跑但沒救回來。
 * 猜錯會往反方向調，所以先收樣本。
 *
 * 全收而不是抽樣：要看的是尾巴（p95），而卡住本來就不是每次都發生，
 * 抽樣會把要找的東西抽掉。
 *
 * **查完記得調回 0。** 每一筆都是寫入額度。
 */
const SAMPLE_RATE = 1;

/**
 * 一次開啟最多回報幾筆。防的是「某個 effect 意外重跑」這種迴圈 ——
 * 正常使用一次開啟大概就是進出列表頁幾次，離這個數字很遠。
 */
const MAX_PER_SESSION = 30;

/** 30 天。在 Console 幫 perf 的 expiresAt 設 TTL 政策，過期的會自己刪掉。 */
const KEEP_DAYS = 30;

let reported = 0;
let loggedFailure = false;

interface NetworkInfo {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
}

/**
 * navigator.connection 只有 Chromium 系（含 Android Chrome）有，
 * 而使用者說卡的正是手機 —— 拿得到的時候，「4g 還是 2g」通常就是答案本身。
 * iOS Safari 沒有，那邊就只能靠時間分段自己說話。
 */
function network(): NetworkInfo {
  const conn = (navigator as Navigator & { connection?: NetworkInfo }).connection;
  if (!conn) return {};
  return {
    effectiveType: conn.effectiveType,
    downlink: conn.downlink,
    rtt: conn.rtt
  };
}

/**
 * 這個分頁本身載入得多快：TTFB 與 DOM 就緒。
 *
 * 冷啟動時這兩個數字發生在所有分段之前 —— 使用者感受到的「按下去很久才有反應」
 * 有可能整段都在這裡，而頁面內的分段一個都不會顯示異常。
 */
function bootTiming(): { ttfb: number; dom: number } | null {
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!entry) return null;
  return {
    ttfb: Math.round(entry.responseStart),
    dom: Math.round(entry.domContentLoadedEventEnd)
  };
}

/** 只留到日期，給 Console 用「這一天的資料」當過濾條件。時間本身在 createdAt。 */
function today(): string {
  const at = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function whenIdle(fn: () => void): void {
  const idle = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;

  // timeout 是保險：一直有事情做的分頁不會有 idle，但這筆還是要送出去。
  if (typeof idle === "function") idle(fn, { timeout: 5000 });
  else setTimeout(fn, 1000);
}

/**
 * 送出一筆。不回傳 promise —— 呼叫端沒有任何理由要等它，
 * 給了 promise 只會誘使某個地方去 await，那就違反第一個原則了。
 */
export function reportTrace(trace: PerfTrace): void {
  try {
    const uid = auth.currentUser?.uid;
    // 規則要求 uid 對得上 request.auth.uid。沒登入的話這筆一定被擋，不必送。
    if (!uid) return;
    if (reported >= MAX_PER_SESSION) return;
    if (Math.random() >= SAMPLE_RATE) return;
    reported += 1;

    const sample = {
      uid,
      page: trace.name,
      total: trace.total,
      /** 開始追之前就花掉的時間。冷啟動時這一段常常比所有分段加起來還大。 */
      sinceStart: trace.sinceStart,
      phases: phaseMap(trace),
      slowest: slowestPhase(trace),
      detail: trace.detail,
      boot: bootTiming(),
      version: __APP_VERSION__,
      // dev 的數字沒有參考價值（vite 不打包、跑在筆電上），但也不值得為它多開一個
      // 資料庫。存成欄位，查的時候濾掉就好。
      mode: import.meta.env.DEV ? "dev" : "prod",
      online: navigator.onLine,
      network: network(),
      installed: isInstalledApp(),
      /** 這台裝置開一個 IndexedDB 要多久。null 代表還沒量完。 */
      probe: storageProbe(),
      /** "indexeddb" 或 "memory"。判斷 30 秒的停頓跟離線快取有沒有關係用的。 */
      cache: localCacheMode,
      userAgent: navigator.userAgent,
      day: today(),
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + KEEP_DAYS * 86_400_000)
    };

    whenIdle(() => {
      void addDoc(collection(db, "perf"), sample).catch(err => {
        /*
          失敗只記第一次。要記是因為「規則忘了部署」看起來跟「功能沒生效」
          一模一樣，都是查不到資料；只記一次是因為離線時每一筆都會失敗，
          灌滿錯誤清單會把真正的錯誤擠掉。
        */
        if (loggedFailure) return;
        loggedFailure = true;
        logError("perf", err);
      });
    });
  } catch {
    // 量測壞掉不能讓頁面壞掉。這裡沒有任何值得讓使用者知道的事。
  }
}
