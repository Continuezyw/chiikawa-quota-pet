# v0.4.0 交付验证 · 2026-11-04

## 验证结果

| 项目 | 结果 |
|---|---|
| `npm test` | 191/191 通过：6 外观、8 陪伴/迁移/Key、49 第三方接口、36 DeepSeek、6 EPT边界、50 EPT、36 自启动模拟 |
| `npm run test:desktop` | 源码完整GUI与重启持久化通过 |
| `npm run test:ept` | 本机真实EPT启动查询、金额显示与手动刷新通过 |
| `npm run build` | 最终Windows x64 v0.4发行目录完成，包含核对后的New API精确路径提示 |
| `npm run test:desktop -- --packaged` | 最终打包版GUI与重启持久化通过 |
| `npm run test:ept -- --packaged` | 最终打包程序实际调用本机EPT并展示/刷新成功，不只模拟 |
| 最终ASAR | v0.4.0，255234 bytes，29 entries；无离线解析模块/IPC、FinOps采集、Playwright运行依赖、Key文件、用户数据及已知个人测试标记 |
| `npm audit --omit=dev` | 生产依赖0漏洞，不代表Electron独立安全评估 |

GUI覆盖：8角色/3尺寸、独立非重叠额度卡与4秒气泡、关闭气泡/双击/打开设置取消待执行气泡；离线UI和IPC删除；EPT路径与第三方设置草稿保留；DeepSeek余额；第三方余额与总额度模式、币种；独立加密Key、仅本次使用、留空Key取消记住、换目标清Key、加密准备失败保留旧配置/Key/缓存；EPT/DeepSeek/第三方在途取消、缓存与重启。

## 自启动边界

- 默认关闭，用户主动操作才修改Windows登录项。发行版按当前exe路径、固定空参数、Electron默认AppUserModelID命名写入并回读，避免自定义注册名称与openAtLogin查询不一致。
- 36项测试全为mock；隔离GUI明确禁止系统登录项读写。未真实开启用户自启动、未修改其任务管理器条目、未物理重启电脑。实际系统策略仍需本人操作开关确认。
- 移动目录后需关闭再开启；不注册EPT、API Key或用户数据参数，不在开发版自动开启。

## 第三方与台词边界

- 第三方入口为已确认HTTPS GET JSON字段适配器，不保证任意平台都有余额接口、不保证名称或聊天协议兼容即余额兼容。不支持POST/签名/Cookie/额外用户身份头等契约。
- 通用、DeepSeek兼容及New API令牌字段模板已用模拟响应验证；未使用真实第三方充值账号。New API参考官方公开代码字段，令牌额度不是账户余额，单位/除数与末尾斜杠由用户按实际部署核对。
- 文字气泡为本地编写的角色风格台词，不是官方台词或大模型输出，无推理消费。不覆盖形象；空间不足可能暂收额度卡或不弹气泡。
- 本文、默认配置及分享包不保存个人实时金额、账号、EPT输出或Key。示例预览的USD 37.80为模拟值，不是任何人的实时余额。

## 分享包

- 文件：`release/ChiikawaQuotaPet-0.4.0-Windows-x64-Personal.zip`，158137049 bytes（150.81 MiB），77 entries。
- SHA256：`732C56AE9BF6CDD6DC432A8258B9C6C3B4315F33F45D4CA7F993C75B8FCEDB74`；附同名`.sha256.txt`。
- 生成及`npm run package:share -- -VerifyOnly`独立复核通过，无用户数据/浏览器资料、两类Key文件或EPT安装。
- 测试目录、暂存目录与直接读取的ZIP内`app.asar`均为`2B670B122382FF1073A928F2E85713257D63D0D378A3A0537BA4F9CF534CAAE2`，与最终实测程序一致。
- v0.1–v0.3分享包保留，未覆盖旧版；v0.4包附使用说明、EPT/第三方接入及素材说明。

## 审查与限制

自启动命名回读、Key记住状态、加密失败预校验、配置原子更新、设置草稿与延迟气泡取消等本次审查发现已修复并回归。未创建git提交、分支或推送。

Windows发行版未签名；未对其他电脑、macOS/Linux/ARM进行实机验收。另一台电脑需自己的EPT安装登录或自己的平台Key。程序目录可移植不等于账号凭据可移植。

八张官方角色PNG仍为个人原型素材，不代表再分发授权，见`THIRD-PARTY-NOTICES.md`。分享包无敏感数据不等于素材已获许可。
