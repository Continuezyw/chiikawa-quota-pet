# 第三方与角色说明 · v0.4.0 个人原型

## 运行时与依赖

应用包含 Electron 及其 Chromium / Node.js 运行时。Electron 与运行时第三方许可应保留在发布目录的 `LICENSE.electron.txt` 与 `LICENSES.chromium.html`。实际依赖版本与许可以 `package-lock.json`、依赖自身许可文件及实际发布目录为准，打包时保留适用的第三方许可。

electron-builder 与 Playwright 为开发 / 验证工具。**v0.4.0 生产运行不使用 `playwright-core`，不启动 Edge / Chrome，也不再提供 FinOps 专用浏览器或 Electron 内嵌报告采集。**Playwright 仅用于开发测试；Electron 自带 Chromium 用于本地桌宠界面，不代表仍在读取浏览器 FinOps 页面。旧 v0.2 关于 `playwright-core` 生产依赖与浏览器安装的说明仅适用于已停用的历史方案。

EPT 是接收者自行安装、由本人使用现有凭据登录的独立本机 CLI。`ChiikawaQuotaPet-0.4.0-Windows-x64-Personal.zip` **不附带 EPT 二进制、token、config 或其他登录凭据**，也不授予 EPT 本身的使用或再分发权利。桌宠只调用本机 `ept.exe` 查询个人汇总，不读取或复制 EPT 凭据，不替用户登录或登出。另一台电脑必须自行满足 EPT 安装、本人登录及 `ept usage` 正常的前提；无 EPT 时可使用本人 DeepSeek 或第三方在线接口；手动/离线来源已删除。

本说明记录 v0.4 的依赖与分发边界；具体测试、发行目录依赖核验和 ZIP 校验结果见项目 docs/verification-v040.md，不把软件验证等同素材授权。

未整包复制参照桌宠 / 额度 GitHub 项目源码；参照项目仅用于架构和交互研究，见 `research-desktop-pets.md`。这不改变实际所用运行时依赖及角色素材各自的许可边界。

## 八张官方来源角色 PNG

v0.4 保留 `assets/characters/` 下的八张透明 PNG，以及三档尺寸和悬停额度卡交互：

- `chiikawa.png`：吉伊 / Chiikawa
- `hachiware.png`：小八 / Hachiware
- `usagi.png`：乌萨奇 / Usagi
- `kurimanju.png`：栗子馒头 / Kurimanju
- `momonga.png`：飞鼠 / Momonga
- `rakko.png`：海獭 / Rakko
- `shisa.png`：狮萨 / Shisa
- `furuhonya.png`：古本屋 / Furuhonya

官方来源为《ちいかわ》动画官方网站角色页 `https://www.anime-chiikawa.jp/chara.html`，原始透明 PNG 图集为 `https://www.anime-chiikawa.jp/images/characters/img_charapage.png`。处理为按官网 CSS 区域裁切、去除透明留白及无损 PNG 压缩，保留原图透明度、颜色和宽高比，不是自行重新绘制。逐项来源、尺寸与版权标注保存在 `assets/characters/manifest.json`，核验记录见 `research-characters.md`。中文名称为本地界面显示名，不宣称为官方中文译名。

版权标注：©ナガノ/ちいかわ製作委員会。

用户提供的 Miraheze 粉丝 Wiki 非官方，仅作为需求参考，未下载其素材，未将其内容当作官方身份或授权依据。官方来源也不能等同于开放素材许可。

## 使用与分发边界

本项目是用户请求的本地 personal prototype，尚未取得角色权利人关于改编、公开再分发或商业使用的授权。公开可下载、个人原型用途和 `ChiikawaQuotaPet-0.4.0-Windows-x64-Personal.zip` 的 `Personal` 命名均不是授权证明，不构成“个人使用免版权”的声明。应用代码或第三方运行时许可不能替代角色素材授权。

公开发布或转发含这些 PNG 的版本前，应先处理相应权利人授权，或替换为有权使用的原创 / 获授权素材；不能把排除用户数据的 ZIP 自动视为获准分发的成品。用户导入的本地 PNG / GIF / WebP 也须自行确认有权使用。本说明不核准任何具体分发行为。

分享包不得包含 `user-data/`、`.local-data/`、旧浏览器 profile / 内嵌会话、个人报告链接、DeepSeek Key、第三方平台 Key 或 EPT 凭据。旧浏览器目录在升级后不会读取或自动删除，可能仍有敏感数据；本人应完全退出桌宠后再手动清理，不能把迁移视为隐私清理已经完成。不要把运行过的整个目录当成干净分享包。

发行范围仅为 Windows x64 完整目录；不能只拷贝 exe，也不承诺 macOS / Linux / Windows ARM 原生支持或凭据跨机可移植。
