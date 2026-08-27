import 'dart:io';

import 'package:image_picker/image_picker.dart';

import '../domain/receipt_policy.dart';

/// 拍照或從相簿選一張收據，縮好、轉成 JPEG。
///
/// 網頁版要自己開 canvas 重畫一次才做得到縮放與轉檔（`imageCompress.ts`），
/// 原生這邊 image_picker 內建 —— 而且是原生解碼器做的，順便處理掉
/// **EXIF 旋轉**：手機直拍的照片是橫的畫素加一個旋轉旗標，自己畫的話
/// 收據會躺著存進去。
///
/// 參數刻意跟網頁版對齊：長邊 1600px、quality 80。收據小字多，再小就開始
/// 糊到讀不出金額；再大則是白白吃 Storage 額度跟行動網路。
class ReceiptPicker {
  final ImagePicker _picker;

  ReceiptPicker({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  /// 取消選取回 null。
  ///
  /// 檔案太大時丟 [ReceiptTooLarge] —— 大小一定要在這裡擋，交給
  /// storage.rules 擋的話會失敗成 unauthorized，那跟「權限不足」長得一樣，
  /// 使用者不會知道是檔案太大。
  Future<File?> pick(ImageSource source) async {
    final picked = await _picker.pickImage(
      source: source,
      maxWidth: maxEdge.toDouble(),
      maxHeight: maxEdge.toDouble(),
      imageQuality: 80,
    );
    if (picked == null) return null;

    final file = File(picked.path);
    final size = await file.length();
    final rejection = sizeRejection(SizeStage.upload, size);
    if (rejection != null) throw ReceiptTooLarge(rejection);

    return file;
  }
}

/// 縮完還是太大。訊息裡已經寫好該怎麼辦了。
class ReceiptTooLarge implements Exception {
  final String message;
  const ReceiptTooLarge(this.message);

  @override
  String toString() => message;
}
