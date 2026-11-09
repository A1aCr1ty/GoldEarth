"""Versioned public-research and original filing corpus. No paywall bypass.

Official filing PDFs establish document provenance, not semantic correctness.
Text is not a return label and is not yet admitted to return-model training.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request

from value_lab import ROOT, now, read, save

BASE = 'https://www.cninfo.com.cn'
CATEGORIES = 'category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh;'
EXCLUDED_TITLES = ('摘要', '英文', '取消', '提示', '补充公告', '问询', '回复')


def request(url, data=None, timeout=40):
    req = urllib.request.Request(url, data=data, headers={
        'User-Agent': 'Mozilla/5.0', 'Referer': BASE + '/new/commonUrl?url=disclosure/list/notice'})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.read(), response.headers.get_content_type(), response.geturl()
        except Exception as exc:
            last = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise last


def stock_map(directory):
    path = directory / 'cninfo_stocks.json'
    if not path.exists():
        payload, _, _ = request(BASE + '/new/data/szse_stock.json')
        save(path, json.loads(payload.decode('utf-8'))['stockList'])
    return {r['code']: r for r in read(path, []) if re.fullmatch(r'\d{6}', r.get('code', ''))}


def filing_query(code, org_id, page):
    body = urllib.parse.urlencode(dict(pageNum=page, pageSize=30,
        column='sse' if code.startswith('6') else 'szse', tabName='fulltext',
        stock=f'{code},{org_id}', category=CATEGORIES,
        seDate='1990-01-01~' + now()[:10], isHLtitle='true')).encode()
    payload, _, _ = request(BASE + '/new/hisAnnouncement/query', body)
    return json.loads(payload.decode('utf-8'))


def normalize_announcement(row):
    title = re.sub(r'<[^>]+>', '', row.get('announcementTitle') or '').strip()
    stamp = datetime.fromtimestamp(row['announcementTime'] / 1000, timezone(timedelta(hours=8)))
    relative = row['adjunctUrl']
    return dict(code=row['secCode'], announcement_id=str(row['announcementId']), title=title,
        published_on=stamp.date().isoformat(), source=BASE + '/new/disclosure/detail?announcementId=' + str(row['announcementId']),
        download_url=BASE + '/new/announcement/download?bulletinId=' + str(row['announcementId']),
        original_url='https://static.cninfo.com.cn/' + relative, observed_at=now(),
        vintage_verified=True, status='discovered')


def collect_index(root, code, org_id):
    directory = root / 'value/corpus'
    first = filing_query(code, org_id, 1)
    rows = list(first.get('announcements') or [])
    for page in range(2, int(first.get('totalpages') or 1) + 1):
        rows.extend(filing_query(code, org_id, page).get('announcements') or [])
        time.sleep(.15)
    documents = {}
    for row in rows:
        attachment_type = str(row.get('adjunctType') or '').upper()
        is_pdf = attachment_type == 'PDF' or (not attachment_type and str(row.get('adjunctUrl') or '').lower().endswith('.pdf'))
        if row.get('secCode') != code or not is_pdf:
            continue
        title = re.sub(r'<[^>]+>', '', row.get('announcementTitle') or '')
        if any(word in title for word in EXCLUDED_TITLES):
            continue
        doc = normalize_announcement(row)
        documents[doc['announcement_id']] = doc
    path = directory / 'filings' / f'{code}.json'
    previous = {r['announcement_id']: r for r in read(path, [])}
    for key, old in previous.items():
        if key in documents and old.get('status') == 'parsed':
            parsed = {k: v for k, v in old.items() if k in ('sha256', 'status', 'pages', 'characters',
                'original_file', 'vintage_evidence', 'parsed_at')}
            documents[key].update(parsed)
    result = sorted(documents.values(), key=lambda r: (r['published_on'], r['announcement_id']))
    save(path, result)
    return result


def pdf_text(content):
    from pypdf import PdfReader
    import io
    reader = PdfReader(io.BytesIO(content))
    pages = []
    for number, page in enumerate(reader.pages, 1):
        pages.append(dict(page=number, text=page.extract_text() or ''))
    return pages


def chunks(pages, size=1200, overlap=100):
    result = []
    for page in pages:
        text = re.sub(r'[ \t]+', ' ', page['text']).strip()
        start = 0
        while start < len(text):
            result.append(dict(page=page['page'], offset=start, text=text[start:start + size]))
            if start + size >= len(text):
                break
            start += size - overlap
    return result


def parse_document(root, doc):
    directory = root / 'value/corpus'
    identity = doc.get('announcement_id') or doc['id']
    raw = directory / 'originals' / f'{identity}.pdf'
    content = raw.read_bytes() if raw.exists() else request(doc['original_url'] if 'original_url' in doc else doc['url'])[0]
    if not content.startswith(b'%PDF'):
        raise ValueError('下载内容不是PDF')
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_bytes(content)
    digest = hashlib.sha256(content).hexdigest()
    pages = pdf_text(content)
    text = ''.join(p['text'] for p in pages)
    if len(text.strip()) < 100:
        raise ValueError('PDF可提取文本不足，可能是扫描件')
    parsed = dict(doc, sha256=digest, status='parsed', pages=len(pages), characters=len(text),
        original_file=str(raw), vintage_evidence=f'官方原始PDF；SHA256={digest}', parsed_at=now())
    save(directory / 'text' / f'{identity}.json', dict(document=parsed, pages=pages, chunks=chunks(pages)))
    return parsed


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript') and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_text(content):
    parser = TextExtractor()
    parser.feed(content.decode('utf-8', errors='replace'))
    return re.sub(r'\s+', ' ', ' '.join(parser.parts)).strip()


def collect_filings(root, limit=6000, codes=None, metadata_only=False, max_documents=None):
    directory = root / 'value/corpus'
    stocks = stock_map(directory)
    selected = codes or sorted(p.stem for p in (root / 'data').glob('*.csv')
        if re.fullmatch(r'\d{6}', p.stem) and p.stem not in ('000300', '399006'))[:limit]
    status = dict(kind='original_filings', started_at=now(), requested=len(selected), completed=0,
        documents=0, parsed=0, failures=[], updated_at=now())
    for code in selected:
        try:
            if code not in stocks:
                raise ValueError('巨潮股票目录无此代码')
            documents = collect_index(root, code, stocks[code]['orgId'])
            status['documents'] += len(documents)
            if not metadata_only:
                changed = False
                for doc in documents:
                    if max_documents is not None and status['parsed'] >= max_documents:
                        break
                    if doc.get('status') == 'parsed':
                        status['parsed'] += 1
                        continue
                    try:
                        doc.update(parse_document(root, doc))
                        status['parsed'] += 1
                    except Exception as exc:
                        doc.update(status='failed', error=str(exc)[:300])
                    changed = True
                    save(directory / 'filings' / f'{code}.json', documents)
                    time.sleep(.2)
                if changed:
                    save(directory / 'filings' / f'{code}.json', documents)
        except Exception as exc:
            status['failures'].append(dict(code=code, error=str(exc)[:300]))
        status['completed'] += 1
        status['updated_at'] = now()
        save(directory / 'filing_progress.json', status)
        time.sleep(.15)
    return status


def collect_knowledge(root, limit=None):
    directory = root / 'value/corpus'
    sources = read(root / 'knowledge_sources.json', [])[:limit]
    status = dict(kind='public_knowledge', started_at=now(), requested=len(sources), completed=0,
        parsed=0, failures=[], updated_at=now())
    for source in sources:
        try:
            content, content_type, final_url = request(source['url'])
            doc = dict(source, final_url=final_url, observed_at=now(), sha256=hashlib.sha256(content).hexdigest())
            if content.startswith(b'%PDF'):
                doc['original_url'] = source['url']
                doc = parse_document(root, doc)
            else:
                text = html_text(content)
                if len(text) < 100:
                    raise ValueError('网页可提取文本不足')
                doc.update(status='parsed', characters=len(text), pages=1)
                save(directory / 'text' / f"{source['id']}.json", dict(document=doc,
                    pages=[dict(page=1, text=text)], chunks=chunks([dict(page=1, text=text)])))
            status['parsed'] += 1
        except Exception as exc:
            status['failures'].append(dict(id=source['id'], url=source['url'], error=str(exc)[:300]))
        status['completed'] += 1
        status['updated_at'] = now()
        save(directory / 'knowledge_progress.json', status)
        time.sleep(.3)
    return status


def status(root):
    directory = root / 'value/corpus'
    filings = list((directory / 'filings').glob('*.json'))
    docs = [r for path in filings for r in read(path, [])]
    return dict(companies=len(filings), filing_documents=len(docs),
        parsed_filings=sum(r.get('status') == 'parsed' for r in docs),
        filing_characters=sum(r.get('characters', 0) for r in docs),
        knowledge_texts=len([p for p in (directory / 'text').glob('*.json')
            if not re.fullmatch(r'\d+', p.stem)]),
        filing_progress=read(directory / 'filing_progress.json', None),
        knowledge_progress=read(directory / 'knowledge_progress.json', None),
        training_admitted=False,
        warning='语料采集不等于预测训练；原文按披露版本保存，文本特征须经独立样本外验证后才能融合。')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['filings', 'knowledge', 'status'])
    parser.add_argument('--limit', type=int)
    parser.add_argument('--codes', help='逗号分隔的六位代码，用于小规模核验')
    parser.add_argument('--metadata-only', action='store_true')
    parser.add_argument('--max-documents', type=int)
    args = parser.parse_args()
    if args.action == 'filings':
        codes = args.codes.split(',') if args.codes else None
        if codes and any(not re.fullmatch(r'\d{6}', c) for c in codes):
            raise ValueError('股票代码格式无效')
        result = collect_filings(ROOT, args.limit or 6000, codes, args.metadata_only, args.max_documents)
    elif args.action == 'knowledge':
        result = collect_knowledge(ROOT, args.limit)
    else:
        result = status(ROOT)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == '__main__':
    main()
