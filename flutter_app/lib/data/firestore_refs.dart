/// Firestore 的路徑，集中在一個地方。
///
/// 路徑打錯不會有編譯錯誤，只會安靜地讀到空集合 —— 而且因為 Security Rules
/// 是照路徑寫的，打錯的那條通常會變成 permission-denied，看起來像權限問題。
/// 集中之後至少只有一個地方會錯。
///
/// **這些路徑必須跟網頁版一模一樣**，兩邊讀寫的是同一批文件。
library;

import 'package:cloud_firestore/cloud_firestore.dart';

FirebaseFirestore get db => FirebaseFirestore.instance;

CollectionReference<Map<String, dynamic>> get usersRef => db.collection('users');

CollectionReference<Map<String, dynamic>> get tasksRef => db.collection('tasks');

CollectionReference<Map<String, dynamic>> get invitesRef => db.collection('invites');

DocumentReference<Map<String, dynamic>> taskRef(String taskId) =>
    tasksRef.doc(taskId);

CollectionReference<Map<String, dynamic>> membersRef(String taskId) =>
    taskRef(taskId).collection('members');

CollectionReference<Map<String, dynamic>> expensesRef(String taskId) =>
    taskRef(taskId).collection('expenses');

CollectionReference<Map<String, dynamic>> paymentsRef(String taskId) =>
    taskRef(taskId).collection('payments');

CollectionReference<Map<String, dynamic>> settlementsRef(String taskId) =>
    taskRef(taskId).collection('settlements');

/// Firestore 的 Timestamp → Dart 的 DateTime。
///
/// 這一行是資料層與領域層的邊界：領域層完全不認得 Timestamp，所以轉換
/// 只能發生在這裡。離線新增時 serverTimestamp 還沒回來，那時是 null。
DateTime? toDateTime(dynamic value) =>
    value is Timestamp ? value.toDate() : null;
