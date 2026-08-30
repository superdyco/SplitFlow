import { collection, doc, getDoc, getDocs, Timestamp } from "firebase/firestore";
import { getBytes, getStorage, ref as storageRef } from "firebase/storage";
import { app, db } from "@/firebase/config";
import { listUserTasks } from "@/services/taskService";
import { MAX_UPLOAD_BYTES } from "@/utils/receiptPolicy";

export interface ExportProgress {
  message: string;
  completedReceipts: number;
  totalReceipts: number;
}

type ProgressCallback = (progress: ExportProgress) => void;

/** Firestore Timestamp 與巢狀資料轉成 JSON 可攜格式。 */
export function exportJsonValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(exportJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        item === undefined ? [] : [[key, exportJsonValue(item)]]
      )
    );
  }
  return value;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function documents(taskId: string, name: string): Promise<Record<string, unknown>[]> {
  const snap = await getDocs(collection(db, "tasks", taskId, name));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

function receiptPathOf(expense: Record<string, unknown>): string | null {
  const receipt = expense.receipt;
  if (!receipt || typeof receipt !== "object") return null;
  const path = (receipt as { path?: unknown }).path;
  return typeof path === "string" && path ? path : null;
}

async function exportedReceipt(path: string): Promise<Record<string, unknown>> {
  try {
    const buffer = await getBytes(storageRef(getStorage(app), path), MAX_UPLOAD_BYTES);
    const bytes = new Uint8Array(buffer);
    return {
      mimeType: "image/jpeg",
      encoding: "base64",
      sizeBytes: bytes.length,
      data: bytesToBase64(bytes)
    };
  } catch (error) {
    return {
      unavailable: true,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/** 匯出使用者目前有權讀取的完整分帳資料；不包含邀請碼、Token 或 API 金鑰。 */
export async function buildDataExport(uid: string, onProgress?: ProgressCallback): Promise<object> {
  const [userSnap, tasks] = await Promise.all([
    getDoc(doc(db, "users", uid)),
    listUserTasks(uid)
  ]);

  const taskParts = await Promise.all(
    tasks.map(async task => {
      const [members, expenses, payments, settlements] = await Promise.all([
        documents(task.id, "members"),
        documents(task.id, "expenses"),
        documents(task.id, "payments"),
        documents(task.id, "settlements")
      ]);
      return { task, members, expenses, payments, settlements };
    })
  );

  const totalReceipts = taskParts.reduce(
    (sum, item) => sum + item.expenses.filter(receiptPathOf).length,
    0
  );
  let completedReceipts = 0;

  const exportedTasks = [];
  for (const part of taskParts) {
    const taskData = { ...part.task } as Record<string, unknown>;
    delete taskData.inviteCode;

    const expenses = [];
    for (const expense of part.expenses) {
      const path = receiptPathOf(expense);
      const exported = { ...expense };
      if (path) {
        onProgress?.({
          message: `正在匯出「${part.task.name}」的收據 ${completedReceipts + 1}/${totalReceipts}`,
          completedReceipts,
          totalReceipts
        });
        exported.receipt = await exportedReceipt(path);
        completedReceipts += 1;
      }
      expenses.push(exported);
    }

    exportedTasks.push({
      ...taskData,
      members: part.members,
      expenses,
      payments: part.payments,
      settlements: part.settlements
    });
  }

  onProgress?.({ message: "正在產生 JSON 檔案", completedReceipts, totalReceipts });
  return exportJsonValue({
    format: "simple-split-data-export",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    account: userSnap.exists() ? { uid: userSnap.id, ...userSnap.data() } : { uid },
    tasks: exportedTasks
  }) as object;
}

export function downloadDataExport(data: object, exportedAt = new Date()): void {
  const date = exportedAt.toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `簡單分帳-資料匯出-${date}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
