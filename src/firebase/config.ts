import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  initializeAuth
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const app = initializeApp(firebaseConfig);
/**
 * 跟 `getAuth()` 只差一件事：**不在這裡設 popupRedirectResolver。**
 *
 * 那個參數在冷啟動時很貴。`initializeCurrentUser` 裡有這段：
 *
 *     if (popupRedirectResolver && this.config.authDomain) {
 *         await this.getOrInitRedirectPersistenceManager();
 *         const result = await this.tryRedirectSignIn(popupRedirectResolver);
 *
 * 那條路會 `_openIframe` → `loadGapi` —— 去 Google 的 CDN 載一支腳本、再開一個
 * 跨來源 iframe，而 `onAuthStateChanged` 要等它跑完。量測：手機 1,620～2,210ms，
 * 桌機 253ms（IndexedDB 只佔 24ms 對 11ms，已經量過排除了）。
 *
 * 整套機制只為了接住 `signInWithRedirect` 的結果，而這個 app 只用
 * `signInWithPopup`。所以 resolver 改成**登入畫面出現時才在背景暖機**
 * （見 ProviderButtons.vue），沒登入的人在讀畫面時就付掉，已登入的人
 * 完全不用付。
 *
 * ⚠️ 這裡拿掉之後，`signInWithPopup` 一定要自己把 resolver 傳進去 ——
 * 而且要確保它**已經暖過**。冷的 resolver 會讓 SDK 在開彈窗之前先 await
 * 一次初始化，手機上那 1.6 秒足夠讓 iOS 把使用者手勢作廢，彈窗被擋掉之後
 * 整個登入會無聲卡死。這個坑踩過一次（2026-08-24）。
 *
 * persistence 照抄 `getAuth()` 的預設順序，一個字都沒動 —— 換了的話
 * 所有人會被登出一次，而那跟這件事無關。
 */
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]
});

/**
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
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

/**
 * 寫進每一筆效能樣本。
 *
 * 留著是因為它已經證明過自己有用：2026-08-24 拿它比對過記憶體快取與 IndexedDB，
 * 兩批資料靠這個欄位分開，才確定 30 秒的停頓跟持久化無關（記憶體模式照樣中）。
 * 下次再懷疑某個全域設定時，改這一行就有對照組，不必靠人記得哪個版號是哪個設定。
 */
export const localCacheMode = "indexeddb";
