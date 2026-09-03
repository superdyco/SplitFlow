/// 天氣的圖示與溫度。四個位置共用。
///
/// 用 Material Icons 而不是自己畫 SVG —— 這一輪剛把分類圖示從 emoji 換成
/// IconData，天氣照同一套。網頁版畫 inline SVG 是因為那邊沒有圖示庫。
library;

import 'package:flutter/material.dart';

import '../domain/models.dart';
import '../domain/weather.dart';
import 'theme.dart';

/// 八組各一個圖示。
///
/// 刻意都用線性（outlined）版本：它們跟分類圖示、地點圖示並排，實心的會
/// 比周圍重，而天氣是這一列裡最不重要的資訊。
const Map<WeatherKind, IconData> _icons = {
  WeatherKind.clear: Icons.wb_sunny_outlined,
  WeatherKind.cloudy: Icons.wb_cloudy_outlined,
  WeatherKind.overcast: Icons.cloud_outlined,
  WeatherKind.fog: Icons.cloud_queue,
  WeatherKind.drizzle: Icons.grain,
  WeatherKind.rain: Icons.water_drop_outlined,
  WeatherKind.snow: Icons.ac_unit,
  WeatherKind.thunder: Icons.flash_on,
};

class WeatherChip extends StatelessWidget {
  final Weather weather;

  /// 文字的字級。圖示會比它大 3。列表上傳 11，表單與明細用預設。
  final double size;

  const WeatherChip({super.key, required this.weather, this.size = 13});

  @override
  Widget build(BuildContext context) {
    final kind = weatherKind(weather.code);

    /*
      有 exact 就印單一溫度，沒有就印當日高低。

      這不只是格式差異 —— 它讓畫面看得出這筆支出有沒有記時間，
      而且不假裝出沒有的精度。
    */
    final label = weather.exact == null
        ? '${weather.low}–${weather.high}°'
        : '${weather.exact}°';

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          _icons[kind] ?? Icons.cloud_outlined,
          size: size + 3,
          color: AppColors.muted,
        ),
        const SizedBox(width: AppSpace.x1),
        Text(label, style: TextStyle(fontSize: size, color: AppColors.muted)),
      ],
    );
  }
}
