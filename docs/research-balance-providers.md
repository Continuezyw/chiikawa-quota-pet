# DeepSeek 余额 provider：官方契约与两个桌面用量模式

**核对日期：2026-11-04（Asia/Shanghai）。** 先调用一次 `web.run`，该调用未返回可用结果；随后通过 `ept websearch` 定位、`ept webfetch` 读取官方文档与作者仓库。只读公开资料，未发送真实 API key、访问企业 SSO、安装上游桌面程序或读取浏览器 / CLI 凭据。下文的实现限制是本项目的选择，不是对上游服务能力的推测；GitHub `main` 文档与源码会变动。

## 1. 官方 API 的边界

官方余额文档指定 **HTTPS GET `https://api.deepseek.com/user/balance`**，示例使用 `Authorization: Bearer <API key>`。认证对象是用户主动提供的 DeepSeek 平台 API key；官方快速开始页指向平台的 API-key 创建页面。本 provider 不提供可配置主机、代理 API 地址、替代路径、推理请求或账户探测。[官方余额接口][balance]、[官方快速开始][start]

| 官方字段 | 含义 | 本地快照映射 |
| --- | --- | --- |
| `is_available`：boolean | 余额是否足够支持 API 调用 | `available` 原样保留，不由金额推断 |
| `balance_infos`：object[] | 各币种余额记录 | 先完整验证，再选 CNY；缺 CNY 时选 USD |
| `currency`：CNY / USD | 余额币种 | `currency`，不换汇、不跨币种求和 |
| `total_balance`：string | 当前可用的赠送余额与充值余额合计 | `remaining`，**不是配额上限** |
| `granted_balance`：string | 未过期的赠送余额 | `details.granted` |
| `topped_up_balance`：string | 当前充值余额 | `details.toppedUp`，不是历史累计充值 |

字段与金额含义来自官方 schema；币种优先级是此次用户要求，不是官方建议。[官方余额接口][balance]

该响应没有总预算、累计消耗、周期用量百分比或服务器采样时间。因此 `total / used / percentage` **始终为 `null`**：不能套用企业报告的 600 元总额度，不能用 `600 - balance` 算已用，不能把余额正数 / 零值转换成 0% / 100% 用量。`updatedAt` 为本地解析成功时间的 ISO 字符串，不声称是供应商结算时间。`available: false` 是一个有效余额快照，不等同于 401、网络失败或解析失败；即使金额非零也保留 false。[官方余额接口][balance]

官方错误说明将 401 归于认证失败、429 归于请求过快或并发 / QPS 限制；该页面未列 403 的余额接口专门语义。本项目对 403 只给出“余额访问被拒绝”，不猜测封禁、权限产品或账户身份。其他非 200 响应统一失败；不把 402 或错误响应伪造成一份零余额快照。[官方错误说明][errors]

### 不与企业 SSO 混用

DeepSeek API key 的认证来源与上述字段由官方接口定义；本仓库原有企业报告则经独立报告地址 / SSO 路径处理。**两者是不同 provider、不同授权对象、不同金额语义**。企业员工的 600 元预算不是 DeepSeek 钱包上限；企业登录 cookie / SSO token 也不能视为 DeepSeek API key。本模块没有企业认证入口，不能因为企业页面展示了 DeepSeek 模型就转用此余额接口。[官方余额接口][balance]、[官方快速开始][start]；企业侧边界仅来自本仓库既有代码，未联网验证企业内部系统。

## 2. 两个 GitHub 桌面用量模式

### A. steipete/CodexBar：API-key 余额与网页登录明细分开

作者的 DeepSeek 文档明确区分 API-key 余额和可选 Platform 会话明细；Swift 源码有固定余额 URL、GET、Bearer、15 秒请求限制，以及赠送 / 充值 / 币种 / `isAvailable` 的独立字段。可借鉴的是**余额与明细能力分离、展示资金组成、不可用状态与金额并列**。[作者 provider 文档][codexbar-doc]、[作者 fetcher 源码][codexbar-source]

不要直接复制它的行为：其文档及源码也包括浏览器会话读取与私有 dashboard 请求；本任务明确禁止这些路径。其通用 quota 展示转换还把余额可用性映射为 0 / 100 的 `usedPercent`，且币种选择倾向有资金的 USD；这些是上游 UI / 选择策略，**不是官方消费百分比，也不是本项目的 CNY 优先策略**。这里只研究公开源码，不执行任何凭据导入或私有请求。[作者 provider 文档][codexbar-doc]、[作者 fetcher 源码][codexbar-source]

### B. saime428/ai-code-usage-tray：Windows 本地优先、过期与退避独立

作者 README 描述 Windows 托盘 / 悬浮条、主进程调度与受限 preload，区分本机记录的 API 等价成本和订阅账单；读取失败保留旧快照并标过期，认证失效停止重试，429 等待记录只持久化状态与时间。隐私说明称可选 OAuth 凭据由 Electron `safeStorage` 加密，诊断不含凭据。[作者 README][tray-readme]、[作者隐私说明][tray-privacy]

可迁移的是**余额快照、刷新失败、数据年龄和授权状态分离**，而不是照搬其 Claude OAuth、CLI / 本机进程令牌来源或会话统计。此项目不是 DeepSeek 余额协议的权威来源，也不是企业 SSO 接入模板。当前 provider 只返回成功快照或分类错误；缓存、退避、密钥存储、IPC 与 UI 全由父任务负责，上游的隐私声明不构成本模块对父任务存储安全的保证。[作者 README][tray-readme]、[作者隐私说明][tray-privacy]

