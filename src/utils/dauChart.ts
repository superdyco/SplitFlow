/**
 * 每日活躍人數折線圖用得到的純函式。圖本身在 `pages/admin/DauChart.vue`。
 */

export interface DauPoint {
  date: string;
  /** 那天沒有彙總資料、或還沒開始記的日子是 null —— 不是 0。 */
  value: number | null;
}

/** 軸上的日期：`2026-09-11` → `9/11`。30 天的軸塞不下完整日期。 */
export function shortDate(key: string): string {
  const [, month, day] = key.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/**
 * 一句話講完這張圖：最近一天、期間最高。
 *
 * 給 canvas 的 aria-label 用，也放在圖的上方 —— 選擇性的直接標示，而不是在
 * 每個點上都印一個數字。「最近一天」取最後一個有資料的日子，缺漏不當成 0。
 */
export function dauSummary(points: DauPoint[]): string {
  const known = points.filter((point): point is { date: string; value: number } => point.value !== null);
  if (!known.length) return "這段期間沒有活躍人數的資料";

  const latest = known[known.length - 1];
  // 同樣高的取最早那天：嚴格大於才換人。
  const peak = known.reduce((best, point) => (point.value > best.value ? point : best));

  return `最近一天（${shortDate(latest.date)}）${latest.value} 人，期間最高 ${peak.value} 人（${shortDate(peak.date)}）`;
}
