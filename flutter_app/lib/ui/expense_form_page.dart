import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/dictation_service.dart';
import '../data/rate_service.dart';
import '../domain/currency.dart';
import '../domain/expense_actions.dart';
import '../domain/expense_date.dart';
import '../domain/member_name.dart';
import '../domain/models.dart';
import '../domain/offline_write.dart';
import '../domain/task_status.dart';
// 'required' 這個名字跟 Flutter 的 @required 標註撞名，加前綴分開。
import '../domain/validation.dart' as validate;
import '../data/place_service.dart';
import '../state/providers.dart';
import 'place_field.dart';
import 'receipt_field.dart';
import 'theme.dart';
import 'weather_chip.dart';

/// 新增／編輯支出。`src/pages/ExpenseFormPage.vue` 的 Flutter 版。
///
/// **這是第一個會寫入的畫面。** 前面所有頁面寫錯最多是畫面不對，這裡寫錯
/// 就是弄髒真實的帳。所以三件事特別小心：
///
///   1. 金額一律走 `parseAmountInput`，不自己解析字串
///   2. 換算走 `convertAmount`，不自己乘除
///   3. 分攤走 `allocate`，總和必須等於金額（自訂模式下差一分錢就擋住送出）
///
/// 這三支都是網頁版驗證過、而且有測試釘住的同一份邏輯。
///
/// 收據與地點都接上了。收據跟網頁版有一個差別：網頁版拍完就排進佇列、
/// 在背景補傳，這裡是**按下儲存時才傳，傳成功才寫進文件**。
/// 理由見 `lib/data/receipt_repository.dart`。
class ExpenseFormPage extends ConsumerStatefulWidget {
  final String taskId;

  /// null 代表新增。
  final Expense? existing;

  /// 「再記一筆」帶過來的預填值。這仍然是**新增**，[existing] 是 null。
  ///
  /// 網頁版是用 `?from=<id>` 再讀一次來源，因為它的入口是一條 URL；
  /// App 的導航本來就帶著物件走，直接把算好的欄位傳進來就好。
  final RepeatFields? repeat;

  const ExpenseFormPage({
    super.key,
    required this.taskId,
    this.existing,
    this.repeat,
  });

  @override
  ConsumerState<ExpenseFormPage> createState() => _ExpenseFormPageState();
}

class _ExpenseFormPageState extends ConsumerState<ExpenseFormPage> {
  final _title = TextEditingController();
  final _amount = TextEditingController();
  final _rate = TextEditingController(text: '1');
  final _note = TextEditingController();

  /// 支出名稱的語音輸入。第一次按下麥克風才會真的初始化。
  final _dictation = DictationService();

  /// 地點欄位現在自己管字串，這裡只留它算出來的結果。
  ExpensePlace? _place;

  /// 收據欄位回報的狀態：沒碰過／換了一張／移除了。
  ReceiptState _receipt = ReceiptState.untouched;

  ExpenseCategory _category = defaultCategory;
  String _currency = 'TWD';
  String _date = todayInput();
  String _time = nowTimeInput();

  Weather? _weather;
  bool _weatherLoading = false;
  String _paidBy = '';
  SplitMode _splitMode = SplitMode.even;

  /// 均分時參與的人。
  final Set<String> _splitWith = {};

  /// 自訂分攤時每個人填的金額字串。
  final Map<String, TextEditingController> _custom = {};

  bool _saving = false;
  bool _rateLoading = false;
  String? _error;
  String? _rateError;
  String _rateUpdatedAt = '';

  bool get _isEdit => widget.existing != null;

  /// 這個人動不動得了正在編輯的這一筆。條件跟 firestore.rules 一樣，
  /// 判斷本身在 `domain/expense_actions.dart`，這裡只是把材料湊齊。
  bool _canManage(Task task, Expense existing, String uid) {
    return canManageExpense(
      expense: existing,
      uid: uid,
      isAdmin: task.ownerId == uid || task.adminIds.contains(uid),
      archived: taskStatusFrom(task.status) == TaskStatus.archived,
    );
  }

