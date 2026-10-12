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
