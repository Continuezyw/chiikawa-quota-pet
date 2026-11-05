# v0.4 第三方 HTTPS GET JSON 适配器

这是受限的字段映射模块，不承诺任意平台都有余额 API；不调用推理、不读取浏览器或其他来源凭据、不创建平台账号或 Key。只查询用户自己核对并确认的接口。本模块及专属测试不需要真实平台认证。

## CommonJS 接口与默认配置

`src/providers/custom.cjs` 仅导出：

| 函数 | 用途 |
| --- | --- |
| `customDefaults()` | 返回全新默认配置，无 Key |
| `validateCustomConfig(input, {allowEmpty = false} = {})` | 返回仅含固定字段的配置副本；无效配置抛出净化错误 |
| `emptyCustomQuota(config)` | 返回当前配置的未知额度，所有观测数值、可用性和时间均为 null |
| `parseCustomResponse(payload, config, updatedAt = new Date().toISOString())` | 按路径解析余额或总额度/用量，不返回原始响应 |
| `restoreCustomQuota(quota, config)` | 校验并重建缓存，不重复换算、不舍入小数 |
| `fetchCustomQuota(config, key, {fetchImpl, signal, timeoutMs} = {})` | 使用独立 Key 的单次 GET，支持取消、限时和限量 |

```json
{
  "preset": "generic",
  "label": "第三方平台",
  "endpoint": "",
  "auth": "bearer",
  "headerName": "X-API-Key",
  "currency": "CREDIT",
  "mode": "balance",
  "remainingPath": "data.balance",
  "totalPath": "data.total",
  "usedPath": "data.used",
  "divisor": 1,
  "confirmed": false
}
```

固定枚举：preset 为 `generic/deepseek/newapi`，auth 为 `bearer/header/none`，currency 为 `CREDIT/CNY/USD`，mode 为 `balance/quota`。缺省字段使用默认值，未知字段丢弃；不会读取未知的 token/apiKey 属性。配置必须是普通对象或无原型对象，配置及映射中的访问器不执行。

保存未设置来源时使用 `validateCustomConfig(input, {allowEmpty: true})`：允许空 endpoint 和 confirmed false，其余字段仍需有效。查询必须完整且 confirmed true；更换目标后必须重新确认。纯解析、未知额度及缓存校验可以接受尚未确认的配置，不发起请求。

## 通用余额与额度

以下示例目标仅用于说明，不是平台接口承诺。不要把 Key 放在 URL、配置、日志或分享包中。

### 余额模式

使用用户平台已确认的 HTTPS 接口，核对响应形如 `{"data":{"balance":"12.345678901"}}`，配置 remainingPath 为 `data.balance`、mode 为 balance，确认后再查询。

仅读取 remainingPath，不读取 totalPath/usedPath，不猜测总额度或百分比。输出：

```js
{
  kind: 'balance', source: 'custom', currency: 'CREDIT', remaining: 12.345678901,
  total: null, used: null, percentage: null, available: null,
  updatedAt: '2026-11-04T00:00:00.000Z',
  custom: {label: '第三方平台', scope: 'account'}
}
```

泛用模式尊重用户所选单位，即使响应含其他币种字段也不自动猜测、换币。未知额外字段忽略，但**顶层 success 严格为 false，或顶层自有 error 字段不是 null/false 时明确拒绝**，不能因错误体中映射余额是 0 就当查询成功。error 为对象、字符串、0、空字符串等也拒绝；嵌套或未知字段不冒充顶层失败判据。

### 额度模式

配置 mode 为 quota，明确设置 totalPath 和 usedPath；两者都必需且必须是有效金额。仅读取这两条金额路径，不读取 remainingPath。输出 kind 为 quota，并包含：

- total、used；`remaining = max(0, total - used)`。
- `overage = max(0, used - total)`。
- `percentage = used / total * 100`，不截断到 100。
- 总额 0 且用量 0 时百分比 0；总额 0 且用量大于 0 时为 100；其他非有限百分比拒绝。
- 同样的 source/currency/available/updatedAt/custom 元数据。

所有未知额度的 remaining/total/used/percentage/available/updatedAt 均为 null；quota 模式还包含 overage null。不会显示样例数值。

## DeepSeek 兼容预设

用户核实兼容接口后，设置 preset 为 deepseek、mode 为 balance、currency 为 CNY 或 USD，remainingPath 为 `balance_infos.0.total_balance`；目标行在索引 1 时明确改为 `balance_infos.1.total_balance`。

**所选路径对应的那一行**必须有自有 currency 属性且与配置完全相同，否则拒绝。不假设第一行是 CNY，不搜寻另一行后替换用户路径，不把美元余额贴人民币标签。只校验所选行金额与币种，不读取未选行金额。

