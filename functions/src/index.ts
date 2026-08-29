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
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";

import { expenseNotification } from "./message.js";
import { recipientIds } from "./recipients.js";

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
