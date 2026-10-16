# MusicFree Web 音源网关

为 Folia Web 接入 MusicFree CommonJS 插件。浏览器通过 Omni 调用网关，插件及其依赖只在服务端运行，无需修改现有页面。

支持插件 JSON 列表及直接 JS 地址、本地文件、相对路径、嵌套列表；每个插件注册为独立的 `musicfree.*` provider。歌曲的原始 JSON 字段与复合主键保留在 `sourceRef.providerData`，用于后续播放、歌词及队列恢复。

## 本地启动

要求 Node.js 24+。在仓库根目录运行：

```bash
npm ci --prefix musicfree-gateway
cp musicfree-gateway/.env.example musicfree-gateway/.env
# 编辑 MUSICFREE_SOURCES；设置固定 MUSICFREE_ITEM_SECRET（openssl rand -hex 32）。
npm run dev:musicfree
```

在 Folia 的 `.env.local` 设置，然后启动或重启 Vite：

```env
VITE_MUSICFREE_API_BASE=http://127.0.0.1:3300/api/musicfree
```

`MUSICFREE_ALLOW_ORIGIN` 必须与浏览器访问 Folia 的 origin 一致，例如 `http://localhost:3000`。手机访问时，网关与前端都要使用手机可达的地址；网关监听 `MUSICFREE_HOST=0.0.0.0`。HTTPS 前端应使用 HTTPS 网关或同源反向代理，避免混合内容。

本地开发或 Codespaces 预览可以让 Vite 代理网关，只暴露网页一个端口：

```bash
VITE_MUSICFREE_API_BASE=/api/musicfree MUSICFREE_DEV_GATEWAY=http://127.0.0.1:3300 npm run dev -- --host 0.0.0.0
```

这时无需跨域配置；浏览器访问 `/api/musicfree`，Vite 转发到本机网关。Codespaces 使用其分配的 HTTPS 预览地址，网关端口保持内部访问。

使用本文 Huibq 列表时，开发服务器的 `/?musicfree-demo=1` 是可直接体验的入口：选中小秋音乐、打开在线首页并搜索“晴天”，避免沿用浏览器保存的空本地库视图。该入口只在启用 `MUSICFREE_DEV_GATEWAY` 的 Vite 开发服务注入，正式构建及普通访问不受影响。

打开 `/api/musicfree/providers` 查看已加载源及加载失败原因。在 Folia 原有的平台选择入口切换到对应插件，再搜索、播放。没有账户的插件使用现有无账户 provider 流程，不显示扫码登录。

## Docker

网关已装配进 Docker Web API backend，沿用 gateway 的 `/api/` 路由。前端在 Docker 环境自动发现 `/api/musicfree`，不需要重新构建前端来更换插件列表。

在 Docker `.env` 中填写：

```env
MUSICFREE_SOURCES=https://fastly.jsdelivr.net/gh/Huibq/keep-alive/Music_Free/myPlugins.json
MUSICFREE_ITEM_SECRET=填入自己生成的固定随机值
```

本次源码改动尚未发布到已有镜像；使用本地构建：

```bash
cd deploy/docker
docker compose -f compose.yaml -f compose.build.yaml up -d --build gateway backend
```

使用本地插件文件时，需要额外挂载只读目录到 backend，再把容器内文件路径写入 `MUSICFREE_SOURCES`。插件列表修改后重启 backend。Vercel 等静态或 serverless 部署可连接独立常驻网关，设置 `VITE_MUSICFREE_API_BASE`。

## 接口及能力边界

- `GET /api/musicfree/providers`：可用 provider、接口能力、加载错误。
- `POST /api/musicfree/providers/:id/search`：`{ query, limit, offset }`；转换插件从 1 开始、页大小不固定的分页。
- `POST /api/musicfree/providers/:id/recommendations`：`{ limit }`；推荐歌单与排行榜。
- `POST /api/musicfree/providers/:id/tracks`：`{ item, proof, kind, limit, offset }`；歌单／排行榜歌曲分页。
- `POST /api/musicfree/providers/:id/detail`：`{ item, proof }`；合并插件补充元数据。
- `POST /api/musicfree/providers/:id/audio`：`{ item, proof, quality }`；返回音频代理地址及代理票据过期时间。
- `POST /api/musicfree/providers/:id/lyrics`：`{ item, proof }`；提供 LRC 原文与翻译。
- `GET/HEAD /api/musicfree/assets/:ticket`：代理封面、音频，保留插件要求的 headers / userAgent，并转发 Range 与 Content-Range。