  @override
  void initState() {
    super.initState();
    final uid = ref.read(authStateProvider).value?.uid ?? '';
    _paidBy = uid;

    final existing = widget.existing;
    if (existing != null) {
      _title.text = existing.title;
      _amount.text = amountToInput(existing.amount, existing.currency);
      _category = existing.category;
      _currency = existing.currency;
      _paidBy = existing.paidBy;
      _splitMode = existing.splitMode;
      _splitWith.addAll(existing.splits.keys);
      _date = existing.date ?? expenseDate(existing);
      _time = existing.time ?? '';
      _place = existing.place;
      /*
        沿用已存的天氣，**不重查**。

        重查的話：離線編輯 → 查回 null → 存檔把原本正確的天氣洗掉，
        而使用者只是改個備註，畫面上完全看不出來發生過這件事。
        網頁版踩過這個坑。
      */
      _weather = existing.weather;
      // 備註一定要回填。存檔時一律寫入 note 欄位，這裡不填就等於
      // 每編輯一次就把原本的備註洗掉一次。
      _note.text = existing.note;
      for (final entry in existing.splits.entries) {
        _custom[entry.key] = TextEditingController(
          text: amountToInput(entry.value, existing.currency),
        );
      }
    }

    // 「再記一筆」：金額、日期、時間、匯率刻意不帶，理由見 repeatFieldsOf。
    final repeat = widget.repeat;
    if (repeat != null) {
      _title.text = repeat.title;
      _category = repeat.category;
      _currency = repeat.currency;
      _paidBy = repeat.paidBy;
      _splitMode = repeat.splitMode;
      _place = repeat.place;
      // 「再記一筆」不帶日期，所以是今天 —— 天氣要照今天重查，不能沿用
      // 來源那筆的。initState 不能 await，交給第一幀之後。
      WidgetsBinding.instance.addPostFrameCallback((_) => _refreshWeather());
      // 只帶「分攤給誰」，**不帶各人的金額**。自訂金額是跟著來源那筆的
      // 總額算出來的，而新的一筆總額還沒填 —— 預填進去只會讓驗證對著
      // 使用者根本沒打過的數字喊「合計對不上」。
      _splitWith.addAll(repeat.splits.keys);
    }
  }

  /// 地點與日期都有了就查天氣。
  ///
  /// **只在使用者改動地點、日期或時間時呼叫，載入既有支出時不呼叫。**
  /// 載入時呼叫的話，離線編輯會查回 null 把原本正確的天氣清掉 ——
  /// 而使用者只是改個備註，畫面上完全看不出來發生過這件事。
  Future<void> _refreshWeather() async {
    // 先清空：改了就重查，查不到就沒有。停在那裡的舊天氣是「三月三號
    // 清邁的雨」配上「三月五號曼谷的晚餐」，跟未換算支出同一個立場 ——
    // 寧可沒有，不要錯的。
    final canLookup = _place?.lat != null && _date.isNotEmpty;
    setState(() {
      _weather = null;
      _weatherLoading = canLookup;
    });
    if (!canLookup) return;

    final found = await ref.read(weatherRepositoryProvider).lookup(
          place: _place,
          date: _date,
          time: _time,
        );
    if (!mounted) return;
    setState(() {
      _weather = found;
      _weatherLoading = false;
    });
  }

  @override
  void dispose() {
    _dictation.dispose();
    _title.dispose();
    _amount.dispose();
    _rate.dispose();
    _note.dispose();
    for (final c in _custom.values) {
      c.dispose();
    }
    super.dispose();
  }

  // ------------------------------------------------------------ 計算

  String _baseCurrency(Task? task) => task?.defaultCurrency ?? 'TWD';
  bool _needsRate(Task? task) => _currency != _baseCurrency(task);

  int? _parsedAmount() {
    try {
      return parseAmountInput(_amount.text, _currency);
    } on FormatException {
      return null;
    }
  }

  double? _parsedRate(Task? task) {
    if (!_needsRate(task)) return 1;
    try {
      return parseRateInput(_rate.text);
    } on FormatException {
      return null;
    }
  }

  /// 均分：所有參與者權重相同，餘數由 `allocate` 依成員順序分配。
  Map<String, int> _evenSplits(List<TaskMember> members) {
    final total = _parsedAmount();
    final ids = members.map((m) => m.uid).where(_splitWith.contains).toList();
    if (total == null || ids.isEmpty) return {};
    final shares = allocate(total, List<int>.filled(ids.length, 1));
    return {for (var i = 0; i < ids.length; i += 1) ids[i]: shares[i]};
  }

  /// 自訂：每個人自己填。回傳的 invalid 代表有欄位格式錯誤。
  ({Map<String, int> splits, bool invalid}) _customSplits() {
    final splits = <String, int>{};
    var invalid = false;
    _custom.forEach((uid, controller) {
      final raw = controller.text.trim();
      if (raw.isEmpty) return;
      try {
        splits[uid] = parseAmountInput(raw, _currency);
      } on FormatException {
        invalid = true;
      }
    });
    return (splits: splits, invalid: invalid);
  }

  Map<String, int> _finalSplits(List<TaskMember> members) =>
      _splitMode == SplitMode.even
          ? _evenSplits(members)
          : _customSplits().splits;

  int _customDiff() {
    final total = _parsedAmount() ?? 0;
    final sum = _customSplits().splits.values.fold<int>(0, (a, b) => a + b);
    return total - sum;
  }

