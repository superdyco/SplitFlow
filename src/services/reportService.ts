/**
 * 公開旅費報告的讀寫。
 *
 * 報告是快照，不是即時查詢 —— 公開讀取絕對不能碰既有資料，那等於把整個
 * 權限模型打開。所以產生時把該公開的數字算好寫成一份新文件，公開的只有那一份。
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { TripReport, TripReportInput } from "@/types/report";

function reportsRef(taskId: string) {
  return collection(db, "tasks", taskId, "reports");
}

/** client 端產生的隨機 id，不需要連線。 */
export function newReportId(): string {
  return doc(reportsRef("placeholder")).id;
}

/**
 * 找這個任務既有的報告。一個任務只有一份，所以 limit(1)。
 *
 * 重新產生時一定要沿用既有的 id —— 每次產生新 id 的話，已經傳出去的
 * 舊網址會全部變成死連結，而「連結永遠不變」正是這個功能的承諾。
 */
export async function findReport(taskId: string): Promise<TripReport | null> {
  const snap = await getDocs(query(reportsRef(taskId), limit(1)));
  const first = snap.docs[0];
  return first ? ({ id: first.id, ...first.data() } as TripReport) : null;
}

/**
 * 第一次產生用 create，重新產生用 update。
 *
 * 分成兩支是為了保住 `createdAt`：統一用 setDoc 全量覆寫的話，重新產生會把
 * 第一次的時間洗掉；而 setDoc 的 mergeFields 只會寫清單裡的欄位，
 * 沒列進去的 createdAt 連第一次都不會被寫入。updateDoc 就乾淨了 ——
 * 它不碰沒提到的欄位。呼叫端本來就知道有沒有既有報告。
 */
export function createReport(
  taskId: string,
  reportId: string,
  input: TripReportInput
): Promise<void> {
  return setDoc(doc(db, "tasks", taskId, "reports", reportId), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export function updateReport(
  taskId: string,
  reportId: string,
  input: TripReportInput
): Promise<void> {
  return updateDoc(doc(db, "tasks", taskId, "reports", reportId), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export function setReportActive(taskId: string, reportId: string, active: boolean): Promise<void> {
  return updateDoc(doc(db, "tasks", taskId, "reports", reportId), {
    active,
    updatedAt: serverTimestamp()
  });
}

/** 公開頁面用。讀不到就是連結錯了或報告已關閉，兩者都回傳 null。 */
export async function getPublicReport(
  taskId: string,
  reportId: string
): Promise<TripReport | null> {
  const snap = await getDoc(doc(db, "tasks", taskId, "reports", reportId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as TripReport) : null;
}
