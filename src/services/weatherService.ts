import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/firebase/config";
import type { ExpensePlace } from "@/types/expense";
import type { ExpenseWeather } from "@/types/weather";

/**
 * 查一筆支出的天氣。查不到就回 null —— 呼叫端不需要區分「沒有座標」、
 * 「API 掛了」、「逾時」，那三件事對畫面是同一件事：不顯示天氣。
 *
 * 前端不直接打 Open-Meteo：查詢邏輯只寫在 `functions/` 一份，手機版之後
 * 接同一個 callable。散成兩份的症狀是同一筆支出在手機和網頁顯示不同天氣。
 */
export async function lookupWeather(
  place: ExpensePlace | null,
  date: string,
  time: string
): Promise<ExpenseWeather | null> {
  // 自己打字的地點沒有座標。這跟地圖是同一個限制。
  if (!place || place.lat === null || place.lng === null || !date) return null;

  try {
    // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
    const call = httpsCallable(getFunctions(app, "asia-east1"), "lookupWeather");
    const result = await call({ lat: place.lat, lng: place.lng, date, time });
    return (result.data as ExpenseWeather | null) ?? null;
  } catch {
    // 天氣是加分不是必要。查不到就當作沒有，不要讓使用者看到錯誤訊息 ——
    // 他正在記一筆帳，那才是他來這一頁的目的。
    return null;
  }
}
