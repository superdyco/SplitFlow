/**
 * 表單裡收據欄位的狀態。
 *
 * 關鍵決定：**新增與編輯都在按下送出時才入列**，不在選完照片的當下。
 * 新增模式的 expenseId 要等 createExpense 才產生，如果編輯模式提早入列、
 * 新增模式不提早，兩條路徑的狀態機就會分岔 —— 一致比早幾秒重要。
 * 送出之前預覽用記憶體裡的 blob URL，使用者不會覺得慢。
 */
import { computed, onUnmounted, ref } from "vue";
import { compressImage } from "@/utils/imageCompress";
import { MAX_ATTEMPTS } from "@/utils/receiptPolicy";
import { getQueued, queueAvailable } from "@/services/receiptQueue";
import {
  deleteReceipt,
  queueReceipt,
  receiptUrl,
  retryReceipt,
  uploadDirect
} from "@/services/receiptService";
import type { ExpenseReceipt } from "@/types/expense";

export function useReceipt() {
  /** 已存在文件裡的收據（編輯模式載入時帶進來）。 */
  const receipt = ref<ExpenseReceipt | null>(null);
  /** 使用者這次新選的照片，還沒送出。 */
  const pending = ref<Blob | null>(null);
  const previewUrl = ref<string | null>(null);
  const busy = ref(false);
  const error = ref<string | null>(null);
  /** 使用者按了移除，送出時要把舊檔一起刪掉。 */
  const removed = ref(false);
  /** 對應佇列項目的失敗次數。到上限就不再自動重試，要讓使用者看得到。 */
  const attempts = ref(0);
  /** 照片標成待上傳，但佇列裡找不到 —— 這台裝置永遠補不了這一筆。 */
  const orphaned = ref(false);

  /**
   * 這個狀態一定要算得出 failed，否則使用者會卡在一個永遠不會變的「待上傳」，
   * 而且連重試按鈕都看不到。
   */
  const state = computed<"empty" | "ready" | "pending" | "failed">(() => {
    if (!previewUrl.value && !receipt.value) return "empty";
    if (!receipt.value?.localId) return "ready";
    return orphaned.value || attempts.value >= MAX_ATTEMPTS ? "failed" : "pending";
  });

  let objectUrl: string | null = null;

  function releasePreview() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  onUnmounted(releasePreview);

  async function pickFile(file: File) {
    busy.value = true;
    error.value = null;
    try {
      const blob = await compressImage(file);
      releasePreview();
      objectUrl = URL.createObjectURL(blob);
      previewUrl.value = objectUrl;
      pending.value = blob;
      removed.value = false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      busy.value = false;
    }
  }

  function clear() {
    releasePreview();
    previewUrl.value = null;
    pending.value = null;
    removed.value = true;
  }

  /** 編輯模式載入既有支出時呼叫。抓不到 URL 不是致命錯誤，欄位空著就好。 */
  async function loadExisting(existing: ExpenseReceipt | null) {
    receipt.value = existing;
    removed.value = false;
    attempts.value = 0;
    orphaned.value = false;

    if (existing?.localId) {
      const queued = await getQueued(existing.localId).catch(() => undefined);
      // 標成待上傳卻不在佇列裡，代表照片在另一台裝置上、或本機資料被清掉了。
      // 這台裝置怎麼等都不會傳成功，要當成失敗讓使用者能處理。
      if (queued) attempts.value = queued.attempts;
      else orphaned.value = true;
    }

    if (!existing?.path) return;
    try {
      previewUrl.value = await receiptUrl(existing.path);
    } catch {
      previewUrl.value = null;
    }
  }

  async function retry() {
    const localId = receipt.value?.localId;
    if (!localId) return;

    busy.value = true;
    error.value = null;
    try {
      // 佇列裡沒有的話重試只是空轉，講清楚比讓使用者一直按有用。
      if (!(await getQueued(localId))) {
        orphaned.value = true;
        error.value = "這張照片不在這台裝置上（可能是用另一台裝置拍的），請移除後重新拍一張。";
        return;
      }
      await retryReceipt(localId);
      attempts.value = 0;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      busy.value = false;
    }
  }

  /**
   * 表單送出、拿到 expenseId 之後呼叫，回傳要寫進文件的 receipt 欄位。
   *
   * IndexedDB 不能用（無痕模式、儲存權限被拒）時降級成當場直傳。
   * 傳不掉就往外丟，讓使用者知道照片沒存進去 —— 靜默吞掉會讓人以為存好了。
   */
  async function commit(taskId: string, expenseId: string): Promise<ExpenseReceipt | null> {
    if (pending.value) {
      const blob = pending.value;
      // 重用既有的 localId：換照片時要覆寫佇列裡那一筆，不能留兩筆搶同一個路徑。
      const localId = receipt.value?.localId ?? crypto.randomUUID();

      if (await queueAvailable()) {
        await queueReceipt(taskId, expenseId, blob, localId);
        return { path: null, localId };
      }

      const path = await uploadDirect(taskId, expenseId, blob);
      return { path, localId: null };
    }

    if (removed.value && receipt.value) {
      await deleteReceipt(taskId, expenseId);
      return null;
    }

    return receipt.value;
  }

  return { receipt, previewUrl, state, busy, error, pickFile, clear, loadExisting, retry, commit };
}