除通用顶层失败判据外，DeepSeek 预设的顶层 `is_available: false` 直接拒绝；成功时 available 仍为 null，不扩展第三方缓存语义。独立 DeepSeek 来源仍可保留其原有“余额 + 不可用”语义，本模块不复用其 Key、响应或缓存。

## New API 令牌用量预设：必须核对平台契约

建议起点：

```js
const selected = {
  ...customDefaults(),
  preset: 'newapi',
  label: 'New API 令牌',
  endpoint: 'https://quota.example.com/api/usage/token/',
  auth: 'bearer',
  currency: 'CREDIT',
  mode: 'quota',
  totalPath: 'data.total_granted',
  usedPath: 'data.total_used',
  divisor: 1,
  confirmed: false
};
```

**必须核对目标平台及版本的真实契约、字段含义、认证方式与单位后才能确认。**建议的 `/api/usage/token` 和路径只是待核对的映射起点，不保证任意 New API/One API 分支都支持；不支持则不要查询或伪造结果。预设名称不会自动填 URL、重写路径、读取其他金额字段或换算单位。

### 一手源码核对（2026-11-04 读取公开 main，非所有部署的版本承诺）

- [New API 官方控制器：controller/token.go](https://github.com/QuantumNous/new-api/blob/main/controller/token.go)：`GetTokenUsage` 校验 Bearer 认证，在 data 中写入 total_granted（令牌剩余额度加已用额度）、total_used（令牌已用额度）、total_available（令牌剩余额度）和 unlimited_quota。成功外层使用 code true，而非必须有 success true；因此本模块不强制 success 字段存在。数值直接来自令牌 quota，不是返回账户货币余额，本模块也不据此假定币种换算。
- [New API 官方路由：router/api-router.go](https://github.com/QuantumNous/new-api/blob/main/router/api-router.go)：路由分组为 `/api` → `/usage` → `/token`，GET 子路径为 `/`，处理器为 GetTokenUsage，并有只读令牌认证。**此源码组合后的注册路径含末尾斜杠 `/api/usage/token/`**；平台可能对无末尾斜杠地址重定向。本模块禁止重定向，务必按目标部署核对精确路径（必要时配置末尾 `/`），不能依赖自动跳转携带 Key。
- [One API 官方控制器：controller/token.go](https://github.com/songquanpeng/one-api/blob/main/controller/token.go) 中的 `GetTokenStatus` 返回顶层 credit_summary，其 total_granted 来自剩余 quota，total_used 固定为 0 并标注未支持；它不是上述 data 包装的令牌总额/已用额契约。[One API 官方 API 路由：router/api.go](https://github.com/songquanpeng/one-api/blob/main/router/api.go) 在此次读取的文件中也未注册上述 `/usage/token` 路由。不能仅因产品名称或几个字段名称相似就认定兼容。

这些 main 链接会变化；应对照平台实际部署的 tag/commit 及其文档。当前 UI 的预设仅是**基于上述 New API 形状的字段模板**，不是“One API / New API 全版本认证通过”的声明；其他分支只有平台明确确认接口与语义后才可使用，不扩展本模块支持范围。

上述建议配置要求响应同时提供 `data.total_granted` 和 `data.total_used`，分别代表该平台确认的令牌总额度、已用额度；二者都是必需的有限非负金额。示例有效正文：

```json
{"success":true,"data":{"total_granted":"1000000.123456789","total_used":"500000.012345678","unlimited_quota":false}}
```

success 字段可以缺省，但明确 false 必须拒绝；error 字段如存在只能为 null/false。缺 total_granted 或 total_used、值无效、只有 total_available 或账户 balance，都不能视为这套映射的成功响应。不根据未配置的字段推导总额度或用量。平台契约不同则显式更改路径，不能自动回退。

New API 输出 `custom.scope: 'token'`，表示该 Key/令牌的额度与用量，**不等同账户余额**。默认保留原始 CREDIT、divisor 1；不能套用未验证的固定比例或汇率。用户核对实际契约后可以明确选择币种与 divisor，不进行自动单位猜测。

根、data 或配置金额所在对象的 unlimited_quota/unlimited 标记如表示无限额度，则明确拒绝。有限标记可为 false、0、`"false"`、`"0"` 或缺省；其他值拒绝。负数哨兵、`"unlimited"`、Infinity 等金额也拒绝，不能把无限额度当 0。

## 路径、数值与精度

- 点路径只读每一级自有数据属性；支持 `data.wallets.0.balance` 数组索引，无 eval、脚本、JSONPath 或表达式。
- 最多 20 段、256 字符。段为 ASCII 字段名或规范非负整数；禁止空段、括号、负索引、前导零索引及 prototype/__proto__/constructor；数组不读取 length 等命名属性。
- 余额模式要求 remainingPath；额度模式要求 totalPath、usedPath。未使用路径允许空字符串，但非空时仍须安全。
- amount 只接受有限非负 number 或严格十进制 string（最多 256 字符），如 `"0"`、`"12.345678901"`。拒绝空白、符号、指数形式的字符串、逗号、布尔值和隐式转换。
- **先拒绝超过 Number.MAX_SAFE_INTEGER 的原始金额，再应用 divisor**；decimal string 在转 Number 前也检查该边界（包括边界整数后非零小数），避免不安全金额通过大 divisor 掩盖精度损失。
- divisor 必须为有限正 number 且不超过 1e9。换算结果必须有限、不超过 1e9；正金额除法下溢为零也拒绝。
- 保留 JavaScript number 小数精度，不按分舍入、不承诺超出 IEEE-754 表示能力的任意精度十进制。
- updatedAt 必须能往返 `new Date(value).toISOString()`，包括毫秒；无效时间不能冒充已查询记录。

## URL、认证和网络安全

- endpoint 仅完整 HTTPS；禁止 user/pass、query、hash（包括空 ?/#）、IP 及数字/十六进制 IP 写法、localhost 及子域、.local、单标签主机、控制字符、反斜线和空白。
- 域名必须是常规 DNS 标签；国际域名需合法 ASCII/Punycode，可用合法端口。验证不查 DNS，不能保证可信公网域名永远不解析到私有 IP；本模块不是完整 DNS 重绑定防护代理，用户必须确认可信目标。
- bearer 只写 `Authorization: Bearer <独立 Key>`；header 只写指定安全 Key/Token 头；none 不读取或发送 Key。
- 自定义头最多 64 字符，限定连字符连接、以 Key/Token 结尾，如 X-API-Key、Api-Key、X-Access-Token。禁止 Cookie、Host、Authorization、Content-Length、连接/代理/转发/方法覆写等传输头及 CR/LF 注入。
- Key 为非空可打印 ASCII 字符串，无控制字符，最多 8192 字符；去首尾空格，不要求 sk- 前缀。只用独立 key 参数，不读取配置、磁盘、环境或其他来源 Key。
- 固定 GET、redirect error、credentials omit、cache no-store，不传 body。额外 options 不可覆写目标、方法、headers/body。拒绝已重定向或响应 URL 不同的结果；HTTP 错误不读正文、不重试。
- 默认 fetch + 正文总限时 10 秒。timeoutMs 仅允许 1–10000 的整数，测试可以缩短，不能延长上限。外部 AbortSignal 取消返回 CANCELLED，截止时间返回 TIMEOUT；请求使用独立 AbortController。
- 流式 UTF-8 正文最多 65536（64 KiB）字节；恰好上限可接受，超限取消 reader，Content-Length 不能绕过累计校验。拒绝无效 UTF-8/JSON；无流时支持 text() 替身并检查字节数。只有 json() 的替身拒绝，因为无法校验原始正文大小。
- 不合作的 fetch/text/reader.read/reader.cancel 不会阻止取消或超时 settle；迟到结果不产生额度更新，迟到响应不读正文，迟到 rejection 已处理。结束清 timer、外部 signal 监听，尽力取消/释放 reader，不等待不合作的 cancel。
- 所有错误是稳定 code 与中文净化消息，不含 Key、URL、原始正文、上游 exception/cause；模块不写日志。

## 缓存与主程序集成边界

restore 校验 source custom、配置一致的 kind/currency/label/scope、规范时间、所有数值与派生字段；拒绝 EPT、DeepSeek、旧导入、其他 label/scope 的缓存。缓存金额已经换算，不重复除 divisor；未知缓存必须完整保留 null。结果只含额度与允许元数据。

**集成层将缓存绑定到完整配置，配置改变时取消旧查询并清除缓存；endpoint 或认证目标改变时还清除此平台 Key，必须重新输入并确认。**仅字段路径、单位或除数改变时，Key 仍绑定同一认证目标，可以保留，但不能保留旧金额快照。契约的 custom 元数据只有 label/scope，不携带 endpoint 身份；同 label/scope 的两个目标无法仅凭额度 JSON 区分，不把旧目标缓存传给新配置的 restore。主程序集成负责平台独立的本机加密 / 会话 Key 存储。

## 错误 code 与专属离线测试

`INVALID_CONFIG / INVALID_KEY / INVALID_RESPONSE / UNAUTHORIZED / FORBIDDEN / RATE_LIMITED / HTTP_ERROR / NETWORK / TIMEOUT / CANCELLED`。

配置/缓存错误抛异常，查询返回 Promise rejection；不能输出原始平台响应。专属测试使用 fetch 注入、内存 Response/ReadableStream、模拟时钟，覆盖失败标记、币种、归属、路径、精度、缓存、URL/header 注入、HTTP 错误、64 KiB、取消/超时/迟到结果和禁止日志 Key。

```powershell
node --test tests/custom.test.cjs
```

测试禁止默认网络，使用虚构 Key，不请求未知用户 Key、不作真实平台认证。
