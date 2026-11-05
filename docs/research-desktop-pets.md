# Windows 桌宠与 AI 额度托盘：窄范围研究

**研究日期：2026-11-04（Asia/Shanghai）**。仅采用项目作者的 GitHub 仓库、源码，以及 Electron / electron-builder / Live2D 官方文档；先调用 `web.run`，再用 `ept websearch` 定位、`ept webfetch` 核对。未访问用户私有站点、读取本机凭据或运行发布程序。下文区分源码证据与设计建议；`main` 链接会随上游变动。

## 结论

**建议轻量 Electron + TypeScript 自建桌宠壳，不整包 fork AIRI**：借 [desk-pet][pet] 的静态图片状态机、[claude-usage-tray-tool][claude-tray] 的 main / preload / renderer 分层、[ai-code-usage-tray][usage-tray] 的本地优先与过期数据处理。首版用自制 SVG / PNG + CSS 动画，额度采集做可替换 provider；角色不必调用 LLM。这是设计取舍，非性能实测。

## 5 个有效仓库对比

| 仓库 / 定位 | 可迁移设计 | Windows 便携性证据与限制 | 认证 / 会话方式 |
| --- | --- | --- | --- |
| [aslt918/desktop-pet][pet]：轻量 Electron 桌宠 | 导入 `idle / happy / sleep` 三张图；置顶、拖动、托盘显隐；静态图呼吸 / 浮动。适合额度→表情映射。 | README 需 Node / npm 启动；[package.json][pet-package] 只有启动 / 测试，仓库页面无发布包。**不是现成 portable 成品**；配置与复制的图片在 `%APPDATA%\desk-pet`。 | 无账户、云同步或遥测；本地形象配置。 |
| [moeru-ai/airi][airi]：完整 AI 角色平台，Stage Tamagotchi 为 Electron | 共享角色层 `packages/stage-ui` 与桌面壳分离；Live2D / VRM、眨眼 / 视线 / 语音模块可借鉴，不宜为额度表移植全栈。 | README 提供 Windows setup.exe；[构建配置][airi-build] 核到 NSIS，**未核到 portable 发布声明**。[桌面说明][airi-desktop] 将下载模型放 userData，不能等同离线单文件。 | 模型 / 语音 provider 配置，不是额度认证模板。[配置源码][airi-provider] 用 localStorage，且应用账户登录后有配置云副本同步；未核实密钥端到端加密，不能宣称“只本地、密钥加密”。 |
| [saime428/ai-code-usage-tray][usage-tray]：Electron 多工具额度 / 用量托盘 | 会话文件增量读取；文件监听驱动工作状态，统计刷新独立；悬浮条 / 托盘 / 详情共用数据，保留旧快照并标过期。 | [package.json][usage-package] 明确 `nsis` + `portable`、Windows x64。README 说明 portable 每次解压新临时目录，启动较慢、托盘身份可能变化；配置 / 凭据仍在 AppData。 | 默认读 Claude / Codex 本机文件，不读浏览器 cookie。可选 Claude OAuth，[源码有 PKCE][usage-oauth]；[隐私说明][usage-privacy] 明示自有凭据用 `safeStorage` 加密，断开时删除。 |
| [paulkoepke/claude-usage-tray-tool][claude-tray]：Electron 单服务额度托盘 | TypeScript + electron-vite；主进程绘制动态托盘、轮询；contextBridge / IPC 给本地 UI 结果，点击开无边框详情。适合首版骨架。 | README 与 [构建配置][claude-build] 均有 Windows portable.exe / NSIS；portable 只提示更新、不自动安装更新。作者披露未付费代码签名及 SmartScreen 提醒。 | 复用本机 Claude Code OAuth token，无单独登录；Windows 来源为 `.claude/.credentials.json`。作者明确额度端点未公开，可能变化或产生服务条款风险。 |
| [SillyToolValley/ai-usage-widget][quota-deck]（QuotaDeck）：.NET 8 WPF，非 Electron | 已用 / 剩余切换、阈值颜色、双托盘仪表、角色主题与额度布局分离；全屏隐藏任务栏仪表。**借 UX，不搬 WPF UI。** | README 给 self-contained 单文件发布命令，可免 .NET Runtime；这是**源码构建路径**，非本次验证的发布包。配置在 `%APPDATA%\QuotaDeck`，仍依赖已登录 CLI。 | 复用 Claude / Codex CLI OAuth；Codex 网络失败回退本机会话快照。[Claude][quota-claude] / [Codex][quota-codex] 源码刷新并回写 CLI 凭据，不能当纯只读采集器；README 明示内部 API。 |

