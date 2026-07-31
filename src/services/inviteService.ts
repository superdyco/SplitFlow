import { doc, getDoc, serverTimestamp, setDoc, type WriteBatch } from "firebase/firestore";
import { db } from "@/firebase/config";
import type { Invite, Task } from "@/types/task";

export function createInviteCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

export async function createInvite(inviteCode: string, task: Task): Promise<void> {
  await setDoc(doc(db, "invites", inviteCode), {
    taskId: task.id,
    taskName: task.name,
    defaultCurrency: task.defaultCurrency,
    startDate: task.startDate,
    endDate: task.endDate,
    createdBy: task.ownerId,
    active: true,
    createdAt: serverTimestamp()
  });
}

export function addInviteToBatch(batch: WriteBatch, inviteCode: string, task: Task): void {
  batch.set(doc(db, "invites", inviteCode), {
    taskId: task.id,
    taskName: task.name,
    defaultCurrency: task.defaultCurrency,
    startDate: task.startDate,
    endDate: task.endDate,
    createdBy: task.ownerId,
    active: true,
    createdAt: serverTimestamp()
  });
}

export async function getInvite(inviteCode: string): Promise<Invite | null> {
  const snap = await getDoc(doc(db, "invites", inviteCode));
  return snap.exists() ? (snap.data() as Invite) : null;
}
