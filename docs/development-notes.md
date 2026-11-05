# 首版已验证的开发要点

日期：2026-11-04。本页记录项目实际验证结果，不替代上游规范。

- npm 11 脚本许可可能使依赖安装完成而 Electron exe 未下载。先确认 node_modules/electron/path.txt 和 dist/electron.exe，审核后单独运行官方 install.js，不全局开放任意依赖脚本。
- Windows PowerShell 经 .bat 转发多行补丁可能破坏引号。本次通过原生 apply_patch 执行入口传递完整单一补丁参数，不使用字符串拼接的文件删除命令。
- Windows PowerShell 5.1 会按系统代码页读取无 BOM 的脚本。打包脚本使用 ASCII 文件名和代码，中文说明内容另放 UTF-8 文本，避免中文路径字面量乱码。
- Playwright Electron 的默认 context 路由不自动覆盖自定义 persist:finops Session。测试通过该 Session 的 protocol.handle 模拟 HTTPS 页面，禁用真实出网；该 mock 只存在于烟雾测试，不进入发布应用。
- BrowserWindow.getBackgroundColor 在本机返回 RGB 而不是 RGBA；测试接受两种返回格式，窗口仍以 transparent: true 创建，视觉截图另外核对透明背景。
- 浏览器页面加载超时的 Promise.race 必须清除未触发的 timeout，否则测试关闭应用后 Node 仍等待计时器。
- Session 清除涉及异步等待，应串行化状态变更、按账号代际取消旧任务，重置期间拒绝同步；不能仅在任务开始时检查账号。
- 金额用整分计算并拒绝第三位小数；DOM 数字解析必须限制格式、单位、完整数值边界和唯一统计，否则文本看似一致仍可能误读 100 倍。
- 样例必须没有实时采样时间；缓存恢复不使用启动时间填充缺失时间。仅在完整恢复成功后采用旧状态。

这些行为都由本仓库测试或本次构建输出验证。没有提取私有站点的密码、浏览器 Cookie 或账户令牌。
