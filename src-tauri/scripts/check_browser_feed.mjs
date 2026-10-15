import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const hook = readFileSync(new URL('../src/trending/browser_feed.js', import.meta.url), 'utf8');
function page(hostname, body, nodes = []) {
  const window = { fetch: async () => ({ clone: () => ({ text: async () => JSON.stringify(body) }) }) };
  class XHR { open() {} send() {} }
  runInNewContext(hook, { window, location: { hostname, href: `https://${hostname}/explore` },
    document: { querySelectorAll: () => nodes }, XMLHttpRequest: XHR, URL });
  return window;
}
async function receive(window, url) {
  await window.fetch(url);
  await new Promise(resolve => setImmediate(resolve));
  return window.__geFeed.read().items;
}

test('小红书使用原生推荐响应并保留笔记访问令牌', async () => {
  const window = page('www.xiaohongshu.com', { success: true, data: { items: [{
    id: 'abc123', xsec_token: 'a+b&c', note_card: { display_title: '测试笔记',
      user: { nickname: '作者' }, interact_info: { liked_count: '1.2万' },
      cover: { url_default: 'http://image.example/cover.jpg' } },
  }] } });
  const items = await receive(window, 'https://edith.xiaohongshu.com/api/sns/web/v1/homefeed');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '测试笔记');
  assert.equal(new URL(items[0].url).searchParams.get('xsec_token'), 'a+b&c');
  assert.equal(new URL(items[0].url).searchParams.get('xsec_source'), 'pc_feed');
  assert.equal(items[0].cover, 'https://image.example/cover.jpg');
  assert.equal(items[0].hotText, '1.2万 赞');
});

test('错误来源、详情接口和失败响应不会被当成推荐内容', async () => {
  const body = { success: false, data: { items: [{ id: 'abc', note_card: { title: '无效' } }] } };
  const window = page('www.xiaohongshu.com', body);
  assert.equal((await receive(window, 'https://evil.example/api/sns/web/v1/homefeed')).length, 0);
  assert.equal((await receive(window, 'https://edith.xiaohongshu.com/api/sns/web/v1/feed')).length, 0);
  assert.equal((await receive(window, 'https://edith.xiaohongshu.com/api/sns/web/v1/homefeed')).length, 0);
});

test('雪球支持嵌套字符串帖子、正文标题和去重', async () => {
  const post = { original_status: JSON.stringify({ id: 456, text: '<p>公司研究</p>',
    user: { id: 123, screen_name: '研究员' }, reply_count: 10 }) };
  const window = page('xueqiu.com', { list: [post, post, { id: 789 }] });
  const items = await receive(window, 'https://xueqiu.com/statuses/hot/listV2.json?size=30');
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://xueqiu.com/123/456');
  assert.equal(items[0].title, '公司研究');
  assert.equal(items[0].author, '研究员');
});

test('缺少可读网络响应时提取已渲染的小红书卡片', () => {
  const link = { href: 'https://www.xiaohongshu.com/explore/abc?xsec_token=token' };
  const node = { querySelector: selector => selector.startsWith('a.cover[href]') ? link
    : selector === '.title' ? { textContent: '页面标题' } : null };
  const window = page('www.xiaohongshu.com', {}, [node]);
  assert.equal(window.__geFeed.read().items[0].title, '页面标题');
  assert.equal(window.__geFeed.read().items[0].url, link.href);
});

test('雪球登录跳到 www 域名后仍安装采集器并读取首页响应', async () => {
  const window = page('www.xueqiu.com', { statuses: [{ id: 456, text: '登录后的首页帖子', user: { id: 123 } }] });
  assert.ok(window.__geFeed, 'www 域名必须安装采集器');
  const items = await receive(window, 'https://www.xueqiu.com/statuses/friends_timeline.json');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '登录后的首页帖子');
});

test('雪球 www 首页文章卡片按帖子链接提取，忽略作者主页链接', () => {
  const authorLink = { href: 'https://www.xueqiu.com/123', textContent: '作者' };
  const postLink = { href: 'https://www.xueqiu.com/123/456', textContent: '31分钟前' };
  const article = {
    querySelectorAll: () => [authorLink, postLink],
    querySelector: selector => selector.includes('.timeline__item__title')
      ? { textContent: '首页帖子正文' } : selector === '.user-name' ? { textContent: '作者' } : authorLink,
  };
  const window = page('www.xueqiu.com', {}, [article]);
  const items = window.__geFeed.read().items;
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '首页帖子正文');
  assert.equal(items[0].url, postLink.href);
  assert.equal(items[0].author, '作者');
});
