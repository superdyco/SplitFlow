import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';

import '../domain/invite.dart';
import '../domain/report.dart';
import 'firestore_refs.dart';
import 'report_mappers.dart';

/// 公開旅費報告的讀寫。`src/services/reportService.ts` 的 Dart 版。
///
/// 報告是快照，不是即時查詢 —— 公開讀取絕對不能碰既有資料，那等於把整個
/// 權限模型打開。所以產生時把該公開的數字算好寫成一份新文件，公開的只有那一份。

CollectionReference<Map<String, dynamic>> reportsRef(String taskId) =>
    taskRef(taskId).collection('reports');

/// 報告地圖在 Storage 的路徑。
///
/// storage.rules 對這個路徑是 `allow read: if true` —— 那條規則是為了
/// 「沒登入的人也要看得到圖」而存在的。日後若收緊，這裡要一起改。
String reportMapPath(String taskId, String reportId) =>
    'tasks/$taskId/reports/$reportId/map.png';

/// 報告的公開網址。原生版沒有自己的公開頁 —— 連結一律指向網頁版，
/// 理由跟邀請連結一樣：收到的人多半沒裝 App，而報告是給沒去的人看的。
/// 網域跟邀請連結共用同一個常數 —— 換網域時只有一個地方要改。
String reportUrl(String taskId, String reportId) =>
    '$webOrigin/r/$taskId/$reportId';

class ReportRepository {
  final FirebaseStorage _storage;

  ReportRepository({FirebaseStorage? storage})
      : _storage = storage ?? FirebaseStorage.instance;

  /// client 端產生的隨機 id，不需要連線。
  String newReportId(String taskId) => reportsRef(taskId).doc().id;

  /// 找這個任務既有的報告。一個任務只有一份，所以 limit(1)。
  ///
  /// 重新產生時一定要沿用既有的 id —— 每次產生新 id 的話，已經傳出去的
  /// 舊網址會全部變成死連結，而「連結永遠不變」正是這個功能的承諾。
  Future<TripReport?> findReport(String taskId) async {
    final snap = await reportsRef(taskId).limit(1).get();
    if (snap.docs.isEmpty) return null;
    final doc = snap.docs.first;
    final data = doc.data();
    // 用 data()[...] 而不是 doc[...]：後者在欄位不存在時會丟例外，
    // 而離線寫入的報告本來就可能還沒有 serverTimestamp。
    return reportFromMap(doc.id, data, toDateTime(data['updatedAt']));
  }

  /// 公開頁面用。讀不到就是連結錯了或報告已關閉，兩者都回傳 null。
  Future<TripReport?> getReport(String taskId, String reportId) async {
    final doc = await reportsRef(taskId).doc(reportId).get();
    final data = doc.data();
    if (data == null) return null;
    return reportFromMap(doc.id, data, toDateTime(data['updatedAt']));
  }

  /// 第一次產生用 set，重新產生用 update。
  ///
  /// 分成兩支是為了保住 `createdAt`：統一用 set 全量覆寫的話，重新產生會把
  /// 第一次的時間洗掉。update 就乾淨了 —— 它不碰沒提到的欄位。
  /// 呼叫端本來就知道有沒有既有報告。
  Future<void> saveReport(
    String taskId,
    TripReport report, {
    required bool isNew,
  }) {
    final doc = reportsRef(taskId).doc(report.id);
    final data = {
      ...reportToMap(report),
      'updatedAt': FieldValue.serverTimestamp(),
    };
    return isNew
        ? doc.set({...data, 'createdAt': FieldValue.serverTimestamp()})
        : doc.update(data);
  }

  /// 關掉連結時一併取消公開。
  ///
  /// 少了這一步，「關閉連結 → 之後又重新開啟」會把當初的公開狀態靜悄悄地
  /// 一起帶回來，而使用者以為自己早就撤下來了。要重新公開就再勾一次。
  Future<void> setActive(String taskId, String reportId, bool active) {
    return reportsRef(taskId).doc(reportId).update({
      'active': active,
      if (!active) 'listed': false,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// 列進探索頁與否。連結是關的就不該列 —— 呼叫端負責擋，這裡只寫欄位。
  Future<void> setListed(String taskId, String reportId, bool listed) {
    return reportsRef(taskId).doc(reportId).update({
      'listed': listed,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// 探索頁的清單。跨所有任務找公開的報告，所以走 collection group 查詢。
  ///
  /// 兩個條件都要：`listed` 是作者願意被瀏覽，`active` 是連結還開著。
  /// 少了後者，作者撤下連結之後這裡還會列出一張點進去是「找不到」的卡片。
  ///
  /// 這個查詢需要 collection group 的複合索引（firestore.indexes.json 已宣告），
  /// 規則那邊也有對應的遞迴萬用字元 match —— 單一集合的 list 規則蓋不到
  /// collection group 查詢。
  Future<List<PublicReport>> listPublicReports({int max = 50}) async {
    final snap = await db
        .collectionGroup('reports')
        .where('listed', isEqualTo: true)
        .where('active', isEqualTo: true)
        .orderBy('updatedAt', descending: true)
        .limit(max)
        .get();

    return [
      for (final doc in snap.docs)
        PublicReport(
          // reports 是 tasks/{taskId}/reports 的子集合，parent.parent 就是那個任務。
          taskId: doc.reference.parent.parent?.id ?? '',
          report: reportFromMap(
            doc.id,
            doc.data(),
            toDateTime(doc.data()['updatedAt']),
          ),
        ),
    ];
  }

  /// 把靜態地圖存進 Storage，回傳路徑。
  ///
  /// 大小由呼叫端先擋（`maxMapBytes`），錯誤訊息才看得懂 —— 交給規則擋的話
  /// 只會拿到 unauthorized，而那個字看不出是檔案太大。
  Future<String> uploadMap(
    String taskId,
    String reportId,
    Uint8List bytes,
  ) async {
    final path = reportMapPath(taskId, reportId);
    // contentType 一定要明講：storage.rules 檢查 `image/png`。
    await _storage.ref(path).putData(
          bytes,
          SettableMetadata(contentType: 'image/png'),
        );
    return path;
  }

  /// 報告地圖的下載網址。公開讀取，沒登入也拿得到。
  Future<String> mapUrl(String taskId, String reportId) =>
      _storage.ref(reportMapPath(taskId, reportId)).getDownloadURL();
}
