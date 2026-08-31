/**
 * 有人新增支出時通知同任務的其他成員。
 *
 * 為什麼是 Firestore 觸發器而不是讓 client 寫完之後自己呼叫：
 *
 *   - client 可以說謊 —— 沒記帳也能叫別人的手機響
 *   - **離線記帳根本不會觸發** —— 排隊中的寫入是 Firestore SDK 之後自己
 *     送出的，那時 client 的程式碼早就沒在跑了
 *
 * 整支函式的原則是**寧可不推播，也不要讓例外冒出去**。這是使用者記帳流程的
 * 旁支，推播沒送出只是少一則通知；讓它 throw 除了在雲端留下一則沒人看的
 * 錯誤日誌之外，什麼也改變不了。
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

import { expenseNotification } from "./message.js";
import { recipientIds } from "./recipients.js";
import { pickSuccessor, type SuccessorCandidate } from "./successor.js";

initializeApp();

const db = getFirestore();

/**
 * 跟 Firestore 同一區（用 `firebase firestore:databases:get "(default)"` 查到的）。
 * 跨區會讓每次觸發多一段延遲。
 */
const REGION = "asia-east1";

/** FCM 一次最多送 500 個 token。 */
const BATCH = 500;

export const onExpenseCreated = onDocumentCreated(
  {
    document: "tasks/{taskId}/expenses/{expenseId}",
    region: REGION
  },
  async event => {
    const expense = event.data?.data();
    if (!expense) return;

    const taskId = event.params.taskId;
    const createdBy = (expense.createdBy as string | undefined) ?? "";

    try {
      const taskSnap = await db.doc(`tasks/${taskId}`).get();
      const task = taskSnap.data();
      if (!task) return;

      const targets = recipientIds((task.memberIds as string[]) ?? [], createdBy);
      // 一個人的任務不用通知任何人，直接結束 —— 不要白跑一趟查 token。
      if (targets.length === 0) return;

      // 記帳的人可能已經被移除，那時查不到 member 文件；文案那邊會退回「有人」。
      const authorSnap = await db.doc(`tasks/${taskId}/members/${createdBy}`).get();
      const author = (authorSnap.data()?.nickname as string | undefined) ?? "";

      const { title, body } = expenseNotification({
        taskName: (task.name as string | undefined) ?? "",
        author,
        expenseTitle: (expense.title as string | undefined) ?? "",
        amount: (expense.amount as number | undefined) ?? 0,
        currency: (expense.currency as string | undefined) ?? ""
      });

      // 虛擬成員沒有帳號就沒有 token 文件，這一步自然把他們過濾掉。
      //
      // 記下每個 token 屬於誰：送失敗要刪掉那份文件，而 FCM 只回報 token
      // 字串。計畫原本是失敗後再查一次 users/*/tokens 去比對，那是多跑一輪
      // 讀取去換一個這裡就知道的答案 —— 而且中間 token 若換掉會對不上。
      const owners = new Map<string, string>();
      const tokenDocs = await Promise.all(
        targets.map(uid => db.collection(`users/${uid}/tokens`).get())
      );
      tokenDocs.forEach((snap, index) => {
        for (const doc of snap.docs) owners.set(doc.id, targets[index]);
      });

      const tokens = [...owners.keys()];
      if (tokens.length === 0) return;

      const stale: string[] = [];

      for (let i = 0; i < tokens.length; i += BATCH) {
        const chunk = tokens.slice(i, i + BATCH);
        const response = await getMessaging().sendEachForMulticast({
          tokens: chunk,
          notification: { title, body },
          // 點通知要導到哪一個任務。data 的值只能是字串。
          data: { taskId }
        });

        // 死 token 不清的話會一直累積，每次推播都白送一次。
        response.responses.forEach((result, index) => {
          if (result.success) return;
          const code = result.error?.code;
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token"
          ) {
            stale.push(chunk[index]);
          } else {
            // 其他錯誤（額度、暫時性故障）不刪 token —— 刪錯的話那台裝置
            // 要等到重開 App 才會重新註冊，中間完全收不到通知。
            logger.warn("推播失敗", { code, taskId });
          }
        });
      }

      await Promise.all(
        stale.map(token => {
          const uid = owners.get(token);
          return uid ? db.doc(`users/${uid}/tokens/${token}`).delete() : undefined;
        })
      );
    } catch (err) {
      // 見檔頭：這是記帳的旁支，讓它安靜地失敗。留下 taskId 才查得出是哪一次。
      logger.error("通知送不出去", { taskId, err });
    }
  }
);

