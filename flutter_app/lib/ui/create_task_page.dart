import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';

import '../domain/currency.dart';
import '../domain/expense_date.dart';
import '../domain/invite.dart';
import '../domain/validation.dart' as validate;
import '../state/providers.dart';
import 'theme.dart';

/// 建立分帳任務。`src/pages/CreateTaskPage.vue` 的 Flutter 版。
///
/// 建完之後**留在這一頁顯示邀請連結**，不是直接跳走。網頁版這樣設計是因為
/// 建任務的下一件事幾乎一定是找人加入，跳到空的任務頁只會讓人再找一次
/// 「邀請」在哪。
class CreateTaskPage extends ConsumerStatefulWidget {
  const CreateTaskPage({super.key});

  @override
  ConsumerState<CreateTaskPage> createState() => _CreateTaskPageState();
}

class _CreateTaskPageState extends ConsumerState<CreateTaskPage> {
  final _name = TextEditingController();
  String _currency = 'TWD';
  String _startDate = '';
  String _endDate = '';
  bool _touched = false;
  bool _saving = false;
  String? _error;

  /// 建立完成後的邀請碼。有值就代表已經建好，畫面切換成分享模式。
  String? _inviteCode;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  String? get _nameError =>
      validate.textFieldError(_name.text, '任務名稱', max: 40, touched: _touched);
  String? get _dateError => validate.dateRangeError(_startDate, _endDate);
  bool get _canSubmit =>
      _name.text.trim().isNotEmpty && _nameError == null && _dateError == null;

  Future<void> _submit() async {
    setState(() => _touched = true);
    if (!_canSubmit) return;

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      /*
        用 `.future` 而不是 `.value`。

        FutureProvider 的 `.value` 在還沒載完時是 null，而這一頁常常是
        使用者登入後第一個碰到 profile 的地方 —— 也就是說 `.value` 幾乎
        必然是 null，然後畫面會說「讀不到你的個人資料，請重新登入再試」，
        叫人去做一件完全無關的事。

        `.future` 會等它載完。這個坑實測時撞到了，不是想像出來的。
      */
      final profile = await ref.read(userProfileProvider.future);
      if (profile == null) {
        throw StateError('找不到個人資料，請先設定暱稱');
      }
      final created = await ref.read(taskRepositoryProvider).createTask(
            name: validate.required(_name.text, '任務名稱'),
            defaultCurrency: _currency,
            startDate: _startDate.isEmpty ? null : _startDate,
            endDate: _endDate.isEmpty ? null : _endDate,
            owner: profile,
          );
      if (!mounted) return;
      setState(() {
        _inviteCode = created.inviteCode;
        _saving = false;
      });
      ref.invalidate(tasksProvider);
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _saving = false;
        });
      }
    }
  }

  Future<void> _pickDate(bool isStart) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked == null) return;
    setState(() {
      if (isStart) {
        _startDate = toDateInput(picked);
      } else {
        _endDate = toDateInput(picked);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    if (_inviteCode != null) {
      return _Created(
        taskName: _name.text.trim(),
        inviteCode: _inviteCode!,
        onDone: () => Navigator.of(context).pop(true),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('建立分帳任務')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Text('任務名稱', style: text.bodySmall),
          const SizedBox(height: 6),
          TextField(
            controller: _name,
            maxLength: 40,
            decoration: const InputDecoration(hintText: '例如：京都・大阪 五天四夜'),
            onChanged: (_) => setState(() {}),
            onTapOutside: (_) => setState(() => _touched = true),
          ),
          if (_nameError != null)
            Text(_nameError!,
                style: text.bodySmall?.copyWith(color: AppColors.danger)),
          const SizedBox(height: 16),
          Text('主要幣別', style: text.bodySmall),
          const SizedBox(height: 6),
          DropdownButton<String>(
            value: _currency,
            isExpanded: true,
            items: [
              for (final code in currencies)
                DropdownMenuItem(value: code, child: Text(code)),
            ],
            onChanged: (value) =>
                setState(() => _currency = value ?? _currency),
          ),
          Text(
            '所有支出最後都會換算成這個幣別結算。建立之後不能改。',
            style: text.bodySmall,
          ),
          const SizedBox(height: 20),
          Text('日期（選填）', style: text.bodySmall),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _pickDate(true),
                  child: Text(_startDate.isEmpty ? '開始日期' : _startDate),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _pickDate(false),
                  child: Text(_endDate.isEmpty ? '結束日期' : _endDate),
                ),
              ),
            ],
          ),
          if (_dateError != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(_dateError!,
                  style: text.bodySmall?.copyWith(color: AppColors.danger)),
            ),
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(_error!,
                style: text.bodyMedium?.copyWith(color: AppColors.danger)),
          ],
          const SizedBox(height: 28),
          FilledButton(
            onPressed: _saving ? null : _submit,
            child: Text(_saving ? '建立中...' : '建立任務'),
          ),
        ],
      ),
    );
  }
}

/// 建好之後的分享畫面。
class _Created extends StatelessWidget {
  final String taskName;
  final String inviteCode;
  final VoidCallback onDone;

  const _Created({
    required this.taskName,
    required this.inviteCode,
    required this.onDone,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final url = inviteUrl(inviteCode);

    return Scaffold(
      appBar: AppBar(title: const Text('建立完成')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
        children: [
          Text(taskName, style: text.headlineSmall),
          const SizedBox(height: 8),
          Text('把連結傳給同行的人，他們點開就能加入。', style: text.bodyMedium),
          const SizedBox(height: 20),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: SelectableText(url, style: text.bodySmall),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            icon: const Icon(Icons.copy, size: 18),
            label: const Text('複製邀請連結'),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: url));
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('已複製')),
              );
            },
          ),
          const SizedBox(height: 24),
          FilledButton(onPressed: onDone, child: const Text('完成')),
        ],
      ),
    );
  }
}
