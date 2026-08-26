/// 結算會用到的資料形狀。`src/types/` 的 Dart 版，只搬結算真的用得到的欄位。
///
/// 刻意不做成完整的 Firestore 文件模型：那一層（序列化、Timestamp、null 相容）
/// 屬於資料存取，會隨 Firestore SDK 走。這裡是純值物件，讓 settlement.dart
/// 可以完全不知道資料從哪來。

library;

enum ExpenseCategory { food, transport, stay, ticket, shopping, other }

/// 分類的顯示資料。順序就是選單的順序，也是金額相同時的次要排序依據。
class CategoryMeta {
  final ExpenseCategory value;
  final String label;
  final String icon;
  const CategoryMeta(this.value, this.label, this.icon);
}

const List<CategoryMeta> expenseCategories = [
  CategoryMeta(ExpenseCategory.food, '餐飲', '🍽'),
  CategoryMeta(ExpenseCategory.transport, '交通', '🚗'),
  CategoryMeta(ExpenseCategory.stay, '住宿', '🏨'),
  CategoryMeta(ExpenseCategory.ticket, '門票', '🎟'),
  CategoryMeta(ExpenseCategory.shopping, '購物', '🛍'),
  CategoryMeta(ExpenseCategory.other, '其他', '📦'),
];

const ExpenseCategory defaultCategory = ExpenseCategory.food;

CategoryMeta categoryMeta(ExpenseCategory value) =>
    expenseCategories.firstWhere((item) => item.value == value);

/// Firestore 存的是字串。認不得的一律歸「其他」—— 不能讓一筆支出因為
/// 分類是新的就整個消失。
ExpenseCategory categoryFrom(String? value) {
  for (final meta in expenseCategories) {
    if (meta.value.name == value) return meta.value;
  }
  return ExpenseCategory.other;
}

/// even：所有參與者均分。custom：每個人的金額由使用者自己填。
enum SplitMode { even, custom }

/// 支出發生的地點。用 Google Places 選的會有完整資訊，
/// 只打名稱時其餘欄位是 null。
class ExpensePlace {
  final String name;
  final String? address;
  final double? lat;
  final double? lng;
  final String? placeId;

  const ExpensePlace({
    required this.name,
    this.address,
    this.lat,
    this.lng,
    this.placeId,
  });

  ExpensePlace copy() => ExpensePlace(
        name: name,
        address: address,
        lat: lat,
        lng: lng,
        placeId: placeId,
      );
}

/// 一筆支出。
class Expense {
  final String id;
  final String title;

  /// 原幣別的金額，最小單位整數。
  final int amount;
  final String currency;

  /// 記帳當下換算成任務主要幣別的金額。
  ///
  /// 可以是 null —— 加入多幣別之前建立的舊支出沒有這個欄位。那種資料
  /// 只有在「本來就是主要幣別」時算得出來，否則要被排除並告訴使用者。
  final int? baseAmount;

  /// 先付錢的人。
  final String paidBy;

  /// 誰分攤多少，**原幣別**的金額。總和等於 amount。
  final Map<String, int> splits;

  final ExpenseCategory category;
  final SplitMode splitMode;

  /// 消費發生的日期 `"YYYY-MM-DD"`。
  ///
  /// 是字串而不是 DateTime，因為日期不該有時區：在曼谷凌晨一點買的東西，
  /// 存成帶時區的時間之後換個地方看就變成前一天了。
  ///
  /// 舊資料沒有這個欄位，是 null，那時退回用 createdAt 的日期。
  final String? date;

  /// 消費發生的時間 `"HH:MM"`，選填。空字串或 null 代表沒記時間 ——
  /// 那種支出只知道是哪一天。
  final String? time;

  /// 離線新增時伺服器時間還沒回來，這裡會是 null。
  final DateTime? createdAt;

  final ExpensePlace? place;

  const Expense({
    required this.id,
    required this.title,
    required this.amount,
    required this.currency,
    required this.baseAmount,
    required this.paidBy,
    required this.splits,
    this.category = ExpenseCategory.other,
    this.splitMode = SplitMode.even,
    this.date,
    this.time,
    this.createdAt,
    this.place,
  });
}

