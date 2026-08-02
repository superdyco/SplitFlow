import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { SettlementSnapshot, SettlementSnapshotInput } from "@/types/settlement";

function settlementsRef(taskId: string) {
  return collection(db, "tasks", taskId, "settlements");
}

export async function listSettlements(taskId: string): Promise<SettlementSnapshot[]> {
  const snap = await getDocs(query(settlementsRef(taskId), orderBy("createdAt", "desc")));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }) as SettlementSnapshot);
}

export async function createSettlement(
  taskId: string,
  input: SettlementSnapshotInput,
  createdBy: string
): Promise<string> {
  const ref = doc(settlementsRef(taskId));
  await setDoc(ref, {
    ...input,
    createdBy,
    createdAt: serverTimestamp()
  });
  return ref.id;
}

/** 快照存下來就不能改，只能整份刪掉重存。 */
export async function deleteSettlement(taskId: string, settlementId: string): Promise<void> {
  await deleteDoc(doc(db, "tasks", taskId, "settlements", settlementId));
}
