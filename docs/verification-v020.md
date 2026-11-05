# v0.2.0 交付验证 · 2026-11-04

## 交付物
- Windows x64 个人原型 ZIP：ChiikawaQuotaPet-0.2.0-Windows-x64-Personal.zip。
- 文件大小：160,980,152 字节。必须解压整个目录，不是单独 exe。
- SHA256：A3D281CE4CE521E8D10E63466013DCE7CF2315F0C8B95DE9147E4C9E2B17611F。
- 同目录 .sha256.txt 可独立校验；旧 v0.1 ZIP 保留，未提交 git。

## 已实际执行
1. npm test：76 / 76 通过。包括个人额度解析、输入与来源校验、未知余额缓存、负坐标 / 屏幕边缘无重叠、系统加密 Key 及清理、报告提取后跳转丢弃、延迟启动与关闭失败、SSO 多标签匹配和真实内容诊断。
2. npm run test:desktop：源码桌面界面回归通过。角色默认单独显示、8 张官方来源图、小中大、独立悬浮卡、手动金额、置顶、settings-only Key IPC、模拟 DeepSeek 请求、缓存 / 401、远程页面无 preload、空白外壳提示、报告身份与清除均通过。
3. npm run build：生成完整 Electron 45.2.2 / Windows x64 目录。
4. npm run test:desktop -- --packaged：发行程序通过同类桌面回归，随后重启验证角色 / 大小 / 显示方式 / 手动来源和额度保留。测试按窗口 URL 识别角色窗口，不依赖两个窗口的加载先后。
5. npm run test:browser：实际启动本机 Edge，chromiumSandbox=true、ignoreHTTPSErrors=false，专用测试 profile。通过 route 提供虚构页面，空白 skeleton、iframe-only、个人额度提取、SSO popup、重复报告拒绝均通过。
6. npm run test:browser -- --actual-report：只通过环境变量使用用户报告入口，新专用 Edge profile 实际显示原站账号密码表单。公开页面事实为 account.lixiang.com、可见文字长度 107、可操作控件存在；未填写密码、未读取现有浏览器 profile。
7. npm run test:browser -- --actual-report --packaged：发行程序使用其打包的 playwright-core，实际启动独立 Edge 并显示可操作原站登录页。没有输入凭据。
8. ASAR 核查：playwright-core 运行目录存在（135 项）；无 user-data、.local-data、state.json、dedicated-browser、deepseek-key 文件；用户的 report / share ID 以及虚构测试 Key 字节不在 ASAR。
9. npm audit --omit=dev：当日运行依赖 0 已知公告漏洞。开发依赖审计仍报告 15 moderate；未执行破坏性 audit fix --force。此检查不是安全认证。
10. npm run package:share：完整目录复制并压缩成功，包含快速说明、Electron 运行时许可证、playwright-core LICENSE / NOTICE、角色来源与权利说明。ZIP 条目检查存在入口 exe，排除个人会话 / 状态 / Key 目录，生成上述 SHA256。

## 仍须本人验证
- 真实企业账号、密码、MFA、登录后的个人报告读取与账号授权。不能把“看到登录表单”或模拟报告通过写成已获得真实额度。
- 真实 DeepSeek Key 对应的余额。自动测试使用固定虚构响应和测试 Key，不携带凭据请求外网，不发送推理请求。
- 另一台电脑、企业终端策略、VPN / 代理、多屏实际 DPI 等。本次在本机中文路径的 Windows x64 实测，不声称任何系统都可用。
- 素材改编 / 公开再分发授权。官网可下载和个人原型用途不是许可证明，权利说明已随包保留。

## 预览与隐私
artifacts/chiikawa-preview.png 为实际桌面截图组合，展示不重叠的悬浮卡和默认角色。金额是明确标记的示例，非实时账户数值。8 角色设置与独立窗口截图亦位于 artifacts，整个 artifacts 不打包。
测试数据、未登录诊断截图、独立浏览器 profile 均在忽略的 artifacts 下，与发布目录隔离。不要将运行后生成的 user-data 加入分享包；跨电脑请重新提供自己的报告与凭据。