## 许可与素材警戒

- 五个项目代码均有 MIT 文本：[desk-pet][pet-license]、[AIRI][airi-license]、[ai-code-usage-tray][usage-license]、[Claude tray][claude-license]、[QuotaDeck][quota-license]。复制代码须保留相应版权 / 许可声明；根 LICENSE 不足以推定第三方图片、字体、音频与依赖均可再分发。
- **QuotaDeck 是明确反例**：LICENSE 排除角色图片，README 列出初音、赛马娘、紫罗兰、间谍过家家、银魂等权利人条款 / 非商业同人说明。这是作者披露，**不是本次独立确认的权利人再分发授权**；不要直接打包角色图或主题预览。[许可][quota-license] / [作者说明][quota-deck]
- AIRI 的 MIT 不替第三方模型及 Cubism SDK 授权。[Live2D 官方发布许可][live2d-license] 区分企业规模，并有 Expandable Application 例外；支持用户导入模型时不能笼统声称“小项目免许可”。首版优先自制 / 明确获授权的静态形象，后续逐项列素材来源与授权。

## 认证与额度语义：可借模式，不照搬协议

1. **本地只读优先**：借 [ai-code-usage-tray][usage-tray] 的快照模式，不复制 token，不为测额度发送推理请求。携带账户、来源、采样时间与 `stale`；本机日志不等于其他设备 / 网页的实时账户额度。API 等价成本也不等于订阅账单，计划额度与模型额度桶不能混用。
2. **独立授权优于共享刷新**：参考 [PKCE][usage-oauth] 与 [自有加密存储][usage-privacy]，但不要照搬 CLI client ID / 权限。QuotaDeck 的原子回写不证明与 CLI 同时刷新不会发生令牌轮换竞争；这是由 [Claude][quota-claude] / [Codex][quota-codex] 写入行为推导的风险。首版默认只读，需要续期让原工具重新登录。
3. **网页登录仅是后续选项，未验证私有站点**：专用登录窗口按 provider / 账户使用 `persist:<id>` Session，后续请求复用该 Session；无 `persist:` 为内存会话。远程页不共享桌宠特权 preload，限制导航、弹窗与权限，不抓系统浏览器 cookie。[Session][electron-session] / [安全指南][electron-security]
4. **加密不等于跨机便携**：Windows `safeStorage` 基于 DPAPI，官方明确不隔离同用户空间其他应用。跨机默认重新认证，token / cookie 不进入 renderer、日志或诊断导出。[safeStorage][electron-storage] 内部额度 API 要能失效：失败保留旧值并标过期，429 持久化退避，认证失效停止重试、提示登录。[上游实践][usage-tray] / [内部 API 声明][quota-deck]

## 可落地的 Electron 首版（设计建议，非已实现）

