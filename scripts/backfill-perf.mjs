/**
 * 把歷史的效能樣本補算成每日直方圖。
 *
 *   node scripts/backfill-perf.mjs 2026-06-01 2026-09-06
 *   node scripts/backfill-perf.mjs 2026-06-01 2026-09-06 --dry-run
 *
 * ## 為什麼需要這支
 *
 * 系統健康那一頁讀的是 `stats/perf/days/{YYYY-MM-DD}`，一天一份直方圖，由
 * `aggregateDaily` 每天 04:00 寫。排程只從部署那天開始寫 —— 在那之前一份都
 * 沒有，所以「近 30 天」跟「近 90 天」會是空的，而且要等三個月才會自己長滿。
 *
 * 但那些數字補得回來**而且是真的**：`perf` 集合從 2026-06 就一直在寫，只是
 * 規則是 `allow read: if false`，沒有人讀得到。這跟 dau 不一樣（見
 * `DAU_SINCE` —— lastSeenAt 在上線前不存在，補出來的只會是 0），所以這支
 * 腳本不需要任何警語，補出來的就是當時真的發生過的載入時間。
 *
 * ## 為什麼是腳本不是後台的按鈕
 *
 * 因為它只會被跑一次。做成按鈕要多一個路由、一個確認對話框、一組載入與
 * 錯誤狀態，而那些東西之後每一次改後台都要跟著維護 —— 為一個一次性的動作
 * 留一個永久的介面，成本在後面。
 *
 * （`adminBackfill` 那支 callable 也會補 perf，但它沒有任何呼叫端，而且一次
 * 上限 31 天。要補三個月從這裡比較直接。）
 *
 * ## 認證
 *
 * 跟 `set-admin.mjs` 同一套：Admin SDK 讀的是 Application Default
 * Credentials，**`firebase login` 不算數**。擇一：
 *
 *   1. GOOGLE_APPLICATION_CREDENTIALS 指向 service account 金鑰
 *   2. gcloud auth application-default login
 *
 * ## 先建置 functions
 *
 * 這支腳本 import 的是 `functions/lib/`（編譯後的 JS），不是 `src/`。
 * 沒建置過會直接告訴你要跑什麼。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function projectId() {
  // 跟 firebase CLI 讀同一個地方，才不會出現「CLI 部署到 A、腳本寫到 B」。
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

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const days = args.filter(arg => !arg.startsWith("--"));
const [from, to] = days;

if (!DAY.test(from ?? "") || !DAY.test(to ?? "") || from > to) {
  console.error("用法：node scripts/backfill-perf.mjs <YYYY-MM-DD> <YYYY-MM-DD> [--dry-run]");
  console.error("例：  node scripts/backfill-perf.mjs 2026-06-01 2026-09-06");
  process.exit(1);
}

/** 日期鍵往後推一天。用 Date.UTC 當載體：這裡算的是日曆日期不是時間點。 */
function nextDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
  const pad = n => String(n).padStart(2, "0");
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

const keys = [];
for (let day = from; day <= to; day = nextDay(day)) keys.push(day);

const project = projectId();
console.log(`專案：${project}`);
console.log(`區間：${from} 至 ${to}（${keys.length} 天）${dryRun ? " · 試跑" : ""}`);

/*
  initializeApp 一定要在 import functions 的模組之前。

  admin.ts 的 db() 是延遲取得的（它的註解就寫著不要在模組頂層呼叫
  getFirestore()），所以先初始化、後 import 才拿得到正確的 app。
  順序反過來不會噴錯，只會在第一次查詢時說找不到預設 app。
*/
initializeApp({ credential: applicationDefault(), projectId: project });

/*
  pathToFileURL 不是裝飾。Windows 上把絕對路徑直接丟給 import() 會被當成
  「協定 d:」而拒絕，而那個錯誤訊息看起來完全不像「路徑要轉成 URL」。
*/
const built = join(root, "functions/lib/admin.js");
if (!existsSync(built)) {
  console.error("functions 還沒建置。先跑：");
  console.error("  npm --prefix functions run build");
  process.exit(1);
}

let rollUpPerf;
try {
  ({ rollUpPerf } = await import(pathToFileURL(built).href));
} catch (err) {
  // 檔案在但 import 失敗 —— 那是另一回事，不要說成「沒建置」。
  console.error("functions/lib/admin.js 載入失敗：");
  console.error(String(err?.message ?? err));
  process.exit(1);
}

/*
  逐天跑，不平行。

  平行會快，但這支腳本一輩子只跑幾次，而它讀的是三個月的 perf 集合 ——
  一次打十天的查詢進去省下來的那幾十秒，換來的是「哪一天失敗了」變得難講。
  補算最重要的性質是知道補到哪裡，中斷了從哪裡接。
*/
let written = 0;
let empty = 0;

for (const [index, day] of keys.entries()) {
  const progress = `[${index + 1}/${keys.length}] ${day}`;
  try {
    if (dryRun) {
      console.log(`${progress} 試跑，沒有寫入`);
      continue;
    }
    const pages = await rollUpPerf(day);
    if (pages.length === 0) {
      empty += 1;
      // 這不是失敗。那天可能真的沒有正式站的樣本 —— 文件照樣寫（空的 pages），
      // 這樣畫面才分得出「那天沒有人來」跟「那天的排程沒跑成」。
      console.log(`${progress} 沒有樣本，寫入空文件`);
    } else {
      written += 1;
      const counts = pages.map(page => page.page).join("、");
      console.log(`${progress} ${pages.length} 頁：${counts}`);
    }
  } catch (err) {
    console.error(`${progress} 失敗：${String(err?.message ?? err)}`);
    console.error(`中斷了。修好之後從這一天接下去：`);
    console.error(`  node scripts/backfill-perf.mjs ${day} ${to}`);
    process.exit(1);
  }
}

console.log(
  dryRun
    ? `試跑完成，${keys.length} 天沒有寫入任何東西`
    : `完成：${written} 天有樣本，${empty} 天是空的`
);
