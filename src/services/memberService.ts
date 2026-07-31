import { arrayUnion, collection, doc, getDoc, getDocs, increment, orderBy, query, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/firebase/config";
import type { TaskMember } from "@/types/member";
import type { UserProfile } from "@/types/user";

export async function getTaskMember(taskId: string, uid: string): Promise<TaskMember | null> {
  const snap = await getDoc(doc(db, "tasks", taskId, "members", uid));
  return snap.exists() ? (snap.data() as TaskMember) : null;
}

export async function listTaskMembers(taskId: string): Promise<TaskMember[]> {
  const snap = await getDocs(query(collection(db, "tasks", taskId, "members"), orderBy("joinedAt", "asc")));
  return snap.docs.map(item => item.data() as TaskMember);
}

export async function joinTask(taskId: string, profile: UserProfile): Promise<void> {
  await runTransaction(db, async transaction => {
    const taskRef = doc(db, "tasks", taskId);
    const memberRef = doc(db, "tasks", taskId, "members", profile.uid);
    const memberSnap = await transaction.get(memberRef);
    if (memberSnap.exists()) return;

    transaction.set(memberRef, {
      uid: profile.uid,
      nickname: profile.nickname,
      role: "member",
      joinedAt: serverTimestamp(),
      active: true
    });
    transaction.update(taskRef, {
      memberIds: arrayUnion(profile.uid),
      memberCount: increment(1),
      updatedAt: serverTimestamp()
    });
  });
}
