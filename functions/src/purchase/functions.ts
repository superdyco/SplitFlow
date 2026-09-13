/**
 * 儲值的雲端函式：purchaseCredits、appStoreNotifications、onPlayNotification。
 *
 * **目前沒有被 index.ts 匯出**（原因寫在 index.ts 的匯出清單上方）。程式碼先進來，
 * 等商店帳號與 secrets 都好了再開。
 *
 * 判斷在 decide.ts，呼叫商店在 stores.ts，這裡只負責把兩者接起來、寫 Firestore。
 */
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { logger } from "firebase-functions";

import { balanceOf, ledgerPurchase, ledgerRevoke } from "../ai/credits.js";
import { BUNDLE_ID, PACKAGE_NAME, packFor } from "./products.js";
import {
  checkAppleTransaction,
  checkPlayPurchase,
  parsePlatform,
  planCredit,
  planRevoke,
  purchaseDocId,
  type VerifiedPurchase
} from "./decide.js";
import {
  APPLE_SECRETS,
  consumePlayPurchase,
  fetchAppleTransaction,
  fetchPlayPurchase,
  verifyAppleNotification
} from "./stores.js";

/** 跟 index.ts 同一區。 */
const REGION = "asia-east1";

let cached: Firestore | null = null;

/**
 * 延遲取得 Firestore。這個檔案被 index.ts import 時，那邊的 initializeApp() 還沒跑
 * （import 會被提升），在頂層呼叫 getFirestore() 會噴「app 尚未初始化」—— admin.ts 同一個理由。
 */
function db(): Firestore {
  if (!cached) cached = getFirestore();
  return cached;
}

/**
 * 儲值。App 付款完成之後把交易識別送來，**這裡向商店查過才加點**。
 *
 * 冪等：購買紀錄的文件 ID 就是商店的交易識別，同一筆重送不會重複加點。App 在
 * 收到回覆之前不結束交易，斷線的話商店下次會重送 —— 所以重送是常態，不是例外。
 *
 * 判斷都在 `purchase/decide.ts`，這裡只負責查商店、照答案寫回去。
 */
export const purchaseCredits = onCall(
  { region: REGION, secrets: APPLE_SECRETS, timeoutSeconds: 60 },
  async request => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "請先登入");
    // 訪客帳號登出就刪除，買的點數會跟著消失。
    if (request.auth?.token.firebase?.sign_in_provider === "anonymous") {
      throw new HttpsError("failed-precondition", "綁定帳號才能儲值");
    }

    const data = (request.data ?? {}) as {
      platform?: unknown;
      productId?: unknown;
      purchaseId?: unknown;
      verificationData?: unknown;
    };
    const platform = parsePlatform(data.platform);
    const pack = packFor(data.productId);
    if (!platform || !pack) throw new HttpsError("invalid-argument", "不認得的儲值方案");

    const rejected = () =>
      new HttpsError("failed-precondition", "這筆購買驗證不過，沒有加點。如果已經付款，請跟我們聯絡。");

    let verified: VerifiedPurchase;
    let token = "";
    let consumed = false;

    if (platform === "ios") {
      if (typeof data.purchaseId !== "string" || !data.purchaseId) {
        throw new HttpsError("invalid-argument", "缺少交易資料");
      }
      const check = checkAppleTransaction(await fetchAppleTransaction(data.purchaseId), {
        bundleId: BUNDLE_ID,
        productId: pack.productId
      });
      if (!check.ok) {
        logger.warn("App Store 交易驗證不過", { uid, purchaseId: data.purchaseId, problem: check.problem });
        throw rejected();
      }
      verified = check.purchase;
    } else {
      token = typeof data.verificationData === "string" ? data.verificationData : "";
      if (!token) throw new HttpsError("invalid-argument", "缺少交易資料");
      const check = checkPlayPurchase(await fetchPlayPurchase(pack.productId, token), {
        productId: pack.productId,
        listPriceTwd: pack.listPriceTwd
      });
      if (!check.ok) {
        // 待處理（例如超商繳費）不是錯誤：不加點，App 也不結束交易，付完商店會再通知。
        if (check.problem === "pending") return { status: "pending", credits: 0, creditsLeft: null };
        logger.warn("Google Play 購買驗證不過", { uid, problem: check.problem });
        throw rejected();
      }
      verified = check.purchase;
      consumed = check.consumed;
    }

    const purchaseId = purchaseDocId(platform, verified.storeId);
    const purchaseRef = db().collection("aiPurchases").doc(purchaseId);
    const creditsRef = db().collection("aiCredits").doc(uid);

    const outcome = await db().runTransaction(async tx => {
      const [purchaseSnap, creditsSnap] = await Promise.all([tx.get(purchaseRef), tx.get(creditsRef)]);
      const plan = planCredit(purchaseSnap.exists ? (purchaseSnap.data() ?? {}) : null, uid);
      const before = balanceOf(creditsSnap.exists ? (creditsSnap.data() ?? {}) : null);

      if (plan.kind === "already") return { status: "already" as const, creditsLeft: before };
      // 不是錯誤：App 要結束這筆交易，不然它會永遠重送、iOS 上同一個商品再也買不了。
      if (plan.kind === "other-account") return { status: "other-account" as const, creditsLeft: null };

      const now = new Date();
      const balanceAfter = before + pack.credits;
      tx.set(purchaseRef, {
        uid,
        platform,
        productId: pack.productId,
        credits: pack.credits,
        storeId: verified.storeId,
        purchaseToken: token || null,
        price: verified.price,
        currency: verified.currency,
        priceSource: verified.priceSource,
        environment: verified.environment,
        status: "credited",
        creditedAt: now,
        refundedAt: null
      });
      // freeGranted：第一次就用買的，之後第一次辨識不會再多送 3 點。
      tx.set(
        creditsRef,
        { balance: balanceAfter, freeGranted: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.set(
        creditsRef.collection("aiLedger").doc(),
        ledgerPurchase({ uid, at: now, delta: pack.credits, balanceAfter, purchaseId, productId: pack.productId })
      );
      return { status: "credited" as const, creditsLeft: balanceAfter };
    });

    /*
      Android：加完點才消耗。重送（already）時也補一次 —— 上次可能加了點卻沒消耗成功，
      而三天內沒消耗 Google 會自動退款。消耗失敗不影響已經加的點數，記一筆等下次重送。
    */
    if (platform === "android" && outcome.status !== "other-account" && !consumed) {
      try {
        await consumePlayPurchase(pack.productId, token);
      } catch (err) {
        logger.error("Google Play 消耗失敗，下次重送會再試", { uid, purchaseId, err: String(err) });
      }
    }

    logger.info("儲值", { uid, purchaseId, status: outcome.status });
    return { status: outcome.status, credits: pack.credits, creditsLeft: outcome.creditsLeft };
  }
);

