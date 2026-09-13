/**
 * 呼叫 App Store 與 Google Play。**只有這支 import 商店的套件。**
 *
 * 判斷一律交給 `decide.ts`：這裡只負責查到、解開簽章、把欄位交出去。
 */
import { readFileSync } from "node:fs";
import { defineSecret } from "firebase-functions/params";
import { APIException, AppStoreServerAPIClient, Environment, SignedDataVerifier } from "@apple/app-store-server-library";
import { androidpublisher, auth } from "@googleapis/androidpublisher";
import { BUNDLE_ID, PACKAGE_NAME } from "./products.js";
import type { AppleTransaction, PlayPurchase } from "./decide.js";

export const APPSTORE_ISSUER_ID = defineSecret("APPSTORE_ISSUER_ID");
export const APPSTORE_KEY_ID = defineSecret("APPSTORE_KEY_ID");
/** App Store Connect 下載的 `.p8` 全文。 */
export const APPSTORE_PRIVATE_KEY = defineSecret("APPSTORE_PRIVATE_KEY");
/** App Store Connect 上 App 資訊裡的 Apple ID（數字）。正式環境驗證簽章時必填。 */
export const APPSTORE_APP_APPLE_ID = defineSecret("APPSTORE_APP_APPLE_ID");

export const APPLE_SECRETS = [APPSTORE_ISSUER_ID, APPSTORE_KEY_ID, APPSTORE_PRIVATE_KEY, APPSTORE_APP_APPLE_ID];

/** 正式環境先查：絕大多數交易在那裡。查不到再查 sandbox（TestFlight、審核人員）。 */
const APPLE_ENVIRONMENTS = [Environment.PRODUCTION, Environment.SANDBOX];

let rootCerts: Buffer[] | null = null;

function appleRootCerts(): Buffer[] {
  // 編譯後這支在 lib/purchase/，憑證在 functions/certs/。
  rootCerts ??= [readFileSync(new URL("../../certs/AppleRootCA-G3.cer", import.meta.url))];
  return rootCerts;
}

function appleClient(environment: Environment): AppStoreServerAPIClient {
  return new AppStoreServerAPIClient(
    APPSTORE_PRIVATE_KEY.value(),
    APPSTORE_KEY_ID.value(),
    APPSTORE_ISSUER_ID.value(),
    BUNDLE_ID,
    environment
  );
}

function appleVerifier(environment: Environment): SignedDataVerifier {
  const appAppleId = environment === Environment.PRODUCTION ? Number(APPSTORE_APP_APPLE_ID.value()) : undefined;
  // enableOnlineChecks：檢查憑證有沒有被撤銷。多一趟網路，但這是錢。
  return new SignedDataVerifier(appleRootCerts(), true, environment, BUNDLE_ID, appAppleId);
}

/**
 * 用交易 ID 向蘋果查這筆交易。**不相信 App 送來的簽章資料** —— 從蘋果那裡重新拿一份。
 *
 * 404 代表這個環境沒有這筆交易，換下一個環境；其他錯誤（金鑰錯、蘋果掛了）照常丟，
 * 讓 App 不結束交易、下次重送。
 */
export async function fetchAppleTransaction(transactionId: string): Promise<AppleTransaction | null> {
  for (const environment of APPLE_ENVIRONMENTS) {
    try {
      const info = await appleClient(environment).getTransactionInfo(transactionId);
      if (!info.signedTransactionInfo) continue;
      const decoded = await appleVerifier(environment).verifyAndDecodeTransaction(info.signedTransactionInfo);
      return decoded as AppleTransaction;
    } catch (err) {
      if (err instanceof APIException && err.httpStatusCode === 404) continue;
      throw err;
    }
  }
  return null;
}

/**
 * 驗證 App Store Server Notifications V2 的簽章，解出通知類型與交易。
 *
 * 通知可能來自正式或沙盒環境，驗證器要指定環境：正式環境驗不過就換沙盒。
 * 兩個都驗不過就丟出最後一個錯誤 —— 那是偽造或損毀的通知。
 */
export async function verifyAppleNotification(
  signedPayload: string
): Promise<{ notificationType: string | null; transaction: AppleTransaction | null }> {
  let lastError: unknown = null;
  for (const environment of APPLE_ENVIRONMENTS) {
    try {
      const verifier = appleVerifier(environment);
      const decoded = await verifier.verifyAndDecodeNotification(signedPayload);
      const signed = decoded.data?.signedTransactionInfo;
      const transaction = signed ? ((await verifier.verifyAndDecodeTransaction(signed)) as AppleTransaction) : null;
      return {
        notificationType: typeof decoded.notificationType === "string" ? decoded.notificationType : null,
        transaction
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** Google 用 Cloud Functions 的執行服務帳戶授權（Play Console 裡邀請它），不需要金鑰檔。 */
function makePlayClient() {
  return androidpublisher({
    version: "v3",
    auth: new auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/androidpublisher"] })
  });
}

let playClient: ReturnType<typeof makePlayClient> | null = null;

function play() {
  playClient ??= makePlayClient();
  return playClient;
}

/**
 * 查這筆 Android 購買。token 不存在、或不屬於這個 App（400／404／410）當作查不到；
 * 其他錯誤照常丟，讓 App 不結束交易、下次重送。
 */
export async function fetchPlayPurchase(productId: string, token: string): Promise<PlayPurchase | null> {
  try {
    const response = await play().purchases.products.get({ packageName: PACKAGE_NAME, productId, token });
    return response.data as PlayPurchase;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 400 || code === 404 || code === 410) return null;
    throw err;
  }
}

/** 消耗。同時也確認了這筆購買 —— 三天內沒確認，Google 會自動退款。 */
export async function consumePlayPurchase(productId: string, token: string): Promise<void> {
  await play().purchases.products.consume({ packageName: PACKAGE_NAME, productId, token });
}
