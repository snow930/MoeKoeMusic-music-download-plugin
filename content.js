(function () {
  'use strict';

  if (window.__MOEKOE_DOWNLOAD__) return;
  window.__MOEKOE_DOWNLOAD__ = true;

  // 与 manifest.json 的 version 保持同步（content script 无法读取 manifest）
  var PLUGIN_VERSION = '1.2.0';
  var VERSION_KEY = 'moekoe_download_plugin_version';
  var PREFS_KEY = 'moekoe_download_prefs';

  // 与主项目 OnlineMusicQueue.js 的 QUALITY_LABELS 保持一致（仅作兜底映射，
  // 正常情况直接使用 current_song.qualityOptions 自带的 label）
  var QUALITY_LABELS = {
    '128': '标准',
    '320': '高品',
    flac: 'FLAC',
    high: 'Hi-Res',
    viper_atmos: '全景声',
    viper_clear: '超清',
    viper_tape: '母带'
  };

  // 各档位标称码率（kbps），仅在拿不到真实 filesize 时用于估算大小（显示带 ≈）。
  // 无损类实际码率随曲目波动较大，估算值仅供参考。
  var EST_BITRATE_KBPS = {
    '128': 128,
    '320': 320,
    flac: 1000,
    high: 2000,
    viper_atmos: 1500,
    viper_clear: 2000,
    viper_tape: 3000
  };

  var toastTimer = null;
  var isDownloading = false;
  var cancelRequested = false;
  var panelEl = null;

  // ==================== 偏好持久化 ====================

  function loadPrefs() {
    try {
      var prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      return {
        quality: typeof prefs.quality === 'string' ? prefs.quality : null,
        lyrics: prefs.lyrics !== false,
        cover: prefs.cover !== false
      };
    } catch (e) {
      return { quality: null, lyrics: true, cover: true };
    }
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {}
  }

  // ==================== 数据读取 ====================

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

  // 清洗 API 返回的 extName（如 mp3/flac），非法值返回空串交由调用方兜底
  function cleanExt(ext) {
    if (typeof ext === 'string' && /^[a-z0-9]{1,5}$/i.test(ext)) return ext.toLowerCase();
    return '';
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
      if (response.status === 404) return '资源不存在（404），链接可能已过期';
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

  // ==================== 本地 API 封装 ====================
  // 主项目渲染层直接 HTTP 调用本地 API server（KuGouMusicApi lite，默认
  // http://127.0.0.1:6521），页面 webSecurity:false 无 CORS/CSP 限制，
  // content script 可直接 fetch，无需经 IPC。

  function getApiBase() {
    try {
      var settings = JSON.parse(localStorage.getItem('settings') || '{}');
      if (settings && settings.apiBaseUrl) return String(settings.apiBaseUrl);
    } catch (e) {}
    return 'http://127.0.0.1:6521';
  }

  // 复刻主项目 request.js 拦截器的 Authorization 头拼法（分号分隔的 k=v 串）。
  // 登录信息存于 localStorage['MoeData']（Pinia persist，paths: UserInfo/Config/Device）。
  function buildAuth() {
    try {
      var moe = JSON.parse(localStorage.getItem('MoeData') || '{}');
      var u = moe.UserInfo || {};
      var d = moe.Device || {};
      var parts = [];
      if (u.token) parts.push('token=' + u.token);
      if (u.userid) parts.push('userid=' + u.userid);
      if (d.dfid) parts.push('dfid=' + d.dfid);
      if (u.t1) parts.push('t1=' + u.t1);
      if (d.mid) parts.push('KUGOU_API_MID=' + d.mid);
      if (d.guid) parts.push('KUGOU_API_GUID=' + d.guid);
      if (d.serverDev) parts.push('KUGOU_API_DEV=' + d.serverDev);
      if (d.mac) parts.push('KUGOU_API_MAC=' + d.mac);
      var header = parts.join(';');
      return { header: header, loggedIn: header.indexOf('token=') >= 0 };
    } catch (e) {
      return { header: '', loggedIn: false };
    }
  }

  function apiGet(path, params) {
    var qs = Object.keys(params || {})
      .filter(function (k) {
        var v = params[k];
        return v !== undefined && v !== null && v !== '';
      })
      .map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      })
      .join('&');
    var headers = {};
    var auth = buildAuth().header;
    if (auth) headers['Authorization'] = auth;
    // 15s 超时：本地 API 正常应答在毫秒级，挂起说明 server 异常，
    // 不能让整个下载流程静默卡死
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    return fetch(getApiBase() + path + (qs ? '?' + qs : ''), {
      credentials: 'include',
      headers: headers,
      signal: controller.signal
    }).then(function (resp) {
      clearTimeout(timer);
      if (!resp.ok) throw new Error(describeError(null, resp));
      return resp.json();
    }).catch(function (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error('本地 API 请求超时（15s），请检查播放器 API 服务');
      throw e;
    });
  }

  // 该曲音质候选：统一走 /privilege/lite（与主项目 addSongToQueue 同款流程），
  // 每个变体的 info 子对象带真实 filesize/bitrate/duration/extname；
  // 接口失败时回退播放器解析好的 qualityOptions（无大小信息）。
  // 返回 { available: [候选], fromLite: 是否来自 privilege 接口 }
  async function getQualityCandidates(song) {
    if (song.hash) {
      try {
        var res = await apiGet('/privilege/lite', { hash: song.hash });
        var seen = {};
        var out = [];
        var items = (res && res.data) || [];
        items.forEach(function (item) {
          var variants = [item].concat(Array.isArray(item && item.relate_goods) ? item.relate_goods : []);
          variants.forEach(function (v) {
            if (!v || !v.hash || v.level === 0) return;
            if (!QUALITY_LABELS.hasOwnProperty(v.quality)) return;
            if (seen[v.quality]) return;
            seen[v.quality] = true;
            var info = v.info || {};
            out.push({
              value: v.quality,
              hash: v.hash,
              label: QUALITY_LABELS[v.quality],
              filesize: typeof info.filesize === 'number' && info.filesize > 0 ? info.filesize : null,
              duration: typeof info.duration === 'number' && info.duration > 0 ? info.duration : null,
              extname: cleanExt(info.extname)
            });
          });
        });
        var order = Object.keys(QUALITY_LABELS);
        out.sort(function (a, b) { return order.indexOf(b.value) - order.indexOf(a.value); });
        if (out.length) return { available: out, fromLite: true };
      } catch (e) {
        console.warn('[Download] /privilege/lite 失败，回退 qualityOptions:', e);
      }
    }
    if (Array.isArray(song.qualityOptions) && song.qualityOptions.length) {
      return {
        available: song.qualityOptions.map(function (o) {
          return {
            value: o.value,
            hash: o.hash || song.playHash || song.hash,
            label: o.label || QUALITY_LABELS[o.value] || o.value,
            filesize: null,
            duration: null,
            extname: ''
          };
        }).filter(function (o) { return o.value && o.hash; }),
        fromLite: false
      };
    }
    return { available: [], fromLite: false };
  }

  // 音质项右侧的大小文案：真实 filesize 优先；缺失时按时长×标称码率估算（带 ≈）
  function formatQualitySize(cand, song) {
    var bytes = cand.filesize;
    var approx = false;
    if (!bytes) {
      var seconds = cand.duration || song.timeLength;
      var kbps = EST_BITRATE_KBPS[cand.value];
      if (seconds && kbps) {
        bytes = Math.round(seconds * kbps * 1000 / 8);
        approx = true;
      }
    }
    if (!bytes) return '';
    return (approx ? '≈' : '') + formatSize(bytes);
  }

  // 取音频直链：已登录按候选音质取（失败明确报错，不静默降级音质）；
  // 未登录降级试听（free_part:1）。
  async function resolveAudio(song, cand) {
    var auth = buildAuth();
    if (auth.loggedIn && cand) {
      var r = await apiGet('/song/url', {
        hash: cand.hash,
        quality: cand.value,
        ppage_id: '356753938'
      });
      var d = r && r.data;
      if (d && Array.isArray(d.url) && d.url[0]) {
        return { url: d.url[0], ext: cleanExt(d.extName) };
      }
      throw new Error('该音质获取失败，可能无权限（VIP/版权限制）');
    }
    var r2 = await apiGet('/song/url', { hash: song.playHash || song.hash, free_part: 1 });
    var d2 = r2 && r2.data;
    if (d2 && Array.isArray(d2.url) && d2.url[0]) {
      return { url: d2.url[0], ext: cleanExt(d2.extName) };
    }
    throw new Error('未获取到音频链接');
  }

  // 歌词两步接口（与主项目 LyricsHandler.getLyrics 同流程，fmt=lrc 直接拿 LRC 文本）：
  // 1) /search/lyric?hash= → candidates[0] 的 {id, accesskey}
  // 2) /lyric?id=&accesskey=&fmt=lrc&decode=true → data.decodeContent
  async function fetchLyrics(hash) {
    var s = await apiGet('/search/lyric', { hash: hash });
    var cands = s && s.data && s.data.candidates;
    if (!Array.isArray(cands) || !cands.length) return null;
    var c = cands[0];
    var l = await apiGet('/lyric', { id: c.id, accesskey: c.accesskey, fmt: 'lrc', decode: 'true' });
    return (l && l.data && l.data.decodeContent) || null;
  }

  // 封面：current_song.img 即播放器使用的封面图（酷狗 {size} 模板已在主项目替换为 480）
  function getCoverUrl(song) {
    return song.img || '';
  }

  function coverExtension(url) {
    try {
      var m = url.split('?')[0].split('#')[0].match(/\.([a-z0-9]{3,4})$/i);
      if (m) return m[1].toLowerCase();
    } catch (e) {}
    return 'jpg';
  }

  // ==================== 下载层 ====================

  // 流式下载（沿用 v1.1.x 的进度与取消机制），返回 Blob
  async function fetchAsBlob(url, onProgress) {
    // credentials: 'include' 透传同源 cookie；Referer/User-Agent 属浏览器
    // forbidden header，content script 无法自定义。
    var response = await fetch(url, { credentials: 'include' });
    console.log('[Download] fetch 响应:', response.status, url.split('?')[0].slice(0, 90));
    if (!response.ok) {
      throw new Error(describeError(null, response));
    }

    var contentLength = response.headers.get('Content-Length');
    var total = contentLength ? parseInt(contentLength, 10) : 0;
    var loaded = 0;

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
      if (onProgress) onProgress(loaded, total);
    }

    return new Blob(chunks);
  }

  // 进度上报：有 Content-Length 按百分比（变化才重建 toast，避免高频 DOM 操作），
  // 分块传输无 Content-Length 时按已下载字节数显示
  function makeProgressReporter(prefix) {
    var lastPct = -1;
    var lastSize = '';
    return function (loaded, total) {
      if (total > 0) {
        var pct = Math.round((loaded / total) * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          showToast(prefix + ' (' + pct + '%)', 0, function () { cancelRequested = true; });
        }
      } else {
        var sizeNow = formatSize(loaded);
        if (sizeNow !== lastSize) {
          lastSize = sizeNow;
          showToast(prefix + ' (' + sizeNow + ')', 0, function () { cancelRequested = true; });
        }
      }
    };
  }

  // ==================== 进度卡片 ====================
  // 点击下载立即显示的可视化进度卡：文件名 + 进度条 + 百分比/速度，
  // 同时充当流程诊断面板——卡片出现即代表流程已启动。

  var progressCard = null;

  function showProgressCard(name) {
    closeProgressCard();
    var el = document.createElement('div');
    el.className = 'moekoe-download-toast moekoe-progress-toast';
    el.innerHTML =
      '<div class="moekoe-progress-row">' +
        '<span class="moekoe-progress-name"></span>' +
        '<span class="moekoe-progress-stat"></span>' +
        '<button class="moekoe-download-cancel">取消</button>' +
      '</div>' +
      '<div class="moekoe-progress-track"><div class="moekoe-progress-fill"></div></div>';
    el.querySelector('.moekoe-progress-name').textContent = name;
    el.querySelector('.moekoe-download-cancel').addEventListener('click', function () {
      cancelRequested = true;
    });
    document.body.appendChild(el);
    progressCard = {
      el: el,
      name: el.querySelector('.moekoe-progress-name'),
      stat: el.querySelector('.moekoe-progress-stat'),
      fill: el.querySelector('.moekoe-progress-fill'),
      lastTime: 0,
      lastLoaded: 0,
      speedText: ''
    };
    console.log('[Download] 进度卡片已显示:', name);
    return progressCard;
  }

  function setProgressName(name) {
    if (progressCard) progressCard.name.textContent = name;
  }

  // 速度按相邻两次采样差计算（字节差/时间差）
  function updateProgressCard(loaded, total) {
    if (!progressCard) return;
    var now = Date.now();
    if (progressCard.lastTime && now > progressCard.lastTime) {
      var speed = (loaded - progressCard.lastLoaded) / ((now - progressCard.lastTime) / 1000);
      if (speed >= 0) progressCard.speedText = formatSize(speed) + '/s';
    }
    progressCard.lastTime = now;
    progressCard.lastLoaded = loaded;
    var parts = [];
    if (total > 0) {
      var pct = Math.min(100, Math.round((loaded / total) * 100));
      progressCard.fill.style.width = pct + '%';
      parts.push(pct + '%');
      parts.push(formatSize(loaded) + '/' + formatSize(total));
    } else {
      progressCard.fill.classList.add('indeterminate');
      parts.push(formatSize(loaded));
    }
    if (progressCard.speedText) parts.push(progressCard.speedText);
    progressCard.stat.textContent = parts.join(' · ');
  }

  function finishProgressCard(text, ok) {
    if (!progressCard) return;
    progressCard.stat.textContent = text;
    progressCard.fill.classList.remove('indeterminate');
    progressCard.fill.style.width = '100%';
    progressCard.fill.classList.toggle('ok', !!ok);
    progressCard.fill.classList.toggle('err', !ok);
    var card = progressCard;
    setTimeout(function () {
      if (progressCard === card) {
        card.el.remove();
        progressCard = null;
      }
    }, ok ? 2500 : 6000);
  }

  function closeProgressCard() {
    if (progressCard) {
      progressCard.el.remove();
      progressCard = null;
    }
  }

  function saveBlob(blob, filename) {
    var blobUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
    console.log('[Download] saveBlob 已触发浏览器保存:', filename, formatSize(blob.size));
  }

  // 编排一次完整下载：音频 → 歌词 → 封面，单个失败不中断其余文件
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

    console.log('[Download] ===== 下载流程启动 =====');
    closePanel();
    showProgressCard('准备中…');

    var song = getCurrentSong();
    var prefs = loadPrefs();

    try {
      if (!song.hash && !song.url) {
        closeProgressCard();
        showToast('暂无歌曲信息，请先播放歌曲');
        return;
      }

      var title = song.title || song.name || song.songName || song.songname || song.filename || '未知歌曲';
      var artist = song.artist || song.singer || song.author || song.singername || song.singerName || song.author_name || '';
      var baseName = sanitizeFilename(artist ? artist + ' - ' + title : title);

      // ---- 组装任务清单 ----
      var tasks = [];

      // 1) 音频：优先用户记住的音质，其次当前播放音质，最后列表最高音质
      var qualityInfo = await getQualityCandidates(song);
      var cands = qualityInfo.available;
      console.log('[Download] 音质候选:', cands.length, '个 (fromLite=' + qualityInfo.fromLite + ')');
      var chosen = null;
      if (cands.length) {
        chosen = cands.find(function (c) { return c.value === prefs.quality; }) ||
                 cands.find(function (c) { return c.value === song.resolvedQuality; }) ||
                 cands[0];
      }
      tasks.push({
        label: '音频' + (chosen ? ' · ' + chosen.label : ''),
        run: async function () {
          var audio = song.url
            ? { url: song.url, ext: getFileExtension(song.url) }
            : await resolveAudio(song, chosen);
          var filename = truncateFilename(baseName + '.' + (audio.ext || 'mp3'));
          var blob = await fetchAsBlob(audio.url, updateProgressCard);
          saveBlob(blob, filename);
          return formatSize(blob.size);
        }
      });

      // 2) 歌词（.lrc，与音频同名）
      if (prefs.lyrics && song.hash) {
        tasks.push({
          label: '歌词',
          run: async function () {
            var text = await fetchLyrics(song.hash);
            if (!text) throw new Error('未找到歌词');
            saveBlob(
              new Blob([text], { type: 'text/plain;charset=utf-8' }),
              truncateFilename(baseName) + '.lrc'
            );
            return text.split('\n').length + ' 行';
          }
        });
      }

      // 3) 封面（与音频同名）
      if (prefs.cover && song.img) {
        tasks.push({
          label: '封面',
          run: async function () {
            var ext = coverExtension(song.img);
            var filename = truncateFilename(baseName) + '.' + ext;
            var blob = await fetchAsBlob(song.img, null);
            if (!blob.size) throw new Error('封面内容为空');
            saveBlob(blob, filename);
            return formatSize(blob.size);
          }
        });
      }

      // ---- 顺序执行 ----
      var okCount = 0;
      var failCount = 0;
      var failMsgs = [];
      for (var i = 0; i < tasks.length; i++) {
        if (cancelRequested) break;
        setProgressName('(' + (i + 1) + '/' + tasks.length + ') ' + tasks[i].label);
        try {
          var detail = await tasks[i].run();
          okCount++;
          console.log('[Download] ' + tasks[i].label + ' 完成:', detail);
        } catch (err) {
          if (cancelRequested) break;
          failCount++;
          failMsgs.push(tasks[i].label + '：' + describeError(err));
          console.error('[Download] ' + tasks[i].label + ' 失败:', err);
        }
      }

      // ---- 结果汇总（进度卡片展示结果后自动消失）----
      if (cancelRequested) {
        finishProgressCard('已取消', false);
      } else if (failCount === 0) {
        finishProgressCard('下载完成 · ' + okCount + ' 个文件', true);
      } else {
        finishProgressCard('完成 ' + okCount + ' 个，失败 ' + failCount + ' 个', false);
        showToast(failMsgs.join('；'), 6000);
      }
    } catch (err) {
      console.error('[Download] 下载失败:', err);
      finishProgressCard('下载' + (cancelRequested ? '已取消' : '失败') + ': ' + describeError(err), false);
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

  // ==================== 音质面板 UI ====================
  // 视觉对齐主项目 .player-menu/.player-menu-item（PlayerControl.scss）：
  // 白底 + CSS 变量文字/hover/active 色，暗色主题随 html.dark 全局滤镜一致压暗。

  function closePanel() {
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
    document.removeEventListener('click', onDocClick, true);
  }

  function onDocClick(e) {
    if (!panelEl) return;
    if (panelEl.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.moekoe-download')) return;
    closePanel();
  }

  function makeCheckRow(text, key, prefs) {
    var row = document.createElement('div');
    row.className = 'moekoe-panel-item moekoe-panel-check';
    var box = document.createElement('span');
    box.className = 'moekoe-checkbox' + (prefs[key] ? ' checked' : '');
    var label = document.createElement('span');
    label.textContent = text;
    row.appendChild(box);
    row.appendChild(label);
    row.addEventListener('click', function () {
      prefs[key] = !prefs[key];
      box.classList.toggle('checked', prefs[key]);
      savePrefs(prefs);
    });
    return row;
  }

  function renderQualityList(list, cands, song, prefs) {
    list.innerHTML = '';
    if (!cands.length) {
      list.className = 'moekoe-panel-list moekoe-panel-empty';
      list.textContent = '暂无可用音质信息';
      return;
    }
    // 默认选中：用户上次选择 > 当前播放音质 > 列表最高音质
    var selected = null;
    if (prefs.quality && cands.some(function (c) { return c.value === prefs.quality; })) {
      selected = prefs.quality;
    } else if (song.resolvedQuality && cands.some(function (c) { return c.value === song.resolvedQuality; })) {
      selected = song.resolvedQuality;
    } else {
      selected = cands[0].value;
    }
    // 仅列出该曲实际存在的档位（与播放器原生音质菜单一致的集合），
    // 右侧显示文件大小；某档下载时无权限会由 toast 明确报错
    cands.forEach(function (cand) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'moekoe-panel-item' + (cand.value === selected ? ' active' : '');
      var label = document.createElement('span');
      label.className = 'moekoe-quality-label';
      label.textContent = cand.label || QUALITY_LABELS[cand.value] || cand.value;
      item.appendChild(label);
      var size = formatQualitySize(cand, song);
      if (size) {
        var sizeEl = document.createElement('span');
        sizeEl.className = 'moekoe-quality-size';
        sizeEl.textContent = size;
        item.appendChild(sizeEl);
      }
      item.addEventListener('click', function () {
        prefs.quality = cand.value;
        savePrefs(prefs);
        var act = list.querySelector('.moekoe-panel-item.active');
        if (act) act.classList.remove('active');
        item.classList.add('active');
      });
      list.appendChild(item);
    });
  }

  function togglePanel(btn) {
    if (panelEl) {
      closePanel();
      return;
    }
    var song = getCurrentSong();
    if (!song.hash && !song.url) {
      showToast('暂无歌曲信息，请先播放歌曲');
      return;
    }

    var prefs = loadPrefs();
    var panel = document.createElement('div');
    panel.className = 'moekoe-panel';
    // 面板挂在下载按钮内部，必须阻止面板内点击冒泡到按钮，
    // 否则点音质项/勾选行会触发按钮的 togglePanel 把面板关掉
    panel.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    var title = document.createElement('div');
    title.className = 'moekoe-panel-title';
    title.textContent = '选择音质';
    panel.appendChild(title);

    var list = document.createElement('div');
    list.className = 'moekoe-panel-list';
    list.textContent = '读取可用音质…';
    panel.appendChild(list);

    panel.appendChild(makeCheckRow('同时保存歌词 (.lrc)', 'lyrics', prefs));
    panel.appendChild(makeCheckRow('同时保存封面', 'cover', prefs));

    var dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'moekoe-panel-download';
    dl.innerHTML = '<i class="fa fa-download" aria-hidden="true"></i><span>下载</span>';
    dl.addEventListener('click', function () {
      closePanel();
      downloadCurrentSong(btn);
    });
    panel.appendChild(dl);

    btn.appendChild(panel); // 按钮 position:relative，面板绝对定位于其上方
    panelEl = panel;
    // 延迟挂外部点击关闭监听，避免当次点击立即触发关闭
    setTimeout(function () {
      document.addEventListener('click', onDocClick, true);
    }, 0);

    // 异步填充音质列表（/privilege/lite 请求完成后回调；
    // 注意 getQualityCandidates 返回 {available, fromLite} 结构）
    getQualityCandidates(song).then(function (info) {
      if (panelEl !== panel) return; // 面板已被关闭
      renderQualityList(list, info.available, song, prefs);
    });
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
      if (isDownloading) {
        downloadCurrentSong(btn); // 进入取消分支
      } else {
        togglePanel(btn);
      }
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
