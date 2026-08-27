import 'dart:async';

import 'package:geolocator/geolocator.dart';

import '../domain/place_bias.dart';

/// 取得裝置目前的座標。`src/services/geolocation.ts` 的 Dart 版。
///
/// 座標本身不花錢 —— 花錢的是拿座標去查附近有什麼。這裡只回答「我在哪」。
///
/// 錯誤訊息全部換成看得懂的話，而且每一種都要講得出**下一步該做什麼**：
/// 「定位失敗」對使用者沒有任何用處，他不知道是要去開設定、走到窗邊、
/// 還是再按一次。
class Geolocation {
  /// 等定位的上限。第一次抓 GPS 可能要好幾秒，太短會在還有機會成功時就先
  /// 報錯；太長則是使用者盯著「定位中...」不知道發生什麼事。
  static const _timeout = Duration(seconds: 10);

  Future<LatLng> current() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const LocationFailure('手機的定位功能沒有開，到系統設定裡打開再試一次。');
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    // deniedForever 要跟一般拒絕分開講：再問一次不會跳出對話框了，
    // 只能自己去系統設定改，這件事一定要說出來。
    if (permission == LocationPermission.deniedForever) {
      throw const LocationFailure(
        '定位權限被永久拒絕了。到系統設定 → 應用程式 → SplitFlow → 權限，把位置打開。',
      );
    }
    if (permission == LocationPermission.denied) {
      throw const LocationFailure('沒有定位權限，這一次就先用上一筆支出的位置。');
    }

    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: _timeout,
        ),
      );
      return LatLng(position.latitude, position.longitude);
    } on TimeoutException {
      // 室內或剛開機時抓不到新的定位很正常。這時候退回上一次已知的位置 ——
      // 網頁版是靠 `maximumAge: 60000` 拿到同一個效果。
      //
      // 舊一點完全沒關係：這個座標只拿來當搜尋的位置偏好，偏好半徑是 30km。
      // 你從上一個定位點走到現在的距離，遠比那個半徑小。
      final last = await Geolocator.getLastKnownPosition();
      if (last != null) return LatLng(last.latitude, last.longitude);

      throw const LocationFailure(
        '定位等太久了，這台裝置目前抓不到位置（室內常這樣）。'
        '先直接打地點名字也可以，或走到窗邊再按一次。',
      );
    } catch (err) {
      // 這裡剩下的是沒預期到的錯誤，原文留著才查得出是什麼。
      throw LocationFailure('定位失敗：$err');
    }
  }
}

class LocationFailure implements Exception {
  final String message;
  const LocationFailure(this.message);

  @override
  String toString() => message;
}
