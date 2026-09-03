import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/firebase/config";
import type { ExpenseWeather } from "@/types/weather";

/** 查天氣要的東西只有座標。 */
export interface WeatherAt {
  lat: number;
  lng: number;
}

/**
 * 查一筆支出的天氣。
 *
 * 收座標而不是 ExpensePlace：座標可以來自選好的地點，也可以來自「定位」——
 * 使用者不想記是哪家店但想記那天在下雨，是完全合理的一種用法。
 *
 * 查不到就回 null —— 呼叫端不需要區分「沒有座標」、
 * 「API 掛了」、「逾時」，那三件事對畫面是同一件事：不顯示天氣。
 *
 * 前端不直接打 Open-Meteo：查詢邏輯只寫在 `functions/` 一份，手機版之後
 * 接同一個 callable。散成兩份的症狀是同一筆支出在手機和網頁顯示不同天氣。
 */
export async function lookupWeather(
  at: WeatherAt | null,
  date: string,
  time: string
): Promise<ExpenseWeather | null> {
  if (!at || !date) return null;

  try {
    // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
    const call = httpsCallable(getFunctions(app, "asia-east1"), "lookupWeather");
    const result = await call({ lat: at.lat, lng: at.lng, date, time });
    return (result.data as ExpenseWeather | null) ?? null;
  } catch {
    // 天氣是加分不是必要。查不到就當作沒有，不要讓使用者看到錯誤訊息 ——
    // 他正在記一筆帳，那才是他來這一頁的目的。
    return null;
  }
}
