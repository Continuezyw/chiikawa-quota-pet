---
status: done
created: 2026-11-04
verification_scope: local-windows-and-mocked-report
---

# 本地可分享 AI 额度桌宠首版 · 2026-11-04

## 范围
Windows 10/11 x64 透明置顶桌宠、可解压运行程序、乌萨奇风格自绘占位皮肤、额度卡、互动、设置与同步。
截图 121.32 / 600.00、478.68 是示例，绝不冒充实时。无公开额度接口证据时，提供用户本人在原站登录的隔离会话页面读取及手动导入，不绕过认证。
不把报告地址、个人额度和登录会话打入分享包。不会读取其他浏览器 cookies，不记录密码。商业发布须替换或授权角色皮肤。

## 文件与任务
- src/main.cjs、src/preload.cjs：透明窗口、托盘、有限 IPC、原站隔离登录与同步。
- src/quota.cjs、src/store.cjs：纯函数校验、个人额度解析、原子存储。
- src/renderer/、assets/usagi.svg：交互桌宠、设置、来源标签、离线预览。
- tests/、scripts/desktop-smoke.cjs：数值、解析、安全边界与 Electron 烟雾验证。
- scripts/package.ps1、README.md：干净 Windows x64 分享包和使用说明。

## 验收
Given 干净目录，when 解压启动，then 无需 Node/Python 即可看到透明桌宠。
Given 只有登录页或模糊多组值，when 同步，then 不推测额度，保留旧值并标明失败。
Given 未登录用户，when 打开自己的报告，then 仅在原站完成认证；未实际认证的接入明确标记未验证。
Given 离线，when 手动输入或粘贴个人额度文本，then 仍可使用桌宠。
Given 总额零、超额、负数、NaN，when 校验，then 零不除零、超额明确展示、非法值拒绝。
Given 本机已有会话，when 打包，then zip 不含个人数据和登录状态。

## 验证
npm test；npm run test:desktop；npm run build；npm run package:share。真实账户登录、另一台电脑兼容性由用户确认，不宣称已经验证。

## 已完成与验证边界
- 数值 / 解析 / URL 边界 / 缓存回归 13 项通过。
- 源码和打包 exe 的桌面测试：置顶、互动、手动、导入、迷你、收起、失败保留旧值、远程权限隔离和错误报告拒绝。
- 模拟原站 Session 的读取适配器通过；并发设置更新、会话重置期间同步拒绝、旧同步不能覆盖新连接均有桌面回归。
- 自绘皮肤、截图示例标签、无伪造实时采样时间、独立登录窗口、干净分享打包已实现。
- 不将模拟报告测试当作真实企业账号验证；实际企业 SSO 跳转链及另一台电脑兼容性需本人确认。

## Suggested Review Order
- 先看入口，理解窗口与本地数据生命周期：
  [main.cjs:1](../src/main.cjs#L1)
- 账号边界与重置事务：
  [main.cjs:46](../src/main.cjs#L46)
- 同步任务按连接代际隔离：
  [main.cjs:194](../src/main.cjs#L194)
- 本地 IPC 发送者校验：
  [main.cjs:245](../src/main.cjs#L245)
- 金额与唯一个人额度解析：
  [quota.cjs:3](../src/quota.cjs#L3)
- 缓存恢复不伪造更新时刻：
  [store.cjs:11](../src/store.cjs#L11)
- UI 来源标签与表单状态：
  [renderer.js:25](../src/renderer/renderer.js#L25)
- 最后核对分发排除策略与烟雾验证：
  [package.ps1:1](../scripts/package.ps1#L1) · [desktop-smoke.cjs:1](../scripts/desktop-smoke.cjs#L1)