- **结构**：main 管 Tray、窗口、provider 调度和存储；窄 preload 只暴露刷新 / 显隐 / 形象设置及脱敏快照；本地 renderer 显示桌宠与额度卡。启用 `contextIsolation: true`、`nodeIntegration: false`、sandbox、CSP，验证 IPC 发起者 / 参数；远程登录另设安全边界。[分层参考][claude-tray] / [安全指南][electron-security]
- **状态**：标准化 `usedPercent / remainingPercent / resetAt / fetchedAt / source / status`。健康 / 警告 / 耗尽与未登录 / 过期分开，未知不能显示成 0% 或 100%，估计重置时间标 `≈`；表情不替代错误文字。静态三状态 + 可暂停 CSS 动画，悬浮详情按需展开，全屏自动隐藏。[桌宠][pet] / [数据语义与悬浮条][usage-tray] / [仪表 UX][quota-deck]
- **发布**：先 Windows x64 portable.exe；更重视启动速度 / 稳定托盘路径时可选完整运行目录 ZIP，安装器后置。`portable` target **不自动让配置随目录走**。[官方 portable 说明][builder-portable] / [临时解压代价][usage-tray]
- **数据模式**：默认 AppData；用户选便携模式时，在创建 Session / 窗口前将 `userData`、`sessionData` 指向原 EXE 目录下的 `data`，以 `PORTABLE_EXECUTABLE_DIR` 定位，不能用临时解压目录。先验证可写，失败明确提示；配置可搬，登录秘密不承诺可搬。[环境变量][builder-portable] / [路径与初始化时机][electron-app]
- **后续验收**：干净 Windows 10/11、无 Node / .NET、普通用户、中文路径、多屏 DPI；测试只读目录、账户切换、跨机重新登录、过期数据、重启退避。自启由用户主动开启且指向原 EXE；发布提供校验值并考虑代码签名，不能把安全软件告警直接判成误报。[发布提醒][usage-tray]

**验证边界**：未做发行包安装、二进制安全审计或 CPU / 内存实测；“portable”仅核到作者文档 / 构建配置，不代表已满足无痕、离线或可迁移登录要求。

[pet]: https://github.com/aslt918/desktop-pet
[pet-package]: https://raw.githubusercontent.com/aslt918/desktop-pet/main/package.json
[pet-license]: https://raw.githubusercontent.com/aslt918/desktop-pet/main/LICENSE
[airi]: https://github.com/moeru-ai/airi
[airi-build]: https://raw.githubusercontent.com/moeru-ai/airi/main/apps/stage-tamagotchi/electron-builder.config.ts
[airi-desktop]: https://github.com/moeru-ai/airi/tree/main/apps/stage-tamagotchi
[airi-provider]: https://raw.githubusercontent.com/moeru-ai/airi/main/packages/stage-ui/src/stores/providers/config.ts
[airi-license]: https://raw.githubusercontent.com/moeru-ai/airi/main/LICENSE
[usage-tray]: https://github.com/saime428/ai-code-usage-tray
[usage-package]: https://raw.githubusercontent.com/saime428/ai-code-usage-tray/main/package.json
[usage-oauth]: https://raw.githubusercontent.com/saime428/ai-code-usage-tray/main/lib/claude-oauth.js
[usage-privacy]: https://raw.githubusercontent.com/saime428/ai-code-usage-tray/main/PRIVACY.md
[usage-license]: https://raw.githubusercontent.com/saime428/ai-code-usage-tray/main/LICENSE
[claude-tray]: https://github.com/paulkoepke/claude-usage-tray-tool
[claude-build]: https://raw.githubusercontent.com/paulkoepke/claude-usage-tray-tool/main/electron-builder.yml
[claude-license]: https://raw.githubusercontent.com/paulkoepke/claude-usage-tray-tool/main/LICENSE
[quota-deck]: https://github.com/SillyToolValley/ai-usage-widget
[quota-claude]: https://raw.githubusercontent.com/SillyToolValley/ai-usage-widget/main/QuotaDeck/ClaudeProvider.cs
[quota-codex]: https://raw.githubusercontent.com/SillyToolValley/ai-usage-widget/main/QuotaDeck/CodexProvider.cs
[quota-license]: https://raw.githubusercontent.com/SillyToolValley/ai-usage-widget/main/LICENSE
[live2d-license]: https://www.live2d.com/en/sdk/license/
[electron-session]: https://www.electronjs.org/docs/latest/api/session
[electron-storage]: https://www.electronjs.org/docs/latest/api/safe-storage
[electron-security]: https://www.electronjs.org/docs/latest/tutorial/security
[electron-app]: https://www.electronjs.org/docs/latest/api/app
[builder-portable]: https://www.electron.build/nsis.html
