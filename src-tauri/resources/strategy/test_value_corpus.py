import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from value_corpus import chunks, html_text, normalize_announcement, parse_document, status, collect_index


class CorpusTests(unittest.TestCase):
    def test_null_attachment_type_does_not_abort_company(self):
        rows=[dict(secCode='000001', announcementId=123, announcementTitle='2024年年度报告',
                   announcementTime=1743177600000, adjunctType=None, adjunctUrl='finalpage/2025-03-29/123.PDF'),
              dict(secCode='000001', adjunctType=None, adjunctUrl=None)]
        scratch=Path(__file__).resolve().parents[3]/'.runlogs'
        with tempfile.TemporaryDirectory(dir=scratch) as temp, patch('value_corpus.filing_query',return_value={'announcements':rows,'totalpages':1}):
            records=collect_index(Path(temp),'000001','org')
        self.assertEqual(len(records),1)
        self.assertEqual(records[0]['announcement_id'],'123')

    def test_chunks_keep_page_and_bounded_overlap(self):
        result = chunks([dict(page=3, text='甲' * 2500)], size=1200, overlap=100)
        self.assertEqual([r['page'] for r in result], [3, 3, 3])
        self.assertEqual(result[1]['offset'], 1100)
        self.assertEqual(''.join(r['text'] for r in result).count('甲'), 2700)

    def test_html_excludes_script_and_style(self):
        text = html_text('<style>隐藏</style><h1>盈利质量</h1><script>未来收益</script><p>现金流</p>'.encode())
        self.assertIn('盈利质量', text)
        self.assertIn('现金流', text)
        self.assertNotIn('未来收益', text)
        self.assertNotIn('隐藏', text)

    def test_official_filing_preserves_date_and_url(self):
        doc = normalize_announcement(dict(secCode='000001', announcementId=123,
            announcementTitle='2024年年度报告', announcementTime=1743177600000,
            adjunctUrl='finalpage/2025-03-29/123.PDF'))
        self.assertEqual(doc['published_on'], '2025-03-29')
        self.assertEqual(doc['original_url'], 'https://static.cninfo.com.cn/finalpage/2025-03-29/123.PDF')
        self.assertTrue(doc['vintage_verified'])

    def test_parse_is_reproducible_and_keeps_hash_evidence(self):
        scratch = Path(__file__).resolve().parents[3] / '.runlogs'
        with tempfile.TemporaryDirectory(dir=scratch) as temp:
            root = Path(temp)
            doc = dict(announcement_id='123', original_url='https://example.invalid/report.pdf', status='discovered')
            with patch('value_corpus.request', return_value=(b'%PDF-fixture', 'application/pdf', '')), \
                 patch('value_corpus.pdf_text', return_value=[dict(page=1, text='经营活动现金流' * 30)]):
                first = parse_document(root, doc)
                second = parse_document(root, doc)
            self.assertEqual(first['sha256'], second['sha256'])
            self.assertIn(first['sha256'], first['vintage_evidence'])
            stored = json.loads((root / 'value/corpus/text/123.json').read_text(encoding='utf-8'))
            self.assertEqual(stored['document']['status'], 'parsed')
            self.assertEqual(status(root)['parsed_filings'], 0)
            self.assertFalse(status(root)['training_admitted'])


if __name__ == '__main__':
    unittest.main()
