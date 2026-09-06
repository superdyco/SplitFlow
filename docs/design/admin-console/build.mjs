import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const css = readFileSync("_shell.css", "utf8");
const nav = readFileSync("_nav.html", "utf8");
const active = {
  Main: "總覽", Users: "使用者", Tasks: "任務",
  Reports: "公開報告", Health: "系統健康", Audit: "稽核日誌", Guard: null
};

for (const f of readdirSync("parts").filter(n => n.endsWith(".body.html"))) {
  const name = f.replace(".body.html", "");
  const body = readFileSync(`parts/${f}`, "utf8");
  const on = active[name];
  const sidebar = on
    ? nav.replace(`class="nav-item" data-nav="${on}"`, `class="nav-item active" data-nav="${on}"`)
    : "";
  writeFileSync(`${name}.dc.html`,
`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
${css}  </style>
</helmet>
${sidebar ? `<div class="app">\n${sidebar}\n${body}</div>` : body}
</x-dc>
</body>
</html>
`);
  console.log("wrote", name + ".dc.html");
}
