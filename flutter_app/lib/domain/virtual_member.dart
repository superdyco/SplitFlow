import 'dart:math';

/// 虛擬成員的 member 文件 ID。`src/utils/virtualMember.ts` 的 Dart 版。
///
/// 格式是 `v_` + 20 個小寫英數，固定 22 字元。這個 id 會被寫進
/// `task.memberIds`，而 `memberIds` 同時是權限清單，所以它**必須不可能等於
/// 任何真實 uid** —— Firebase Auth 的 uid 是 28 字元，長度就對不上。
///
/// 這條格式在四個地方各出現一次：這裡、網頁版的 `src/utils/virtualMember.ts`、
/// `firestore.rules`、規則測試。改一處就要改四處。
library;

const String _alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
const int _bodyLength = 20;

final RegExp virtualMemberIdPattern = RegExp(r'^v_[a-z0-9]{20}$');

/// 用 `Random.secure()` 的理由是碰撞而不是保密 —— 這個 id 不是門禁
/// （邀請碼才是），但它一旦跟另一個虛擬成員撞號，兩個人的帳會合在一起。
String generateVirtualMemberId() {
  final random = Random.secure();
  final buffer = StringBuffer('v_');
  for (var i = 0; i < _bodyLength; i++) {
    buffer.write(_alphabet[random.nextInt(_alphabet.length)]);
  }
  return buffer.toString();
}

bool isVirtualMemberId(String id) => virtualMemberIdPattern.hasMatch(id);
