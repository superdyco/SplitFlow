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
 * 認證用 Application Default Credentials：
 *
 *   gcloud auth application-default login
 *
 * 或把 service account 金鑰的路徑放進 GOOGLE_APPLICATION_CREDENTIALS。
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
const email = args.find(arg => !arg.startsWith("--"));

if (!list && !email) {
  console.error("用法：node scripts/set-admin.mjs <email> [--revoke]");
  console.error("      node scripts/set-admin.mjs --list");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: projectId() });
const auth = getAuth();

if (list) {
  // 沒有「查詢所有有某個 claim 的人」這種 API，只能翻。管理者是個位數，
  // 使用者是千位數，翻一遍幾秒鐘的事，一年也跑不了幾次。
  const admins = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (user.customClaims?.admin === true) admins.push(user);
    }
    pageToken = page.pageToken;
  } while (pageToken);

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
} catch {
  console.error(`找不到帳號：${email}`);
  console.error("這個 email 必須先在 App 或網頁上註冊過。");
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
