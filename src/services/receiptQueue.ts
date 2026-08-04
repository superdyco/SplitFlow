/**
 * 待上傳收據的本機佇列。
 *
 * 存在的理由：Firestore 的寫入會排進離線佇列，Storage 的上傳不會。
 * 在餐廳沒訊號時拍的收據如果不先留在本機，等回到有網路的地方收據已經丟了。
 *
 * 用 IndexedDB 而不是 localStorage：後者只能存字串，圖片轉 base64 會膨脹三分之一，
 * 還有 5MB 上限而且同步阻塞主執行緒。IndexedDB 可以直接存 Blob。
 *
 * 這一層只做讀寫，不做判斷 —— 「這個項目該上傳還是該丟掉」在 receiptPolicy 裡。
 */

const DB_NAME = "splitflow-uploads";
const STORE = "receipts";
const VERSION = 1;

export interface QueuedReceipt {
  /** 佇列 key，同時也是 expense.receipt.localId。 */
  id: string;
  /** 存目標位置而不是回頭查 Firestore —— 上傳時可能還在離線。 */
  taskId: string;
  expenseId: string;
  /** 壓縮後的 JPEG。 */
  blob: Blob;
  createdAt: number;
  /** 連續失敗次數。 */
  attempts: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  // 只開一次，之後共用。開失敗的話把 promise 清掉，下次還有機會重試
  // （使用者可能中途退出無痕模式，或把被拒絕的儲存權限打開）。
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("這個瀏覽器不支援本機暫存"));
        return;
      }
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("開啟本機暫存失敗"));
    }).catch((err: unknown) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("本機暫存操作失敗"));
      })
  );
}

/**
 * 無痕模式、儲存權限被拒、或瀏覽器太舊時會是 false。
 * 呼叫端要據此降級成「照片必須當場傳完」，不能靜默吞掉 ——
 * 那會讓使用者以為存好了、其實照片消失。
 */
export async function queueAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

/** 用 put 而不是 add：換照片時是覆寫同一個 id，不該留兩筆搶同一個路徑。 */
export function enqueue(item: QueuedReceipt): Promise<void> {
  return run("readwrite", store => store.put(item)).then(() => undefined);
}

export function listQueued(): Promise<QueuedReceipt[]> {
  return run<QueuedReceipt[]>("readonly", store => store.getAll());
}

export function removeQueued(id: string): Promise<void> {
  return run("readwrite", store => store.delete(id)).then(() => undefined);
}

/**
 * 查單一項目。回傳 undefined 有兩種意思：已經傳完刪掉了，或者照片根本
 * 不在這台裝置上（用另一台拍的、本機資料被清掉）。呼叫端要分辨得出來。
 */
export function getQueued(id: string): Promise<QueuedReceipt | undefined> {
  return run<QueuedReceipt | undefined>("readonly", store => store.get(id));
}

export async function setAttempts(id: string, attempts: number): Promise<void> {
  const item = await getQueued(id);
  // 項目可能在這之間被刪掉了（例如使用者刪了那筆支出），沒有就算了。
  if (!item) return;
  await run("readwrite", store => store.put({ ...item, attempts }));
}
