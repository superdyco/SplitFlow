import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/auth_repository.dart';
import '../data/bias_store.dart';
import '../data/data_export_repository.dart';
import '../data/expense_repository.dart';
import '../data/favorite_repository.dart';
import '../data/geolocation.dart';
import '../data/place_service.dart';
import '../data/push_repository.dart';
import '../data/receipt_picker.dart';
import '../data/receipt_repository.dart';
import '../data/report_repository.dart';
import '../data/task_repository.dart';
import '../domain/favorites.dart';
import '../domain/models.dart';
import '../domain/report.dart';
import '../domain/settlement.dart';

/// 狀態層。`src/composables/` 與 `src/stores/` 的 Riverpod 版。
///
/// 選 Riverpod 而不是 Provider 的理由跟網頁版選 composable 一樣：
/// **取用不綁 widget tree**。領域層完全不知道 Flutter 存在，狀態層也就不該
/// 逼它知道 —— 測試裡可以直接把 repository 換掉，不用先蓋一棵 widget 樹。

// ---------------------------------------------------------------- repository

/// repository 用 provider 包起來而不是直接 new，這樣測試可以 override。
final authRepositoryProvider = Provider((ref) => AuthRepository());
final userRepositoryProvider = Provider((ref) => UserRepository());
final taskRepositoryProvider = Provider((ref) => TaskRepository());
final expenseRepositoryProvider = Provider((ref) => ExpenseRepository());
final paymentRepositoryProvider = Provider((ref) => PaymentRepository());
final settlementRepositoryProvider =
    Provider((ref) => SettlementRepository());

/// 地點搜尋。沒設 `--dart-define=PLACES_API_KEY` 的話它會回報自己不可用，
/// 地點欄位就退回純文字輸入。
final placeServiceProvider = Provider((ref) => PlaceService());
final biasStoreProvider = Provider((ref) => BiasStore());

/// 「我現在在哪」。只用來當地點搜尋的位置偏好與地圖的中心點，
/// 不會存進任何一筆支出。
final geolocationProvider = Provider((ref) => Geolocation());

/// 收據。picker 是拍照／選圖，repository 是 Storage。
final receiptPickerProvider = Provider((ref) => ReceiptPicker());
final receiptRepositoryProvider = Provider((ref) => ReceiptRepository());

/// 公開旅費報告與收藏。報告是 owner 產生的快照，收藏是私人的。
final reportRepositoryProvider = Provider((ref) => ReportRepository());
final favoriteRepositoryProvider = Provider((ref) => FavoriteRepository());

/// 推播。註冊 token、清除 token、問通知權限。
final pushRepositoryProvider = Provider((ref) => PushRepository());
final dataExportRepositoryProvider = Provider((ref) => DataExportRepository());

/// 一張收據的下載網址。
///
/// 用 provider 而不是在 widget 裡 `FutureBuilder`，是為了讓同一個路徑在
/// 縮圖與放大檢視之間共用同一次查詢 —— 點開來看不該再問一次網址。
final receiptUrlProvider = FutureProvider.family<String, String>((ref, path) {
  return ref.watch(receiptRepositoryProvider).downloadUrl(path);
});

// ---------------------------------------------------------------- 登入

/// 目前的登入狀態。
///
/// 用 stream 而不是一次性讀取：Firebase 還原登入狀態是非同步的，開 App 當下
/// `currentUser` 可能還是 null，等一下才變成使用者。畫面要跟著變，不能只看
/// 第一眼。
final authStateProvider = StreamProvider<User?>((ref) {
  return ref.watch(authRepositoryProvider).authStateChanges();
});

/// 我的暱稱等資料。沒登入時是 null。
final userProfileProvider = FutureProvider<UserProfile?>((ref) async {
  final user = ref.watch(authStateProvider).value;
  if (user == null) return null;
  return ref.watch(userRepositoryProvider).getProfile(user.uid);
});

/// 這個任務存過的結算紀錄。
final snapshotsProvider =
    FutureProvider.family<List<SettlementSnapshot>, String>((ref, taskId) {
  return ref.watch(settlementRepositoryProvider).list(taskId);
});

