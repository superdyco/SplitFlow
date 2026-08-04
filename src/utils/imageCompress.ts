/**
 * 收據照片的壓縮。
 *
 * 手機原圖是 3–5MB，直接傳既吃 Storage 額度又拖慢行動網路上傳。
 * 縮到長邊 1600px、JPEG quality 0.8 之後大約 200–400KB，收據上的金額仍然清楚。
 *
 * `scaledSize` 單獨匯出是為了能測 —— canvas 在測試環境跑不起來，
 * 但真正容易算錯的就是尺寸那段。
 */
import { MAX_EDGE } from "@/utils/receiptPolicy";

export interface Size {
  width: number;
  height: number;
}

/** 等比例縮到長邊不超過 maxEdge。本來就比較小的圖原樣回傳，不放大。 */
export function scaledSize(width: number, height: number, maxEdge: number): Size {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };

  const ratio = maxEdge / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

export async function compressImage(file: File, maxEdge = MAX_EDGE, quality = 0.8): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // imageOrientation 一定要指定 from-image：iPhone 拍的直式照片是橫的畫素
    // 加上一個 EXIF 旋轉旗標，預設的 "none" 會讓收據躺著存進去。
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // 瀏覽器解不開這個格式時丟的是英文原文（"The source image could not be
    // decoded."），對使用者沒有意義。實際上幾乎都是同一件事：iPhone 的 HEIC
    // 或 ProRAW 拿到非 Safari 的瀏覽器上。訊息要講得出下一步怎麼辦。
    throw new Error(
      "讀不出這張照片的格式（iPhone 的 HEIC 或 ProRAW 在部分瀏覽器打不開）。" +
        "請直接用相機拍一張，或先把照片轉存成 JPEG。"
    );
  }

  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("這個瀏覽器不支援照片壓縮，請換一個瀏覽器再試");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });
    if (!blob) throw new Error("照片轉檔失敗，請再試一次");
    return blob;
  } finally {
    // 不釋放的話這張解碼後的點陣圖會一直佔著記憶體，連拍幾張就會很明顯。
    bitmap.close();
  }
}
