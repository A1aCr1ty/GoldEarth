(function (input) {
  const result = { pageUrl: location.href, pageTitle: document.title, ready: false, status: '', message: '', items: [], candidateIds: [], matchedIds: [] };
  const compact = text => text.toLowerCase().replace(/xiaomi/g, "小米").replace(/redmi/g, "红米").replace(/[^a-z0-9\u3400-\u9fff]/g, '');
  const query = input.keyword.toLowerCase();
  const terms = query.match(/[a-z]+[0-9]*|[0-9]+[a-z]*|[\u3400-\u9fff]+/g) || [];
  const pocket = query.match(/pocket\s*(\d+[a-z]*)/i);
  const seen = new Set();
  const amountPattern = /^(?:[¥￥]\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;
  const cleanAmount = value => {
    const text = String(value ?? '').normalize('NFKC').trim();
    return amountPattern.test(text) ? text : null;
  };
  function matches(title) {
    const normalized = compact(title);
    if (query === 'redmi book 14 2026') {
      if (!/(?:redmi|红米)[\s-]*book[\s-]*14(?![0-9a-z])|(?:redmi|红米)[\s-]*book[\s-]*14(?=2026)/i.test(title)
          || !/(?:^|[^0-9])2026(?![0-9])|book[\s-]*142026(?![0-9])/i.test(title)
          || /book[\s-]*(?:pro|air)|14[\s-]*(?:pro|air)|202[0-5]款|仅主板|屏幕总成|充电器|适配器|键盘膜/i.test(title)) return false;
    } else if (!terms.length || !terms.every(t => normalized.includes(compact(t)))) return false;
    if (pocket && (!/大疆|dji/i.test(title) || !new RegExp('pocket[\\s-]*' + pocket[1] + '\\b(?![\\s-]*axis)', 'i').test(title))) return false;
    if (!/全能|combo/i.test(query) && /全能套装|creator\s*combo/i.test(title)) return false;
    return !/租赁|租金|押金|定金|订金|求购|回收|收购|维修|故障|配件单|仅配件|贴膜|保护套|保护壳|空盒|包装盒|for parts|replacement|not working/i.test(title);
  }
  function add(title, raw, href, condition) {
    if (!matches(title)) return;
    const match = String(raw).replace(/\s+/g, '').match(/^[¥￥]?([0-9][0-9,]*(?:\.[0-9]{1,2})?)$/);
    if (!match) return;
    const price = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0 || price > 10000000) return;
    let url;
    try { url = new URL(href, location.href); } catch (_) { return; }
    const hosts = { suning: ['product.suning.com'], taobao: ['item.taobao.com', 'detail.tmall.com'], nine: ['m2.9ji.com'], xianyu: ['www.goofish.com'], jd: ['item.jd.com'] }[input.provider] || [];
    if (!hosts.includes(url.hostname) || url.protocol !== 'https:') return;
    // Strip tracking parameters so repeated cards across loads remain one sample.
    if (['taobao', 'xianyu'].includes(input.provider)) {
      const id = url.searchParams.get('id');
      if (!id || !/^\d+$/.test(id)) return;
      url.search = ''; url.searchParams.set('id', id);
    } else if (['nine', 'jd', 'suning'].includes(input.provider)) url.search = '';
    url.hash = '';
    if (seen.has(url.pathname + url.search) || result.items.length >= 100) return;
    seen.add(url.pathname + url.search);
    result.items.push({ title, price, currency: 'CNY', url: url.href, source: input.provider, condition: condition || '' });
  }
  if (input.provider === 'nine') {
    const cards = document.querySelectorAll('a.list-item[href*="/secondHand/detail/"]');
    result.ready = cards.length > 0;
    for (const card of cards) {
      const title = card.querySelector('.product-name');
      const price = card.querySelector('.product-price');
      const condition = card.querySelector('.level-tag-name');
      // 不采广告“到手价”、新机价、已售商品或分期付款金额。
      if (!title || !price || !condition || /售罄|已售|已下架/.test(card.innerText || '')) continue;
      add(title.textContent.trim(), price.textContent, card.href, condition.textContent.trim());
    }
  } else if (input.provider === 'xianyu') {
    const ret = window.__xyRawRet || '';
    const blocked = /(?:登录后查看|请先登录|滑动验证|安全验证|访问受限)/.test(document.body?.innerText || '');
    if (!ret.startsWith('SUCCESS::') && (ret || blocked)) {
      result.ready = true;
      result.status = 'restricted';
      result.message = '闲鱼限制了本次搜索。打开闲鱼窗口，按页面提示登录或验证后重试。';
      return result;
    }
    let rows;
    if (ret.startsWith('SUCCESS::')) {
      try { rows = JSON.parse(window.__xyRaw || '{}').data?.resultList; } catch (_) {}
    }
    const candidateIds = new Set();
    const matchedIds = new Set();
    const track = (id, title) => {
      if (!/^\d+$/.test(String(id))) return;
      candidateIds.add(String(id));
      if (title && matches(title)) matchedIds.add(String(id));
    };
    if (Array.isArray(rows)) {
      result.ready = true;
      for (const row of rows) {
        const item = row?.data?.item?.main?.exContent;
        if (!item) continue;
        track(item.itemId, item.title);
        if (!item.title || !item.itemId || !item.price) continue;
        if (item.sold || item.soldOut || item.isSold) continue;
        add(item.title, item.price, 'https://www.goofish.com/item?id=' + encodeURIComponent(item.itemId), item.condition || '');
      }
    }
    // The rendered search results can be available even when the response shape changes.
    const cards = document.querySelectorAll('a[href*="/item?"][href*="id="]');
    for (const card of cards) {
      const text = card.innerText || '';
      const titleNode = card.querySelector('[class*="title"], [class*="Title"]');
      const priceNode = card.querySelector('[class*="price"], [class*="Price"]');
      const title = titleNode?.textContent?.trim()
        || card.getAttribute?.('title')?.trim()
        || card.getAttribute?.('aria-label')?.trim()
        || card.querySelector('img[alt]')?.getAttribute?.('alt')?.trim();
      try {
        const url = new URL(card.href, location.href);
        if (url.origin !== 'https://www.goofish.com' || url.pathname !== '/item') continue;
        track(url.searchParams.get('id'), title);
      } catch (_) { continue; }
      if (/已售出|已卖出|已下架|售罄|券后|分期|到手价|补贴后/.test(text) ||
          card.closest?.('aside, [class*="recommend"], [class*="Recommend"]')) continue;
      // Price components often render the currency symbol and digits in separate nodes.
      // Only accept bare digits from a price element, never from general card text.
      const priceText = priceNode?.textContent?.replace(/\s+/g, '') || '';
      const lines = text.normalize('NFKC').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const amounts = new Set();
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const amount = /^[¥￥]$/.test(line)
          ? cleanAmount(line + (lines[index + 1] || ''))
          : /^[¥￥]/.test(line) ? cleanAmount(line) : null;
        if (amount) amounts.add(amount.replace(/[¥￥,\s]/g, ''));
      }
      const explicit = cleanAmount(priceText);
      if (explicit) amounts.add(explicit.replace(/[¥￥,\s]/g, ''));
      const price = amounts.size === 1 ? [...amounts][0] : null;
      if (!title || !price) continue;
      add(title, price, card.href, '');
    }
    result.candidateIds = Array.from(candidateIds);
    result.matchedIds = Array.from(matchedIds);
    result.ready ||= cards.length > 0;
    if (!result.items.length && result.ready) {
      result.message = '已读取闲鱼搜索结果，但没有通过型号、在售状态及价格筛选的商品。';
    }
  } else if (input.provider === 'suning' || input.provider === 'taobao') {
    const body = document.body?.innerText || '';
    const suning = input.provider === 'suning';
    const cards = document.querySelectorAll(suning ? '#product-list .general li.item-wrap' : '[class*="Card--doubleCardWrapper"]');
    // A normal page header can say 请登录 even when public product cards are available.
    if (!cards.length && /请登录|登录后查看|滑动验证|安全验证|访问受限/.test(body)) {
      result.ready = true; result.status = 'restricted'; result.message = '平台要求登录或验证，本次未取得公开报价'; return result;
    }
    result.ready = cards.length > 0;
    for (const card of cards) {
      const title = card.querySelector(suning ? '.title-selling-point a' : '[class*="Title--title"]');
      const price = card.querySelector(suning ? '.price-box .def-price' : '[class*="Price--priceText"]');
      const link = !suning && card.matches?.('a[href*="id="]') ? card : card.querySelector(suning ? '.title-selling-point a' : 'a[href*="id="]');
      const text = title?.textContent?.trim() || '';
      if (!title || !price || !link || !/二手|[0-9]成新|[0-9]新/.test(text) || /售罄|已售|下架|券后|补贴后|分期/.test(card.innerText || '')) continue;
      add(text, price.textContent, link.href, (text.match(/\d+成新|\d+新/) || ['二手'])[0]);
    }
  } else if (input.provider === 'jd') {
    if (location.hostname === 'passport.jd.com') {
      result.ready = true;
      result.status = 'restricted';
      result.message = '京东二手搜索跳转登录，本次未取得公开报价';
      return result;
    }
    const cards = document.querySelectorAll('li.gl-item[data-sku]');
    result.ready = cards.length > 0;
    for (const card of cards) {
      const title = card.querySelector('.p-name em');
      const price = card.querySelector('.p-price i');
      const link = card.querySelector('.p-name a');
      if (!title || !price || !link || !/二手|[0-9]成新/.test(title.textContent)) continue;
      add(title.textContent.trim(), price.textContent, link.href, (title.textContent.match(/\d+成新/) || ['二手'])[0]);
    }
  }
  return result;
})(__INPUT_JSON__);
