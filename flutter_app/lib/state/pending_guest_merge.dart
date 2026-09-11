import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/auth_repository.dart';

/// 已經換到正式帳號、但合併還沒完成的訪客證明。一小時內有效。
///
/// 放在 provider 而不是個人頁的 State：換帳號的那一刻 authStateChanges 會響，
/// 個人頁整個重建，State 裡的東西會跟著消失 —— 而這串 token 是重試唯一的依據。
/// 跟 `pending_invite.dart` 是同一個理由：流程中途畫面會換掉，東西不能跟著丟。
class PendingGuestMerge {
  final String guestToken;

  /// 上一次失敗的原因。null 代表還在跑或還沒跑過。
  final String? error;

  const PendingGuestMerge(this.guestToken, {this.error});
}

final pendingGuestMergeProvider =
    StateProvider<PendingGuestMerge?>((ref) => null);

/// 跑一次合併。成功回 true 並清掉 pending；失敗留著 token 與原因，給畫面顯示重試。
///
/// 收 repository 與 controller 而不是 ref：呼叫端在換帳號之前就要把它們拿好，
/// 換過去之後那個 widget 可能已經被丟掉，ref 不能再用。
Future<bool> runGuestMerge(
  AuthRepository repo,
  StateController<PendingGuestMerge?> pending,
  String guestToken,
) async {
  pending.state = PendingGuestMerge(guestToken);
  try {
    await repo.mergeGuest(guestToken);
    pending.state = null;
    return true;
  } catch (err) {
    pending.state = PendingGuestMerge(guestToken, error: '合併沒有完成：$err');
    return false;
  }
}
