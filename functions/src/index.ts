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
import { readWeather, weatherUrl, type WeatherResult } from "./weather.js";
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

/** 天氣查詢的逾時。使用者在等預覽，不能讓表單卡住。 */
const WEATHER_TIMEOUT_MS = 6000;

/**
 * 真的去打 Open-Meteo。**任何失敗都回 null，不丟例外。**
 *
 * 天氣是裝飾不是資料 —— 查不到就是沒有，跟自己打字的地點沒有座標是同一種
 * 缺席。這個原則跟報告的地圖一樣：「地圖是加分不是必要，拍不出來也照樣
 * 產得出報告」。
 */
async function fetchWeather(
  lat: number,
  lng: number,
  date: string,
  time: string
): Promise<WeatherResult | null> {
  const today = new Date().toISOString().slice(0, 10);
  const url = weatherUrl({ lat, lng, date, today });

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS) });
    // 錯誤是 400 帶 JSON body，所以不看狀態碼直接讀 —— reason 是唯一講得出
    // 「為什麼這筆沒天氣」的東西。
    const json = await res.json();
    const result = readWeather(json, time);
    if (!result) logger.info("天氣查不到", { url, body: json });
    return result;
  } catch (err) {
    logger.info("天氣查詢失敗", { url, err: String(err) });
    return null;
  }
}

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
 * 表單的天氣預覽。地點與日期都有了就呼叫這裡。
 *
 * 為什麼不讓前端直接打 Open-Meteo：`functions/` 與 `src/` 是兩個獨立套件、
 * 沒有共用程式碼，前端自己查的話網頁一份、Flutter 一份、離線補寫的觸發器
 * 再一份 —— 同一段邏輯三份，分岔的症狀是「同一筆支出在手機和網頁顯示不同
 * 天氣」。
 */
export const lookupWeather = onCall({ region: REGION }, async request => {
  // 不驗證呼叫者的話，這就是一個掛在我們帳單上的公開天氣代理。
  // 只要登入就好 —— 不必是那個任務的成員，因為天氣不是任何人的秘密。
  if (!request.auth) throw new HttpsError("unauthenticated", "請先登入");

  const { lat, lng, date, time } = request.data ?? {};
  if (typeof lat !== "number" || typeof lng !== "number" || typeof date !== "string") {
    throw new HttpsError("invalid-argument", "需要座標與日期");
  }

  return await fetchWeather(lat, lng, date, typeof time === "string" ? time : "");
});

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

/**
 * 補寫離線記的帳的天氣。
 *
 * **這個觸發器只服務一種情況**：使用者記帳當下沒訊號，拿不到 callable 的
 * 預覽。文件之後同步上去，這裡才跑。有預覽的那些進來時已經帶著 weather，
 * 會直接跳過。
 *
 * 刻意不併進 `onExpenseCreated`：那支函式把推播的所有步驟包在同一個
 * try/catch 裡，而且對單人任務會提早 return。併進去會讓 Open-Meteo 掛掉時
 * 推播也不送，而且單人旅程永遠不會有天氣。
 */
export const onExpenseWeather = onDocumentCreated(
  {
    document: "tasks/{taskId}/expenses/{expenseId}",
    region: REGION
  },
  async event => {
    const expense = event.data?.data();
    if (!expense) return;

    // 已經有了就不動 —— 前端存進來的預覽值優先，那是使用者看過的那個值。
    if (expense.weather) return;

    const place = expense.place as { lat?: number; lng?: number } | null | undefined;
    const lat = place?.lat;
    const lng = place?.lng;
    // 自己打字的地點沒有座標。這跟地圖是同一個限制。
    if (typeof lat !== "number" || typeof lng !== "number") return;

    const date = typeof expense.date === "string" ? expense.date : "";
    if (!date) return;

    const weather = await fetchWeather(
      lat,
      lng,
      date,
      typeof expense.time === "string" ? expense.time : ""
    );
    if (!weather) return;

    try {
      await event.data!.ref.update({ weather });
    } catch (err) {
      // 補寫失敗就算了。這支函式的原則跟推播那支一樣：寧可少一個裝飾，
      // 也不要讓例外冒出去在雲端留一則沒人看的錯誤日誌。
      logger.info("天氣補寫失敗", { err: String(err) });
    }
  }
);