## 3. 本次交付契约（实现选择）

仅有 `src/providers/deepseek.cjs`、`tests/deepseek.test.cjs` 与本文三个文件；没有依赖、日志、落盘、环境变量读取、IPC、token 抓取、SSO 或 UI 代码。

```js
const {fetchDeepSeekBalance, parseDeepSeekBalance} = require('./src/providers/deepseek.cjs');
const snapshot = await fetchDeepSeekBalance(apiKey, {fetchImpl, timeoutMs});
const parsed = parseDeepSeekBalance(payload);
const deterministic = parseDeepSeekBalance(payload, '2026-11-04T00:00:00.000Z');
```

- CommonJS 命名导出两函数。`fetchImpl` 默认 `globalThis.fetch`；只有调用者主动传入的 key 会被使用。key 仅要求字符串、trim 后非空、原串无 CR / LF；不要求 `sk-` 前缀或固定长度，发送时 trim 两端空白。
- 一个固定官方 GET：key 只在 Bearer header，`redirect: 'error'`、`credentials: 'omit'`、`cache: 'no-store'`；额外 URL / baseUrl 选项不能改变目的地。注入 fetch 是受信测试 / 主进程依赖，不是可供 renderer 传入的网络能力。
- 默认 10 秒；`timeoutMs` 必须是 1～60000 的整数。AbortController 配合 Promise.race 覆盖 fetch **和正文读取**，即使测试 stub 忽略 abort，调用也能在期限到达后拒绝；成功 / 失败均清理计时器并 abort 未消费的网络工作。没有自动重试或备用端点。
- 标准 Fetch 的流式正文最多读 65536 字节；text-only 适配器在读取后验证 UTF-8 字节数。json-only 测试适配器允许直接给已解析对象，但其自身分配内存无法由本模块限制。所有适配器都受同一截止时间和 schema 校验。
- parser 不读网络、文件或凭据、不改写 payload；可选第二参数注入规范 ISO `updatedAt`，使完整结果对相同输入确定，解析过程不查询当前时钟。单参数兼容入口默认采本地时间，因此这一默认值有时钟依赖，不能声称单参数调用具有数学意义的确定性。官方响应本身没有时间字段，不能伪造供应商时间。
- 严格验证所需自有字段 / 类型：1～2 个币种记录，CNY / USD 精确大写，各币种唯一；任何记录不支持或金额损坏均拒绝，不跳过非首选记录。金额必须是最多 64 字符的非负十进制字符串，转换后有限且不超过 `Number.MAX_SAFE_INTEGER`；不接收数字、指数、空白、负数或货币符号，不舍入到分。无关扩展字段忽略，不拷入快照；返回 JS number，仍有 JS 浮点精度限制。
- 错误为 `DeepSeekBalanceError`，固定 `code` / 固定消息，无上游 error、cause、正文、statusText、URL 或 key 拼接。分类：`INVALID_KEY`、`INVALID_OPTIONS`、`UNAUTHORIZED`（401）、`FORBIDDEN`（403）、`RATE_LIMITED`（429）、`HTTP_ERROR`、`NETWORK`、`TIMEOUT`、`INVALID_RESPONSE`。父任务可据 code 决定提示 / 退避，不需字符串猜测。

成功快照字段：`{kind: 'balance', source: 'deepseek', currency: 'CNY' | 'USD', remaining: number, total: null, used: null, percentage: null, updatedAt: ISO, details: {granted: number, toppedUp: number}, available: boolean}`。没有账户身份、跨币种汇总或“总额度 600”隐含默认值。

## 4. 验证方法与未覆盖事项

从仓库根目录执行 `node --test tests/deepseek.test.cjs`（本次测试运行时为 Node 24.18.0）。测试使用 node:test、伪 key、注入 fetch、内存 Response / ReadableStream 与模拟计时器；默认全局 fetch 被阻断，**没有携带凭据的外网请求**。覆盖精确映射、零值 / 不可用、CNY / USD、坏字段 / 金额 / 非首选行、重定向、HTTP 分类与脱敏、正文大小、网络 / 正文挂起超时和计时器清理。

本次 provider 独立测试 **36 / 36 通过**，两个 CJS 文件均通过 `node --check`。额外联跑既有 `tests/quota.test.cjs` 时，观察到 `compact: 'false'` 设置校验的一项 `assert.throws` 失败；它不属于本模块，也不在允许写入范围内，未修改相关代码或测试。

未做真实账户余额实测、企业 SSO 实测、上游发行包安装或安全审计；不承诺断网缓存、跨机密钥便携、轮询退避或 UI 展示，父任务另行验收。

[balance]: https://api-docs.deepseek.com/api/get-user-balance
[start]: https://api-docs.deepseek.com/
[errors]: https://api-docs.deepseek.com/quick_start/error_codes
[codexbar-doc]: https://raw.githubusercontent.com/steipete/CodexBar/main/docs/deepseek.md
[codexbar-source]: https://raw.githubusercontent.com/steipete/CodexBar/main/Sources/CodexBarCore/Providers/DeepSeek/DeepSeekUsageFetcher.swift
[tray-readme]: https://raw.githubusercontent.com/saime428/ai-code-usage-tray/main/README.md
[tray-privacy]: https://raw.githubusercontent.com/saime428/ai-code-usage-tray/main/PRIVACY.md
