/**
 * 只註冊長條圖用得到的 chart.js 模組。
 *
 * 這個檔案存在的理由是 tree-shaking。在元件裡直接寫 `await import("chart.js")`
 * 拿到的是整個 module namespace，Rollup 沒辦法判斷哪些用不到，整包都會進 chunk。
 * 改成在這裡用「靜態的具名匯入」，Rollup 就搖得掉沒註冊的那些 controller
 * （line、pie、radar、scatter…）。
 *
 * 元件那邊再動態 import 這個檔案，所以沒點開結算頁的人不會下載到它 ——
 * 跟 `mapsLoader` 同樣的考量。
 */
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip
} from "chart.js";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export { Chart };
