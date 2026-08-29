import 'package:flutter_riverpod/flutter_riverpod.dart';

/// 「因為點了通知而要打開的任務」。
///
/// **不能在收到通知的當下就導頁。** `_Root` 有三段狀態判斷（沒登入 → 登入頁；
/// 登入但沒暱稱 → 取暱稱頁；都有了 → 任務列表），太早 push 會疊在登入頁上面，
/// 而那時使用者還沒登入、讀任務會被規則擋下。
///
/// 所以改成放在這裡等著：任務列表掛載之後才消費它並 push，消費完設回 null。
final pendingTaskIdProvider = StateProvider<String?>((ref) => null);
