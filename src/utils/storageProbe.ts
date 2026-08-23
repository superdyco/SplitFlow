/**
 * 這台裝置開一個 IndexedDB 要多久。
 *
 * 為什麼要量這個：手機冷啟動有 1.6～2.2 秒花在還原登入狀態，桌機只要 0.25 秒。
 * 最可疑的是 IndexedDB —— Firebase Auth 挑儲存方式時會呼叫每一種的
 * `_isAvailable()`，而 IndexedDB 那個實作是**真的開資料庫、寫一筆、再刪掉**，
 * 而且擋在所有讀取前面的 `Promise.all` 裡。Safari 開 IndexedDB 很慢是老問題。
 *
 * 但那 1.6 秒也可能是網路（還原時可能要重新整理 token），換儲存方式就毫無幫助。
 * 兩個假設分不出來之前不該動 auth 的設定 —— 動了要嘛沒效果，要嘛把所有人登出。
 *
 * 所以這裡直接量：做一次跟 `_isAvailable()` 一樣的事（開、寫、刪），看它多久。
 * 平台之間差 10 倍就是 IndexedDB，兩邊都快就是網路，去查別的地方。
 *
 * 用自己的資料庫名字，不碰 Firebase 的。跑在 idle，不跟真正的載入搶資源。
 */

const DB_NAME = "splitflow-probe";
const STORE = "probe";

export interface StorageProbe {
  /** 開一個 IndexedDB 並寫入、刪除一筆的時間。-1 代表量不到（無痕模式等）。 */
  idbMs: number;
  /** localStorage 同樣的一輪。它是同步的，正常應該接近 0。 */
  lsMs: number;
}

let result: StorageProbe | null = null;

/** 還沒量完就是 null，呼叫端照樣送出樣本，不要為了它等。 */
export function storageProbe(): StorageProbe | null {
  return result;
}

function probeIndexedDb(): Promise<number> {
  return new Promise(resolve => {
    if (typeof indexedDB === "undefined") {
      resolve(-1);
      return;
    }

    const startedAt = performance.now();
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(-1);
      return;
    }

    /*
      Safari 的 IndexedDB 有時候會開到一半就不回應了 —— 而那正好是我們懷疑的
      故障本身。沒有這個逾時的話這個 promise 永遠不會 settle，樣本裡就變成
      「沒量到」，跟「量到很慢」看起來一樣。10 秒到了就記 10 秒，那本身是答案。
    */
    const timer = setTimeout(() => resolve(Math.round(performance.now() - startedAt)), 10_000);
    const done = (value: number) => {
      clearTimeout(timer);
      resolve(value);
    };

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onerror = () => done(-1);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.put("1", "available");
        store.delete("available");
        tx.oncomplete = () => {
          const ms = Math.round(performance.now() - startedAt);
          db.close();
          done(ms);
        };
        tx.onerror = () => {
          db.close();
          done(-1);
        };
      } catch {
        db.close();
        done(-1);
      }
    };
  });
}

function probeLocalStorage(): number {
  const startedAt = performance.now();
  try {
    localStorage.setItem("splitflow-probe", "1");
    localStorage.getItem("splitflow-probe");
    localStorage.removeItem("splitflow-probe");
  } catch {
    return -1;
  }
  return Math.round(performance.now() - startedAt);
}

/**
 * 量一次就好，結果留著給之後每一筆樣本帶上。
 *
 * 排在 idle 是因為它自己會開一個 IndexedDB —— 在冷啟動當下跑的話，會跟
 * Firebase Auth 搶同一個資源，把要量的東西弄髒。
 */
export function runStorageProbe(): void {
  const idle = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;

  const run = () => {
    void probeIndexedDb().then(idbMs => {
      result = { idbMs, lsMs: probeLocalStorage() };
    });
  };

  if (typeof idle === "function") idle(run, { timeout: 8000 });
  else setTimeout(run, 3000);
}
