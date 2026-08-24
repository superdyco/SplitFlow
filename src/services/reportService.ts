/**
 * 公開旅費報告的讀寫。
 *
 * 報告是快照，不是即時查詢 —— 公開讀取絕對不能碰既有資料，那等於把整個
 * 權限模型打開。所以產生時把該公開的數字算好寫成一份新文件，公開的只有那一份。
 */
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { PublicReport, TripReport, TripReportInput } from "@/types/report";
import type { ReportDay } from "@/utils/reportTimeline";

function reportsRef(taskId: string) {
  return collection(db, "tasks", taskId, "reports");
}

/**
 * 時間軸是後來才加的，之前產生的報告沒有這個欄位。補成空陣列，
 * 頁面就只要處理一種形狀 —— 比照 `normalizeExpense` 對舊支出的做法。
 * 那些報告重新產生一次就會真的補上。
 */
function toReport(id: string, data: DocumentData): TripReport {
  return {
    id,
    ...data,
    timeline: (data.timeline as ReportDay[] | undefined) ?? [],
    // 沒有這個欄位的舊報告一律當成沒公開 —— 補值的方向要偏向不外洩。
    listed: data.listed === true
  } as TripReport;
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
  return first ? toReport(first.id, first.data()) : null;
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

/**
 * 關掉連結時一併取消公開。
 *
 * 少了這一步，「關閉連結 → 之後又重新開啟」會把當初的公開狀態靜悄悄地
 * 一起帶回來，而使用者以為自己早就撤下來了。要重新公開就再勾一次。
 */
export function setReportActive(taskId: string, reportId: string, active: boolean): Promise<void> {
  return updateDoc(doc(db, "tasks", taskId, "reports", reportId), {
    active,
    ...(active ? {} : { listed: false }),
    updatedAt: serverTimestamp()
  });
}

/** 列進探索頁與否。連結是關的就不該列 —— 呼叫端負責擋，這裡只寫欄位。 */
export function setReportListed(taskId: string, reportId: string, listed: boolean): Promise<void> {
  return updateDoc(doc(db, "tasks", taskId, "reports", reportId), {
    listed,
    updatedAt: serverTimestamp()
  });
}

/**
 * 探索頁的清單。跨所有任務找公開的報告，所以走 collection group 查詢。
 *
 * 兩個條件都要：`listed` 是作者願意被瀏覽，`active` 是連結還開著。
 * 少了後者，作者撤下連結之後這裡還會列出一張點進去是「找不到」的卡片。
 *
 * 這個查詢需要 collection group 的複合索引，宣告在 firestore.indexes.json。
 * 規則那邊也要對應的遞迴萬用字元 match —— 單一集合的 list 規則蓋不到
 * collection group 查詢。
 */
export async function listPublicReports(max = 50): Promise<PublicReport[]> {
  const snap = await getDocs(
    query(
      collectionGroup(db, "reports"),
      where("listed", "==", true),
      where("active", "==", true),
      orderBy("updatedAt", "desc"),
      limit(max)
    )
  );

  return snap.docs.map(item => ({
    ...toReport(item.id, item.data()),
    // reports 是 tasks/{taskId}/reports 的子集合，parent.parent 就是那個任務。
    taskId: item.ref.parent.parent?.id ?? ""
  }));
}

/** 公開頁面用。讀不到就是連結錯了或報告已關閉，兩者都回傳 null。 */
export async function getPublicReport(
  taskId: string,
  reportId: string
): Promise<TripReport | null> {
  const snap = await getDoc(doc(db, "tasks", taskId, "reports", reportId));
  return snap.exists() ? toReport(snap.id, snap.data()) : null;
}