`proof` 由网关签发，绑定 provider 和完整歌曲 JSON。更改字段会失效，避免客户端伪造任意媒体/歌词 URL。配置固定 `MUSICFREE_ITEM_SECRET` 可在重启后继续验证队列；未配置时需重新搜索。代理资源票据以加密数据携带上游地址和请求头，有效期 24 小时；使用固定密钥时可跨网关实例验证。过期后重新请求播放或曲库以刷新地址。

已适配搜索、播放、封面、歌曲信息、逐句歌词、推荐歌单及排行榜歌曲分页。无需上游账号，首页同时提供浏览器持久保存的“我喜欢”；不同 provider 的收藏互相隔离。收藏通过 IndexedDB 独立表保存，普通 API 缓存清理不会删除。专辑／艺人详情、上游账户及远端歌单写入尚未接入。私人 FM 与每日推荐按实际能力隐藏，不伪造入口。

搜索缺少封面时，网关会调用插件 `getMusicInfo` 补充（并限制并发）；失败时保留歌曲，返回 `metadataErrors`，客户端记录诊断。

MusicFree 的 `artist` 是显示字符串，不保证多艺人结构或真实艺人 ID。时长 `duration` 从秒转换为 Folia 毫秒；没有返回时保留未知值。封面和时长都是可选字段；缺失值需要插件补充，适配器不猜测。带时间戳 LRC 使用 Folia 现有解析器，纯文本歌词无法提供真实逐句同步。

Folia `standard/high` 请求插件 `standard/high`，`lossless/hires` 请求 `super`。插件级别不保证真实编码：例如提供的 Huibq 小芸 0.3.0 把 `super` 映射为 320k，所以适配器不把它标记为已验证无损或 Hi-Res。首期无自动音质降级。

服务端兼容 axios、crypto-js、dayjs、big-integer、qs、he、cheerio、webdav。其他依赖与 MusicFree 专属宿主 API 尚未实现，加载失败会报告原因。只运行管理员在 `MUSICFREE_SOURCES` 配置的可信脚本；worker 和 VM 用于兼容及超时隔离，不是运行恶意代码的安全沙箱。不要将客户端上传脚本接到此接口。

### 插件账号与音源设置

在网关服务或 Vercel 的服务端环境变量中配置 `MUSICFREE_PLUGIN_VARIABLES`，内容为按 provider ID 隔离的 JSON 对象。配置后重新部署或重启网关。以下只展示结构，值必须由自己的合法账号或服务提供；不要照填占位文本，也不要使用 `VITE_` 前缀：

```json
{"musicfree.52a08ed9d22b00e59a5c":{"music_u":"自己的 MUSIC_U 或 MUSIC_A","ikun_key":"自己的音源 key","source":"服务提供的酷我渠道值"}}
```

只填写需要的字段。宿主通过全局及方法参数的 `env.getUserVariables()` 将这些设置交给对应插件，恢复 worker 后继续保留，不在 provider 描述中返回值。网易音乐插件的 Cookie 提取代码错误地使用正则第一个捕获组；宿主会在网易官方 HTTPS 请求上应用显式配置的 `music_u`（支持裸 MUSIC_U 值、MUSIC_U/MUSIC_A Cookie），保留其他设备 Cookie，并避免向该插件调用的第三方站点转发网易凭据。

合法账号配置不保证某首歌可播放，也不增加账号的订阅或地区权限。该版本网易音乐在歌曲条目 `code:404` 时直接转到酷我，不会尝试它的其他解析源，因此仅填写 `ikun_key` 不保证修复这些歌曲。没有凭据时保留插件原来的匿名行为，不提供共享账号或猜测渠道值。

## 验证

```bash
npm run test:unit -- test/unit/onlineMusic/musicfreeProvider.test.ts test/unit/onlineMusic/musicfreeGateway.test.ts
npm run typecheck
```

测试通过真实本地 HTTP 与 worker 验证 JSON 列表、失败源隔离、分页、复合身份、队列字段持久化、逐句 LRC、音频请求头、Range 和签名校验，不依赖公网源可用性。

### Huibq 列表实测（2026-10-11）

