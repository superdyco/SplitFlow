import { disableNetwork, enableNetwork } from "firebase/firestore";
import { db } from "@/firebase/config";
import { logError } from "@/utils/debugLog";
import { traceDetail } from "@/utils/perfTrace";

/**
 * 把 Firestore 的連線切掉再接回來。
 *
 * 這是 SDK 提供的唯一一條「強制重連」的路，而且它順便解決了畫面的問題 ——
 * `disableNetwork` 會把線上狀態設成 Offline，SDK 自己的註解寫得很清楚：
 *
 *     // Set the OnlineState to Offline so get()s return from cache, etc.
 *
 * 卡住的那個 `getDocs` 之所以卡住，就是因為 SDK 認為自己在線上，所以壓著
 * 本機快取不發、等伺服器同步。狀態一翻成 Offline，那份快取立刻放出來。
 * 所以這一個動作同時做了兩件事：畫面馬上有東西，連線也真的重建。
 *
 * 代價是它是**全域**的：整個 app 的 Firestore 會一起被切離線再接回來，包括
 * 背景的收據補傳與排隊中的寫入。SDK 設計上支援（寫入留在佇列，恢復後送出），
 * 但這是為什麼它只在真的卡住時才跑，不是每次讀取都先來一輪。
 */

/**
 * 同一時間只跑一次。
 *
 * 頁面上可能有好幾個讀取一起卡住（列表加上按了「計算我的花費」），每個都
 * 觸發一輪切斷重連的話，後面幾輪會打斷前面那輪正在建立的連線，把要修的
 * 東西修得更糟。
 */
let recovering = false;

export async function recoverConnection(): Promise<void> {
  if (recovering) return;
  recovering = true;

  // 記進當下的耗時分段，之後才回答得了「這個補救到底有沒有在跑、跑完有多快」。
  traceDetail("recovered", true);

  try {
    await disableNetwork(db);
    await enableNetwork(db);
  } catch (err) {
    // 這是背景的補救動作，失敗了沒有話可以對使用者說 —— 原本那個讀取會自己
    // 走完它的路（成功、失敗、或者還是等 30 秒）。留一筆給診斷資訊就好。
    logError("reconnect", err);
  } finally {
    recovering = false;
  }
}
