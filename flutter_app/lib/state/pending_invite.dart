import 'package:flutter_riverpod/flutter_riverpod.dart';

/// 因為點邀請連結而等待處理的邀請碼。
///
/// 跟通知導頁一樣，不能收到連結就立刻 push：使用者可能尚未登入，或第一次
/// 登入還沒設定暱稱。先存在這裡，等 TaskListPage 掛載才消費，登入過程不會
/// 把邀請碼弄丟。
final pendingInviteCodeProvider = StateProvider<String?>((ref) => null);
