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
    createdBy: data.createdBy,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}

export async function listExpenses(taskId: string): Promise<Expense[]> {
  const snap = await getDocs(query(expensesRef(taskId), orderBy("createdAt", "desc")));
  return snap.docs.map(item => normalizeExpense(item.id, item.data()));
}

export async function getExpense(taskId: string, expenseId: string): Promise<Expense | null> {
  const snap = await getDoc(doc(db, "tasks", taskId, "expenses", expenseId));
  return snap.exists() ? normalizeExpense(snap.id, snap.data()) : null;
}

export async function createExpense(taskId: string, input: ExpenseInput, createdBy: string): Promise<string> {
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

  await batch.commit();
  return expenseRef.id;
}

export async function updateExpense(taskId: string, expenseId: string, input: ExpenseInput): Promise<void> {
  await updateDoc(doc(db, "tasks", taskId, "expenses", expenseId), {
    ...input,
    // 舊文件改存新格式後就不需要這個欄位了，但 Firestore 的 update 不會自動清掉，
    // 留著也不影響讀取（normalizeExpense 只在缺 splits 時才會看它）。
    updatedAt: serverTimestamp()
  });
}

export async function deleteExpense(taskId: string, expenseId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, "tasks", taskId, "expenses", expenseId));
  batch.update(doc(db, "tasks", taskId), {
    expenseCount: increment(-1),
    updatedAt: serverTimestamp()
  });
  await batch.commit();
}
