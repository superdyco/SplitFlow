import 'package:cloud_firestore/cloud_firestore.dart';

import '../domain/favorites.dart';
import 'firestore_refs.dart';
import 'report_mappers.dart';

/// 收藏的讀寫。`src/services/favoriteService.ts` 的 Dart 版。
///
/// 全部掛在 `users/{uid}/favorites` 底下，規則只認本人 ——
/// 收藏是私人的，別人不該知道你存了誰的旅程。

/// 一次最多列這麼多。收藏頁是一個清單，不是無限捲軸。
const int _maxFavorites = 100;

CollectionReference<Map<String, dynamic>> _favoritesRef(String uid) =>
    usersRef.doc(uid).collection('favorites');

class FavoriteRepository {
  /// 加入收藏。用 set 而不是 add：id 是算出來的，重複按只會蓋寫同一份，
  /// 不會產生兩筆一樣的收藏。
  Future<void> add(String uid, FavoriteReport favorite) {
    return _favoritesRef(uid).doc(favorite.id).set({
      ...favoriteToMap(favorite),
      'savedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> remove(String uid, String taskId, String reportId) {
    return _favoritesRef(uid).doc(favoriteId(taskId, reportId)).delete();
  }

  /// 單一份報告收藏過了沒。一次 doc 讀取，不用把整份清單撈下來。
  Future<bool> isFavorited(String uid, String taskId, String reportId) async {
    final doc =
        await _favoritesRef(uid).doc(favoriteId(taskId, reportId)).get();
    return doc.exists;
  }

  /// 新收藏的排前面 —— 剛存起來的那份要馬上看得到，不用捲到最後。
  Future<List<FavoriteReport>> list(String uid) async {
    final snap = await _favoritesRef(uid)
        .orderBy('savedAt', descending: true)
        .limit(_maxFavorites)
        .get();
    return [
      for (final doc in snap.docs) favoriteFromMap(doc.id, doc.data()),
    ];
  }

  /// 收藏過的 id 集合。探索頁一次畫很多張卡，每張都問一次「收藏了嗎」會是
  /// N 趟往返；改成一次把清單撈下來自己比對。
  Future<Set<String>> favoritedIds(String uid) async {
    final snap = await _favoritesRef(uid).limit(_maxFavorites).get();
    return {for (final doc in snap.docs) doc.id};
  }
}