列表：`https://fastly.jsdelivr.net/gh/Huibq/keep-alive/Music_Free/myPlugins.json`，五个插件均成功加载；以下为搜索“周杰伦”后的首条样本，不能代表整个曲库的成功率。

| 插件 | 搜索与基本信息 | 封面 | 逐句歌词 | 浏览器音频验证 |
| --- | --- | --- | --- | --- |
| 小秋音乐 | 成功 | HTTP 200 | 带时间戳 LRC | 《晴天》约 269.7 秒，播放、跳转成功 |
| 小芸音乐 | 成功 | 详情补充后 HTTP 200 | 带时间戳 LRC | 《想你就写信 (Live)》约 238.7 秒，播放、跳转成功 |
| 小枸音乐 | 成功，声明时长 269 秒 | HTTP 200 | 带时间戳 LRC | 《晴天》只返回约 9.8 秒，不算完整歌曲可用 |
| 小蜗音乐 | 成功 | 搜索提供，详情接口失败 | 上游接口失败 | 《晴天》约 269.7 秒，播放、跳转成功 |
| 小蜜音乐 | 上游返回结构导致搜索失败 | 未验证 | 未验证 | 未验证 |

实际浏览器音频验证经过网关，执行媒体解码、播放、跳转至指定时间。首次整页验证时本环境浏览器进程崩溃；停止并行类型检查后，完整 Folia 页面已成功挂载，并确认五个 MusicFree provider 注册到 Omni。开发示例入口默认展示曲库首页；加 `musicfree-search=1` 可打开小秋音乐的“晴天”搜索结果（30 条），点击首条触发 Folia 实际播放约 269.7 秒音频。歌词的整页视觉展示仍需单独验证。

