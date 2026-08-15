import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentData
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { Expense, ExpenseInput } from "@/types/expense";
import { allocate } from "@/utils/currency";
import { compareExpenses } from "@/utils/expenseDate";

function expensesRef(taskId: string) {
  return collection(db, "tasks", taskId, "expenses");
}

/**
 * 自訂分攤與匯率是後來才加的，之前建立的支出只有 splitMemberIds、沒有 splits/rate/baseAmount。
 * 讀取時就地補成新格式，後面的計算與畫面只要處理一種形狀。舊文件被編輯過就會真的寫成新格式。
 */
function normalizeExpense(id: string, data: DocumentData): Expense {
  const amount = data.amount as number;
  let splits = data.splits as Record<string, number> | undefined;

  if (!splits) {
    const legacyIds = (data.splitMemberIds as string[] | undefined) ?? [];
    const shares = allocate(amount, legacyIds.map(() => 1));
    splits = Object.fromEntries(legacyIds.map((uid, index) => [uid, shares[index]]));
  }

  return {
    id,
    title: data.title,
    category: data.category,
    amount,
    currency: data.currency,
    rate: (data.rate as number | undefined) ?? null,
    baseAmount: (data.baseAmount as number | undefined) ?? null,
    paidBy: data.paidBy,
    splitMode: (data.splitMode as Expense["splitMode"] | undefined) ?? "even",
    splits,
    place: (data.place as Expense["place"] | undefined) ?? null,
    receipt: (data.receipt as Expense["receipt"] | undefined) ?? null,
    note: (data.note as string | undefined) ?? "",
    date: (data.date as string | undefined) ?? null,
    time: (data.time as string | undefined) ?? "",
    createdBy: data.createdBy,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}

/**
 * 查詢維持 orderBy("createdAt")，排序在前端用 `compareExpenses` 做。
 * 改成 orderBy("date") 的話，Firestore 會把沒有 date 欄位的文件整個排除掉，
 * 舊支出就直接從列表消失了。
 */
export async function listExpenses(taskId: string): Promise<Expense[]> {
  const snap = await getDocs(query(expensesRef(taskId), orderBy("createdAt", "desc")));
  return snap.docs.map(item => normalizeExpense(item.id, item.data())).sort(compareExpenses);
}

export async function getExpense(taskId: string, expenseId: string): Promise<Expense | null> {
  const snap = await getDoc(doc(db, "tasks", taskId, "expenses", expenseId));
  return snap.exists() ? normalizeExpense(snap.id, snap.data()) : null;
}

export interface CreateExpenseResult {
  /** Firestore 的文件 id。client 端產生，離線也拿得到。 */
  id: string;
  /** 伺服器確認的 promise。離線時不會 resolve，呼叫端要用 settleWrite 包起來。 */
  synced: Promise<void>;
}

/**
 * 這三個寫入函式都刻意不 await，把「要不要等伺服器」交給呼叫端用 `settleWrite` 決定。
 *
 * Firestore 的寫入 promise 要等伺服器確認才 resolve，離線時永遠不會回來 ——
 * 但資料已經安全排進本機佇列了。在這裡 await 的話畫面會卡死在「儲存中...」。
 */
export function createExpense(
  taskId: string,
  input: ExpenseInput,
  createdBy: string
): CreateExpenseResult {
  const expenseRef = doc(expensesRef(taskId));
  const batch = writeBatch(db);

  batch.set(expenseRef, {
    ...input,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.update(doc(db, "tasks", taskId), {
    expenseCount: increment(1),
    updatedAt: serverTimestamp()
  });

  return { id: expenseRef.id, synced: batch.commit() };
}

export function updateExpense(taskId: string, expenseId: string, input: ExpenseInput): Promise<void> {
  return updateDoc(doc(db, "tasks", taskId, "expenses", expenseId), {
    ...input,
    // 舊文件改存新格式後就不需要這個欄位了，但 Firestore 的 update 不會自動清掉，
    // 留著也不影響讀取（normalizeExpense 只在缺 splits 時才會看它）。
    updatedAt: serverTimestamp()
  });
}

export function deleteExpense(taskId: string, expenseId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, "tasks", taskId, "expenses", expenseId));
  batch.update(doc(db, "tasks", taskId), {
    expenseCount: increment(-1),
    updatedAt: serverTimestamp()
  });
  return batch.commit();
}
