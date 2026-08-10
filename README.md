# MoeKoeMusic-download-plugin

<a href="https://github.com/snow930/MoeKoeMusic-music-download-plugin/releases/latest"><img src="https://img.shields.io/github/v/release/snow930/MoeKoeMusic-music-download-plugin?style=flat-square" /></a>
<a href="https://github.com/snow930/MoeKoeMusic-music-download-plugin/stargazers"><img src="https://img.shields.io/github/stars/snow930/MoeKoeMusic-music-download-plugin?style=flat-square" /></a>
<a href="https://github.com/snow930/MoeKoeMusic-music-download-plugin/blob/main/LICENSE"><img src="https://img.shields.io/github/license/snow930/MoeKoeMusic-music-download-plugin?style=flat-square" /></a>

**MoeKoeMusic 插件：一键下载当前播放的音乐文件**

> 仅适用于 [MoeKoeMusic](https://github.com/MoeKoeMusic/MoeKoeMusic)（开源酷狗第三方客户端，Electron + Vue）。点击播放栏的下载按钮，即可将当前播放的歌曲以原始音质保存到本地。

## ✨ 功能

- 🔘 播放栏一键下载当前歌曲（与音量、播放列表等控制按钮同级）
- 📊 流式下载 + 实时进度提示（支持无 Content-Length 的分块响应，按已下载字节数显示）
- ⏹ 下载中再次点击按钮可**取消**
- 🎵 自动识别标题/歌手/专辑字段命名差异（兼容 KuGou API 多种字段名）
- 🗂 文件名安全化：非法字符替换、超长文件名截断、扩展名自动识别
- 🔁 页面切换后按钮自动重建（MutationObserver 监听 SPA 路由变化）

## 📦 安装

1. 前往 [Releases](https://github.com/snow930/MoeKoeMusic-music-download-plugin/releases/latest) 下载 `MoeKoeMusic-download-plugin.zip`
2. 打开 MoeKoeMusic：**设置 → 插件 → 安装插件 → 选择 zip 文件**
3. 播放任意歌曲，播放栏出现下载按钮即安装成功

> 要求 MoeKoeMusic **1.6.7+**（见 manifest `minversion`）。

## 🧩 实现原理

1. **读取当前歌曲** — 从 `localStorage['current_song']` 获取 `url`、`title`、`artist` 等字段
2. **注入下载按钮** — 添加到播放器 `.extra-controls` 容器，使用 Font Awesome 下载图标
3. **流式下载** — `fetch`（透传同源 cookie）+ `ReadableStream` 分块读取，实时显示进度
4. **触发保存** — 音频数据转为 Blob URL，通过 `<a download>` 触发浏览器下载

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
cd dist && zip -r ../MoeKoeMusic-download-plugin.zip MoeKoeMusic-download-plugin
```

## 📜 更新日志

- **v1.1.0** — 增加下载取消；增加分块响应进度 fallback；文件名截断；错误分类提示（VIP/404/429）；cookie 透传；权限最小化
- **v1.0.0** — 首个版本：播放栏下载按钮 + 流式下载 + 进度提示

## 📄 许可证

[MIT](LICENSE) © snow930