协议依据：[MusicFree 插件协议](https://musicfree.catcat.work/plugin/protocol.html)、[媒体类型](https://musicfree.catcat.work/plugin/basic-type.html)、[内置 npm 包](https://musicfree.catcat.work/plugin/internal-pkgs.html)。

首页与收藏补充验证：小秋、小芸推荐歌单及小枸排行榜均返回 35 张卡片，首张集合能取得 10 首歌曲并继续分页。浏览器验证小秋首页含推荐卡片与“我喜欢”，收藏《你的》后刷新仍能读取。小蜜上游推荐接口返回结构错误，保留本地收藏入口。

## Vercel

仓库构建会安装网关运行依赖并编译 `api-ts/musicfree.ts`，Node Function 由 `vercel.json` 将 `/api/musicfree/*` 转发到该入口。worker 与依赖显式包含在函数产物中，网关环境文件不进入产物。

项目使用 Node.js 24，Build Command 为 `npm run build`，Output Directory 为 `dist`。配置以下项目环境变量后再构建：

- `VITE_MUSICFREE_API_BASE=/api/musicfree`
- `MUSICFREE_SOURCES=https://fastly.jsdelivr.net/gh/Huibq/keep-alive/Music_Free/myPlugins.json`
- `MUSICFREE_ITEM_SECRET`：生成一个固定随机值，并作为加密环境变量保存。所有实例必须使用同一值，收藏与媒体票据才能跨实例验证。

收藏仍保存在当前浏览器；这一版没有接入 Clerk 或跨设备同步。生产构建与编译后的 HTTP 入口已在本地验证，实际 Vercel 发布与线上验证仍需要目标团队的部署权限。

### 播放接口 502 排查

`POST /api/musicfree/providers/<provider>/audio` 返回 502 表示网关或插件调用失败，不能据此认定歌曲已下架。前端会显示播放失败，并保留队列供重试；插件 worker 超时或退出后，下一次请求会重建 worker，不会在同一实例里持续复用失效进程。失败的那次调用不会自动重放。

Vercel 函数日志中的 `[MusicFree] request failed` 记录 `providerId`、`operation`、错误码和上游 HTTP 状态，不记录歌曲原始字段、密钥或完整上游 URL。`ERR_MUSICFREE_TIMEOUT` / `ERR_MUSICFREE_WORKER_STOPPED` 指向 worker 故障；`ERR_BAD_REQUEST` / `ERR_BAD_RESPONSE` 配合 `upstreamStatus` 可识别上游拒绝或服务异常。浏览器 Network 的 Response 仍保留网关返回的错误文字。

Huibq 列表中的 `musicfree.c997421dc59d58c22d09` 是小芸音乐，其 0.3.0 插件从 `lxmusicapi.onrender.com` 取播放地址；搜索与播放使用不同上游，所以能搜索不代表能取得音频。Vercel 请求摘要的 `No outgoing requests` 本身不能定位 worker 内的失败原因，应结合函数日志和响应正文。若缺少固定 `MUSICFREE_ITEM_SECRET`，跨实例签名失败返回的是 403，需要设置固定密钥并重新搜索，而不是把它当作上游 502。

### MusicFreePluginsHub 聚合订阅

可将服务端 `MUSICFREE_SOURCES` 设置为 `https://musicfreepluginshub.2020818.xyz/plugins.json`；Vercel 前端继续使用 `VITE_MUSICFREE_API_BASE=/api/musicfree`，并保留固定的 `MUSICFREE_ITEM_SECRET`。修改环境变量和网关代码后需要重新部署。

网关按需加载各插件的依赖，避免大型列表在每个 worker 中重复加载全部依赖。支持插件全局和方法参数中的 `env.getUserVariables()`（未配置时返回空对象）、`atob` / `btoa`，推荐歌单使用插件实际提供的标签。需要私人 Navidrome、WebDAV 账号或 API 密钥的插件不因这些兼容接口而自动获得凭据。

聚合冷启动最多同时初始化两个 worker，所需依赖通过异步 `import()` 在 VM 执行期限之前预载。这样兼容 Vercel 禁用 `require(ESM)` 的运行环境，也避免并行加载依赖占满脚本的 3 秒期限。封面和音频使用与插件一致的 Axios HTTP(S) 流式传输，保留 Range 和请求头、支持代理，并在解压后移除失效的压缩内容长度。推荐歌单接口失败时仍保留该插件可用的榜单；两条读取都失败时仍报告错误。

修正后，用真实订阅运行 Folia 的 Bravais 主页验证：29 个 MusicFree 条目注册成功，菜单另含 3 个内置平台，共 32 行；网易音乐展示 35 张推荐卡和“我喜欢”，14 次封面请求返回 200，抽查的 5 张封面在浏览器中解码成功。没有推荐方法的插件只展示浏览器收藏，不虚构推荐。菜单旁的文字圆圈是平台默认徽标，不是歌单封面。两个网易云电台条目来自订阅内的两个 CDN 地址。

2026-10-12 实测：订阅含 34 个条目，29 个插件可加载，5 个 `music.haitangw.net` 下载地址失败。相同列表的进程 RSS 从约 1.3 GB 降至约 730 MB。`W音乐` 修复了 `env is not defined`，搜索和歌词可用，但所测歌曲的播放结果不是有效 URL。5sing 样本能取得 HTTP 206、`audio/mpeg` 音频及歌词；部分其他插件仍有上游 503/412、页面解析失败或无音频地址。猫耳样本返回 HLS 播放列表，不等同于 Folia 浏览器音频已验证可播放。聚合订阅中的小芸、小秋等仍引用已暂停的 Render 音频服务，因此更换订阅地址不会自动修复这些插件。

2026-10-13 继续验证 `musicfree.52a08ed9d22b00e59a5c`（网易音乐）：线上《夜曲》取音频返回 502 `Invalid URL`。本地追踪同一插件发现网易 `/api/song/enhance/player/url/v1` 返回歌曲条目 `code: 404`、无 URL，插件转到酷我 `http://nmobi.kuwo.cn/mobi.s`；后者 HTTP 200，但 `data.url` 为字符串 `"None"`。《晴天》《孤勇者》《稻香》的搜索首条样本也返回该占位值；《起风了》的 standard/high 样本在生产网关均取得 HTTP 206、64 KiB 的 `audio/mpeg` 数据。结果随歌曲而变，不代表所有歌曲都可播放。网关对非 HTTP(S) 音频地址返回带 `code: "invalid-response"` 的 424（依赖失败）和明确提示，保留可重试错误，不伪装为歌曲下架，也不向客户端暴露原始地址；同一 worker 的后续有效请求仍可正常签发媒体票据。


自定义域名排障补充：用相同的《夜曲》POST 请求对照，Vercel 原域名返回 JSON 502，而 `music.vachiika.me` 返回 Cloudflare HTML 502，造成前端“响应不是 JSON”的二次错误。网关将无效媒体地址单独返回 HTTP 424，明确的上游 503 保留为 HTTP 503；未知网关故障仍返回 502。浏览器只对非 JSON 的 502/503/504 自动重试一次，两次请求共用原有 45 秒期限；插件返回的 JSON 错误不重试。非 JSON 失败保留实际 HTTP 状态，便于区分代理故障与音源无效。直接打开只支持 POST 的接口会得到 HTTP 405 和 `Allow: POST, OPTIONS`，而不是误导性的“未知接口”。这些改动不使上游缺失的音频恢复。

### Nairocy 订阅实测与切换

订阅 `https://music.nairocy.com/plugins.json` 在修正兼容性后加载 24 个插件，13 个独立脚本仍失败（下载 403/451、超时，以及两份 Thomas 脚本的重复变量语法错误）。远程脚本下载使用与媒体代理相同的 Axios 流式传输，保留 TLS 校验、12 秒期限及解压后 4 MiB 限额。使用计算表达式调用 `require()` 的插件预载允许的依赖，仍拒绝 allowlist 外的包。

无需个人账号的实际浏览器验证：酷我（念心音源）《晴天》播放时长约 269.75 秒，播放时间推进、跳转到 45 秒均成功，歌曲封面解码为 1080×1080；推荐接口返回 6 张卡，抽查 3 张推荐封面均解码成功，推荐集合能读取歌曲。5sing 样本也通过播放和跳转，时长约 261.51 秒。GD音乐台取得可解码 MP3，但后续浏览器搜索失败，不能据此认定持续可用。该列表中的网易音乐仍返回无效地址；碳酸氢钠样本地址返回 HTML，不计为可播放。测试样本不保证整个曲库的成功率。

切换生产部署：在 Vercel 项目的 Production 环境变量中将 `MUSICFREE_SOURCES` 改为 `https://music.nairocy.com/plugins.json`，然后重新部署。保持前端 `VITE_MUSICFREE_API_BASE=/api/musicfree`，选择“酷我（念心音源）”进行播放验证。订阅仅换列表，不会自动修复列表中的失效插件；新的脚本 URL 会生成新的 provider ID，旧队列仍指向原音源，需要从新源重新搜索歌曲。

### Ciallo 的生产环境诊断

Ciallo 可在本地取得完整音频，但生产 Vercel 上的取音频请求实测约 8.5 秒后失败，搜索正常。插件把 Axios 超时写死为 8 秒，并用“网络请求失败”替换原始异常。宿主仅在取音频操作中将 `https://api.s0o1.com/API/wyy_music` 的期限放宽到 18 秒，仍低于 worker 的 20 秒期限；其他地址与操作保留插件原来的期限。Axios 错误按 RPC 隔离保留状态、错误码与主机名，不记录 URL 参数或凭据。超时使用 JSON 503，附安全诊断字段，避免将已识别的超时变成可被代理替换的 HTML 502。超时适配本身不证明该上游已在生产环境恢复，需继续验证实际播放。

延长期限后的生产诊断确认 `api.s0o1.com` 仍报 `ETIMEDOUT`。Ciallo 的网易专用兼容层因此为主接口保留 6 秒，将传输失败后的请求交给 Z·网易云使用的公开网易代理（9 秒期限）。备用请求保留同一首网易歌曲 ID 和请求音质，不重新搜索、不换成其他平台，不转发网易 Cookie。返回结果须匹配歌曲 ID、来自网易 CDN，时长超过 45 秒，无试听标记，且满足请求音质；不接受 30 秒片段，也不自动降级无损请求。搜索、歌词、推荐与封面继续调用原插件。必须在生产网关验证备用接口可达及实际音频播放，不能用本地完整解码代替生产验证。

备用适配部署后，在 `music.vachiika.me` 搜索 `holdin on` 的首条（网易 ID `26995594`），标准、高音质请求均成功取得音频；从生产媒体代理下载的两份完整文件分别约 5.7 MB、9.5 MB，FFmpeg 均完整解码到 237.381338 秒。完整页面验证同时发现 Bravais 首页搜索仅导航到浮层、未执行查询，并将在线页签归到内置网易；已改为通过共享搜索 store 执行当前选中 provider 的查询，再提交导航。UI 回归覆盖从 Bravais 首页输入、正确插件请求、结果显示、推荐封面及切换音源。
