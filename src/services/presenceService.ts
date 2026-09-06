import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/config";

/**
 * 「這個人今天有來」的戳記。
 *
 * 個人檔案本來只有 createdAt 與 updatedAt，沒有任何欄位說得出「有多少人還在
 * 用」。管理後台的活躍人數與裝置分佈都靠這一個欄位 —— 沒有它，那兩塊畫面
 * 就只能拿註冊數來假裝，而假裝出來的數字唯一的用途就是被拿來做決定。
 *
 * ## 一天只寫一次
 *
 * 不擋的話就是每次開啟、每次導航都寫一次。擋掉之後一個人一天最多一次寫入，
 * 一千多個使用者一天一千多次 —— 成本可以忽略，而「今天有沒有來」這個問題
 * 一天寫一次就答得完整。
 *
 * ## 為什麼不 await
 *
 * 它掛在路由守衛上，而守衛是 await 的：擋在那裡就是**畫面還停在上一頁**，
 * 連「讀取中」都還沒出現。這個戳記慢一秒鐘沒有任何人會受影響，所以它一律
 * 射後不理，而且任何失敗都吞掉。
 */

const KEY = "splitflow:last-seen";

/**
 * 這個文件這輪已經寫過哪一天。
 *
 * 有 localStorage 為什麼還要它：Safari 的無痕模式與「封鎖網站資料」的設定會
 * 讓 localStorage 讀寫直接丟例外。只靠 localStorage 的話，那些人每一次導航
 * 都會寫一次 —— 而他們正是最不該被多收費的一群。
 */
let stampedFor: string | null = null;

/** 本地時區的今天。跟後端彙總用的台北時區一致，使用者也都在這個時區。 */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readGuard(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeGuard(day: string): void {
  try {
    localStorage.setItem(KEY, day);
  } catch {
    // 存不進去就靠 stampedFor 撐這一輪。下次開啟會再寫一次，那是可以接受的多餘。
  }
}

/**
 * 這台裝置是什麼。
 *
 * 網頁版一律是 `"web"`，裝在主畫面的 PWA 也是 —— 它跑的是同一份程式碼、
 * 同一組查詢，跟 Flutter 那邊的原生 App 是兩件事。想分開看安裝與否的話，
 * 那是另一個欄位，不是把這個欄位的意思弄模糊。
 *
 * `"android"` 與 `"ios"` 由 Flutter App 自己寫。
 */
const PLATFORM = "web";

/**
 * 記下這個人今天來過。失敗一律吞掉。
 *
 * 不回 Promise 是刻意的 —— 回了就會有人 await 它，而 await 它就是把它加進
 * 使用者盯著空白畫面的那段時間裡。
 */
export function markSeen(uid: string): void {
  const day = today();
  if (stampedFor === day || readGuard() === day) return;

  /*
    先記下來再送出，不是等成功才記。

    等成功才記的話，離線開啟就會每次導航都排一筆寫入進佇列 —— 回到連線時
    那些寫入會一起送出，全部指向同一份文件、寫同一個值。
  */
  stampedFor = day;
  writeGuard(day);

  updateDoc(doc(db, "users", uid), {
    // serverTimestamp() 在規則裡就等於 request.time，而規則要求兩者相等。
    // 這不是形式：那條規則是「這個戳記不能被偽造」的全部。
    lastSeenAt: serverTimestamp(),
    lastPlatform: PLATFORM
  }).catch(() => {
    /*
      沒有重試也沒有回報。

      這是一支旁支：戳記沒寫成，後台的當日活躍就少算一個人，而使用者什麼
      感覺都不會有。為它加重試會讓一支「不重要到可以整支不執行」的東西
      開始有狀態。

      也不把 stampedFor 還原 —— 還原的話，接下來每一次導航都會再試一次，
      而失敗的原因（離線、規則、網路）通常在這一輪裡不會改變。
    */
  });
}
