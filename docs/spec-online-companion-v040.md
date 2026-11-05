---
title: 在线额度桌宠精简与陪伴增强
type: feature
created: 2026-11-04
status: done
baseline_commit: NO_VCS
review_loop_iteration: 1
---

<frozen-after-approval>
## Intent
**Problem:** 用户不需要手动与离线额度入口，希望桌宠可选择开机启动、点击有文字回应，且个人第三方平台也能查询。
**Approach:** v0.4删除手动入口与解析模块；保留EPT、DeepSeek，增加受限HTTPS GET JSON映射。开机启动默认关闭，角色回复使用本地台词与独立气泡窗口，不调用大模型。

## Boundaries & Constraints
**Always:** 保留8角色、3尺寸、拖动、独立悬浮卡。失败保留当前来源缓存并标非实时，首次未知不显示样例。第三方Key与DeepSeek完全隔离、本机加密或仅本次使用；更换接口/认证目标清除第三方Key与缓存。原手动缓存迁移到EPT未知，保留外观。自启动只由用户切换写系统配置。
**Ask First:** 不代用户创建第三方Key或平台账号；不在测试中真实启用开机启动，不安装新系统组件。
**Never:** 浏览器额度读取、密码/Token提取、凭据写JSON/日志/ZIP、推理调用、任意脚本映射、重定向携Key、伪造通用余额API或未验证单位换算。

## I/O & Edge-Case Matrix
| 情景 | 输入 | 结果 | 错误处理 |
|---|---|---|---|
| 删除离线功能 | 旧manual/import/sample缓存 | EPT未知，外观保留 | 原入口与IPC不存在 |
| 自启动 | 用户开/关 | 当前可执行文件注册/撤销，系统状态回读 | 开发/隔离测试不写真实注册表 |
| 点击 | 非拖动、非双击 | 本地角色台词出现约4秒 | 不遮挡形象或额度卡 |
| 第三方余额 | 自己确认的HTTPS GET地址、JSON路径、单位 | 显示映射余额与币种 | 不假定总额或百分比 |
| 第三方额度 | total/used两字段 | 显示剩余与比例 | 校验有限非负数，精度保留 |
| API失败 | 未授权、超时、无效JSON、重定向 | 净化错误与缓存 | 10秒超时、64KiB正文限制 |
| 换接口/来源 | 请求在途 | 取消旧查询、丢弃迟到结果 | Key不跨平台复用 |
</frozen-after-approval>

## Code Map
- src/main.cjs / src/preload.cjs -- 来源、Key隔离、自启动与气泡IPC。
- src/store.cjs / src/secrets.cjs -- 配置迁移、通用API配置与独立Key。
- src/startup.cjs -- 系统登录项设置与状态。
- src/providers/custom.cjs -- HTTPS接口验证、映射与限时限量请求。
- src/dialogue.cjs / src/appearance.cjs -- 本地台词与不重叠气泡几何。
- src/renderer/ -- 去离线界面，自启动、台词开关与第三方设置。
- tests/ / scripts/ -- 新回归与便携包验证。

## Tasks & Acceptance
- [x] 删除src/quota.cjs与旧离线测试、IPC、表单；迁移旧手动设置。
- [x] 实现自启动模块、设置开关与只读真实状态；隔离测试不改用户登录项。
- [x] 实现本地角色台词、点击气泡，兼容拖动、双击与显示边缘。
- [x] 实现第三方HTTPS GET、Bearer/自定义Key头/无认证、点路径、余额/总用量模式和显式单位。
- [x] 更新单测、源码/打包GUI、实际EPT回归与v0.4分享文档。

**Acceptance Criteria:**
- Given旧版离线配置，when升级，then原手动入口完全删除、EPT重新查询且外观保留。
- Given用户切换自启动，when操作成功，then系统登录项与开关一致；默认安装不启用。
- Given点击/拖动/双击角色，when交互结束，then仅单击显示台词，拖动不触发，双击打开设置。
- Given有效第三方接口配置，when查询，then只发送该平台独立Key到已确认HTTPS目标；平台无可用接口则明确提示不支持。

## Spec Change Log

2026-11-04 审查补丁：Electron自定义登录项名称与默认AppUserModelID回读不一致，改用默认命名，新增native契约mock；第三方留空Key仍落实persist开关，加密准备失败不提交新目标；保存其他来源不清除第三方草稿、外观变更不覆盖EPT草稿，打开设置取消待执行气泡。保持默认不自启动、独立Key、固定网络请求与无推理台词。191/191及源码/最终打包GUI和真实EPT回归通过。

## Design Notes
通用入口是接口适配器，不承诺任意平台无需API便可查询。提供通用JSON、DeepSeek兼容和New API令牌字段模板；New API默认保留平台原始credit单位，币种/比例换算由用户按平台文档核对，不把令牌额度当账户余额。已核对公开官方控制器与路由，不把One API名称或不同分支当兼容证明；精确路径及末尾斜杠由用户核对。
Windows开机启动基于Electron登录项接口，程序移动目录后需用户重新注册。气泡使用独立透明窗口，先尝试形象上方，再选择无碰撞侧边，无法放置则暂时收起额度卡，绝不压住形象。

## Verification
- npm test -- 来源、安全、状态、自启动模拟、气泡几何与接口错误。
- npm run test:desktop / npm run test:ept -- 源码GUI及真实EPT。
- npm run build；同上--packaged -- 最终发行程序。
- npm run package:share及-VerifyOnly -- v0.4 ZIP无用户数据、API Key或EPT安装。

最终ZIP与独立校验通过，ASAR与实测版一致；结果见 [v0.4交付记录](verification-v040.md)。自启动仅mock测试，第三方仅模拟API，真实EPT已实测。

## Suggested Review Order

**在线来源与Key隔离**

- 统一刷新、来源取消与净化错误。
  [main.cjs:205](../src/main.cjs#L205)

- 验证接口目标、字段与显式单位。
  [custom.cjs:88](../src/providers/custom.cjs#L88)

- 加密预校验与独立平台Key保存。
  [secrets.cjs:11](../src/secrets.cjs#L11)

**系统与陪伴**

- 默认登录项命名，禁止测试写真实系统。
  [startup.cjs:9](../src/startup.cjs#L9)

- 本地气泡展示、自动收起和取消。
  [main.cjs:116](../src/main.cjs#L116)

- 屏幕边缘同时避让角色与额度卡。
  [appearance.cjs:31](../src/appearance.cjs#L31)

**界面与迁移**

- 移除旧离线来源，保留外观。
  [store.cjs:19](../src/store.cjs#L19)

- 在线设置、草稿保护与显示口径。
  [renderer.js:58](../src/renderer/renderer.js#L58)

**测试与分享**

- 默认状态、迁移、Key与气泡回归。
  [companion.test.cjs:1](../tests/companion.test.cjs#L1)

- 源码/打包GUI及敏感数据隔离。
  [desktop-smoke.cjs:1](../scripts/desktop-smoke.cjs#L1)

- 生成无用户数据的ZIP并独立校验。
  [package.ps1:1](../scripts/package.ps1#L1)
