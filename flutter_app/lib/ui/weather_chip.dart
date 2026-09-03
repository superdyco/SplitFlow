/// 天氣的圖示與溫度。四個位置共用。
///
/// 用 Material Icons 而不是自己畫 —— 這一輪剛把分類圖示從 emoji 換成
/// IconData，天氣照同一套。網頁版畫 inline SVG 是因為那邊沒有圖示庫，
/// 但兩邊的**分組、顏色與名稱必須一樣**：同一筆支出在手機和網頁不該長不同。
library;

import 'package:flutter/material.dart';

import '../domain/models.dart';
import '../domain/weather.dart';
import 'theme.dart';

/// 八組各一個圖示。
///
/// 晴與雷用**實心**版本，其餘用線性。這不是風格選擇：那兩個是黃的，
/// 而細線在那個亮度下會消失 —— 色塊不會。見 theme.dart 的 weatherSun。
const Map<WeatherKind, IconData> _icons = {
  WeatherKind.clear: Icons.wb_sunny,
  WeatherKind.cloudy: Icons.wb_cloudy_outlined,
  WeatherKind.overcast: Icons.cloud_outlined,
  WeatherKind.fog: Icons.cloud_queue,
  WeatherKind.drizzle: Icons.grain,
  WeatherKind.rain: Icons.water_drop_outlined,
  WeatherKind.snow: Icons.ac_unit,
  WeatherKind.thunder: Icons.bolt,
};

/// 圖示的顏色。**只有三種，不是八種。**
///
/// 顏色講「哪一類」，形狀與名稱講「哪一個」。八種顏色會讓一個小圖示變成
/// 調色盤，而且藍色系彼此根本分不出來 —— 分辨毛毛雨與大雨本來就該靠文字。
Color _colorOf(WeatherKind kind) {
  switch (kind) {
    case WeatherKind.clear:
    case WeatherKind.thunder:
      // 太陽與閃電都是黃的。品牌橘拿來畫太陽讀起來是「橘色的太陽」，
      // 不是「晴天」—— 這是少數不該讓品牌色說話的地方。
      return AppColors.weatherSun;
    case WeatherKind.drizzle:
    case WeatherKind.rain:
    case WeatherKind.snow:
      return AppColors.weatherWet;
    default:
      return AppColors.muted;
  }
}

/// `chip` 是表單裡的那一格 —— 剛選完地點，這是動作的回饋，要看得見。
/// `inline` 是列表與報告上的一行小字，不該搶走分類圖示的注意力。
enum WeatherChipVariant { chip, inline }

class WeatherChip extends StatelessWidget {
  final Weather weather;
  final WeatherChipVariant variant;

  /// 顯示天氣名稱。小尺寸下兩個字比圖示好認，但列表那一行已經很擠。
  final bool showLabel;

  const WeatherChip({
    super.key,
    required this.weather,
    this.variant = WeatherChipVariant.inline,
    this.showLabel = false,
  });

  @override
  Widget build(BuildContext context) {
    final kind = weatherKind(weather.code);
    final color = _colorOf(kind);
    final chip = variant == WeatherChipVariant.chip;

    /*
      有 exact 就印單一溫度，沒有就印當日高低。

      這不只是格式差異 —— 它讓畫面看得出這筆支出有沒有記時間，
      而且不假裝出沒有的精度。
    */
    final temp = weather.exact == null
        ? '${weather.low}–${weather.high}°'
        : '${weather.exact}°';

    final row = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          _icons[kind] ?? Icons.cloud_outlined,
          size: chip ? 22 : 16,
          color: color,
        ),
        const SizedBox(width: AppSpace.x2),
        if (showLabel) ...[
          Text(
            weatherLabels[kind] ?? '',
            style: TextStyle(
              fontSize: chip ? 15 : 12,
              // 文字用 ink/muted，不用天氣色：那一行旁邊還有地點與金額，
              // 整串都上色會變成三種顏色搶同一列。有顏色的只有圖示。
              color: chip ? AppColors.ink : AppColors.muted,
            ),
          ),
          const SizedBox(width: AppSpace.x1),
        ],
        Text(
          temp,
          style: figure(
            size: chip ? 15 : 12,
            weight: chip ? FontWeight.w700 : FontWeight.w400,
            color: chip ? AppColors.ink : AppColors.muted,
          ),
        ),
      ],
    );

    if (!chip) return row;

    // 表單那一格：跟旁邊的欄位同一種框，看得出是這一區的一部分。
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpace.x3,
        vertical: 10,
      ),
      decoration: BoxDecoration(
        color: AppColors.card,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: row,
    );
  }
}
