/// AI 讀收據。辨識的邏輯一行都不在這裡 —— 在 `functions/src/ai/`，
/// 這裡只呼叫 callable 與讀餘額。跟 `weather_repository.dart` 同一個理由。
library;

import 'dart:convert';
import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';

import '../domain/ai_receipt.dart';
import 'firestore_refs.dart';

class AiRepository {
  /// **呼叫就扣 1 點**，失敗也扣。錯誤原樣往外丟：函式的訊息都是中文，
  /// 交給 `errorText` 顯示。
  Future<AiReadResult> readReceipt(File file) async {
    final bytes = await file.readAsBytes();
    // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
    final call = FirebaseFunctions.instanceFor(region: 'asia-east1').httpsCallable(
      'readReceipt',
      // 函式自己有 30 秒的 AI 逾時，這裡多留一點。
      options: HttpsCallableOptions(timeout: const Duration(seconds: 70)),
    );
    final result = await call.call<Map<Object?, Object?>>({'image': base64Encode(bytes)});
    return AiReadResult.fromMap(result.data);
  }

  /// 剩幾點。null 代表還沒用過 —— 第一次辨識時才會送 3 點。
  Future<int?> credits(String uid) async {
    final snap = await db.collection('aiCredits').doc(uid).get();
    if (!snap.exists) return null;
    final balance = snap.data()?['balance'];
    return balance is num ? balance.toInt() : 0;
  }
}
