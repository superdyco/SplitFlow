import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
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
export const auth = getAuth(app);

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
