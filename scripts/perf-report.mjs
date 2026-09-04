/**
 * 把 perf 集合的樣本整理成「到底卡在哪一段」。
 *
 * 存在的理由：Firestore Console 查得到單筆，但回答不了效能問題 —— 一筆 3 秒
 * 可能只是那個人在電梯裡。要看的是分布（p50 跟 p95 差多少）、是哪一段慢、
 * 以及冷啟動跟站內導航有沒有差。這些 Console 都算不出來。
 *
 * 走 firebase-admin，會繞過 Security Rules —— perf 的規則是「誰都不能讀」，
 * 所以這是唯一讀得到的路。
 *
 * 用法：
 *   node scripts/perf-report.mjs --key <service-account.json> [--days 7] [--page tasks]
 *
 * 只用 day 做查詢條件（單一欄位不等式，不需要複合索引）；page 與 mode 在
 * 記憶體裡篩。樣本數是「幾個人 × 幾天」的等級，撈回來自己濾比開索引划算。
 */
import { readFileSync } from "node:fs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

const keyPath = arg("key") ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
const days = Number(arg("days") ?? 7);
const page = arg("page") ?? "tasks";
/** 預設只看正式站：dev 跑在筆電上而且 vite 不打包，數字沒有參考價值。 */
const mode = arg("mode") ?? "prod";
const limit = Number(arg("limit") ?? 5000);

if (!keyPath) {
  console.error(`
需要服務帳戶金鑰：

  --key   Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰
          ** 不要放進 repo **

例：
  node scripts/perf-report.mjs --key C:/keys/splitflow.json --days 7
  node scripts/perf-report.mjs --key C:/keys/splitflow.json --page tasks-costs
  node scripts/perf-report.mjs --key C:/keys/splitflow.json --mode dev
`);
  process.exit(1);
}

// ---------------------------------------------------------------- 統計

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/**
 * p50 與 p95 一起看才有意義。
 *
 * 只看平均會被幾筆極端值拉走；只看 p95 會把「大家都慢」跟「少數人很慢」
 * 混為一談。兩個數字差很多 = 某些情境下才慢（通常是冷啟動或差網路），
 * 兩個都大 = 這一段本來就慢，跟情境無關。
 */
function summarize(values) {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(0, ...values)
  };
}