  bool _canSubmit(Task? task, List<TaskMember> members) {
    if (_title.text.trim().isEmpty) return false;
    if (_parsedAmount() == null) return false;
    if (_parsedRate(task) == null) return false;
    if (_splitMode == SplitMode.even) return _splitWith.isNotEmpty;
    final custom = _customSplits();
    return !custom.invalid && custom.splits.isNotEmpty && _customDiff() == 0;
  }

  // ------------------------------------------------------------ 動作

  Future<void> _lookupRate(Task? task) async {
    setState(() {
      _rateLoading = true;
      _rateError = null;
    });
    try {
      final quote = await getRate(_currency, _baseCurrency(task));
      if (!mounted) return;
      setState(() {
        // 六位小數 —— 跟 parseRateInput 的上限一致，不然抓回來的值自己過不了驗證。
        _rate.text = quote.rate.toStringAsFixed(6);
        _rateUpdatedAt = quote.updatedAt;
      });
    } catch (err) {
      if (mounted) setState(() => _rateError = err.toString());
    } finally {
      if (mounted) setState(() => _rateLoading = false);
    }
  }

  Future<void> _submit(Task task, List<TaskMember> members) async {
    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final parsed = parseAmountInput(_amount.text, _currency);
      final usedRate = _needsRate(task) ? parseRateInput(_rate.text) : 1.0;
      final converted =
          convertAmount(parsed, _currency, task.defaultCurrency, usedRate);
      if (converted <= 0) {
        throw FormatException(
          '換算成 ${task.defaultCurrency} 後金額不到最小單位，請確認匯率',
        );
      }

      final splits = _finalSplits(members);
      if (splits.isEmpty) throw const FormatException('至少要有一位分攤成員');
      if (_splitMode == SplitMode.custom && _customDiff() != 0) {
        throw const FormatException('自訂分攤的合計必須等於支出金額');
      }

      final place = _place;
      final input = <String, dynamic>{
        'title': validate.required(_title.text, '支出名稱'),
        'category': _category.name,
        'amount': parsed,
        'currency': _currency,
        'rate': usedRate,
        'baseAmount': converted,
        'paidBy': _paidBy,
        'splitMode': _splitMode.name,
        'splits': splits,
        // 從建議選出來的帶著座標，只打名字的就只有名字 —— 後者跟網頁版
        // 沒設定金鑰時的退化行為一致。
        'place': place == null
            ? null
            : {
                'name': place.name,
                'address': place.address,
                'lat': place.lat,
                'lng': place.lng,
                'placeId': place.placeId,
              },
        // 查不到就是 null —— 那時 onExpenseWeather 觸發器會在文件建立後
        // 補寫，所以離線記的帳最後還是會有天氣。
        'weather': _weather == null
            ? null
            : {
                'code': _weather!.code,
                'high': _weather!.high,
                'low': _weather!.low,
                'exact': _weather!.exact,
              },
        'note': _note.text.trim(),
        'date': _date.isEmpty ? todayInput() : _date,
        // 清空的話就是空字串（沒記時間），不要補上現在幾點。
        'time': _time,
      };

      /*
        收據只在**使用者動過它**的時候才出現在這個 map 裡。

        沒動過就整個 key 不提 —— Firestore 的 update 只動有列出來的欄位。
        寫 `receipt: null` 的話，網頁版拍的那張照片的引用就被清掉了：
        檔案還在 Storage，但沒有任何地方指向它，等於使用者的收據不見了。

        新的照片不在這裡處理，因為新增支出時還沒有 id、也就還沒有 Storage
        路徑。那一段在下面 `_saveReceipt`。
      */
      if (_receipt.change == ReceiptChange.removed) {
        input['receipt'] = null;
      }

      final repo = ref.read(expenseRepositoryProvider);
      final uid = ref.read(authStateProvider).value?.uid ?? '';

      final WriteOutcome outcome;
      final String expenseId;
      if (_isEdit) {
        expenseId = widget.existing!.id;
        outcome = await settleWrite(
          repo.updateExpense(widget.taskId, expenseId, input),
        );
      } else {
        final created = repo.createExpense(widget.taskId, input, uid);
        expenseId = created.id;
        outcome = await settleWrite(created.synced);
      }

      // 帳先存好了，照片才處理。順序不能反過來：新增時要先有 id 才有路徑，
      // 而且萬一照片傳失敗，至少這筆帳是記下來的。
      final receiptError = await _saveReceipt(expenseId);

      if (!mounted) return;
      if (receiptError != null) {
        // 支出已經寫進去了，這裡不能再擋著不讓走 —— 只是照片沒上去。
        // 留在原地讓他重按一次儲存，比默默吞掉好。
        setState(() {
          _error = receiptError;
          _saving = false;
        });
        return;
      }
      Navigator.of(context).pop(outcome);
    } on FormatException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// 處理收據。成功（或本來就沒事要做）回 null，失敗回要顯示的訊息。
  ///
  /// 上傳成功才寫 `receipt` 欄位。沒有離線佇列的情況下先把文件標成待上傳，
  /// 那個狀態就永遠不會變，而使用者完全沒辦法補救。
  Future<String?> _saveReceipt(String expenseId) async {
    final storage = ref.read(receiptRepositoryProvider);
    final repo = ref.read(expenseRepositoryProvider);

    if (_receipt.change == ReceiptChange.removed) {
      // 文件那邊在上面的 input 裡已經清掉了，這裡只負責檔案。
      // 刪不掉就算了 —— 孤兒檔案是接受的取捨，總比讓編輯失敗好。
      await storage.delete(widget.taskId, expenseId);
      return null;
    }

    final file = _receipt.file;
    if (_receipt.change != ReceiptChange.replaced || file == null) return null;

    try {
      final path = await storage.upload(widget.taskId, expenseId, file);
      // 只寫 receipt 一個欄位，跟網頁版補傳時一樣。
      await repo.updateExpense(widget.taskId, expenseId, {
        'receipt': {'path': path, 'localId': null},
      });
      return null;
    } catch (err) {
      return '這筆支出存好了，但收據沒有傳上去（$err）。'
          '等網路穩一點再編輯這筆支出、重新選一次照片就可以。';
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('刪除這筆支出？'),
        content: const Text('刪掉就找不回來了。'),
        actions: [
          // 取消刻意用灰的：兩顆都是主色的話，紅的那顆就不顯眼了。
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.muted),
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            child: const Text('刪除'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _saving = true);
    try {
      // 先清收據再刪支出：反過來的話，文件沒了就沒有東西能告訴我們該刪哪個
      // 路徑，那張圖會永遠留在 Storage 上。
      //
      // 刪不掉不擋刪除 —— 孤兒檔案是設計上接受的取捨（`ReceiptRepository.delete`
      // 本來就把例外吞掉了）。網頁版的順序與理由一模一樣。
      if (widget.existing!.receipt != null) {
        await ref
            .read(receiptRepositoryProvider)
            .delete(widget.taskId, widget.existing!.id);
      }

      await settleWrite(
        ref
            .read(expenseRepositoryProvider)
            .deleteExpense(widget.taskId, widget.existing!.id),
      );
      if (mounted) Navigator.of(context).pop(WriteOutcome.synced);
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _saving = false;
        });
      }
    }
  }

  // ------------------------------------------------------------ 畫面

  @override
  Widget build(BuildContext context) {
    final task = ref.watch(taskProvider(widget.taskId)).value;
    final members = ref.watch(membersProvider(widget.taskId)).value ?? const [];

    // 一律取一次，不要包在條件裡 —— 有條件的 watch 會讓訂閱時有時無。
    final uid = ref.watch(authStateProvider).value?.uid ?? '';

    // 第二道防線。列表已經依權限分流了，但這一頁自己也要擋 —— 少了它，
    // 之後任何一個新的入口導進來，使用者都會整張表單填完才被規則打回票。
    final existing = widget.existing;
    final blocked =
        existing != null && task != null && !_canManage(task, existing, uid);

    // 已被移除的成員若原本就在這筆支出裡，仍要留在選單上，
    // 不然編輯時會被迫把他踢掉。
    final selectable =
        members.where((m) => m.active || _splitWith.contains(m.uid)).toList();

    // 新增時預設全員均分。
    if (!_isEdit && _splitWith.isEmpty && selectable.isNotEmpty) {
      _splitWith.addAll(selectable.where((m) => m.active).map((m) => m.uid));
    }
    for (final m in selectable) {
      _custom.putIfAbsent(m.uid, () => TextEditingController());
    }

    final text = Theme.of(context).textTheme;
    final needsRate = _needsRate(task);
    final amountErr = amountInputError(_amount.text, _currency);
    final rateErr = needsRate ? rateInputError(_rate.text) : null;
    final parsed = _parsedAmount();
    final usedRate = _parsedRate(task);
    final base = (parsed != null && usedRate != null && task != null)
        ? convertAmount(parsed, _currency, task.defaultCurrency, usedRate)
        : null;

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? '編輯支出' : '新增支出')),
      body: task == null
          ? const Center(child: CircularProgressIndicator())
          : blocked
          ? const _Blocked()
          // SingleChildScrollView + Column 而不是 ListView，是因為 ListView
          // **會把捲出畫面的欄位整個 dispose 掉**。這一頁的欄位各自握著自己的
          // 狀態（挑好還沒上傳的收據、打到一半的地點），捲上去看一眼金額再捲
          // 回來，那些東西就沒了 —— 而且畫面上看起來就只是「我明明選過照片」。
          //
          // 表單不是長列表，十幾個欄位一次全建起來沒有任何效能問題。
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.x4,
                AppSpace.x2,
                AppSpace.x4,
                AppSpace.x8,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // 分類排在名稱前面：先按一下分類，名稱要打什麼通常也就想好了，
                  // 而且手指從分類滑到名稱是連續動作。
                  _Card(
                    children: [
                      _Field(
                        label: '分類',
                        /*
                          四欄格子而不是一排 chip。六個分類的 chip 在 390px
                          寬度下會換行成兩排長短不一的膠囊，最後兩個常常掉到
                          第二排的左邊，看起來像另一組東西。

                          格子等寬，六個剛好兩列，而且每一格 66px 高，
                          比 chip 的命中區大得多。
                        */
                        child: GridView.count(
                          crossAxisCount: 4,
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          mainAxisSpacing: AppSpace.x2,
                          crossAxisSpacing: AppSpace.x2,
                          childAspectRatio: 1.25,
                          children: [
                            for (final meta in expenseCategories)
                              _CategoryTile(
                                meta: meta,
                                selected: _category == meta.value,
                                onTap: () =>
                                    setState(() => _category = meta.value),
                              ),
                          ],
                        ),
                      ),
                      _Field(
                        label: '支出名稱',
                        child: _TitleField(
                          controller: _title,
                          dictation: _dictation,
                          // 講出來的內容**直接取代**欄位內容，不是接在後面 ——
                          // 「晚」加上聽到的「晚餐」會變成「晚晚餐」，那比重打
                          // 一次還煩。名稱本來就短，講錯再講一次就好。
                          onText: (text) => setState(() {
                            _title.text = text.length > 60
                                ? text.substring(0, 60)
                                : text;
                          }),
                          onChanged: () => setState(() {}),
                        ),
                      ),
                      _Field(
                        label: '金額',
                        hint: minorUnits(_currency) > 0
                            ? '最多 ${minorUnits(_currency)} 位小數'
                            : '$_currency 不使用小數',
                        error: amountErr,
                        child: Row(
                          children: [
                            // 金額是這一頁存在的理由，所以它是這一頁最大的
                            // 字。不另外開一張卡：_Card 的註解已經論證過
                            // 「依主題分卡會讓總高變長」，那跟密度是反向的。
                            Expanded(
                              child: TextField(
                                controller: _amount,
                                keyboardType: const TextInputType.numberWithOptions(
                                  decimal: true,
                                ),
                                style: figure(size: 32),
                                decoration: const InputDecoration(
                                  hintText: '0',
                                  isDense: true,
                                ),
                                onChanged: (_) => setState(() {}),
                              ),
                            ),
                            const SizedBox(width: 12),
                            DropdownButton<String>(
                              value: _currency,
                              items: [
                                for (final code in currencies)
                                  DropdownMenuItem(value: code, child: Text(code)),
                              ],
                              onChanged: (value) {
                                if (value == null) return;
                                setState(() {
                                  _currency = value;
                                  _rateUpdatedAt = '';
                                  if (value == task.defaultCurrency) {
                                    _rate.text = '1';
                                  }
                                });
                              },
                            ),
                          ],
                        ),
                      ),
                      if (needsRate)
                        _Field(
                          label: '匯率（1 $_currency = ? ${task.defaultCurrency}）',
                          hint: _rateUpdatedAt.isEmpty
                              ? '匯率在記帳當下鎖住，之後波動不影響這筆帳'
                              : '更新於 $_rateUpdatedAt',
                          error: rateErr ?? _rateError,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: TextField(
                                      controller: _rate,
                                      keyboardType:
                                          const TextInputType.numberWithOptions(
                                              decimal: true),
                                      onChanged: (_) => setState(() {}),
                                    ),
                                  ),
                                  const SizedBox(width: AppSpace.x3),
                                  OutlinedButton(
                                    onPressed: _rateLoading
                                        ? null
                                        : () => _lookupRate(task),
                                    child: Text(_rateLoading ? '查詢中' : '查匯率'),
                                  ),
                                ],
                              ),
                              // 換算後金額本來是浮在欄位外的一整塊。它是匯率的結果，
                              // 不是另一件事 —— 網頁版壓成 ≈ TWD 672 一行，這裡照做。
                              if (base != null) ...[
                                const SizedBox(height: AppSpace.x2),
                                Text(
                                  '≈ ${task.defaultCurrency} '
                                  '${formatAmount(base, task.defaultCurrency)}',
                                  style: text.bodySmall,
                                ),
                              ],
                            ],
                          ),
                        ),
                    ],
                  ),
                  _Card(
                    title: '這趟的細節',
                    children: [
                      _Field(
                        label: '日期與時間',
                        child: Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () async {
                                  final parts =
                                      _date.split('-').map(int.tryParse).toList();
                                  final initial = parts.length == 3 &&
                                          parts.every((p) => p != null)
                                      ? DateTime(parts[0]!, parts[1]!, parts[2]!)
                                      : DateTime.now();
                                  final picked = await showDatePicker(
                                    context: context,
                                    initialDate: initial,
                                    firstDate: DateTime(2020),
                                    lastDate: DateTime(2100),
                                  );
                                  if (picked != null) {
                                    setState(() => _date = toDateInput(picked));
                                    _refreshWeather();
                                  }
                                },
                                child: Text(_date.isEmpty ? '選日期' : _date),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () async {
                                  final picked = await showTimePicker(
                                    context: context,
                                    initialTime: TimeOfDay.now(),
                                  );
                                  if (picked != null) {
                                    setState(() => _time =
                                        '${picked.hour.toString().padLeft(2, '0')}:'
                                            '${picked.minute.toString().padLeft(2, '0')}');
                                    _refreshWeather();
                                  }
                                },
                                child: Text(_time.isEmpty ? '沒記時間' : _time),
                              ),
                            ),
                            if (_time.isNotEmpty)
                              IconButton(
                                tooltip: '清除時間',
                                icon: const Icon(Icons.close, size: 18),
                                onPressed: () {
                                  setState(() => _time = '');
                                  _refreshWeather();
                                },
                              ),
                          ],
                        ),
                      ),
                      _Field(
                        label: '地點（選填）',
                        hint: PlaceService.placesEnabled
                            ? '選建議的地點會一起記下座標，報告的地圖才標得出來'
                            : '沒有設定地點金鑰，目前只能打名字',
                        child: PlaceField(
                          taskId: widget.taskId,
                          initial: widget.existing?.place,
                          // 這一格自己管輸入，父層只要知道最後算出來是什麼。
                          onChanged: (value) {
                            _place = value;
                            _refreshWeather();
                          },
                        ),
                      ),
                      // 天氣是加分不是必要：查不到就整段不出現，沒有錯誤
                      // 訊息。使用者正在記一筆帳，那才是他來這一頁的目的。
                      if (_weatherLoading)
                        Padding(
                          padding: const EdgeInsets.only(
                            bottom: AppSpace.x4,
                          ),
                          child: Text('查天氣中...', style: text.bodySmall),
                        )
                      else if (_weather != null)
                        Padding(
                          padding: const EdgeInsets.only(
                            bottom: AppSpace.x4,
                          ),
                          child: WeatherChip(
                            weather: _weather!,
                            variant: WeatherChipVariant.chip,
                            showLabel: true,
                          ),
                        ),
                      _Field(
                        label: '收據（選填）',
                        hint: _isEdit ? null : '按下儲存時才會上傳，傳完才算數',
                        child: ReceiptField(
                          existing: widget.existing?.receipt,
                          taskId: widget.taskId,
                          expenseId: widget.existing?.id,
                          canManage: true,
                          onChanged: (value) => setState(() => _receipt = value),
                        ),
                      ),
                      _Field(
                        label: '備註（選填）',
                        child: TextField(controller: _note, maxLines: 3),
                      ),
                    ],
                  ),
                  _Card(
                    title: '怎麼分',
                    children: [
                      _Field(
                        label: '誰先付的',
                        child: DropdownButton<String>(
                          value: selectable.any((m) => m.uid == _paidBy)
                              ? _paidBy
                              : (selectable.isEmpty ? null : selectable.first.uid),
                          isExpanded: true,
                          items: [
                            for (final m in selectable)
                              DropdownMenuItem(
                                value: m.uid,
                                child: Text(
                                  memberDisplayName(m),
                                ),
                              ),
                          ],
                          onChanged: (value) =>
                              setState(() => _paidBy = value ?? _paidBy),
                        ),
                      ),
                      _Field(
                        label: '分攤方式',
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            SegmentedButton<SplitMode>(
                              segments: const [
                                ButtonSegment(
                                    value: SplitMode.even, label: Text('均分')),
                                ButtonSegment(
                                    value: SplitMode.custom, label: Text('自訂')),
                              ],
                              selected: {_splitMode},
                              onSelectionChanged: (s) =>
                                  setState(() => _splitMode = s.first),
                            ),
                            const SizedBox(height: 12),
                            if (_splitMode == SplitMode.even)
                              for (final m in selectable)
                                CheckboxListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  value: _splitWith.contains(m.uid),
                                  title: Text(
                                    memberDisplayName(m),
                                  ),
                                  onChanged: (on) => setState(() {
                                    on == true
                                        ? _splitWith.add(m.uid)
                                        : _splitWith.remove(m.uid);
                                  }),
                                )
                            else ...[
                              for (final m in selectable)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          memberDisplayName(m),
                                        ),
                                      ),
                                      SizedBox(
                                        width: 130,
                                        child: TextField(
                                          controller: _custom[m.uid],
                                          textAlign: TextAlign.right,
                                          keyboardType:
                                              const TextInputType.numberWithOptions(
                                                  decimal: true),
                                          decoration:
                                              const InputDecoration(isDense: true),
                                          onChanged: (_) => setState(() {}),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              // 差額一定要顯示。合計不等於金額時送出鍵是灰的，
                              // 不講差多少的話使用者只能自己一個一個加。
                              Builder(builder: (context) {
                                final diff = _customDiff();
                                return Text(
                                  diff == 0
                                      ? '合計正好等於支出金額'
                                      : diff > 0
                                          ? '還差 ${formatAmount(diff, _currency)}'
                                          : '超出 ${formatAmount(-diff, _currency)}',
                                  style: text.bodySmall?.copyWith(
                                    color: diff == 0
                                        ? AppColors.success
                                        : AppColors.danger,
                                  ),
                                );
                              }),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                  /*
                    刪除留在捲動流裡，不進固定列。網頁版的 93be088 講的就是
                    手機：系統對話框的 OK 落在哪不是我們能決定的，而它傾向
                    落在拇指下 —— 螢幕底部那一列就是拇指的定位點，不可逆的
                    操作不該常駐在那裡。

                    附帶好處：刪除需要刻意捲下去才找得到，那正是它應得的摩擦。
                  */
                  if (_isEdit)
                    OutlinedButton(
                      onPressed: _saving ? null : _delete,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.danger,
                      ),
                      child: const Text('刪除這筆支出'),
                    ),
                ],
              ),
            ),
      /*
        送出鈕固定在畫面底部。記帳常常是在餐廳裡站著單手做的，而它原本在
        十一個區塊之後。

        用 bottomNavigationBar 而不是把它塞進捲動流底部：
        resizeToAvoidBottomInset 預設是 true，鍵盤跳出來時 body 會縮、
        這一列會被推到鍵盤正上方。這是框架直接管 view insets ——
        網頁版為了同一件事得用 sticky 再繞開 iOS Safari 把 fixed 元素頂歪
        的行為。這一項在 Flutter 是用對元件，不是 workaround。

        錯誤訊息跟著進來：不然送出失敗時使用者停在表單上方，訊息印在捲動流
        底部，他會按了送出、什麼都沒發生、也不知道為什麼。

        背景是 card（白）不是 bg：danger 對頁面底色只有 4.10:1、對白底才有
        4.66:1，而錯誤訊息就印在這一列上。這是 test/theme_contrast_test.dart
        逼出來的結論，不是配色偏好。

        SafeArea 是必要的（iPhone 底部那條橫槓）。讀取中與沒權限時不給這一列
        —— 那兩個畫面上沒有東西可以送出。
      */
      bottomNavigationBar: (task == null || blocked)
          ? null
          : Container(
              decoration: const BoxDecoration(
                color: AppColors.card,
                border: Border(top: BorderSide(color: AppColors.line)),
              ),
              child: SafeArea(
                minimum: const EdgeInsets.fromLTRB(
                  AppSpace.x4,
                  AppSpace.x2,
                  AppSpace.x4,
                  AppSpace.x2,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_error != null) ...[
                      Text(
                        _error!,
                        style: text.bodySmall?.copyWith(
                          color: AppColors.danger,
                        ),
                      ),
                      const SizedBox(height: AppSpace.x2),
                    ],
                    Row(
                      children: [
                        /*
                          跨幣別時把換算後的合計放在送出鈕旁邊。那是按下去
                          之後真正會被記進帳裡的數字，而它原本只出現在卷軸
                          上方的匯率欄位裡 —— 按鈕在畫面底部，看不到它。
                        */
                        if (base != null) ...[
                          Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('合計', style: text.bodySmall),
                              Text(
                                '${task.defaultCurrency} '
                                '${formatAmount(base, task.defaultCurrency)}',
                                style: figure(size: 16, weight: FontWeight.w700),
                              ),
                            ],
                          ),
                          const SizedBox(width: AppSpace.x3),
                        ],
                        Expanded(
                          child: FilledButton(
                            onPressed: (_saving || !_canSubmit(task, selectable))
                                ? null
                                : () => _submit(task, selectable),
                            child: Text(_saving ? '儲存中...' : '儲存'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}

/// 進得來但改不了。說清楚是誰改得了，不然使用者只會覺得 App 壞了。
class _Blocked extends StatelessWidget {
  const _Blocked();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.lock_outline, size: 40, color: AppColors.muted),
            const SizedBox(height: 12),
            Text('這筆不是你記的', style: text.titleMedium),
            const SizedBox(height: 8),
            Text(
              '你只能修改自己建立或自己先付的支出。'
              '要改這一筆的話，找記帳的人或任務的管理員。',
              style: text.bodySmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('返回'),
            ),
          ],
        ),
      ),
    );
  }
}

