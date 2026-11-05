# FinOps 浏览器接入历史 · v0.2.0 · 已由 v0.3.0 EPT 替代

> **历史文档，浏览器方案已停用。**v0.3.0 已舍弃全部 FinOps 浏览器读取、专用 Edge / Chrome 登录、Electron 内嵌登录及普通浏览器打开入口。当前默认来源是本机 EPT CLI，使用说明见 [EPT 接入](ept-integration.md) 和 [README](../README.md)。不要按旧文档配置报告链接、打开登录窗口或执行浏览器诊断来接入当前版本。

## 保留本文件的原因

本文件只保留 v0.2 调查与认证边界，便于说明旧方案为何不能作为当前接入及验证依据。旧 `spec-chiikawa-v020.md`、`verification-v020.md` 等文档也仅为历史记录；其中浏览器入口、示例默认金额、命令与测试结论不适用于 v0.3。

## v0.2 历史观察（2026-11-04）

- 早期公开页面入口返回 HTTP 200，但正文只是 SPA 外壳，没有个人额度数字；200 不代表已获得数据权限。
- 公开前端资源引用企业微前端及 SSO 初始化逻辑，未据此确认任何免登录个人额度 API。公开静态代码不等于个人凭据或接口授权。
- 早期未认证观察曾见认证初始化 / SSO pending 和空白页面；这只是当时的阻塞状态，不是所有企业环境白屏原因的证明。
- 随后用真实报告入口与新的专用 Edge profile，曾显示可操作原站登录页；没有输入账号密码。它只说明当时能显示登录页，不代表认证成功、MFA 完成、报告授权或登录后真实个人额度已核验。
- 旧浏览器方案曾使用桌宠独立 profile / 内嵌 Session，而非复用系统浏览器原有 profile。它仍可能持久化 Cookie 与原站本地存储，不能视为无痕或全目录加密。

本文不保留个人报告链接、凭据或个人实时金额，也不提供已停用方案的操作步骤。历史截图金额只曾作为非实时示例，不能移入 v0.3 默认值。

## 当前替代方案与迁移

v0.3 默认调用独立的本机 `ept.exe`，优先 `ept usage --summary-only --json`；仅旧 CLI 明确报 `unknown flag` 时回退 `ept usage` 文本。解析含 LiWork 等使用的个人总汇总，不把 Coding 分项当作总消耗。EPT 由本人事先安装、登录，桌宠不读取或复制其 token / config，也不提供 EPT 登录 / 登出。

旧 `finops` 来源迁移 `ept`，不再保存旧 `reportUrl` / `loginMode`，保留角色、尺寸等外观设置。**旧 `user-data/` 中的 dedicated-browser profile 与内嵌会话不会读取，也不会自动删除。**历史文件仍可能含 Cookie、令牌、报告链接或旧配置；如需清理，先完全退出桌宠，再由本人确认目录并手动删除。开发版同样检查 `.local-data/`；不要误删 EPT 自己的数据。

不存在当前浏览器登录后“再点读取”的步骤。EPT 不可用时显示错误、保留缓存并标非实时；无缓存时显示未知值 `—`。可切换手动来源离线记录，不通过浏览器读取或绕过认证补救。

## DeepSeek 独立余额边界仍保留

DeepSeek 使用本人主动提供的 API Key，查询官方账户赠送 / 充值余额，不是企业个人预算，不与 EPT 金额混算，不伪造总限额、累计已用或周期百分比。它不使用 EPT 凭据、企业 SSO 或浏览器 Cookie，也不发模型推理请求。

Key 持久化仍使用 Electron `safeStorage` 本机系统加密；系统加密不可用时可选择仅本次使用。清除本地 Key 不等于撤销平台 Key，也不改变 EPT 登录状态。当前操作见 README，官方余额契约与字段语义见 `research-balance-providers.md`。

## 历史验证与当前交付边界

`verification-v020.md` 保存旧版本测试与交付记录。浏览器虚构报告测试、可操作登录页及旧 packaged smoke 都不是 v0.3 EPT 接入验收，也不能证明读取过真实登录后的个人额度。

v0.3 的测试、构建、生产依赖核验与 ZIP 校验具体结果待主任务更新，本文不宣称已通过。当前目标包名是 `ChiikawaQuotaPet-0.3.0-Windows-x64-Personal.zip`，仅支持 Windows x64 完整目录，不附 EPT 二进制或凭据。另一台机须自己安装、登录 EPT 且 `ept usage` 正常；无 EPT 仍可用手动来源离线记录。

八张动画官网角色 PNG 的来源与授权边界未改变。粉丝 Wiki 非官方，personal prototype 与 `Personal` 包名不是版权许可，干净 ZIP 不等于素材获准再分发；公开发布或转发含图版本前须处理素材权利，详见 `THIRD-PARTY-NOTICES.md` 与 `research-characters.md`。
