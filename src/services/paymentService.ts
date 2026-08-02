import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { Payment, PaymentInput } from "@/types/payment";

function paymentsRef(taskId: string) {
  return collection(db, "tasks", taskId, "payments");
}

export async function listPayments(taskId: string): Promise<Payment[]> {
  const snap = await getDocs(query(paymentsRef(taskId), orderBy("createdAt", "desc")));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }) as Payment);
}

export async function createPayment(taskId: string, input: PaymentInput, createdBy: string): Promise<string> {
  const paymentRef = doc(paymentsRef(taskId));
  await setDoc(paymentRef, {
    ...input,
    createdBy,
    // 收款人自己記的話當下就算確認，本來就只有他能證明錢收到了。
    confirmedAt: input.status === "confirmed" ? serverTimestamp() : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return paymentRef.id;
}

export async function confirmPayment(taskId: string, paymentId: string): Promise<void> {
  await updateDoc(doc(db, "tasks", taskId, "payments", paymentId), {
    status: "confirmed",
    confirmedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function deletePayment(taskId: string, paymentId: string): Promise<void> {
  await deleteDoc(doc(db, "tasks", taskId, "payments", paymentId));
}