// ---------------------------------------------------------------- 任務

/// 我參與的所有任務。
///
/// 不在這裡過濾狀態 —— 分堆是 `partitionTasks` 的事，而那支有測試釘住
/// 「已刪除的絕對不能出現」。放在這裡過濾的話那條規則就散掉了。
final tasksProvider = FutureProvider<List<Task>>((ref) async {
  final user = ref.watch(authStateProvider).value;
  if (user == null) return const [];
  return ref.watch(taskRepositoryProvider).listUserTasks(user.uid);
});

final taskProvider = FutureProvider.family<Task?, String>((ref, taskId) {
  return ref.watch(taskRepositoryProvider).getTask(taskId);
});

final membersProvider =
    FutureProvider.family<List<TaskMember>, String>((ref, taskId) {
  return ref.watch(taskRepositoryProvider).listTaskMembers(taskId);
});

final expensesProvider =
    FutureProvider.family<List<Expense>, String>((ref, taskId) {
  return ref.watch(expenseRepositoryProvider).listExpenses(taskId);
});

final paymentsProvider =
    FutureProvider.family<List<Payment>, String>((ref, taskId) {
  return ref.watch(paymentRepositoryProvider).listPayments(taskId);
});

// ---------------------------------------------------------------- 結算

/// 一個任務的結算結果。
///
/// 三筆資料都到齊才算得出來，所以這裡把它們合起來等。
///
/// **成員順序不是裝飾**：`allocate` 的餘數是照加入順序分的，順序錯了那一塊錢
/// 就落在別人身上，跟網頁版的數字會對不起來。所以一定要用
/// `listTaskMembers` 的順序（依 joinedAt），不能用 `task.memberIds`。
final settlementProvider =
    FutureProvider.family<Settlement, String>((ref, taskId) async {
  final task = await ref.watch(taskProvider(taskId).future);
  final expenses = await ref.watch(expensesProvider(taskId).future);
  final payments = await ref.watch(paymentsProvider(taskId).future);
  final members = await ref.watch(membersProvider(taskId).future);

  return settleExpenses(
    expenses,
    payments,
    members.map((member) => member.uid).toList(),
    task?.defaultCurrency ?? 'TWD',
  );
});


// ---------------------------------------------------------------- 報告

/// 這個任務既有的報告。沒產生過就是 null。
///
/// 產生、撤銷、改公開狀態之後都要 invalidate —— 那三個動作都會改到這份文件，
/// 而畫面上的「連結開著沒」「有沒有列進探索」全看它。
final taskReportProvider =
    FutureProvider.family<TripReport?, String>((ref, taskId) {
  return ref.watch(reportRepositoryProvider).findReport(taskId);
});

/// 報告地圖的下載網址。公開讀取，沒登入也拿得到。
///
/// 用 provider 而不是在 widget 裡 FutureBuilder，理由跟收據縮圖一樣：
/// 同一份報告在同一次瀏覽裡不該重複問網址。
final reportMapUrlProvider =
    FutureProvider.family<String, (String, String)>((ref, key) {
  return ref.watch(reportRepositoryProvider).mapUrl(key.$1, key.$2);
});

/// 探索頁：別人願意公開的旅程。
final publicReportsProvider = FutureProvider<List<PublicReport>>((ref) {
  return ref.watch(reportRepositoryProvider).listPublicReports();
});

/// 我的收藏。
final favoritesProvider = FutureProvider<List<FavoriteReport>>((ref) async {
  final user = ref.watch(authStateProvider).value;
  if (user == null) return const [];
  return ref.watch(favoriteRepositoryProvider).list(user.uid);
});

/// 收藏過的 id 集合。探索頁一次畫很多張卡，每張都問一次會是 N 趟往返。
final favoritedIdsProvider = FutureProvider<Set<String>>((ref) async {
  final user = ref.watch(authStateProvider).value;
  if (user == null) return const {};
  return ref.watch(favoriteRepositoryProvider).favoritedIds(user.uid);
});