/// 回國之後的還款。只有 confirmed 的才算數 —— 收款人沒點頭之前，
/// 那筆錢在帳上不存在。
class Payment {
  /// Firestore 文件 id。確認與刪除都要靠它。
  ///
  /// 有預設值是因為結算只看金額與狀態 —— 算餘額的測試不需要編出 id 來。
  final String id;

  final String from;
  final String to;
  final int amount;

  /// "pending" 或 "confirmed"。
  final String status;

  const Payment({
    this.id = '',
    required this.from,
    required this.to,
    required this.amount,
    required this.status,
  });
}

/// 一個人在這趟旅程的收支。balance 為正代表別人欠他。
class MemberBalance {
  final String uid;
  final int paid;
  final int owed;
  final int balance;

  const MemberBalance({
    required this.uid,
    required this.paid,
    required this.owed,
    required this.balance,
  });
}

/// 一筆建議轉帳。
class Transfer {
  final String from;
  final String to;
  final int amount;

  const Transfer({required this.from, required this.to, required this.amount});
}

/// 即時算出來的結算結果。
class Settlement {
  final String currency;
  final int total;
  final int expenseCount;

  /// 已確認付款的總額。
  final int paidTotal;
  final List<MemberBalance> balances;
  final List<Transfer> transfers;

  /// 算不出換算金額而被排除的支出。要讓使用者知道有哪幾筆沒被算進去，
  /// 不能默默跳過 —— 那會讓總額對不上而沒有人知道為什麼。
  final List<Expense> unconverted;

  const Settlement({
    required this.currency,
    required this.total,
    required this.expenseCount,
    required this.paidTotal,
    required this.balances,
    required this.transfers,
    required this.unconverted,
  });
}

/// 要存進 Firestore 的結算快照。
///
/// 暱稱一起存進去，之後有人改暱稱或被移除都不會改寫這份歷史紀錄。
class SettlementSnapshotInput {
  final String currency;
  final int total;
  final int paidTotal;
  final int expenseCount;
  final List<MemberBalance> balances;
  final List<Transfer> transfers;
  final Map<String, String> memberNames;
  final String note;

  const SettlementSnapshotInput({
    required this.currency,
    required this.total,
    required this.paidTotal,
    required this.expenseCount,
    required this.balances,
    required this.transfers,
    required this.memberNames,
    required this.note,
  });
}

/// 一個分帳任務。
class Task {
  final String id;
  final String name;
  final String ownerId;
  final List<String> adminIds;

  /// Security Rules 靠這個欄位判斷成員身分，所以它跟 members 子集合永遠一起改。
  final List<String> memberIds;
  final String defaultCurrency;
  final String? startDate;
  final String? endDate;
  final String status;
  final String inviteCode;
  final int memberCount;
  final int expenseCount;

  const Task({
    required this.id,
    required this.name,
    required this.ownerId,
    required this.adminIds,
    required this.memberIds,
    required this.defaultCurrency,
    required this.startDate,
    required this.endDate,
    required this.status,
    required this.inviteCode,
    required this.memberCount,
    required this.expenseCount,
  });
}

/// 任務裡的一位成員。
///
/// 被移除的人 `active` 是 false 但文件留著 —— 既有支出還查得到他的暱稱，
/// 但因為已經從 `task.memberIds` 拿掉，Security Rules 不再讓他讀這個任務。
class TaskMember {
  final String uid;
  final String nickname;

  /// owner / admin / member。
  final String role;
  final bool active;

  const TaskMember({
    required this.uid,
    required this.nickname,
    required this.role,
    required this.active,
  });
}

class UserProfile {
  final String uid;
  final String nickname;
  final String email;
  final String? photoUrl;
  final String provider;

  const UserProfile({
    required this.uid,
    required this.nickname,
    required this.email,
    required this.photoUrl,
    required this.provider,
  });
}
