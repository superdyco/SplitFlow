import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/place_service.dart';
import '../domain/auth_error.dart' as auth;
import '../domain/debug_log.dart';
import '../domain/diagnostics.dart';
import '../state/providers.dart';
import 'place_map.dart';
import 'theme.dart';

/// 個人設定頁最下面的診斷資訊。`src/pages/ProfilePage.vue` 那一區的
/// Flutter 版。
///
/// **使用者說「它壞了」的時候，手上要有東西可看。** 在這之前整個原生版
/// 沒有版本號、沒有錯誤紀錄，而手機上打不開 console —— 唯一的線索是
/// 使用者的轉述。
///
/// 預設收起來：這是要出問題時才展開的東西，平常擺在設定頁只是噪音。
class DiagnosticsSection extends ConsumerStatefulWidget {
  final String provider;

  const DiagnosticsSection({super.key, required this.provider});

  @override
  ConsumerState<DiagnosticsSection> createState() => _DiagnosticsSectionState();
}

class _DiagnosticsSectionState extends ConsumerState<DiagnosticsSection> {
  bool _open = false;

  /// 推播 token 問得到與否。展開時才問 —— 那是一次網路往返，
  /// 不該在每次進設定頁時都付。
  bool? _pushToken;
  bool _asked = false;

  Future<void> _collect() async {
    if (_asked) return;
    _asked = true;
    final token = await ref.read(pushRepositoryProvider).hasToken();
    if (mounted) setState(() => _pushToken = token);
  }

  String _text() {
    return buildDiagnosticsText(DiagnosticsInput(
      version: appVersion,
      uid: ref.read(authStateProvider).value?.uid ?? '',
      loginMethod: auth.providerLabel(widget.provider),
      platform: '${Platform.operatingSystem} '
          '${Platform.operatingSystemVersion}',
      pushToken: _pushToken,
      // 只講有沒有設定，**絕不印出金鑰本身**。
      placesKey: PlaceService.placesEnabled,
      mapsKey: PlaceMap.enabled,
      errors: recentErrors(),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('診斷資訊', style: text.titleMedium),
              subtitle: Text('版本、系統、錯誤紀錄。回報問題時複製這一段。',
                  style: text.bodySmall),
              trailing: Icon(_open ? Icons.expand_less : Icons.expand_more),
              onTap: () {
                setState(() => _open = !_open);
                if (_open) _collect();
              },
            ),
            if (_open) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.line),
                ),
                child: SelectableText(
                  _text(),
                  style: text.bodySmall?.copyWith(
                    fontFamily: 'monospace',
                    height: 1.5,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                icon: const Icon(Icons.copy, size: 18),
                label: const Text('複製診斷資訊'),
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: _text()));
                  if (!context.mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('已複製診斷資訊')),
                  );
                },
              ),
              const SizedBox(height: 12),
            ],
          ],
        ),
      ),
    );
  }
}
