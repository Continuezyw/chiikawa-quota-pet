---
status: done
created: 2026-11-04
---
# Chiikawa 桌宠 v0.2.0

## 目标
修正 v0.1 原站登录白屏体验，用可选的 Chiikawa 官方来源角色构建只显示形象的桌宠；悬停额度在独立侧边卡中显示且不遮挡角色。Windows x64 免安装，支持小 / 中 / 大尺寸，保留个人数据不打包。

## 边界
- 企业原站额度、DeepSeek 官方充值余额、手动额度语义独立。DeepSeek 余额接口不能查询企业 600 元限额，也不返回已用百分比。
- 不能绕过 SSO、TLS、企业网络或读其他浏览器 cookies；优先提供专用 Edge / Chrome 登录配置，不复用默认个人 profile。内嵌模式失败必须给出可操作诊断而非静默白屏。
- DeepSeek Key 仅在设置输入；主进程使用 Windows safeStorage 保存，不出现在状态 JSON / 日志 / hover renderer / 分享包，清除可撤销本地存储。
- 官方网页公开图片只用于用户请求的本地原型，附来源和权利声明，不将粉丝 wiki 冒充官方，不宣称个人使用自动获得版权许可。
- 全部网络和凭据只由明确的登录、同步或来源设置操作触发；失败保留缓存并标非实时。

## 文件计划
- src/main.cjs：小型透明宠物窗口、独立额度悬停窗口、点击穿透、拖动和尺寸、来源调度。
- src/appearance.cjs、src/store.cjs：角色 / 尺寸校验、布局纯函数、旧状态迁移。
- src/providers/finops.cjs：专用系统浏览器授权登录，报告身份检查、同源与确定报告微前端 frame 读取。
- src/providers/deepseek.cjs、src/secrets.cjs：正式 API 余额与安全本地 Key。
- src/renderer/：角色选择与尺寸设置，hover-only / always 两种显示，诊断与独立来源 UI。
- assets/characters/：官方来源 PNG 与可复核 manifest。
- tests/、scripts/desktop-smoke.cjs：回归白屏诊断、无形象遮挡、尺寸、来源语义、权限与凭据边界。
- scripts/package.ps1、README.md：v0.2 干净分享包，保留旧包。

## 验收
Given 默认启动，when 未悬停，then 仅形象可见，没有永久额度卡或工具栏。
Given 任意尺寸和屏幕边缘，when 悬停，then 额度卡在形象之外且不越出当前工作区；移出延迟收起，可移到卡片操作。
Given 切换角色 / 尺寸，when 保存，then 立即更新并重启保留；图片失败有回退和错误提示。
Given 内嵌原站空白或脚本不可达，when 登录读取，then 状态给出原因 / 浏览器入口 / 企业网络提示，不将页面外壳视为成功。
Given DeepSeek 返回余额，when 展示，then 只展示币种和真实余额，绝不伪造用量百分比。
Given 不同额度源或更换链接 / Key，when 同步，then 旧任务不能覆盖新来源，成功前显示示例或缓存标签。
Given 分享包，when 核查，then 不含 user-data、browser profiles、api key、个人 report IDs。

## 验证边界
自动测试模拟认证后的报告；真实企业账号及 DeepSeek Key 不由代理代填。已通过发行程序的专用 Edge 打开真实入口并显示账号密码登录表单，但未认证或核验登录后的额度；企业网络权限不可在应用中凭空修复。

## 实现与验证结果
- 76 / 76 单元测试通过，源码及 Windows x64 发行程序桌面回归通过；重启保留角色 / 尺寸 / 显示方式 / 手动额度。
- 实际 Edge 沙盒浏览器集成测试覆盖空白 skeleton、iframe-only、SSO popup 和重复报告；发行程序真实未登录入口也通过可操作页面检查。
- 无重叠面板在四角与负坐标屏幕布局测试通过；工作区放不下时隐藏卡而不覆盖形象。
- provider 延迟启动 / 关闭失败 / 提取后导航、登录诊断旧结果、Key 临时文件清理、未知余额均已按审查发现修复。
- 分享 ZIP 已生成，含运行时及角色来源 / 权利声明；ASAR 和 ZIP 检查无个人状态 / 会话 / Key / 报告 ID。详见 verification-v020.md。

## Suggested Review Order
**桌面交互与数据边界**
- 独立窗口负责形象与悬浮卡，权限角色明确。
  [main.cjs:100](../src/main.cjs#L100)
- 工作区布局保证卡片不覆盖角色。
  [appearance.cjs:8](../src/appearance.cjs#L8)
- 来源切换与异步结果在主进程校验。
  [main.cjs:283](../src/main.cjs#L283)
**登录与余额**
- 专用浏览器独立 profile，检查真实可操作内容。
  [finops.cjs:71](../src/providers/finops.cjs#L71)
- 只读取一致报告与明确允许 frame。
  [finops.cjs:31](../src/providers/finops.cjs#L31)
- 固定官方余额请求，不构造消费百分比。
  [deepseek.cjs:124](../src/providers/deepseek.cjs#L124)
- 系统加密 Key 与状态 JSON 分离。
  [secrets.cjs:4](../src/secrets.cjs#L4)
**素材、回归与发布**
- 图片逐项记录官方来源及权利边界。
  [manifest.json:1](../assets/characters/manifest.json#L1)
- 实际桌面自动化验证显示、余额、权限与重启。
  [desktop-smoke.cjs:17](../scripts/desktop-smoke.cjs#L17)
- 分享目录排除个人数据，生成 ZIP 与 SHA256。
  [package.ps1:1](../scripts/package.ps1#L1)
