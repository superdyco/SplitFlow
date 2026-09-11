/**
 * 只註冊用得到的 chart.js 模組：結算頁的長條圖、後台總覽的折線圖。
 *
 * 這個檔案存在的理由是 tree-shaking。在元件裡直接寫 `await import("chart.js")`
 * 拿到的是整個 module namespace，Rollup 沒辦法判斷哪些用不到，整包都會進 chunk。
 * 改成在這裡用「靜態的具名匯入」，Rollup 就搖得掉沒註冊的那些 controller
 * （pie、radar、scatter…）。
 *
 * 元件那邊再動態 import 這個檔案，所以沒點開結算頁或後台的人不會下載到它 ——
 * 跟 `mapsLoader` 同樣的考量。
 */
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip
} from "chart.js";

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip
);

export { Chart };