/**
 * 刪除自己的帳號。App Store 指引 5.1.1(v) 要求 App 內就能發起。
 *
 * **帳目留下，身分標記為已刪除。** 一個人的支出不只是他自己的資料，也是同行者
 * 的共同紀錄 —— 單方面抽掉會讓別人已經算好的帳突然對不上，而他付過的錢別人
 * 可能還沒還。
 *
 * 為什麼在伺服器端做：現行規則下成員刪不掉自己的成員文件（`allow delete` 要
 * admin），也沒有任何路徑改得了 `ownerId`。要在用戶端完成就得為一輩子用一次
 * 的操作永久開兩個洞。而且用戶端跑到一半斷線會停在半刪除狀態，沒有人收拾得了。
 */
export const deleteAccount = onCall({ region: REGION }, async request => {
  // uid 只從 auth context 拿。只要它來自參數，任何人就能刪任何人的帳號。
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }

  let deletedTasks = 0;
  let transferredTasks = 0;
  let leftTasks = 0;

  const tasks = await db.collection("tasks").where("memberIds", "array-contains", uid).get();

  for (const taskSnap of tasks.docs) {
    const task = taskSnap.data();
    const memberIds: string[] = task.memberIds ?? [];
    const adminIds: string[] = task.adminIds ?? [];

    // 冪等：上一次跑到一半就成功處理過的任務直接跳過。
    if (!memberIds.includes(uid)) continue;

    if (task.ownerId === uid) {
      const membersSnap = await taskSnap.ref.collection("members").orderBy("joinedAt").get();
      const candidates: SuccessorCandidate[] = membersSnap.docs.map(doc => ({
        uid: doc.id,
        active: doc.data().active !== false,
        virtual: doc.data().virtual === true
      }));

      const successor = pickSuccessor(adminIds, candidates, uid);

      if (successor === null) {
        // 沒有真人接得了手，留著任務也沒有人看得到。
        await db.recursiveDelete(taskSnap.ref);
        deletedTasks += 1;
        continue;
      }

      await taskSnap.ref.update({
        ownerId: successor,
        adminIds: [...new Set([...adminIds.filter(id => id !== uid), successor])],
        memberIds: memberIds.filter(id => id !== uid),
        memberCount: Math.max(0, memberIds.length - 1),
        updatedAt: FieldValue.serverTimestamp()
      });
      // 接手的人角色也要跟著改，不然成員列上不會顯示他是擁有者。
      await taskSnap.ref.collection("members").doc(successor).set({ role: "owner" }, { merge: true });
      transferredTasks += 1;
    } else {
      await taskSnap.ref.update({
        adminIds: adminIds.filter(id => id !== uid),
        memberIds: memberIds.filter(id => id !== uid),
        memberCount: Math.max(0, memberIds.length - 1),
        updatedAt: FieldValue.serverTimestamp()
      });
      leftTasks += 1;
    }

    // 成員文件留著。支出的 splits 以 uid 當 key，刪掉之後成員列與結算只剩
    // 一串裸 uid，其他人看不懂那筆帳是誰的。
    //
    // 暱稱不覆寫：畫面自己組「小美（已刪除）」。而且結算快照的 memberNames
    // 本來就永久保存了當時的暱稱，覆寫並不會真的抹掉什麼。
    await taskSnap.ref.collection("members").doc(uid).set(
      { active: false, deleted: true },
      { merge: true }
    );
  }

  await db.recursiveDelete(db.collection("users").doc(uid).collection("tokens"));
  await db.recursiveDelete(db.collection("users").doc(uid).collection("favorites"));
  await db.collection("users").doc(uid).delete();

  // Auth 放最後。反過來的話中途失敗使用者已經登不進來，永遠無法重試，資料就
  // 卡在半刪除狀態。放最後，任何一步失敗他都還在，再按一次即可。
  try {
    await getAuth().deleteUser(uid);
  } catch (error) {
    // 已經刪掉了就是成功 —— 這是重試會走到的路。
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") throw error;
  }

  logger.info("帳號已刪除", { uid, deletedTasks, transferredTasks, leftTasks });
  return { deletedTasks, transferredTasks, leftTasks };
});
