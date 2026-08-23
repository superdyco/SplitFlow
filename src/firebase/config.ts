import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/**
 * ⚠️ 實驗中，不是最終狀態。改回來的方式在這段註解最後面。
 *
 * 要驗證的問題：「PWA 從背景回來，進我的任務要等 30 秒」是不是 IndexedDB
 * 這條路造成的。量測顯示那 30 秒花在等伺服器同步，而壓住本機快取的那行
 * SDK 判斷（waitForSyncWhenOnline）跟持久化無關 —— 但恢復時要重新取得
 * 多分頁主控權這條路，光看程式碼排除不掉，只能實測。
 *
 * 讀法：在手機上重現幾次，然後
 *   node scripts/perf-report.mjs --key <金鑰> --days 7
 * 報告會照本機快取模式分開列。還是 30 秒 = 跟這個設定無關；變快了 = 是它。
 *
 * 改回來：git checkout main && npm run deploy
 * **這段期間離線記帳會失效**，測完就換回去，不要留著。
 *
 * ---- 以下是原本的說明，改回去時一起還原 ----
 *
 * 開啟 IndexedDB 離線快取。這是出國用的工具，網路常常時好時壞：
 * 已經載入過的任務與支出在斷線時照樣看得到，這段期間新增或修改的資料
 * 會排隊，連上網之後自動送出。
 *
 * 用 `persistentMultipleTabManager`，因為舊的單分頁模式在使用者開第二個
 * 分頁時會讓其中一個拿不到快取。多分頁管理器會協調它們共用同一份。
 *
 * 注意這只解決「資料」，不解決「打開 App」——完全沒有網路時瀏覽器連
 * index.html 與 JS 都拿不到，畫面根本走不到 Firestore 這一層。那需要
 * service worker，是另一件事。
 */
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});

/**
 * 寫進每一筆效能樣本，兩批資料才分得開。
 *
 * 靠 commit 短碼分也行，但那要人記得「哪一版是哪個設定」—— 實驗結果不該
 * 依賴記憶力。這個常數跟上面那行一起改，就不會有對不上的問題。
 */
export const localCacheMode = "memory";
