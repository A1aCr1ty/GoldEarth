"""Restore the reviewed exercise JPEGs from the pinned upstream revision."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'exercise-media'

def download(asset):
    destination = ROOT / asset['path']
    if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest() == asset['sha256']:
        return asset['path'] + ': verified'
    with urllib.request.urlopen(asset['sourceUrl'], timeout=40) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != asset['sha256']:
        raise ValueError('Source checksum changed: ' + asset['path'])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return asset['path'] + ': restored'

if __name__ == '__main__':
    manifest = json.loads((ROOT / 'ATTRIBUTION.json').read_text(encoding='utf-8'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(download, manifest['files']):
            print(result)
