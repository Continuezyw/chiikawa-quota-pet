# Chiikawa 官方角色素材核验

研究日期：2026-11-04（Asia/Shanghai）。素材用于用户明确请求的本地个人原型；不将公开可下载等同于再分发许可。

## 结论与来源身份

- 八个请求角色均已从[《ちいかわ》动画官方网站角色页][anime]找到，不需要从粉丝 Wiki 或二次转载页面取图。页面 HTML 自述为「ちいかわ - オフィシャルサイト」，加载[官网公开组件][component]；组件页脚原文标注 `©ナガノ/ちいかわ製作委員会`。[anime][component]
- 实际图片来自同一官网域名下的[透明 PNG 图集][sprite]。角色组件的 `.main-img` 使用该图集作为背景，桌面版 `.bg-*` CSS 给出角色位置、宽度和高度；下面的裁切坐标由此取得，非人工重绘或推测。[component][sprite]
- [英文角色官网][english-cast]也列出这八名角色，用于交叉核对英文拼写。英文站首页自述为美国官方来源，其[Terms of Use][english-terms]说明站点由 Spiralcute International, Inc. 拥有和控制；本次没有选用英文页面的带色背景角色卡图。[english-home][english-cast][english-terms]
- 用户提供的 [Miraheze 页面][wiki]仅作为需求参考，未据此认定官方身份，未下载其素材，也未把 Wiki 内容作为角色图片授权依据。

## 本地素材清单

八个文件都是保留透明度的索引色 PNG。所有 `sourceUrl` 均为[原图集][sprite]，`sourcePage` 均为[角色页][anime]。中文 `name` 是原型界面显示名，不宣称为官方中文译名；日文名称及官网内部 code 来自[公开角色组件][component]，英文拼写来自[英文角色页][english-cast]。

| id / 文件 | 官网日文名 | 英文名 | 官网内部 code | CSS 裁切框 `(x,y,w,h)` | 输出尺寸 | 大小（字节） |
| --- | --- | --- | --- | --- | --- | ---: |
| chiikawa / chiikawa.png | ちいかわ | Chiikawa | chiikawa | (0,0,335,362) | 323 × 359 | 12,155 |
| hachiware / hachiware.png | ハチワレ | Hachiware | hachiware | (343,0,335,374) | 326 × 370 | 13,367 |
| usagi / usagi.png | うさぎ | Usagi | usagi | (690,0,335,463) | 310 × 457 | 14,435 |
| kurimanju / kurimanju.png | くりまんじゅう | Kurimanju | kuri | (1457,0,308,365) | 307 × 352 | 12,476 |
| momonga / momonga.png | モモンガ | Momonga | momo | (1035,0,419,391) | 403 × 388 | 20,122 |
| rakko / rakko.png | ラッコ | Rakko | racco | (2289,0,340,362) | 337 × 360 | 18,378 |
| shisa / shisa.png | シーサー | Shisa | sisa | (2636,0,400,355) | 398 × 355 | 18,515 |
| furuhonya / furuhonya.png | 古本屋 | Furuhonya | huruhonya | (3456,0,314,424) | 303 × 409 | 15,208 |

PNG 合计 **124,656 字节，约 122 KiB**。这是本地文件实测，不包含 manifest。

处理只包含：官网 CSS 区域裁切 → 以 alpha 非零边界去除透明留白 → 无损 PNG 压缩。保留原调色板和透明信息，不做白色抠图、不擦除内部白色、不重新绘制、不改变颜色、不缩放。古本屋 CSS 框的右缘略超过原图实际宽度；裁切时将框限制在真实图像范围内，保留原图全部可见像素。[component][sprite]

## 可复现下载与检查

- 原图集：3766 × 463，209,921 字节。[sprite]
- 本次下载原文件 SHA-256：`856b8b0e181c4a1c2a826816ed0b19eaad271fb580e76c5b21273885ec0ff07e`。
- 脚本：`scripts/download-characters.cjs`。需要 Node、系统 curl 和 Python + Pillow；本机验证环境为 Pillow 12.3.0。无需修改应用依赖。

```powershell
node scripts/download-characters.cjs
node scripts/download-characters.cjs --source "C:\path\to\official-sprite.png"
```

无参数时只请求上面的单个公开 HTTPS 图片，不读取凭据、不访问登录页面、不绕过认证或付费限制；最多下载 1 MiB，35 秒超时。`--source` 可离线复现。脚本会先校验图集 hash，若上游改图则停止，要求重新核对角色页和 CSS，不能仅为通过检查而盲改 hash。裁切后输出文件尺寸、字节数和 SHA-256。未做重采样，同一输入的像素内容可复现；PNG 压缩字节可能随 Pillow / zlib 版本变化。

本次检查覆盖：脚本语法；官网实际下载；8 个指定且唯一的 id；manifest 字段完整及纯相对 PNG 文件名；PNG 可解码；透明与不透明像素同时存在；裁切后 RGBA 像素与官方对应区域逐像素一致；透明留白裁切后的 alpha 边界；八角色视觉检查。**未启动应用，未运行应用、main 或桌面测试。**

## 权利标注与整合边界

- 每个 manifest 项保留官网页脚版权标注 `©ナガノ/ちいかわ製作委員会`；官方素材不因应用代码许可而转为开放许可。[component]
- 本次未取得权利人关于改编、公开分发或商业使用的授权；用户的个人原型用途不是授权证明。英文官网的使用条款也不应被解读为桌面应用素材再分发授权。[english-terms]
- 不在本研究侧任务里修改应用 UI、main、打包逻辑或其他声明文件。接入方读取 `assets/characters/manifest.json` 的数组，并在该目录内拼接每项 `file`；保持图片宽高比，不把 `sourceUrl` 当运行时必须联网的热链。
- 接入方需同步已有 `docs/THIRD-PARTY-NOTICES.md` 和发布说明：其中原先「没有附带网络下载的官方素材」的旧描述不再适用于这八张图。发布给他人之前应重新处理素材许可或改用有授权的角色皮肤；本研究没有核准公开分发。

## 一手来源

[anime]: https://www.anime-chiikawa.jp/chara.html
[component]: https://www.anime-chiikawa.jp/js/main.js
[sprite]: https://www.anime-chiikawa.jp/images/characters/img_charapage.png
[english-home]: https://www.chiikawaofficial.com/
[english-cast]: https://www.chiikawaofficial.com/characters
[english-terms]: https://www.chiikawaofficial.com/privacy-policy-1
[wiki]: https://chiikawa.miraheze.org/wiki/Main_Page
