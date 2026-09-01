import 'dart:io';

import 'package:firebase_storage/firebase_storage.dart';

import '../domain/debug_log.dart';
import '../domain/receipt_policy.dart';

/// 收據照片的上傳、下載網址與刪除。`src/services/receiptService.ts` 的
/// Dart 版 —— 但**沒有那個離線佇列**。
///
/// 網頁版的流程是「拍照 → 進 IndexedDB → 支出標成待上傳 → 有網路再補傳」。
/// 原生版目前是「傳成功了才把 receipt 寫進支出文件」。
///
/// 這樣少了離線拍照的能力，但換到一個更重要的性質：**不會有卡住的中間狀態**。
/// 沒有佇列卻先把文件標成待上傳的話，那個「待上傳」永遠不會變 —— 而且
/// 使用者完全沒辦法補救。寧可當下就說「照片沒傳上去，等一下再編輯一次」。
///
/// 網頁版排隊中的收據（`receipt.localId`）原生版讀得懂、顯示成待上傳，
/// 但不會去碰它 —— 那張圖在另一台裝置的瀏覽器裡，這裡拿不到。
class ReceiptRepository {
  final FirebaseStorage _storage;

  ReceiptRepository({FirebaseStorage? storage})
      : _storage = storage ?? FirebaseStorage.instance;

  /// 同一個路徑的下載網址是穩定的，同一次執行不該重複問。
  final Map<String, String> _urlCache = {};

  Future<String> downloadUrl(String path) async {
    final cached = _urlCache[path];
    if (cached != null) return cached;

    final url = await _storage.ref(path).getDownloadURL();
    _urlCache[path] = url;
    return url;
  }

  /// 上傳一張收據，回傳 Storage 路徑。
  ///
  /// contentType 一定要明講：storage.rules 檢查 `image/jpeg`，
  /// 讓 SDK 自己猜的話副檔名一變就被規則擋下來，而錯誤碼是看不懂的
  /// unauthorized。
  Future<String> upload(String taskId, String expenseId, File file) async {
    final path = receiptPath(taskId, expenseId);
    await _storage.ref(path).putFile(
          file,
          SettableMetadata(contentType: 'image/jpeg'),
        );
    // 換了照片，舊網址指向的是舊內容。
    _urlCache.remove(path);
    return path;
  }

  /// 刪除 Storage 上的收據。
  ///
  /// 失敗就算了 —— 留下孤兒檔案是設計上接受的取捨（跟網頁版一致）。
  /// 檔案本來就不存在、或現在離線，都不該讓使用者的編輯因此失敗。
  Future<void> delete(String taskId, String expenseId) async {
    final path = receiptPath(taskId, expenseId);
    _urlCache.remove(path);
    try {
      await _storage.ref(path).delete();
    } catch (err) {
      // 見上面。留下紀錄是因為「Storage 一直刪不掉」跟「這張圖本來就不在」
      // 在畫面上長得一模一樣，而前者會慢慢累積孤兒檔案。
      logError('storage', err);
    }
  }
}
