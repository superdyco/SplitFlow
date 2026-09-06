/**
 * 授予（或收回）平台管理者權限。
 *
 *   node scripts/set-admin.mjs someone@example.com
 *   node scripts/set-admin.mjs someone@example.com --revoke
 *   node scripts/set-admin.mjs --list
 *
 * 為什麼是本機腳本而不是後台裡的一個按鈕：管理者身分是 custom claim，而 claim
 * 只寫得進有 service account 的地方。這就是重點 —— 系統裡沒有任何一條路可以
 * 讓一個登入中的帳號把自己（或別人）升成管理者。第一個管理者只能從這裡來。
 *
 * ## 認證
 *
 * **firebase-tools 的登入不算數。** `firebase login` 存的是 CLI 自己的憑證，
 * Admin SDK 讀的是 Application Default Credentials，兩套完全不同 —— 已經
 * 能 `firebase deploy` 不代表這支腳本跑得動。
 *
 * 兩條路，擇一：
 *
 *   1. service account 金鑰（不用裝東西）
 *      Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰，
 *      然後把路徑放進 GOOGLE_APPLICATION_CREDENTIALS。
 *      那個檔案等於整個專案的鑰匙，放在 repo 外面。
 *
 *   2. gcloud auth application-default login（要先裝 gcloud SDK）
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function projectId() {
  // 跟 firebase CLI 讀同一個地方，才不會出現「CLI 部署到 A、腳本改到 B」。
  try {
    const rc = JSON.parse(readFileSync(join(root, ".firebaserc"), "utf8"));
    const id = rc?.projects?.default;
    if (id) return id;
  } catch {
    // 落到下面的錯誤訊息
  }
  console.error("讀不到 .firebaserc 的 projects.default，先照 .firebaserc.example 建一份");
  process.exit(1);
}

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const list = args.includes("--list");
/** 診斷用：這個專案裡到底有哪些帳號。找不到 email 時第一個該問的問題。 */
const who = args.includes("--who");
const email = args.find(arg => !arg.startsWith("--"));

if (!list && !who && !email) {
  console.error("用法：node scripts/set-admin.mjs <email> [--revoke]");
  console.error("      node scripts/set-admin.mjs --list   目前有哪些管理者");
  console.error("      node scripts/set-admin.mjs --who    這個專案裡有哪些帳號");
  process.exit(1);
}

const project = projectId();
console.log(`專案：${project}`);

initializeApp({ credential: applicationDefault(), projectId: project });
const auth = getAuth();

/**
 * 把失敗講清楚。
 *
 * 這支腳本原本把 getUserByEmail 的**所有**錯誤都印成「找不到帳號」，包括
 * 認證失敗 —— 而那句話會讓人跑去檢查自己有沒有註冊過，實際上問題在憑證。
 * 一個把 A 錯誤說成 B 錯誤的訊息，比沒有訊息更花時間。
 */
function explain(err) {
  const code = err?.code ?? "";
  const message = String(err?.message ?? err);

  if (code === "auth/user-not-found") return null;

  if (
    message.includes("Could not load the default credentials") ||
    message.includes("Could not refresh access token") ||
    code === "app/invalid-credential"
  ) {
    return [
      "讀不到憑證。",
      "",
      "firebase-tools 的登入不算數 —— Admin SDK 讀的是另一套。兩條路擇一：",
      "",
      "  1. Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰，",
      "     存在 repo 外面，然後：",
      "       export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json",
      '     （PowerShell：$env:GOOGLE_APPLICATION_CREDENTIALS="C:\\path\\key.json"）',
      "",
      "  2. 裝 gcloud SDK 之後跑：",
      "       gcloud auth application-default login",
      "",
      `原始錯誤：${message}`
    ].join("\n");
  }

  return `操作失敗：${message}`;
}

if (who) {
  try {
    const page = await auth.listUsers(20);
    if (page.users.length === 0) {
      console.log("這個專案一個帳號都沒有 —— 多半是專案選錯了。");
    } else {
      console.log(`前 ${page.users.length} 個帳號：`);
      for (const user of page.users) {
        const providers = user.providerData.map(p => p.providerId).join(", ") || "—";
        console.log(`  ${user.email ?? "(沒有 email)"}  [${providers}]  ${user.uid}`);
      }
    }
  } catch (err) {
    console.error(explain(err) ?? `操作失敗：${err}`);
    process.exit(1);
  }
  process.exit(0);
}

if (list) {
  // 沒有「查詢所有有某個 claim 的人」這種 API，只能翻。管理者是個位數，
  // 使用者是千位數，翻一遍幾秒鐘的事，一年也跑不了幾次。
  const admins = [];
  let pageToken;
  try {
    do {
      const page = await auth.listUsers(1000, pageToken);
      for (const user of page.users) {
        if (user.customClaims?.admin === true) admins.push(user);
      }
      pageToken = page.pageToken;
    } while (pageToken);
  } catch (err) {
    console.error(explain(err) ?? `操作失敗：${err}`);
    process.exit(1);
  }

  if (admins.length === 0) {
    console.log("目前沒有任何管理者");
  } else {
    console.log(`目前的管理者（${admins.length} 位）：`);
    for (const user of admins) console.log(`  ${user.email ?? "(沒有 email)"}  ${user.uid}`);
  }
  process.exit(0);
}

let user;
try {
  user = await auth.getUserByEmail(email);
} catch (err) {
  const problem = explain(err);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  console.error(`在 ${project} 找不到這個 email 的帳號：${email}`);
  console.error("");
  console.error("可能是：");
  console.error("  - 還沒在 App 或網頁上註冊過");
  console.error("  - 用 Google 登入時綁的是另一個 email");
  console.error("  - 這不是你平常在用的那個專案");
  console.error("");
  console.error("先跑 `npm run set-admin -- --who` 看看這個專案裡有哪些帳號。");
  process.exit(1);
}

/*
  保留其他 claim。setCustomUserClaims 是整包覆寫不是合併 —— 直接寫
  { admin: true } 會把這個帳號身上其他的 claim 全部抹掉。現在還沒有別的
  claim，但這種「現在剛好沒差」的寫法就是之後某天悄悄弄丟東西的那一行。
*/
const claims = { ...(user.customClaims ?? {}) };
if (revoke) delete claims.admin;
else claims.admin = true;

await auth.setCustomUserClaims(user.uid, claims);

if (revoke) {
  /*
    收回權限時一併作廢 refresh token，逼他下次換發時拿到沒有 claim 的新
    token。不做的話，他手上那張帶著 admin 的 token 最長還能再用一小時。

    授予的時候不需要這一步 —— 早一點晚一點拿到權限沒有安全問題。
  */
  await auth.revokeRefreshTokens(user.uid);
  console.log(`已收回 ${email} 的管理者權限`);
  console.log(`已作廢他的登入憑證，但手上那張最長還能用 1 小時。`);
} else {
  console.log(`已授予 ${email} 管理者權限（uid ${user.uid}）`);
  console.log("");
  console.log("注意：claim 不會立刻出現在已登入的 token 裡。");
  console.log("      請他重新登入，或等最長 1 小時後自動換發，/admin 才進得去。");
}
