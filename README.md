# MoeKoeMusic-download-plugin

<a href="https://github.com/snow930/MoeKoeMusic-music-download-plugin/releases/latest"><img src="https://img.shields.io/github/v/release/snow930/MoeKoeMusic-music-download-plugin?style=flat-square" /></a>
<a href="https://github.com/snow930/MoeKoeMusic-music-download-plugin/stargazers"><img src="https://img.shields.io/github/stars/snow930/MoeKoeMusic-music-download-plugin?style=flat-square" /></a>
<a href="https://github.com/snow930/MoeKoeMusic-music-download-plugin/blob/main/LICENSE"><img src="https://img.shields.io/github/license/snow930/MoeKoeMusic-music-download-plugin?style=flat-square" /></a>

**MoeKoeMusic 插件：一键下载当前播放的音乐文件**

> 仅适用于 [MoeKoeMusic](https://github.com/MoeKoeMusic/MoeKoeMusic)（开源酷狗第三方客户端，Electron + Vue）。点击播放栏的下载按钮，即可将当前播放的歌曲以原始音质保存到本地。

## ✨ 功能

- 🔘 播放栏一键下载当前歌曲（与音量、播放列表等控制按钮同级）
- 🎚 **音质选择**：面板列出该曲全部可用音质（标准/高品/FLAC/Hi-Res/全景声/超清/母带），记住上次选择
- 📝 **歌词下载**：同步保存 `.lrc` 歌词（与音频同名）
- 🖼 **封面下载**：同步保存封面图（与音频同名）
- 📊 流式下载 + 实时进度提示（支持无 Content-Length 的分块响应，按已下载字节数显示）
- ⏹ 下载中再次点击按钮可**取消**
- 🗂 多文件顺序下载，单个失败不中断其余文件，结束汇总成功/失败数
- 🎵 自动识别标题/歌手/专辑字段命名差异（兼容 KuGou API 多种字段名）
- 🗂 文件名安全化：非法字符替换、超长文件名截断、扩展名自动识别
- 🔁 页面切换后按钮自动重建（MutationObserver 监听 SPA 路由变化）

## 📦 安装

1. 前往 [Releases](https://github.com/snow930/MoeKoeMusic-music-download-plugin/releases/latest) 下载 `MoeKoeMusic-download-plugin.zip`
2. 打开 MoeKoeMusic：**设置 → 插件 → 安装插件 → 选择 zip 文件**
3. 播放任意歌曲，播放栏出现下载按钮即安装成功

> 要求 MoeKoeMusic **1.6.7+**（见 manifest `minversion`）。

> ⚠️ **更新插件后请刷新播放器页面（`Ctrl+R`）或重启应用**，否则运行中的仍是旧版代码（content script 仅页面加载时注入一次）。插件更新后首次打开播放器也会出现对应提示。

## 🧩 实现原理

1. **读取当前歌曲** — 从 `localStorage['current_song']` 获取 `hash`、`qualityOptions`（可用音质表）、`img`、`title`、`artist` 等字段
2. **注入下载按钮与音质面板** — 按钮添加到播放器 `.extra-controls` 容器；点击弹出音质面板，视觉对齐主项目 `.player-menu` 弹层（CSS 变量取色，明暗主题自动适配）
3. **获取音频直链** — 优先复用 `qualityOptions`；已登录经本地 API server（KuGouMusicApi lite，默认 `http://127.0.0.1:6521`）调 `/song/url?hash=&quality=&ppage_id=` 取对应音质直链，未登录降级 `free_part=1` 试听；请求携带与主项目 `request.js` 同格式的 `Authorization` 头（读取 `localStorage['MoeData']`）
4. **歌词/封面** — 歌词走 `/search/lyric?hash=` → `/lyric?fmt=lrc&decode=true` 两步接口拿 LRC 文本；封面直接使用 `current_song.img`
5. **流式下载** — `fetch`（透传同源 cookie）+ `ReadableStream` 分块读取，实时显示进度
6. **触发保存** — 文件数据转为 Blob URL，通过 `<a download>` 触发浏览器下载

## ⚠️ 已知限制

- **防盗链**：浏览器禁止 content script 自定义 `Referer`/`User-Agent`（forbidden header）。若酷狗音频 URL 校验这些头，直连可能返回 403/401，本插件会给出"可能是 VIP/版权歌曲或链接已过期"提示。若你的账号遇到此问题，建议向 MoeKoeMusic 作者反馈开放官方下载接口。
- **依赖内部存储**：插件读取 `localStorage['current_song']` 属于主项目内部实现，主项目版本升级可能调整该字段，插件会做多字段兼容兜底；如失效请提交 issue。
- **版权**：本插件用于下载**你已有播放/下载权限**的内容（个人备份、已购曲目等）。请勿用于传播侵权文件，使用者需自行承担相关责任。

## ❓ FAQ

**Q：点下载没反应？**
先确认已播放一首歌曲（播放栏出现后按钮才可用）；若提示"暂无音频 URL"说明 `current_song` 尚未写入。

**Q：下载失败提示 403/401？**
见上文"已知限制·防盗链"。也可能是该歌曲为 VIP 独占且当前账号无权限。

**Q：下载的文件名乱码或过长？**
文件名已做非法字符替换与 180 字符截断；异常命名请提交 issue 附上歌曲信息。

## 🔧 开发与自构建

```bash
# 源码结构
manifest.json   # 插件清单（MV3 兼容）
content.js      # 下载逻辑
styles.css      # 按钮与提示样式

# 手动打包（发布 zip 由 GitHub Actions 在打 tag 时自动生成）
mkdir -p dist/MoeKoeMusic-download-plugin
cp manifest.json content.js styles.css dist/MoeKoeMusic-download-plugin/
cp -r icons dist/MoeKoeMusic-download-plugin/
cd dist && zip -r ../MoeKoeMusic-download-plugin.zip MoeKoeMusic-download-plugin
```

## 📜 更新日志

- **v1.2.1** — 修复歌词下载失败（`/search/lyric`、`/lyric` 响应字段路径错误）与缺失的 toast 函数定义；修复选择音质后实际下载的仍是当前播放音质的问题（`/song/url` 响应字段路径错误，现按所选音质取直链）；音质项支持再次点击取消选择，可仅下载歌词/封面；音质、歌词、封面全不选时提示至少选择一项
- **v1.2.0** — 新增音质选择面板：列出该曲实际可用音质并显示真实文件大小（缺失时按时长×码率估算并带 ≈），记住上次选择；新增歌词同步下载（.lrc）；新增封面同步下载；多文件顺序下载、单个失败不中断并汇总结果；新增可视化下载进度卡片（进度条 / 百分比 / 实时速度 / 取消）；本地 API 请求 15s 超时保护；扩展名改用 API 返回的 extName；面板 UI 对齐主项目弹层风格并适配明暗主题
- **v1.1.3** — 新增插件图标：粉→蓝紫渐变圆角方形 + 白色下载箭头（icons/ 16/48/128，MV3 icons 字段），插件列表不再显示空白
- **v1.1.2** — 增加插件更新自检：检测到版本更新时提示"请刷新页面或重启播放器后生效"；README/Release 同步注明更新后需刷新或重启
- **v1.1.1** — 取消入口更明显：下载中按钮图标变为 ✕（红色）且提示"点击取消"，进度提示内嵌"取消"按钮；修复 `.downloading`/toast 的 `pointer-events:none` 导致点击取消被阻断的问题
- **v1.1.0** — 增加下载取消；增加分块响应进度 fallback；文件名截断；错误分类提示（VIP/404/429）；cookie 透传；权限最小化
- **v1.0.0** — 首个版本：播放栏下载按钮 + 流式下载 + 进度提示

## 📄 许可证

[MIT](LICENSE) © snow930
