/// 收據照片的大小規則、路徑與上傳佇列的判斷。
/// `src/utils/receiptPolicy.ts` 的 Dart 版。
///
/// 判斷跟 I/O 分開，是因為本機儲存與 Storage 在測試環境裡都跑不起來，
/// 但真正容易寫錯的是「這個項目現在該怎麼辦」。那部分放在這裡就測得到。

library;

/// 壓縮後照片的長邊上限（px）。收據小字多，再小就開始糊到讀不出金額。

const int maxEdge = 1600;

/// 連續失敗幾次之後停止自動重試，交還給使用者決定。
const int maxAttempts = 5;

/// 佇列項目的保存期限。超過就丟掉，不然傳不出去的圖會永遠佔著手機空間。
const Duration maxAge = Duration(days: 30);

/// 原始檔的上限。
///
/// 這**不是** Storage 的限制，是為了保護記憶體：解碼會把整張圖攤進記憶體，
/// 超大圖在手機上會直接當掉。
///
/// 為什麼是 12MB 而不是更寬鬆的值：檔案大小其實是記憶體用量的爛代理指標。
/// 一張壓縮率高的 24MB HEIC 可能是 48MP，解碼成點陣圖要 190MB。真正的解法是
/// 解碼時就降採樣，但那需要先知道長寬，而知道長寬就得先解碼，是雞生蛋。
///
/// 所以改用「把門檻壓低」來繞過：手機相機拍的 12MP HEIC 通常是 2–4MB，
/// 12MB 對正常使用完全沒有影響，卻能擋掉 ProRAW 與超長全景那些真正會把
/// 記憶體吃爆的東西。這是一個收據拍照功能，沒有理由收更大的原始檔。
const int maxSourceBytes = 12 * 1024 * 1024;

/// 壓縮後的上限。
///
/// **必須跟 storage.rules 的數字一致**，否則會傳出去才被規則拒絕，
/// 使用者拿到的是沒有原因的失敗。改這裡就要改 storage.rules，反之亦然。
/// 網頁版與原生版共用同一份規則，所以這個數字兩邊也必須一樣。
const int maxUploadBytes = 2 * 1024 * 1024;

/// 給訊息用。不到 1MB 顯示 KB，否則全部會變成沒有資訊量的「0.0 MB」。
String formatBytes(int bytes) {
  final mb = bytes / (1024 * 1024);
  if (mb < 1) return '${(bytes / 1024).round()} KB';
  return '${mb.toStringAsFixed(1)} MB';
}

/// 壓縮前看原始檔，壓縮後看產出物。
enum SizeStage { source, upload }

/// 太大就回傳要顯示給使用者的訊息，沒問題是 null。
///
/// 大小一定要在前端擋。交給 storage.rules 擋的話，上傳會失敗成
/// `storage/unauthorized`，那跟「權限不足」長得一模一樣，使用者不會知道
/// 是檔案太大，而且還會白白重試好幾次。
String? sizeRejection(SizeStage stage, int bytes) {
  if (stage == SizeStage.source) {
    if (bytes <= maxSourceBytes) return null;
    return '這張照片 ${formatBytes(bytes)} 太大了（上限 ${formatBytes(maxSourceBytes)}）。'
        '如果是 ProRAW 或全景照，請改用一般模式拍一張收據就好。';
  }

  if (bytes <= maxUploadBytes) return null;
  return '壓縮後仍有 ${formatBytes(bytes)}，超過上限 ${formatBytes(maxUploadBytes)}。'
      '請改拍一張只有收據、背景單純一點的照片。';
}

/// 一筆支出一張收據，所以路徑可以直接推導、不需要存檔名。
/// 這也讓「換照片」變成單純的覆蓋，不會累積舊檔。
///
/// 分成獨立的目錄層而不是 `{expenseId}.jpg`，是因為 Storage 規則的路徑
/// 萬用字元只能吃整個 segment，帶字面後綴的寫法比對不到。
String receiptPath(String taskId, String expenseId) =>
    'tasks/$taskId/expenses/$expenseId/receipt.jpg';

enum QueueAction {
  /// 現在就傳。
  upload,

  /// 太舊了，從佇列刪掉。
  dropExpired,

  /// 試太多次了，保留項目但停止自動重試，等使用者手動觸發。
  holdExhausted,
}

/// 過期優先於試到上限 —— 都過期了，留著讓使用者手動重試也沒有意義。
QueueAction queueAction({
  required DateTime createdAt,
  required int attempts,
  required DateTime now,
}) {
  if (now.difference(createdAt) > maxAge) return QueueAction.dropExpired;
  if (attempts >= maxAttempts) return QueueAction.holdExhausted;
  return QueueAction.upload;
}
