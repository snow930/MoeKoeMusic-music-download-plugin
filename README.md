**一键下载当前播放的音乐文件**

# MoeKoeMusic-download-plugin

本插件用于MoeKoeMusic（一键下载当前播放的音乐文件）

 📂 文件结构

```text
MoeKoeMusic-download-plugin/
├── manifest.json   # 插件清单
├── content.js      # 下载逻辑
└── styles.css      # 按钮样式
```


## 安装方法
在 MoeKoeMusic 中：设置 → 插件 → 安装插件 → 选择 zip 文件。

读取当前歌曲信息 — 从 localStorage['current_song'] 获取歌曲的 url、title、artist 等字段
在播放栏添加下载按钮 — 注入到 .extra-controls（与其他控制按钮同级），使用 Font Awesome 的 fa-download 图标
流式下载 — 通过 fetch + ReadableStream 分块读取音频数据，显示进度百分比
触发浏览器下载 — 将下载的音频数据转为 Blob URL，通过 <a download> 触发下载

关键实现细节
content.js:60-62 — 兼容 KuGou API 多种字段命名 (songName/songname/title, singer/artist/author_name 等)
content.js:68-90 — 使用 response.body.getReader() 流式读取，支持大文件下载并显示进度
content.js:92-99 — 通过 Blob URL 绕过跨域下载限制
content.js:140-146 — MutationObserver 监听 DOM 变化，确保页面切换后按钮不会丢失