/**
 * 商店退款：扣回買的點數（扣到 0 為止），購買紀錄改成 refunded。
 *
 * 通知可能重送，`planRevoke` 對已退款的紀錄會跳過。帳號刪掉之後才來的退款：
 * 沒有點數可扣，但購買紀錄照樣標成退款（`aiPurchases` 不隨刪帳號刪除）。
 */
async function revokePurchase(purchaseId: string, source: string): Promise<void> {
  const purchaseRef = db().collection("aiPurchases").doc(purchaseId);

  const plan = await db().runTransaction(async tx => {
    const purchaseSnap = await tx.get(purchaseRef);
    const purchase = purchaseSnap.exists ? (purchaseSnap.data() ?? null) : null;
    const uid = typeof purchase?.uid === "string" ? purchase.uid : null;
    const creditsRef = uid ? db().collection("aiCredits").doc(uid) : null;
    // transaction 要先讀完再寫，所以點數文件也在這裡讀。
    const creditsSnap = creditsRef ? await tx.get(creditsRef) : null;

    const decision = planRevoke(purchase, creditsSnap?.exists ? (creditsSnap.data() ?? {}) : null);
    if (decision.kind === "skip") return decision;

    const now = new Date();
    tx.update(purchaseRef, { status: "refunded", refundedAt: now });
    if (uid && creditsRef && creditsSnap?.exists) {
      tx.set(
        creditsRef,
        { balance: decision.balanceAfter, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.set(
        creditsRef.collection("aiLedger").doc(),
        ledgerRevoke({ uid, at: now, delta: decision.delta, balanceAfter: decision.balanceAfter, purchaseId })
      );
    }
    return decision;
  });

  logger.info("商店退款", { purchaseId, source, plan });
}

/**
 * App Store Server Notifications V2。網址填在 App Store Connect（正式與沙盒兩個欄位都填這支）。
 *
 * 簽章驗不過回 400。其他類型一律 200 —— 回非 200 蘋果會一直重送，而消耗型商品
 * 本來就只會收到退款相關的通知。
 */
export const appStoreNotifications = onRequest({ region: REGION, secrets: APPLE_SECRETS }, async (req, res) => {
  const signedPayload = (req.body as { signedPayload?: unknown } | undefined)?.signedPayload;
  if (req.method !== "POST" || typeof signedPayload !== "string") {
    res.status(400).send("bad request");
    return;
  }

  let decoded: Awaited<ReturnType<typeof verifyAppleNotification>>;
  try {
    decoded = await verifyAppleNotification(signedPayload);
  } catch (err) {
    logger.warn("App Store 通知驗證不過", { err: String(err) });
    res.status(400).send("invalid");
    return;
  }

  if (decoded.notificationType === "REFUND" && decoded.transaction?.transactionId) {
    await revokePurchase(purchaseDocId("ios", decoded.transaction.transactionId), "app-store");
  }
  res.status(200).send("ok");
});

/**
 * Google Play 即時開發者通知（Pub/Sub 主題 `play-billing`）。只處理一次性商品的作廢購買。
 * 部署時 Firebase 會自動建立主題；Google 那邊的發布權限要手動給（計畫 Task 11）。
 */
export const onPlayNotification = onMessagePublished({ topic: "play-billing", region: REGION }, async event => {
  let message: {
    packageName?: string;
    testNotification?: unknown;
    voidedPurchaseNotification?: { orderId?: string; productType?: number };
  };
  try {
    message = event.data.message.json;
  } catch (err) {
    logger.warn("Play 通知不是 JSON", { err: String(err) });
    return;
  }

  if (message?.packageName !== PACKAGE_NAME) return;
  if (message.testNotification) {
    logger.info("Play 測試通知");
    return;
  }

  const voided = message.voidedPurchaseNotification;
  // productType 2 是一次性商品；1 是訂閱，我們沒有。
  if (voided?.productType === 2 && voided.orderId) {
    await revokePurchase(purchaseDocId("android", voided.orderId), "google-play");
  }
});
