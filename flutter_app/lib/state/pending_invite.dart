import 'package:flutter_riverpod/flutter_riverpod.dart';

/// 因為點邀請連結而等待處理的邀請碼。
///
/// 跟通知導頁一樣，不能收到連結就立刻 push：使用者可能尚未登入，或第一次
/// 登入還沒設定暱稱。先存在這裡，等 TaskListPage 掛載才消費，登入過程不會
/// 把邀請碼弄丟。
final pendingInviteCodeProvider = StateProvider<String?>((ref) => null);

/// 因為點報告連結而等待開啟的那一份報告。
///
/// 跟邀請碼分開存：兩種連結會落在不同的畫面，而且報告不需要登入，
/// 混在同一個欄位的話就得在消費端再判斷一次它到底是哪一種。
final pendingReportProvider =
    StateProvider<({String taskId, String reportId})?>((ref) => null);