/// 一張卡，帶一個可選的小標。
///
/// 十一個欄位平鋪時每個東西的視覺重量都一樣，所以真正必填的那兩個 ——
/// 名稱與金額 —— 沒有重量。分組依「你會不會動它」而不是依主題：依主題要
/// 四張卡，而卡片的 padding 是有成本的，總高度會比平鋪更長，那是反方向。
///
/// 主卡不給小標：它是主角，不需要一個標題來宣告自己是主角。
class _Card extends StatelessWidget {
  final String? title;
  final List<Widget> children;

  const _Card({this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.x4),
      child: Card(
        child: Padding(
          // 底部只給 x1：每個 _Field 自己帶 bottom: x4，兩邊都給 16 的話
          // 卡片底部會空出 32。
          padding: const EdgeInsets.fromLTRB(
            AppSpace.x4,
            AppSpace.x4,
            AppSpace.x4,
            AppSpace.x1,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (title != null) ...[
                Text(title!, style: text.titleSmall),
                const SizedBox(height: AppSpace.x4),
              ],
              ...children,
            ],
          ),
        ),
      ),
    );
  }
}

/// 分類格子的一格。
///
/// 選中用實心 primaryDark 加白字，不是加邊框或換底色的淺色版：一排六格
/// 裡面「哪一個被選了」要在半秒內看出來，而淺色差異在陽光下的手機上看不出來。
class _CategoryTile extends StatelessWidget {
  final CategoryMeta meta;
  final bool selected;
  final VoidCallback onTap;

