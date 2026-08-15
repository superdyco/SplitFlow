/**
 * 取得裝置目前的座標，包成 promise 並把瀏覽器的錯誤碼換成看得懂的話。
 *
 * 只用瀏覽器內建的 Geolocation API，不打任何付費 API —— 座標本身是免費的，
 * 花錢的是拿座標去換地點名稱（見 `placeService.nearbyPlaces`）。
 *
 * 不 import firebase 也不 import vue。
 */
import type { LatLng } from "@/utils/placeBias";

/**
 * 等定位的上限。手機第一次抓 GPS 可能要好幾秒，太短會在還有機會成功時
 * 就先報錯；太長則是使用者盯著「定位中...」不知道發生什麼事。
 */
const TIMEOUT_MS = 10000;

/**
 * 快取容忍度：一分鐘內抓過的位置就直接用。
 * 記帳時人不會在一分鐘內移動到另一條街，省下一次 GPS 喚醒。
 */
const MAX_AGE_MS = 60000;

/**
 * 瀏覽器有沒有這個 API。注意：**有**不等於**能用** ——
 * 非安全來源（用區網 IP 開 dev server 那種 http 網址）照樣有 navigator.geolocation，
 * 但一呼叫就被拒絕。那種情況留給 `getCurrentLatLng` 去講清楚原因，
 * 這裡不預先把按鈕藏起來，不然使用者連為什麼沒有定位鍵都不知道。
 */
export function geolocationAvailable(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

function messageFor(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      // 非安全來源被擋下來時瀏覽器也是回這個碼，所以順便提醒。
      return window.isSecureContext
        ? "你拒絕了定位權限，可以在網址列的權限設定裡改回來。"
        : "這個網址不是 HTTPS，瀏覽器不給定位。請用正式網址或 localhost 開啟。";
    case error.POSITION_UNAVAILABLE:
      return "抓不到目前位置，可能是室內收不到訊號。";
    case error.TIMEOUT:
      return "定位太久沒有回應，請再試一次。";
    default:
      return error.message || "定位失敗";
  }
}

export function getCurrentLatLng(): Promise<LatLng> {
  if (!geolocationAvailable()) return Promise.reject(new Error("這個瀏覽器不支援定位"));

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      error => reject(new Error(messageFor(error))),
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS }
    );
  });
}
