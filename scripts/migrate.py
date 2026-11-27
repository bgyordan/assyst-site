# One-off: converts the WordPress export (/home/user/export) into content files.
import json, re, sys, os, html
from urllib.parse import unquote
sys.path.insert(0, os.path.dirname(__file__))
from bs4 import BeautifulSoup, Comment
from markdownify import markdownify as md
EX = '/home/user/export'
OUT = 'src/content'
TR = dict(zip('абвгдежзийклмнопрстуфхцчшщъьюя', ['a','b','v','g','d','e','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','ts','ch','sh','sht','a','','yu','ya']))
def translit(s): return ''.join(TR.get(c, c) for c in s.lower())
def clean(h):
    s = BeautifulSoup(h, 'html.parser')
    for t in s(['script','style','noscript','svg','canvas','meta','title','link']): t.decompose()
    for c in s.find_all(string=lambda x: isinstance(x, Comment)): c.extract()
    out = md(str(s), heading_style='ATX', strip=['div','span','section','figure','article'])
    out = out.replace('https://assyst.bg/wp-content/uploads/', '/uploads/')
    out = re.sub(r'(/uploads/[^)\s"]*?)-\d+x\d+(\.\w+)', r'\1\2', out)  # use originals
    out = re.sub(r'https://assyst\.bg/', '/', out)
    out = out.replace(' ', ' ')
    out = re.sub(r'\n[ \t]+', '\n', out); out = re.sub(r'\n{3,}', '\n\n', out)
    return out.strip() + '\n'
def q(s): return json.dumps(s, ensure_ascii=False)
media = {m['id']: m['source_url'].replace('https://assyst.bg/wp-content/uploads/', '/uploads/') for m in json.load(open(f'{EX}/media.json'))}
cats = {c['id']: c['name'] for c in json.load(open(f'{EX}/categories.json'))}
os.makedirs(f'{OUT}/posts', exist_ok=True)
for p in json.load(open(f'{EX}/posts.json')):
    slug = unquote(p['slug'])
    title = html.unescape(p['title']['rendered']).replace(' ', ' ')
    exc = html.unescape(BeautifulSoup(p['excerpt']['rendered'], 'html.parser').get_text()).replace(' ', ' ')
    exc = re.sub(r'\s+', ' ', exc).replace(' [&hellip;]', '').replace('[…]', '').strip()
    fm = ['---', f'title: {q(title)}', f'slug: {q(slug)}', f'date: {p["date"][:10]}',
          f'categories: {q([cats[c] for c in p["categories"]])}']
    if p['featured_media'] in media: fm.append(f'image: {q(media[p["featured_media"]])}')
    fm.append(f'excerpt: {q(exc[:300])}')
    fm.append('---')
    fn = translit(slug)[:60].strip('-')
    open(f'{OUT}/posts/{p["date"][:10]}-{fn}.md', 'w').write('\n'.join(fm) + '\n\n' + clean(p['content']['rendered']))
os.makedirs(f'{OUT}/events', exist_ok=True)
for e in json.load(open(f'{EX}/events.json'))['events']:
    slug = unquote(e['slug'])
    fm = ['---', f'title: {q(html.unescape(e["title"]))}', f'slug: {q(slug)}',
          f'start: {e["start_date"][:10]}', f'end: {e["end_date"][:10]}', 'location: ""', '---']
    open(f'{OUT}/events/{e["start_date"][:10]}-{translit(slug)[:50]}.md', 'w').write('\n'.join(fm) + '\n\n' + clean(e['description']))
print('ok')
