(function () {
  'use strict';

  if (window.__MOEKOE_DOWNLOAD__) return;
  window.__MOEKOE_DOWNLOAD__ = true;

  // 与 manifest.json 的 version 保持同步（content script 无法读取 manifest）
  var PLUGIN_VERSION = '1.1.2';
  var VERSION_KEY = 'moekoe_download_plugin_version';

  var toastTimer = null;
  var isDownloading = false;
  var cancelRequested = false;

  function getCurrentSong() {
    try {
      return JSON.parse(localStorage.getItem('current_song') || '{}');
    } catch (e) {
      return {};
    }
  }

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  }

  // Windows 路径名最长约 255 字符，截断到 180 并保留扩展名
  function truncateFilename(filename) {
    var MAX = 180;
    if (filename.length <= MAX) return filename;
    var extIndex = filename.lastIndexOf('.');
    var ext = extIndex > 0 ? filename.slice(extIndex) : '';
    return filename.slice(0, MAX - ext.length) + ext;
  }

  function getFileExtension(url) {
    try {
      var path = url.split('?')[0].split('#')[0];
      var ext = path.split('.').pop().toLowerCase();
      if (ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) return ext;
    } catch (e) {}
    return 'mp3';
  }

  // cancelAction 存在时在 toast 内嵌"取消"按钮
  function showToast(msg, duration, cancelAction) {
    duration = duration || 2500;
    var toast = document.querySelector('.moekoe-download-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'moekoe-download-toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = msg;
    toast.appendChild(span);
    if (cancelAction) {
      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'moekoe-download-cancel';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', cancelAction);
      toast.appendChild(cancelBtn);
    }
    toast.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    if (duration === 0) return; // 0 = 常驻显示
    toastTimer = setTimeout(function () {
      toast.style.opacity = '0';
    }, duration);
  }

  function formatSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + 'GB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MB';
    return (bytes / 1024).toFixed(0) + 'KB';
  }

  function describeError(err, response) {
    if (response) {
      if (response.status === 403 || response.status === 401) {
        return '访问被拒绝（' + response.status + '），可能是 VIP/版权歌曲或音频链接已过期';
      }
      if (response.status === 404) return '音频资源不存在（404），链接可能已过期';
      if (response.status === 429) return '请求过于频繁（429），请稍后再试';
      return 'HTTP ' + response.status;
    }
    if (cancelRequested) return '已取消下载';
    return err && err.message ? err.message : '未知错误';
  }

  function setButtonIcon(btn, iconClass) {
    var i = btn.querySelector('i');
    if (i) i.className = iconClass;
  }

  async function downloadCurrentSong(btn) {
    if (isDownloading) {
      // 下载中再次点击 = 取消
      cancelRequested = true;
      showToast('正在取消…');
      return;
    }
    isDownloading = true;
    cancelRequested = false;
    btn.classList.add('downloading');
    btn.title = '点击取消下载';
    setButtonIcon(btn, 'fa fa-times'); // 下载中图标变为 ✕，提示可取消

    var song = getCurrentSong();
    if (!song.url) {
      showToast('暂无音频 URL，请先播放歌曲');
      resetButton(btn);
      return;
    }

    var title = song.title || song.name || song.songName || song.songname || song.filename || '未知歌曲';
    var artist = song.artist || song.singer || song.author || song.singername || song.singerName || song.author_name || '';
    var ext = getFileExtension(song.url);
    var filename = truncateFilename(sanitizeFilename(artist ? artist + ' - ' + title : title) + '.' + ext);

    showToast('正在下载: ' + filename, 0);

    try {
      // credentials: 'include' 透传同源 cookie；Referer/User-Agent 属浏览器
      // forbidden header，content script 无法自定义。若音频 URL 有防盗链，
      // 请改用主项目插件 API，或向 MoeKoeMusic 作者反馈开放下载接口。
      var response = await fetch(song.url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(describeError(null, response));
      }

      var contentLength = response.headers.get('Content-Length');
      var total = contentLength ? parseInt(contentLength, 10) : 0;
      var loaded = 0;
      var lastPct = -1;
      var lastSize = '';

      var reader = response.body.getReader();
      var chunks = [];

      while (true) {
        if (cancelRequested) {
          await reader.cancel();
          throw new Error('已取消下载');
        }
        var result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
        loaded += result.value.length;
        if (total > 0) {
          var pct = Math.round(loaded / total * 100);
          if (pct !== lastPct) { // 百分比变化才重建 toast，避免高频 DOM 操作
            lastPct = pct;
            showToast('下载中: ' + filename + ' (' + pct + '%)', 0, function () { cancelRequested = true; });
          }
        } else {
          // 分块传输无 Content-Length 时，按已下载字节数显示进度
          var sizeNow = formatSize(loaded);
          if (sizeNow !== lastSize) {
            lastSize = sizeNow;
            showToast('下载中: ' + filename + ' (' + sizeNow + ')', 0, function () { cancelRequested = true; });
          }
        }
      }

      var blob = new Blob(chunks);
      var blobUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);

      showToast('下载完成: ' + filename + ' (' + formatSize(blob.size) + ')');
    } catch (err) {
      console.error('[Download] 下载失败:', err);
      showToast('下载' + (cancelRequested ? '已取消' : '失败') + ': ' + describeError(err));
    } finally {
      resetButton(btn);
    }
  }

  function resetButton(btn) {
    btn.classList.remove('downloading');
    btn.title = '下载当前歌曲';
    setButtonIcon(btn, 'fa fa-download');
    isDownloading = false;
    cancelRequested = false;
  }

  function createDownloadButton() {
    var extraControls = document.querySelector('.extra-controls');
    if (!extraControls) return;

    if (document.querySelector('.moekoe-download')) return;

    var btn = document.createElement('div');
    btn.className = 'extra-btn moekoe-download';
    btn.title = '下载当前歌曲';
    btn.innerHTML = '<i class="fa fa-download" aria-hidden="true"></i>';
    btn.addEventListener('click', function () {
      downloadCurrentSong(btn);
    });

    extraControls.appendChild(btn);
  }

  // 插件更新自检：版本变化时提醒用户刷新/重启，否则运行中的仍是旧版代码
  function checkPluginVersion() {
    try {
      var saved = localStorage.getItem(VERSION_KEY);
      if (saved !== PLUGIN_VERSION) {
        showToast('插件已更新到 v' + PLUGIN_VERSION + '，请刷新页面（Ctrl+R）或重启播放器后生效', 6000);
        localStorage.setItem(VERSION_KEY, PLUGIN_VERSION);
      }
    } catch (e) {
      console.warn('[Download] 版本自检失败:', e);
    }
  }

  function init() {
    createDownloadButton();
    checkPluginVersion();

    // MoeKoeMusic 为 SPA，路由切换会重建播放器 DOM，因此需要 subtree 监听
    // 以保证按钮不丢失（回调仅在按钮缺失时重建，开销可控）。
    var observer = new MutationObserver(function () {
      var extraControls = document.querySelector('.extra-controls');
      if (extraControls && !document.querySelector('.moekoe-download')) {
        createDownloadButton();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
