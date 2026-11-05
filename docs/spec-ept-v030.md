---
title: EPT 额度替换浏览器读取
type: feature
created: 2026-11-04
status: done
baseline_commit: NO_VCS
review_loop_iteration: 1
---

<frozen-after-approval>
## Intent
**Problem:** 原站页面本人可见额度，但浏览器采集无法可靠读取；用户明确要求舍弃浏览器方式，改用本机 ept usage。
**Approach:** 公司额度来源替换为 EPT 命令，默认启动和定期刷新；优先本机已验证的结构化 summary-only / json 参数，旧版本明确不支持参数时回退文本汇总。

## Boundaries & Constraints
**Always:** 保留8角色、三档大小、独立悬浮卡、手动记录和 DeepSeek 来源；读取个人总花费，包含沙箱费用。当前来源失败保留缓存并标过期，未查询额度显示未知。EPT 自己处理已有账号权限；桌宠只调用固定 usage 命令，不读登录配置。
**Ask First:** 若需安装 EPT、重新认证、写用户 EPT 配置或访问非用户授权范围，需本人操作或许可。
**Never:** 浏览器 profile / DOM / SSO / 任意命令执行 / 复制 EPT token / 推理探测 / 调整预算。分享包不含凭据、个人缓存或 EPT 可执行文件，不把个人使用视为素材授权。

## I/O & Edge-Case Matrix
| 情景 | 输入 | 输出 | 错误处理 |
|---|---|---|---|
| JSON汇总 | budget600 actual175.79 percent29.2983 monthly | 剩余424.21，显示29.30% | 校验数值及百分比一致性 |
| 高精度JSON | actual179.30498902 | 内部保留精度，显示金额2位 | 不先舍入分项或成本 |
| 旧版文本 | 多个工具与部门明细 | 只取个人使用汇总 | 缺失/重复/单位错误拒绝 |
| EPT未安装或失效 | 无程序/未登录/网络失败 | 可操作提示 | 不显示伪造0额度、不保存原始stderr |
| 超额或0额度 | used>total/0 | 非负剩余，明确百分比 | 不除0 |
| 旧配置 | finops、旧报告地址 | EPT来源，形象尺寸保留 | 不再保存报告地址，不自动删旧浏览器资料 |
| 来源变更/退出 | 查询在途 | 中止自己的子进程，丢弃旧结果 | 不影响新来源与系统EPT登录 |
</frozen-after-approval>

## Code Map
- src/providers/ept.cjs -- 命令定位、安全进程与汇总解析。
- src/store.cjs -- 未知额度及高精度缓存，旧配置迁移。
- src/main.cjs / src/preload.cjs -- 删浏览器、刷新与受限IPC。
- src/renderer/ -- EPT设置、周期与采样状态，未知值显示。
- tests/ / scripts/desktop-smoke.cjs -- 解析与进程、界面、迁移和真实命令验证。
- package.json / scripts/package.ps1 / docs/ -- v0.3便携包和前置条件。

## Tasks & Acceptance
**Execution:**
- [x] src/providers/ept.cjs -- 实现验证后的JSON契约及文本回退，隐藏子进程限时限量。
- [x] src/main.cjs / src/preload.cjs / src/store.cjs -- EPT启动刷新、来源隔离、缓存与迁移，删除浏览器入口与provider。
- [x] src/renderer/ -- EPT路径与刷新设置、未知值、周期，保留原有外观交互。
- [x] tests/ / scripts/ -- 覆盖错误、精度、部门混淆、来源切换取消与重启；本人授权真实命令实测。
- [x] package.json / scripts/package.ps1 / docs/ -- 移除浏览器运行依赖，构建v0.3 ZIP、隐私和校验核查。
**Acceptance Criteria:**
- Given已安装登录EPT，when启动/点击/定期刷新，then只执行固定usage命令，并以成功快照展示剩余与用量。
- Given失败或来源变更，when任务结束，then缓存不被错误覆盖，不泄漏原始输出，不再打开网页。
- Given另一台Win x64电脑，when解压，then外观可用；EPT同步需要该机自己的EPT与账号，离线手动源可用。

## Spec Change Log

## Design Notes
本机 ept usage --help 已确认支持 --json 和 --summary-only；实际输出包含 plan_name / total_budget / actual_cost / usage_percentage / reset_cycle，不含服务端采样时间。更新时间标本地读取时间，不伪造统计范围。优先此JSON避免将 Coding 分项或部门花费误认为个人总额。

## Verification
- npm test / npm run test:desktop -- 解析、命令安全、来源与界面回归。
- npm run test:ept -- 本机真实EPT读取，不写原始输出或凭据。
- npm run build / npm run test:desktop -- --packaged / npm run test:ept -- --packaged -- 发行程序。
- npm run package:share -- ZIP无个人数据、浏览器provider与EPT凭据，保留旧版本。

2026-11-04：109/109 测试通过，源码与打包版桌面回归、重启及实际EPT查询通过。最终ZIP和独立校验通过，ZIP内ASAR与实测版相同。详见 [v0.3交付记录](verification-v030.md)。未创建提交或分支。

## Suggested Review Order

**来源替换与安全执行**

- 先看额度刷新入口：固定EPT来源与失败缓存。
  [main.cjs:159](../src/main.cjs#L159)
- 固定参数、隐藏进程、超时与取消边界。
  [ept.cjs:114](../src/providers/ept.cjs#L114)
- 仅允许实际EPT路径，不接收任意shell命令。
  [ept.cjs:91](../src/providers/ept.cjs#L91)

**个人汇总与状态一致性**

- JSON总消耗保留精度，不误读Coding分项。
  [ept.cjs:29](../src/providers/ept.cjs#L29)
- 旧版文本限制个人区域，拒绝部门和混淆标签。
  [ept.cjs:48](../src/providers/ept.cjs#L48)
- 切换来源取消旧请求，并清除不适用缓存。
  [main.cjs:199](../src/main.cjs#L199)
- 迁移旧浏览器配置，保留形象和手动来源。
  [store.cjs:13](../src/store.cjs#L13)

**界面与交付**

- 未知额度、显示精度与独立额度卡绑定。
  [renderer.js:55](../src/renderer/renderer.js#L55)
- 用户原格式、长空白、金额归属与迁移回归。
  [ept-regression.test.cjs:1](../tests/ept-regression.test.cjs#L1)
- 实际EPT与桌面联调，不将模拟误称实时。
  [ept-smoke.cjs:1](../scripts/ept-smoke.cjs#L1)
- 分享包排除凭据，独立ZIP与SHA256校验。
  [package.ps1:1](../scripts/package.ps1#L1)
