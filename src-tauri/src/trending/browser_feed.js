// 在平台自己的网页会话中读取推荐流，保留网站原生的登录和请求签名。
(() => {
  if (window.__geFeed) return;
  const xueqiuHost = host => host === 'xueqiu.com' || host === 'www.xueqiu.com';
  const source = xueqiuHost(location.hostname) ? 'xueqiu'
    : location.hostname === 'www.xiaohongshu.com' ? 'xiaohongshu' : '';
  if (!source) return;
  const id = `${Date.now()}-${Math.random()}`;
  let received = [];
  const text = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const item = (title, url, extra = {}) => ({
    rank: 0, title: text(title).slice(0, 160), url, cover: '', summary: '',
    author: '', hotText: '', hotValue: 0, tag: '', meta: '', ...extra,
  });
  const parse = value => {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return null; }
  };
  function fromResponse(body) {
    const data = parse(body);
    if (!data || data.success === false) return [];
    if (source === 'xueqiu') {
      const list = data.list || data.data?.list || data.statuses || [];
      if (!Array.isArray(list)) return [];
      return list.filter(entry => entry && typeof entry === 'object').map(entry => {
        const post = parse(entry.original_status) || entry;
        const user = post.user || {};
        const path = post.target_url || post.target || (user.id && post.id ? `/${user.id}/${post.id}` : '');
        if (!path) return null;
        let url;
        try { url = new URL(path, 'https://xueqiu.com').href; } catch { return null; }
        return item(post.title || post.description || post.text, url, {
          summary: text(post.description || post.text || post.excerpt).slice(0, 180),
          author: text(user.screen_name),
          hotText: post.reply_count ? `${post.reply_count} 回复` : '',
        });
      }).filter(Boolean);
    }
    const list = data.data?.items;
    if (!Array.isArray(list)) return [];
    return list.filter(entry => entry && typeof entry === 'object').map(entry => {
      const note = entry.note_card;
      const noteId = entry.id || note?.note_id;
      if (!note || !noteId) return null;
      const url = new URL(`/explore/${encodeURIComponent(noteId)}`, 'https://www.xiaohongshu.com');
      if (entry.xsec_token) {
        url.searchParams.set('xsec_token', entry.xsec_token);
        url.searchParams.set('xsec_source', 'pc_feed');
      }
      return item(note.display_title || note.title || note.desc, url.href, {
        cover: String(note.cover?.url_default || note.cover?.url || '').replace(/^http:/, 'https:'),
        author: text(note.user?.nickname),
        hotText: note.interact_info?.liked_count ? `${note.interact_info.liked_count} 赞` : '',
      });
    }).filter(Boolean);
  }
  function matchesUrl(url) {
    try {
      const u = new URL(url, location.href);
      return source === 'xueqiu'
        ? xueqiuHost(u.hostname) && /^\/statuses\/(hot\/listV2|public_timeline_by_category|recommend|friends_timeline)\.json$/.test(u.pathname)
        : u.hostname === 'edith.xiaohongshu.com' && u.pathname === '/api/sns/web/v1/homefeed';
    } catch { return false; }
  }
  function accept(url, body) {
    try {
      if (!matchesUrl(url)) return;
      const items = fromResponse(body);
      if (items.length) received = items.slice(0, 50);
    } catch { /* 网站的非 JSON 响应不算成功 */ }
  }
  const originalFetch = window.fetch;
  window.fetch = function(input) {
    const pending = originalFetch.apply(this, arguments);
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    if (matchesUrl(url)) pending.then(response => response.clone().text().then(body => accept(url, body))).catch(() => {});
    return pending;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__geFeedUrl = String(url);
    return originalOpen.apply(this, arguments);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', () => {
      try { accept(this.__geFeedUrl, this.responseType === 'json' ? this.response : this.responseText); } catch {}
    });
    return originalSend.apply(this, arguments);
  };
  function fromDom() {
    const nodes = document.querySelectorAll(source === 'xueqiu'
      ? 'article, .timeline__item, .status-item' : 'section.note-item');
    return Array.from(nodes).map(node => {
      const anchor = node.querySelector(source === 'xueqiu'
        ? 'a[href*="/statuses/"], a.timeline__item__title, a[href]' : 'a.cover[href], a[href*="/explore/"]');
      // 雪球卡片中的作者链接不是帖子，单独按帖子地址筛选。
      const postLink = source === 'xueqiu' ? Array.from(node.querySelectorAll('a[href]')).find(a => {
        try { return /^\/\d+\/\d+$/.test(new URL(a.href).pathname); } catch { return false; }
      }) : anchor;
      if (!postLink) return null;
      const titleNode = node.querySelector(source === 'xueqiu'
        ? '.timeline__item__title, .content, .timeline__item__content' : '.title');
      const title = titleNode?.textContent || (source === 'xueqiu' ? postLink.textContent : '');
      return item(title, postLink.href, {
        author: text(node.querySelector(source === 'xueqiu' ? '.user-name' : '.author .name, .author-wrapper .name')?.textContent),
        cover: source === 'xiaohongshu' ? (node.querySelector('a.cover img')?.src || '') : '',
      });
    }).filter(Boolean);
  }
  window.__geFeed = { read() {
    const all = received.length ? received : fromDom();
    const seen = new Set();
    const items = all.filter(entry => {
      if (!entry.title || seen.has(entry.url)) return false;
      seen.add(entry.url); return true;
    }).slice(0, 30);
    return { id, pageUrl: location.href, items };
  } };
})();
