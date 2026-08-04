/**
 * 收據照片的上傳、刪除與補傳。
 *
 * 流程：拍照 → 壓縮 → 進 IndexedDB 佇列 → 支出文件標成待上傳 →
 * 有網路時把圖傳到 Storage → 回頭把支出的 receipt 改成 Storage 路徑。
 *
 * firebase/storage 用動態 import：沒碰過收據的使用者不必付這段體積。
 */
import { doc, updateDoc } from "firebase/firestore";
import { app, db } from "@/firebase/config";
import { MAX_ATTEMPTS, queueAction, receiptPath } from "@/utils/receiptPolicy";
import {
  enqueue,
  listQueued,
  removeQueued,
  setAttempts,
  type QueuedReceipt
} from "@/services/receiptQueue";

/** 同一個物件的下載 URL 是穩定的，同一次 session 進出編輯頁不該重複問。 */
const urlCache = new Map<string, string>();

/** 擋重入：三個觸發點可能同時到，同一批項目不要被傳兩次。 */
let flushing = false;

/**
 * 上傳進度要能通知畫面。
 *
 * 補傳是在背景發生的，而 App 讀支出用的是一次性的 getDocs 而不是 onSnapshot ——
 * 沒有這個通知的話，照片傳完了畫面還停在「待上傳」，使用者只能手動重整。
 */
export type ReceiptEvent =
  | { localId: string; status: "uploading" }
  | { localId: string; status: "uploaded"; path: string }
  | { localId: string; status: "failed" };

const listeners = new Set<(event: ReceiptEvent) => void>();

/** 回傳取消訂閱的函式，呼叫端在 onUnmounted 要記得叫它。 */
export function onReceiptEvent(cb: (event: ReceiptEvent) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

let uploadingId: string | null = null;

/**
 * 現在正在傳的項目。畫面載入時 flush 可能已經在跑了、事件早就發過，
 * 所以除了訂閱事件之外還要問得到「當下」的狀態。
 */
export function uploadingReceiptId(): string | null {
  return uploadingId;
}

function emit(event: ReceiptEvent) {
  for (const cb of listeners) cb(event);
}

async function storage() {
  const { getStorage } = await import("firebase/storage");
  return getStorage(app);
}

export async function receiptUrl(path: string): Promise<string> {
  const cached = urlCache.get(path);
  if (cached) return cached;

  const { getDownloadURL, ref } = await import("firebase/storage");
  const url = await getDownloadURL(ref(await storage(), path));
  urlCache.set(path, url);
  return url;
}

/** 直接傳，不經佇列。給 IndexedDB 不能用時的降級路徑。回傳 Storage 路徑。 */
export async function uploadDirect(taskId: string, expenseId: string, blob: Blob): Promise<string> {
  const { ref, uploadBytes } = await import("firebase/storage");
  const path = receiptPath(taskId, expenseId);
  await uploadBytes(ref(await storage(), path), blob, { contentType: "image/jpeg" });
  urlCache.delete(path);
  return path;
}

/**
 * 只排進佇列，**不**在這裡觸發上傳。
 *
 * 呼叫端必須先把 expense 文件寫成待上傳狀態，再自己呼叫 flushReceipts()。
 * 順序反過來會有競態：flush 完成後會把文件改成 { path, localId: null } 並刪掉
 * 佇列項目，接著呼叫端那次寫入又用 { path: null, localId } 蓋回去 ——
 * 照片其實傳上去了，但文件永遠顯示「待上傳」，而且佇列已空、補救不了。
 */
export async function queueReceipt(
  taskId: string,
  expenseId: string,
  blob: Blob,
  localId: string
): Promise<void> {
  await enqueue({ id: localId, taskId, expenseId, blob, createdAt: Date.now(), attempts: 0 });
}

/** 使用者手動重試：把失敗次數歸零再跑一次 flush。 */
export async function retryReceipt(localId: string): Promise<void> {
  await setAttempts(localId, 0);
  await flushReceipts();
}

async function uploadOne(item: QueuedReceipt): Promise<string> {
  const { ref, uploadBytes } = await import("firebase/storage");
  const path = receiptPath(item.taskId, item.expenseId);

  await uploadBytes(ref(await storage(), path), item.blob, { contentType: "image/jpeg" });

  // 只寫 receipt 一個欄位。Firestore 在 update 時看到的是合併後的文件，
  // 所以規則的 validExpenseShape() 仍然過得了，不需要為此放寬規則。
  // 也刻意不動 updatedAt —— 這是系統補傳，不是使用者編輯。
  await updateDoc(doc(db, "tasks", item.taskId, "expenses", item.expenseId), {
    receipt: { path, localId: null }
  });

  urlCache.delete(path);
  await removeQueued(item.id);
  return path;
}

export async function flushReceipts(): Promise<void> {
  if (flushing) return;
  flushing = true;

  try {
    // IndexedDB 開不起來時 listQueued 會丟，那就什麼都不用做。
    const items = await listQueued().catch(() => [] as QueuedReceipt[]);
    const now = Date.now();

    console.info(`[receipt] flush 開始，佇列有 ${items.length} 筆`);

    // 序列處理不併發：行動網路上併發傳圖沒有好處，還會讓記憶體同時扛好幾張。
    for (const item of items) {
      const action = queueAction(item, now);
      console.info(
        `[receipt] ${item.id} → ${action}（已失敗 ${item.attempts} 次，目標 ${receiptPath(item.taskId, item.expenseId)}）`
      );

      if (action === "drop-expired") {
        await removeQueued(item.id);
        continue;
      }
      if (action === "hold-exhausted") continue;

      uploadingId = item.id;
      emit({ localId: item.id, status: "uploading" });

      try {
        const path = await uploadOne(item);
        console.info(`[receipt] ${item.id} 上傳成功`);
        emit({ localId: item.id, status: "uploaded", path });
      } catch (err) {
        // 背景上傳失敗如果不留下記錄，使用者只會看到一個永遠不會消失的「待上傳」，
        // 而我們完全查不出原因。這行是刻意留著的。
        const code = (err as { code?: string }).code;
        console.error(`[receipt] ${item.id} 上傳失敗（code=${code ?? "無"}）`, err);
        emit({ localId: item.id, status: "failed" });

        // 支出已經被刪掉了，這個項目永遠不會成功，直接丟棄不要一直重試。
        if (code === "not-found") {
          await removeQueued(item.id);
          continue;
        }

        // 規則拒絕是確定性的：再試一百次也一樣（權限不對、檔案不合規）。
        // 不像斷線那樣值得等，所以直接跳到上限、讓畫面立刻顯示失敗，
        // 而不是讓使用者等五輪毫無意義的重試。
        // 注意 storage/unauthenticated 不算在內 —— 那是 token 過期，重登入就好。
        if (code === "storage/unauthorized" || code === "permission-denied") {
          await setAttempts(item.id, MAX_ATTEMPTS);
          continue;
        }

        await setAttempts(item.id, item.attempts + 1);
      } finally {
        uploadingId = null;
      }
    }
  } finally {
    flushing = false;
  }
}

/** 刪除 Storage 上的收據。失敗就算了 —— 留下孤兒檔案是設計上接受的取捨。 */
export async function deleteReceipt(taskId: string, expenseId: string): Promise<void> {
  const path = receiptPath(taskId, expenseId);
  urlCache.delete(path);
  try {
    const { deleteObject, ref } = await import("firebase/storage");
    await deleteObject(ref(await storage(), path));
  } catch {
    // 檔案本來就不存在、或現在離線 —— 都不該讓使用者的編輯因此失敗。
  }
}
