/// 邀請連結。`src/utils/firestore.ts` 的 `buildInviteUrl` 的 Dart 版。
library;

/// 網頁版的網址。原生版**沒有**自己的加入頁，邀請連結一律指向這裡。
///
/// 不是偷懶：收到連結的人多半還沒裝 App，而網頁版的加入頁不需要先安裝
/// 任何東西 —— 打開就看得到旅程名稱、按登入就進得去。要是連結指向
/// 一個要先下載 App 才打得開的東西，那條連結就沒有價值了。
///
/// 網頁版是用 `window.location.origin` 組的，原生版沒有那個東西，
/// 所以這裡寫死。換網域的話這一行要改。
const String webOrigin = 'https://splitflow-e39c0.web.app';

String inviteUrl(String inviteCode) => '$webOrigin/join/$inviteCode';
