# v0.3.0 交付验证 · 2026-11-04

## 已通过

| 检查 | 结果 |
| --- | --- |
| `npm test` | 109/109：JSON / 文本解析、精度、个人与部门分隔、超时 / 输出限制、来源迁移与取消等 |
| `npm run test:desktop` | 源码桌面回归通过，八角色 / 三尺寸 / 独立悬浮卡 / 手动 / DeepSeek 保留，EPT 模拟流程通过，重启持久化通过 |
| `npm run test:ept` | 实际执行本机 EPT：启动查询、额度数值、悬浮卡显示及手动刷新通过 |
| `npm run build` | Windows x64 v0.3.0 发行目录构建完成 |
| `npm run test:desktop -- --packaged` | 最终打包程序桌面回归与重启持久化通过 |
| `npm run test:ept -- --packaged` | 最终打包程序实际调用本机 EPT，启动查询、额度显示及手动刷新通过 |
| 最终 `app.asar` 审查 | v0.3.0，218334 bytes，27 entries；无 FinOps provider、Playwright 运行依赖、EPT 可执行文件、用户状态、浏览器 profile 或已知测试秘密标记 |
| `npm audit --omit=dev` | 生产依赖 0 漏洞；不代表开发依赖或 Electron 的独立安全评估 |

## 分享包

- 文件：`release/ChiikawaQuotaPet-0.3.0-Windows-x64-Personal.zip`。
- 大小：158122450 bytes（约 150.80 MiB），共 76 个 ZIP entries。
- SHA256：`4E75F32D9740E8F2829E179DC05043C1A15B512AAD4F9283FE27F7E6EA47B5AF`；同目录附同名 `.sha256.txt`。
- `npm run package:share` 与独立 `npm run package:share -- -VerifyOnly` 均通过：未发现用户数据目录、Cookie、Key 文件、旧浏览器 profile、EPT 安装或凭据。
- 已分别比较测试发行目录、分享暂存目录及直接从 ZIP 读取的 `app.asar`，三者 SHA256 均为 `C0397FB842593EFFADC25340447E9348FA5BA279197E9925BAE5B60923CD10FB`。
- v0.1 与 v0.2 ZIP 保留，未覆盖旧发行文件。本交付记录位于源码文档，分享包附简明说明、EPT 接入和素材说明。

## 口径与限制

- 默认来源为 EPT，优先 `ept usage --summary-only --json`，只在旧 CLI 明确不支持参数时回退固定 `ept usage`；已移除浏览器登录与读取。
- JSON `actual_cost` 是个人总消耗；用户提供的历史文本样例为 175.79 / 600 元，剩余 424.21 元、已用 29.30%，包含沙箱费用。此样例不是当前实时余额，不写入发行默认值。
- 真实 EPT 测试仅记录通过 / 失败，不把个人金额、用户身份或原始输出写入本文、日志或分享包。服务端输出没有统计时间，界面显示的是本地查询时间。
- 没有成功查询时显示未知；失败或重启缓存标非实时。周期刷新不代表持续实时同步。
- 接收者须安装并登录自己的 EPT，满足企业网络 / 权限要求；ZIP 不携带 EPT 程序或凭据。未在其他电脑或其他操作系统完成实机验证。
- DeepSeek 仅完成模拟 API / Key 隔离测试，未使用真实充值账户验余额。Windows 发行程序未签名，不应关闭安全软件。
- 八张官方角色图片的个人测试用途不等于素材再分发许可；见 `THIRD-PARTY-NOTICES.md`。

## 预览

`artifacts/chiikawa-ept-preview.png` 是本地实际界面截图合成，使用上述历史样例、并非实时查询画面；预览文件不进入分享包。
