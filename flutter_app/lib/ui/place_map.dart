import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart' as maps;

import '../domain/place_bias.dart' as domain;
import 'theme.dart';

/// 地點下面那張小地圖。`src/components/map/PlaceMap.vue` 的 Flutter 版。
///
/// 用原生的 Google 地圖 view，跟網頁版一樣可以縮放拖曳。
///
/// **金鑰有兩個地方要設，而且是同一把**：
///
///   - `android/local.properties` 的 `MAPS_API_KEY` → 進 AndroidManifest，
///     原生 SDK 讀的是那個
///   - `--dart-define=MAPS_API_KEY=...` → 這裡讀的是這個，只用來決定
///     「要不要畫地圖」
///
/// 兩份看起來重複，但各有真正的用途：原生 SDK 沒有辦法在執行期問「金鑰設了
/// 沒」，而沒設金鑰時 `GoogleMap` 會畫出**一塊灰色**，沒有錯誤、沒有訊息。
/// 那是最糟的失敗方式 —— 使用者只會覺得地圖壞了。所以 Dart 這邊自己判斷，
/// 沒設就不要畫，改講一句說得出下一步的話。
class PlaceMap extends StatelessWidget {
  final domain.LatLng center;

  /// 標記上點下去顯示的名稱。
  final String title;

  const PlaceMap({super.key, required this.center, required this.title});

  static const _apiKey = String.fromEnvironment('MAPS_API_KEY');
  static bool get enabled => _apiKey.isNotEmpty;

  /// 單一標記時的縮放層級。16 大約是「看得到這條街上有哪幾家店」。
  static const _zoom = 16.0;

  @override
  Widget build(BuildContext context) {
    final position = maps.LatLng(center.lat, center.lng);

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        height: 180,
        child: maps.GoogleMap(
          initialCameraPosition:
              maps.CameraPosition(target: position, zoom: _zoom),
          markers: {
            maps.Marker(
              markerId: const maps.MarkerId('place'),
              position: position,
              infoWindow: maps.InfoWindow(title: title),
            ),
          },
          // 地圖在一個會捲動的表單裡，預設情況下捲動手勢會被外面的
          // SingleChildScrollView 搶走，地圖就拖不動了。EagerGestureRecognizer
          // 讓地圖先拿到手勢。
          //
          // 代價是手指放在地圖上時捲不動表單 —— 這是對的取捨：一張拖不動的
          // 互動地圖沒有意義，而地圖只佔 180px，旁邊到處都捲得動。
          gestureRecognizers: {
            Factory<OneSequenceGestureRecognizer>(
              () => EagerGestureRecognizer(),
            ),
          },
          // 這是確認用的小圖，不是導航：不需要那些會擠掉畫面的控制項。
          zoomControlsEnabled: false,
          myLocationButtonEnabled: false,
          mapToolbarEnabled: false,
        ),
      ),
    );
  }
}

/// 沒設定金鑰時取代地圖的說明。
///
/// 講的是「你少了什麼、東西有沒有存到」，而不是「地圖無法使用」——
/// 使用者真正在意的是那個座標有沒有記下來（有）。
class PlaceMapUnavailable extends StatelessWidget {
  const PlaceMapUnavailable({super.key});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: Text(
        '座標已經記下來了，但這個版本沒有設定地圖金鑰，所以顯示不出地圖。'
        '報告頁的地圖在網頁版看得到。',
        style: text.bodySmall,
      ),
    );
  }
}
