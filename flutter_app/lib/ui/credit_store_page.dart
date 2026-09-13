/// 儲值 AI 辨識點數。
///
/// 價格一律用商店回傳的字串（`ProductDetails.price`），不寫死 NT$ —— 其他地區的
/// 使用者看到的是當地幣別。點數與加送標籤來自 `domain/credit_store.dart`。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import '../data/error_text.dart';
import '../domain/ai_receipt.dart';
import '../domain/credit_store.dart';
import '../state/providers.dart';
import '../state/purchase_listener.dart';
import 'ledger.dart';
import 'theme.dart';

class CreditStorePage extends ConsumerStatefulWidget {
  const CreditStorePage({super.key});

  @override
  ConsumerState<CreditStorePage> createState() => _CreditStorePageState();
}

class _CreditStorePageState extends ConsumerState<CreditStorePage> {
  List<ProductDetails>? _products;
  String? _loadError;

  /// 正在付款的商品。付款畫面是商店畫的，結果從 PurchaseListener 回來。
  String? _buying;

  @override
  void initState() {
    super.initState();
    // 進來時清掉上一次的訊息，免得看到上一回「已加 30 點」。
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(purchaseNoticeProvider.notifier).state = null;
    });
    _load();
  }

  Future<void> _load() async {
    final repository = ref.read(creditPurchaseRepositoryProvider);
    try {
      if (!await repository.available()) {
        if (mounted) setState(() => _loadError = '目前無法儲值：這台裝置連不上商店。');
        return;
      }
      final products = await repository.products();
      if (!mounted) return;
      setState(() {
        _products = products;
        _loadError = products.isEmpty ? '目前無法儲值：商店沒有回傳方案，稍後再試。' : null;
      });
    } catch (err) {
      if (mounted) setState(() => _loadError = '目前無法儲值：${errorText(err)}');
    }
  }

  Future<void> _buy(ProductDetails product) async {
    setState(() => _buying = product.id);
    try {
      await ref.read(creditPurchaseRepositoryProvider).buy(product);
    } catch (err) {
      if (!mounted) return;
      setState(() => _buying = null);
      ref.read(purchaseNoticeProvider.notifier).state = PurchaseNotice(errorText(err), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final user = ref.watch(authStateProvider).value;
    final balance = ref.watch(aiCreditsProvider).value ?? freeCredits;
    final notice = ref.watch(purchaseNoticeProvider);

    // 監聽回報任何結果（成功、待處理、錯誤、取消）都代表這次付款結束了。
    ref.listen(purchaseNoticeProvider, (_, __) {
      if (_buying != null) setState(() => _buying = null);
    });

    final products = _products;

    return Scaffold(
      appBar: AppBar(title: const Text('儲值 AI 點數')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpace.x4),
        children: [
          if (user?.isAnonymous ?? false)
            Text(
              '綁定帳號才能儲值 —— 訪客帳號登出就會刪除，買的點數會跟著消失。到個人設定綁定帳號。',
              style: text.bodyMedium,
            )
          else ...[
            Text('現在有 $balance 點', style: text.titleLarge),
            const SizedBox(height: AppSpace.x2),
            Text('每讀一張收據用 1 點。點數跟著帳號走，網頁上也扣得到。', style: text.bodySmall),
            const SizedBox(height: AppSpace.x4),
            if (notice != null) ...[
              Text(
                notice.message,
                style: text.bodyMedium?.copyWith(color: notice.error ? AppColors.danger : AppColors.ink),
              ),
              const SizedBox(height: AppSpace.x3),
            ],
            if (_loadError != null)
              Text(_loadError!, style: text.bodyMedium?.copyWith(color: AppColors.danger))
            else if (products == null)
              const Center(child: CircularProgressIndicator())
            else
              LedgerCard(
                children: [
                  for (var i = 0; i < products.length; i++) ...[
                    if (i > 0) const LedgerDivider(),
                    _PackRow(
                      product: products[i],
                      busy: _buying != null,
                      buying: _buying == products[i].id,
                      onBuy: () => _buy(products[i]),
                    ),
                  ],
                ],
              ),
          ],
        ],
      ),
    );
  }
}

class _PackRow extends StatelessWidget {
  final ProductDetails product;
  final bool busy;
  final bool buying;
  final VoidCallback onBuy;

  const _PackRow({
    required this.product,
    required this.busy,
    required this.buying,
    required this.onBuy,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final pack = packInfo(product.id);
    final bonus = pack == null ? '' : bonusLabel(pack);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.x4, vertical: AppSpace.x3),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${pack?.credits ?? '?'} 點', style: figure(size: 22, weight: FontWeight.w700)),
                if (bonus.isNotEmpty)
                  Text(bonus, style: text.bodySmall?.copyWith(color: AppColors.primaryDeep)),
              ],
            ),
          ),
          FilledButton(
            onPressed: busy ? null : onBuy,
            child: Text(buying ? '處理中…' : product.price),
          ),
        ],
      ),
    );
  }
}
