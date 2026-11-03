"""把 app/app.html + app/vendor 内联打包成 dist/班序-班级管理.html 单文件。

用法：python3 app/build.py
"""
from pathlib import Path

root = Path(__file__).parent
html = (root / 'app.html').read_text()
lib = (root / 'vendor/xlsx.full.min.js').read_text()
license_text = (root / 'vendor/LICENSE').read_text()

assert '/*XLSX_LIBRARY*/' in html, 'app.html 缺少 /*XLSX_LIBRARY*/ 占位符'
out = html.replace(
    '/*XLSX_LIBRARY*/',
    '/*\nSheetJS Community Edition 0.20.3\n' + license_text + '\n*/\n' + lib,
)
assert '/*XLSX_LIBRARY*/' not in out

# 同步 app.js（内联脚本的独立副本，便于阅读与检索）
first = out.index('<script>')
body_start = out.index('<script>', first + len('<script>')) + len('<script>')
body_end = out.index('</script>', body_start)
js = out[body_start:body_end]
(root / 'app.js').write_text(js)

dest = root.parent / 'dist' / '班序-班级管理.html'
dest.write_text(out)
print(f'已生成 {dest}  ({dest.stat().st_size / 1024:.0f} KB)')
print(f'已同步 {root / "app.js"}  ({len(js) / 1024:.0f} KB)')