function pad(text, width) {
  const value = String(text);
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padLeft(text, width) {
  const value = String(text);
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function table(title, rows) {
  console.log(`\n${title}`);
  console.log(`  ${pad("", 14)}${padLeft("樣本", 6)}${padLeft("p50", 8)}${padLeft("p95", 9)}${padLeft("最慢", 9)}`);
  for (const [label, stat] of rows) {
    console.log(
      `  ${pad(label, 14)}${padLeft(stat.n, 6)}${padLeft(`${stat.p50}ms`, 8)}${padLeft(`${stat.p95}ms`, 9)}${padLeft(`${stat.max}ms`, 9)}`
    );
  }
}

/** 次數分布。看「最慢的那一段是誰」與「冷啟動佔多少」用的。 */
function tally(samples, pick) {
  const counts = new Map();
  for (const sample of samples) {
    const key = String(pick(sample) ?? "（沒有）");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function share(title, entries, total) {
  console.log(`\n${title}`);
  for (const [label, count] of entries) {
    const percent = Math.round((count / total) * 100);
    console.log(`  ${pad(label, 20)}${padLeft(count, 5)}  ${"█".repeat(Math.round(percent / 4))} ${percent}%`);
  }
}

// ---------------------------------------------------------------- 主流程

function cutoffDay(daysBack) {
  const at = new Date();
  at.setDate(at.getDate() - daysBack + 1);
  const p = value => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

async function main() {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))) });
  const db = getFirestore();

  const since = cutoffDay(days);
  const snap = await db.collection("perf").where("day", ">=", since).limit(limit).get();
  const samples = snap.docs
    .map(item => item.data())
    .filter(sample => sample.page === page && sample.mode === mode);

  if (!samples.length) {
    console.log(`\n${since} 之後沒有 page=${page} mode=${mode} 的樣本。`);
    console.log("如果剛部署完，先在手機上進幾次那一頁再跑一次。");
    return;
  }

  console.log(`\nSplitFlow 效能報告`);
  console.log(`頁面 ${page}　模式 ${mode}　範圍 ${since} 起 ${days} 天　樣本 ${samples.length} 筆`);

  // 分段：把每一筆的同名分段收在一起。
  const byPhase = new Map();
  for (const sample of samples) {
    for (const [name, ms] of Object.entries(sample.phases ?? {})) {
      if (!byPhase.has(name)) byPhase.set(name, []);
      byPhase.get(name).push(ms);
    }
  }

  const phaseRows = [...byPhase.entries()]
    .map(([name, values]) => [name, summarize(values)])
    .sort((a, b) => b[1].p50 - a[1].p50);

  table("各分段耗時（由慢到快，看 p50）", phaseRows);

  /*
    sinceStart 只對冷啟動有意義。站內導航時它是「這次開啟已經多久」——
    那不是等待成本，把它跟其他數字並排會讓人以為使用者等了兩分半。
  */
  const coldSamples = samples.filter(sample => sample.detail?.cold);
  const overall = [["總計", summarize(samples.map(sample => sample.total))]];
  if (coldSamples.length) {
    overall.push(
      // 這兩個是獨立記的，不是分段 —— 第一次導航去哪是裝置決定的，
      // 分段只看得到「這一次導航等了多久」，看不到帳算在別次導航上的部分。
      ["冷啟動：還原登入", summarize(coldSamples.map(sample => sample.detail?.authRestoreMs ?? 0))],
      ["冷啟動：讀個人資料", summarize(coldSamples.map(sample => sample.detail?.profileLoadMs ?? 0))],
      ["冷啟動：進頁面之前", summarize(coldSamples.map(sample => sample.sinceStart ?? 0))],
      ["冷啟動：TTFB", summarize(coldSamples.map(sample => sample.boot?.ttfb ?? 0))],
      ["冷啟動：DOM 就緒", summarize(coldSamples.map(sample => sample.boot?.dom ?? 0))]
    );
  }
  table("整體", overall);

  /*
    逐日與逐版本的走勢。

    上面每一張表回答的都是「現在卡在哪一段」，但「**又**變慢了」是另一種問題
    —— 它問的是「什麼時候開始的」，而把七天的樣本混在一起算 p50 正好會把那個
    轉折抹平。分開列就看得出來是某一天起跳（資料長大、Firestore 那邊出事）
    還是某一版起跳（我們自己改壞的）。

    version 是 build 時記下的 git short SHA（見 vite.config.js 的 buildVersion），
    所以某一版突然變慢的話，`git log` 直接查得到那一版動了什麼。

    只列總計不列分段：這一區是拿來定位「哪一天、哪一版」的，定位到了再回頭
    看上面的分段表。兩件事混在一張表裡誰都讀不下去。
  */
  function trend(title, key) {
    const buckets = new Map();
    for (const sample of samples) {
      const value = String(sample[key] ?? "（沒有記錄）");
      if (!buckets.has(value)) buckets.set(value, []);
      buckets.get(value).push(sample.total);
    }
    table(
      title,
      [...buckets.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([label, values]) => [label, summarize(values)])
    );
  }

  trend("逐日走勢（總計）", "day");
  trend("逐版本走勢（總計）", "version");

  if (!coldSamples.length) {
    console.log("");
    console.log("  （沒有冷啟動樣本。要看的話得把 App 從多工完全滑掉再開。）");
  }

  share("最慢的是哪一段", tally(samples, sample => sample.slowest), samples.length);

  const warm = samples.filter(sample => !sample.detail?.cold);
  table("冷啟動 vs 站內導航（總計）", [
    ["冷啟動", summarize(coldSamples.map(sample => sample.total))],
    ["站內導航", summarize(warm.map(sample => sample.total))]
  ]);

  const cached = samples.filter(sample => sample.detail?.fromCache);
  const live = samples.filter(sample => sample.detail?.fromCache === false);
  if (cached.length || live.length) {
    table("查詢命中離線快取 vs 連伺服器（總計）", [
      ["命中快取", summarize(cached.map(sample => sample.total))],
      ["連伺服器", summarize(live.map(sample => sample.total))]
    ]);
  }

  /*
    本機快取模式的對照。比的是 query 那一段而不是總計 —— 總計會被其他分段稀釋，
    而這個實驗要問的問題只有一個：換掉快取之後，等伺服器那一段有沒有變短。

    舊的樣本沒有這個欄位（功能上線之前寫的），歸在「沒有記錄」，那些一律是 indexeddb。
  */
  const byCache = new Map();
  for (const sample of samples) {
    const key = sample.cache ?? "沒有記錄（indexeddb）";
    if (!byCache.has(key)) byCache.set(key, []);
    byCache.get(key).push(sample.phases?.query ?? 0);
  }
  table(
    "本機快取模式 × query",
    [...byCache.entries()].map(([mode, values]) => [mode, summarize(values)])
  );

  /*
    卡住補救（切斷再重連）的成效。這是驗收那個修法唯一的依據：

      - 觸發率 = 連線多常是死的
      - 觸發那一群的 query = 修法把 30 秒壓到多少（目標是門檻 + 重連的時間）

    沒觸發那一群本來就快，拿來當對照組。
  */
  const recovered = samples.filter(sample => sample.detail?.recovered);
  const untouched = samples.filter(sample => !sample.detail?.recovered);
  table("卡住補救 × query", [
    ["有觸發", summarize(recovered.map(sample => sample.phases?.query ?? 0))],
    ["沒觸發", summarize(untouched.map(sample => sample.phases?.query ?? 0))]
  ]);
  console.log(`  觸發率 ${Math.round((recovered.length / samples.length) * 100)}%`);

  /*
    背景時間 × query。這一區是為了回答「卡 30 秒的是不是都剛從背景回來」——
    在此之前這個變數根本沒被記錄過，只能猜。

    分桶而不是散點，是因為要看的是「哪個區間開始出事」，不是每一筆的確切秒數。
  */
  function backgroundBucket(sample) {
    const ms = sample.detail?.hiddenMs;
    if (ms === undefined) return "沒有記錄（舊版）";
    if (!ms) return "沒進過背景";
    if (ms < 30_000) return "背景 <30 秒";
    if (ms < 120_000) return "背景 30 秒–2 分";
    return "背景 >2 分";
  }

  const byBackground = new Map();
  for (const sample of samples) {
    const key = backgroundBucket(sample);
    if (!byBackground.has(key)) byBackground.set(key, []);
    byBackground.get(key).push(sample.phases?.query ?? 0);
  }
  table(
    "背景時間 × query",
    [...byBackground.entries()].map(([bucket, values]) => [bucket, summarize(values)])
  );

  // 冷啟動判斷壞掉時留下的線索：第一次導航到底跑去哪了。
  share("這個分頁第一次導航去哪", tally(samples, sample => sample.detail?.firstPath), samples.length);

  /*
    平台對照。回答的是「為什麼手機卡、桌機不卡」——同一份程式碼、同一個
    Firestore、同一個網路，剩下的差別就是這一欄。

    iOS 上的「Chrome」仍然是 WebKit（Apple 不准別的引擎），所以標籤照實寫成
    iPhone Chrome，但判讀時要記得它跟 Mac Chrome 不是同一個引擎。
  */
  function platform(sample) {
    const ua = sample.userAgent ?? "";
    const os = /iPhone/.test(ua)
      ? "iPhone"
      : /iPad/.test(ua)
        ? "iPad"
        : /Android/.test(ua)
          ? "Android"
          : /Macintosh/.test(ua)
            ? "Mac"
            : /Windows/.test(ua)
              ? "Windows"
              : "其他";
    const browser = /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /Safari/.test(ua)
          ? "Safari"
          : "其他";
    return `${os} ${browser} ${sample.installed ? "PWA" : "瀏覽器"}`;
  }

  const byPlatform = new Map();
  for (const sample of samples) {
    const key = platform(sample);
    if (!byPlatform.has(key)) byPlatform.set(key, []);
    byPlatform.get(key).push(sample);
  }

  table(
    "平台 × query",
    [...byPlatform.entries()].map(([name, rows]) => [
      name,
      summarize(rows.map(sample => sample.phases?.query ?? 0))
    ])
  );
  for (const [name, rows] of byPlatform) {
    const stalled = rows.filter(sample => sample.detail?.recovered).length;
    console.log(`  ${name}：卡住 ${stalled}/${rows.length} 次`);
  }

  // 冷啟動的開機成本也要照平台分：3.3 秒的空窗是不是只有手機才有。
  const coldByPlatform = new Map();
  for (const sample of coldSamples) {
    const key = platform(sample);
    if (!coldByPlatform.has(key)) coldByPlatform.set(key, []);
    coldByPlatform.get(key).push(sample.sinceStart ?? 0);
  }
  if (coldByPlatform.size) {
    table(
      "平台 × 冷啟動進頁面之前",
      [...coldByPlatform.entries()].map(([name, values]) => [name, summarize(values)])
    );
  }

  // 這一區是目前最大的那塊在哪裡：桌機實測 1,053ms，手機推算約 3,300ms。
  const authByPlatform = new Map();
  for (const sample of coldSamples) {
    const key = platform(sample);
    if (!authByPlatform.has(key)) authByPlatform.set(key, []);
    authByPlatform.get(key).push(sample.detail?.authRestoreMs ?? 0);
  }
  if (authByPlatform.size) {
    table(
      "平台 × 還原登入狀態",
      [...authByPlatform.entries()].map(([name, values]) => [name, summarize(values)])
    );
  }

  /*
    平台 × IndexedDB。這一區要分辨手機冷啟動那 1.6 秒是儲存還是網路：
    Firebase Auth 挑儲存方式時會真的開一次 IndexedDB（寫一筆再刪掉），
    這裡量的是同一件事。差 10 倍就是它，兩邊都快就要往網路那邊查。

    -1 代表量不到（無痕模式等），排除掉才不會把平均拉成負的。
  */
  const probeByPlatform = new Map();
  for (const sample of samples) {
    const ms = sample.probe?.idbMs;
    if (ms === undefined || ms === null || ms < 0) continue;
    const key = platform(sample);
    if (!probeByPlatform.has(key)) probeByPlatform.set(key, []);
    probeByPlatform.get(key).push(ms);
  }
  if (probeByPlatform.size) {
    table(
      "平台 × 開一次 IndexedDB",
      [...probeByPlatform.entries()].map(([name, values]) => [name, summarize(values)])
    );
  }

  share("網路", tally(samples, sample => sample.network?.effectiveType), samples.length);
  share("裝置", tally(samples, sample => (sample.installed ? "已安裝的 App" : "瀏覽器")), samples.length);
  share("版本", tally(samples, sample => sample.version), samples.length);

  // 最慢的幾筆：分布看不出的個案（某支手機、某個時段）要靠這裡點名。
  const worst = [...samples].sort((a, b) => b.total - a.total).slice(0, 5);
  console.log("\n最慢的 5 筆");
  for (const sample of worst) {
    const phases = Object.entries(sample.phases ?? {})
      .map(([name, ms]) => `${name} ${ms}`)
      .join("　");
    const background = sample.detail?.hiddenMs
      ? `背景 ${Math.round(sample.detail.hiddenMs / 1000)}s → ${Math.round((sample.detail.sinceVisibleMs ?? 0) / 1000)}s 後進頁面`
      : "沒進過背景";
    console.log(
      `  ${sample.total}ms　${sample.day}　${sample.detail?.cold ? "冷啟動" : `第 ${sample.detail?.navIndex ?? "?"} 次導航`}　${background}`
    );
    console.log(`    ${phases}`);
  }
  console.log("");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
