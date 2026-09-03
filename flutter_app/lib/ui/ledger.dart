/// 「一組內容一個容器」的四件套。
///
/// 網頁版靠 CSS class 就能共用這套長相（`.card` / `.card-strip` / `.row-line`），
/// Flutter 沒有這條路，所以它們得是真的 widget。
///
/// 這個檔案存在的理由是一句話：**卡片從「每一則內容一張」變成「一組內容一個」**。
/// 三張任務卡並排變成一張卡三列，中間一條線。密度就是這樣來的，
/// 而分隔線取代的正是原本陰影在做的事。
library;

import 'package:flutter/material.dart';

import 'theme.dart';

/// 卡片容器。
///
/// `clipBehavior` 是必要的：表頭條與分隔線都是滿寬的方塊，不裁切的話
/// 它們會從圓角的缺口露出方角來。
class LedgerCard extends StatelessWidget {
  final List<Widget> children;

  const LedgerCard({super.key, required this.children});

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.hardEdge,
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: children,
      ),
    );
  }
}

/// 卡頂的表頭條。左邊講這一組是什麼，右邊講它的小計。
///
/// 用底色而不是粗體字來分層：粗體字跟列裡的標題只差一個字重，
/// 掃視的時候分不出哪一行是標題。
class LedgerStrip extends StatelessWidget {
  final String title;
  final String? trailing;

  const LedgerStrip({super.key, required this.title, this.trailing});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.rowHead,
        border: Border(bottom: BorderSide(color: AppColors.rowLine)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpace.x4,
          vertical: 10,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
            ),
            if (trailing != null)
              Text(
                trailing!,
                style: figure(
                  size: 13,
                  weight: FontWeight.w400,
                  color: AppColors.muted,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 卡片裡的一列。
///
/// [amount] 走固定寬度而不是讓它自然靠右：用 Expanded 包標題的話，金額的
/// **左緣**會跟著標題長度跑，右對齊就只是每列各自貼右邊，位數還是對不齊。
class LedgerRow extends StatelessWidget {
  /// 金額欄的固定寬度。夠放到七位數（`999,999`）。
  static const amountWidth = 76.0;

  /// 給測試抓金額欄用。
  ///
  /// 量文字的位置量不到這件事：金額右對齊，所以位數不同的兩個字串左緣本來
  /// 就不一樣，而右緣就算沒有固定寬度也會對齊（它被 Expanded 擠到最右邊）。
  /// 要驗的是**這一欄本身每列一樣寬、起點一樣**，所以要抓得到它。
  static const amountKey = Key('ledger-amount');

  /// 有圖示時，分隔線該縮到的位置 —— 圖示的右緣。
  static const iconIndent = 44.0;

  final IconData? icon;
  final String title;
  final String? subtitle;
  final String? amount;

  /// 金額底下的小字，通常是幣別代碼。
  ///
  /// 分開放而不是跟金額連寫：一整欄的「TWD 12,480」同字級的話，眼睛每一列
  /// 都要先跳過三個字母才讀得到數字。
  final String? amountNote;
  final Color? amountColor;
  final Widget? trailing;
  final VoidCallback? onTap;

  const LedgerRow({
    super.key,
    this.icon,
    required this.title,
    this.subtitle,
    this.amount,
    this.amountNote,
    this.amountColor,
    this.trailing,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpace.x4,
        vertical: AppSpace.x3,
      ),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 18, color: AppColors.primaryDark),
            const SizedBox(width: AppSpace.x3),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontSize: 14, color: AppColors.ink),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: AppSpace.text),
                  Text(
                    subtitle!,
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (amount != null)
            SizedBox(
              key: amountKey,
              width: amountWidth,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    amount!,
                    textAlign: TextAlign.right,
                    style: figure(
                      size: 15,
                      weight: FontWeight.w600,
                      color: amountColor ?? AppColors.ink,
                    ),
                  ),
                  if (amountNote != null)
                    Text(
                      amountNote!,
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.muted,
                      ),
                    ),
                ],
              ),
            ),
          if (trailing != null) ...[
            const SizedBox(width: AppSpace.x2),
            trailing!,
          ],
        ],
      ),
    );

    if (onTap == null) return row;
    return InkWell(onTap: onTap, child: row);
  }
}

/// 列與列之間的線。
///
/// [indent] 預設縮到內容起點；有圖示的列傳 [LedgerRow.iconIndent]。
/// 整條拉滿會讓列表看起來像表格而不是清單。
class LedgerDivider extends StatelessWidget {
  final double indent;

  const LedgerDivider({super.key, this.indent = AppSpace.x4});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: indent),
      child: const DecoratedBox(
        decoration: BoxDecoration(color: AppColors.rowLine),
        child: SizedBox(height: 1, width: double.infinity),
      ),
    );
  }
}
