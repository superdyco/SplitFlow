/**
 * 檢查 build 產出的 chunk 之間有沒有循環相依。
 *
 * 為什麼需要這個：`manualChunks` 如果把互相 import 的模組分到不同 chunk，
 * Rollup 不會報錯，build 會成功，dev server 也正常（dev 不套用 manualChunks），
 * 但正式站一載入就會噴 "Cannot access 'x' before initialization"。
 *
 * 這個坑踩過一次：umbrella 的 `firebase/auth` 只是 re-export，實作在 `@firebase/auth`，
 * 兩者被分到不同 chunk 就成環。所以 build 之後一律跑一次這個檢查。
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "assets");

let files;
try {
  files = readdirSync(assetsDir).filter(name => name.endsWith(".js"));
} catch {
  console.error(`找不到 ${assetsDir}，請先執行 npm run build`);
  process.exit(1);
}

const graph = new Map();
for (const file of files) {
  const code = readFileSync(join(assetsDir, file), "utf8");
  const deps = new Set();
  for (const match of code.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) {
    deps.add(match[1]);
  }
  graph.set(file, [...deps]);
}

/** 拿掉檔名裡的 hash，訊息才讀得懂。 */
const label = name => name.replace(/-[A-Za-z0-9_-]{8}\.js$/, "");

const cycles = new Set();
const state = new Map();
const stack = [];

function walk(node) {
  state.set(node, "visiting");
  stack.push(node);
  for (const next of graph.get(node) ?? []) {
    if (!graph.has(next)) continue;
    if (state.get(next) === "visiting") {
      cycles.add([...stack.slice(stack.indexOf(next)), next].map(label).join(" -> "));
    } else if (!state.has(next)) {
      walk(next);
    }
  }
  stack.pop();
  state.set(node, "done");
}

for (const file of graph.keys()) {
  if (!state.has(file)) walk(file);
}

if (cycles.size) {
  console.error(`chunk 循環相依 ${cycles.size} 個，正式站載入時會壞掉：\n`);
  for (const cycle of cycles) console.error(`  ${cycle}`);
  console.error("\n通常是 manualChunks 把同一個套件的 re-export 與實作分到了不同 chunk。");
  process.exit(1);
}

console.log(`chunk 檢查通過，${graph.size} 個 chunk 沒有循環相依`);
