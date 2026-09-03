/// 完整結算與付款紀錄。原本是任務頁的第三個頁籤。
///
/// 搬出來的理由不是這一頁不重要，正好相反：「我還要付誰多少」是這個 app
/// 存在的理由，所以它的**答案**該在任務頁第一眼看得到（那是頂部的摘要卡），
/// 而完整的面板 —— 誰欠誰、付款記錄、確認流程 —— 是答案的後續，
/// 不是每次進任務頁都要看的東西。
///
/// 這一頁只是外殼。`SettlementTab` 的內部完全沒有改。
library;

import 'package:flutter/material.dart';

import '../domain/models.dart';
import 'settlement_tab.dart';

class SettlementPage extends StatelessWidget {
  final Task task;
  final bool archived;

  const SettlementPage({super.key, required this.task, required this.archived});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('結算與付款紀錄')),
      body: SettlementTab(task: task, archived: archived),
    );
  }
}
