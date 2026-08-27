package com.dyco.splitflow

import android.content.pm.PackageManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.security.MessageDigest

/**
 * 把「這個 App 是誰」交給 Dart。
 *
 * 為什麼需要：Android 限制的 API 金鑰是靠**套件名 + 簽章 SHA-1** 認人的。
 * 原生 SDK（地圖）會自動把這兩樣附在請求上，但我們用 REST 直接打 Places
 * 的請求不會 —— Google 那邊看到的是 `<empty>`，然後回
 * `Requests from this Android client application <empty> are blocked`。
 *
 * 解法是自己送 `X-Android-Package` 與 `X-Android-Cert` 兩個 header。
 * 套件名 Dart 拿得到（package_info），但**簽章指紋只有原生這邊問得到**。
 *
 * 為什麼在執行期讀而不是寫死一個常數：debug 與 release 是不同的簽章，
 * 上架 Play 之後又會被 Play 用它自己的憑證重簽。寫死的話，換一種建置方式
 * 就會壞掉，而且壞的形式是「地點搜尋沒反應」，看不出跟簽章有關。
 * 這裡讀的是**正在跑的這個 APK** 的簽章，三種情況都對。
 */
class MainActivity : FlutterActivity() {
    private val channelName = "splitflow/app_identity"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                if (call.method == "get") {
                    result.success(
                        mapOf(
                            "package" to packageName,
                            "sha1" to signingCertificateSha1()
                        )
                    )
                } else {
                    result.notImplemented()
                }
            }
    }

    /**
     * 簽章憑證的 SHA-1，**大寫、不含冒號** —— Google 的 header 要這個格式。
     *
     * 讀不到就回 null，Dart 那邊會退回「不送這兩個 header」。那時候搜尋還是
     * 會被擋，但至少不是崩潰，而且錯誤訊息看得出是同一件事。
     */
    private fun signingCertificateSha1(): String? {
        return try {
            val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val info = packageManager.getPackageInfo(
                    packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES
                )
                // 有輪替過簽章的話用目前這一把。
                info.signingInfo?.let {
                    if (it.hasMultipleSigners()) it.apkContentsSigners
                    else it.signingCertificateHistory
                }
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(
                    packageName,
                    PackageManager.GET_SIGNATURES
                ).signatures
            }

            val first = signatures?.firstOrNull() ?: return null
            MessageDigest.getInstance("SHA-1")
                .digest(first.toByteArray())
                .joinToString("") { "%02X".format(it) }
        } catch (err: Exception) {
            null
        }
    }
}
