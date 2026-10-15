(function (input) {
  const result = { pageUrl: location.href, pageTitle: document.title, ready: false, status: '', message: '', items: [], relatedUrls: [] };
  const compact = text => text.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '');
  const query = input.keyword.toLowerCase();
  const terms = query.match(/[a-z]+[0-9]*|[0-9]+[a-z]*|[\u3400-\u9fff]+/g) || [];
  const pocket = query.match(/pocket\s*(\d+[a-z]*)/i);
  const seen = new Set();
  function matches(title) {
    const normalized = compact(title);
    if (!terms.length || !terms.every(t => normalized.includes(compact(t)))) return false;
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
    const hosts = { nine: ['m2.9ji.com'], xianyu: ['www.goofish.com'], jd: ['item.jd.com'], zhuanzhuan: ['m.zhuanzhuan.com'] }[input.provider] || [];
    if (!hosts.includes(url.hostname) || seen.has(url.pathname + url.search)) return;
    seen.add(url.pathname + url.search);
    result.items.push({ title, price, currency: 'CNY', url: url.href, source: input.provider, condition: condition || '' });
  }
  if (input.provider === 'zhuanzhuan') {
    const title = document.querySelector('#tab-prod .text__content--condition');
    const price = document.querySelector('#tab-prod .price-info-2026__num');
    const condition = document.querySelector('#tab-prod .same-product-title');
    const body = document.body.innerText || '';
    if (/商品已下架|商品已售出|商品不存在|宝贝已卖出/.test(body)) {
      result.ready = true;
      result.status = 'restricted';
      result.message = '转转商品已售出或不可用，未计价';
      return result;
    }
    if (!title || !price || !condition || !/立即购买/.test(body)) return result;
    result.ready = true;
    // 仅当前商品主售价；新品价、价格趋势图、同款卡片上的数字均不直接计价。
    const id = new URL(location.href).searchParams.get('infoId');
    if (id && /^\d+$/.test(id)) add(title.textContent.trim(), price.textContent,
      'https://m.zhuanzhuan.com/u/streamline_detail/new-goods-detail?infoId=' + id, condition.textContent.trim());
    if (result.items.length) {
      for (const card of document.querySelectorAll('#tab-prod .model-item__spu[lego-goods-exposure]')) {
        try {
          const related = JSON.parse(card.getAttribute('lego-goods-exposure')).infoId;
          if (/^\d+$/.test(related) && related !== id) result.relatedUrls.push(
            'https://m.zhuanzhuan.com/u/streamline_detail/new-goods-detail?infoId=' + related);
        } catch (_) { /* 页面卡片无有效商品 ID 时跳过 */ }
      }
    } else result.message = '转转商品型号与检索词不匹配，未计入样本';
  } else if (input.provider === 'nine') {
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
    if (ret && !ret.startsWith('SUCCESS::')) {
      result.ready = true;
      result.status = 'restricted';
      result.message = '闲鱼本次限制了公开搜索，未取得可用在售样本';
      return result;
    }
    if (!ret.startsWith('SUCCESS::')) return result;
    let rows;
    try { rows = JSON.parse(window.__xyRaw || '{}').data.resultList; } catch (_) { return result; }
    if (!Array.isArray(rows)) return result;
    result.ready = true;
    for (const row of rows) {
      const item = row?.data?.item?.main?.exContent;
      if (!item || !item.title || !item.itemId || !item.price) continue;
      if (item.sold || item.soldOut || item.isSold) continue;
      add(item.title, item.price, 'https://www.goofish.com/item?id=' + encodeURIComponent(item.itemId), item.condition || '');
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