  const _CategoryTile({
    required this.meta,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final foreground = selected ? Colors.white : AppColors.primaryDark;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: selected ? AppColors.primaryDark : null,
          border: selected
              ? null
              : Border.all(color: AppColors.lineStrong),
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(meta.icon, size: 18, color: foreground),
            const SizedBox(height: AppSpace.x1),
            Text(
              meta.label,
              style: TextStyle(
                fontSize: 11,
                color: selected ? Colors.white : AppColors.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  final String label;
  final String? hint;
  final String? error;
  final Widget child;

  const _Field({
    required this.label,
    this.hint,
    this.error,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.x4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: text.bodySmall),
          const SizedBox(height: AppSpace.x2),
          child,
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: AppSpace.x2),
              child: Text(error!,
                  style: text.bodySmall?.copyWith(color: AppColors.danger)),
            )
          else if (hint != null)
            Padding(
              padding: const EdgeInsets.only(top: AppSpace.x2),
              child: Text(hint!, style: text.bodySmall),
            ),
        ],
      ),
    );
  }
}

/// 支出名稱欄位，右邊掛一顆麥克風。
///
/// 抽成獨立的 widget 是為了 `ListenableBuilder`：語音的狀態變化只該重畫
/// 這一列，而不是整張表單 —— 那上面有十幾個各自握著狀態的欄位。
class _TitleField extends StatelessWidget {
  final TextEditingController controller;
  final DictationService dictation;
  final void Function(String text) onText;
  final VoidCallback onChanged;

  const _TitleField({
    required this.controller,
    required this.dictation,
    required this.onText,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return ListenableBuilder(
      listenable: dictation,
      builder: (context, _) {
        final listening = dictation.listening;
        final error = dictation.error;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: controller,
                    decoration: const InputDecoration(hintText: '例如：晚餐'),
                    onChanged: (_) => onChanged(),
                  ),
                ),
                const SizedBox(width: 4),
                // 聽的時候換成停止圖示，因為按下去就是停。
                IconButton(
                  tooltip: listening ? '停止語音輸入' : '用說的輸入支出名稱',
                  onPressed: () => dictation.toggle(onText),
                  color: listening ? AppColors.primary : AppColors.muted,
                  icon: Icon(listening ? Icons.stop_circle : Icons.mic_none),
                ),
              ],
            ),
            if (listening)
              Text('請說話...', style: text.bodySmall)
            else if (error != null)
              Text(
                error,
                style: text.bodySmall?.copyWith(color: AppColors.danger),
              ),
          ],
        );
      },
    );
  }
}
