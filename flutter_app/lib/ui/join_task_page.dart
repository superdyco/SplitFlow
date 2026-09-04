import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/providers.dart';
import 'task_page.dart';
import 'theme.dart';

/// 原生邀請加入頁。資料與網頁版 `/join/:inviteCode` 讀的是同一份 invite 文件。
class JoinTaskPage extends ConsumerStatefulWidget {
  final String inviteCode;

  const JoinTaskPage({super.key, required this.inviteCode});

  @override
  ConsumerState<JoinTaskPage> createState() => _JoinTaskPageState();
}

class _JoinTaskPageState extends ConsumerState<JoinTaskPage> {
  Map<String, dynamic>? _invite;
  bool _loading = true;
  bool _joining = false;
  bool _alreadyMember = false;
  String? _error;

  String get _taskId => (_invite?['taskId'] as String?) ?? '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final invite = await ref
          .read(taskRepositoryProvider)
          .getInvite(widget.inviteCode);
      if (invite == null || invite['active'] == false) {
        if (mounted) {
          setState(() => _error = '這個邀請連結不存在或已停用。');
        }
        return;
      }

      final uid = ref.read(authStateProvider).value?.uid;
      var alreadyMember = false;
      if (uid != null) {
        try {
          final member = await ref
              .read(taskRepositoryProvider)
              .getTaskMember(invite['taskId'] as String, uid);
          alreadyMember = member?.active == true;
        } catch (_) {
          // 讀不到自己的 member 文件就當作尚未加入，按加入時規則仍會把關。
        }
      }

      if (mounted) {
        setState(() {
          _invite = invite;
          _alreadyMember = alreadyMember;
        });
      }
    } catch (err) {
      if (mounted) setState(() => _error = '讀取邀請失敗：$err');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openTask() {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(builder: (_) => TaskPage(taskId: _taskId)),
    );
  }

  Future<void> _join() async {
    final profile = ref.read(userProfileProvider).value;
    if (profile == null || _taskId.isEmpty) return;

    setState(() {
      _joining = true;
      _error = null;
    });

    try {
      await ref.read(taskRepositoryProvider).joinTask(widget.inviteCode);
      ref.invalidate(tasksProvider);
      if (mounted) _openTask();
    } on FirebaseFunctionsException catch (err) {
      if (!mounted) return;
      // callable 的訊息帶著它自己的理由（連結失效、任務已封存、還沒設暱稱），
      // 那些話比任何通用文案都準確，直接顯示。
      setState(() => _error = err.message ?? '加入失敗：${err.code}');
    } on FirebaseException catch (err) {
      if (!mounted) return;
      setState(() => _error = '加入失敗：${err.message ?? err.code}');
    } catch (err) {
      if (mounted) setState(() => _error = '加入失敗：$err');
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('任務邀請')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: _loading
                ? const CircularProgressIndicator()
                : Card(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (_invite != null) ...[
                            Text(
                              '加入簡單分帳',
                              textAlign: TextAlign.center,
                              style: text.bodySmall,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              (_invite!['taskName'] as String?) ?? '未命名任務',
                              textAlign: TextAlign.center,
                              style: text.headlineSmall,
                            ),
                            const SizedBox(height: 10),
                            Text(
                              _details(_invite!),
                              textAlign: TextAlign.center,
                              style: text.bodyMedium?.copyWith(
                                color: AppColors.muted,
                              ),
                            ),
                            if (_alreadyMember) ...[
                              const SizedBox(height: 14),
                              Text(
                                '你已經是這個任務的成員了。',
                                textAlign: TextAlign.center,
                                style: text.bodySmall,
                              ),
                            ],
                          ],
                          if (_error != null) ...[
                            const SizedBox(height: 16),
                            Text(
                              _error!,
                              textAlign: TextAlign.center,
                              style: text.bodyMedium?.copyWith(
                                color: AppColors.danger,
                              ),
                            ),
                          ],
                          if (_invite != null) ...[
                            const SizedBox(height: 24),
                            FilledButton(
                              onPressed: _joining
                                  ? null
                                  : (_alreadyMember ? _openTask : _join),
                              child: Text(
                                _joining
                                    ? '加入中...'
                                    : (_alreadyMember ? '進入任務' : '加入這個任務'),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

String _details(Map<String, dynamic> invite) {
  final currency = (invite['defaultCurrency'] as String?) ?? 'TWD';
  final start = (invite['startDate'] as String?) ?? '未設定日期';
  final end = (invite['endDate'] as String?) ?? '未設定日期';
  return '主要幣別 $currency · $start - $end';
}
