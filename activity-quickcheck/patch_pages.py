from pathlib import Path
base=Path('cloudflare-live/public')
raw=(base/'index.html').read_text()
raw=raw.replace('<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/scanner.css">','<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/platform.css"><link rel="stylesheet" href="/scanner.css"><link rel="stylesheet" href="/review-grid.css">')
raw=raw.replace('<script defer src="/app-vault.js"></script><script defer src="/app.js"></script>','<script defer src="/app-vault.js"></script><script defer src="/review-grid.js"></script><script defer src="/app.js"></script>')
a='<header class="hero"><div class="hero-inner"><div class="logo">✿</div>\n<div><div class="eyebrow">SCUT BOMBAX · ACTIVITY QUICKCHECK</div><h1>花工木棉 · 活动速签</h1><p>现场报名 · 资料审核 · 快速签到 · 人工认证</p></div></div></header>'
assert raw.count(a)==1
basehead='<header class="hero"><div class="hero-inner"><div class="logo">✿</div><div><div class="eyebrow">SCUT BOMBAX · ACTIVITY</div><h1>花工木棉 · 活动平台</h1><p>无需登录，发现校园活动 · 报名 · 一码通</p></div>'
header={
'index.html':basehead+'<nav class="hero-nav" aria-label="站点导航"><a href="/my">我的活动 · 一码通</a><a href="/adminlogin">主办方管理 ↗</a></nav></div></header>',
'adminlogin.html':basehead+'<nav class="hero-nav" aria-label="站点导航"><a href="/">← 返回活动首页</a></nav></div></header>',
'admin.html':basehead+'<nav class="hero-nav" aria-label="站点导航"><a href="/">查看公开活动首页 ↗</a></nav></div></header>',
'my.html':basehead+'<nav class="hero-nav" aria-label="站点导航"><a href="/">← 返回活动首页</a><a href="/adminlogin">主办方管理</a></nav></div></header>'
}
for name,head in header.items():
 s=raw.replace(a,head)
 s=s.replace('<main class="shell">','<main class="shell'+(' admin-shell' if name=='admin.html' else '')+'">')
 if name=='adminlogin.html':s=s.replace('<title>花工木棉 · 活动速签</title>','<title>工作人员登录 · 花工木棉</title>')
 if name=='admin.html':s=s.replace('<title>花工木棉 · 活动速签</title>','<title>活动管理后台 · 花工木棉</title>')
 if name=='my.html':s=s.replace('<title>花工木棉 · 活动速签</title>','<title>我的活动与一码通 · 花工木棉</title>')
 (base/name).write_text(s)
print('Student-only index, /my and isolated /adminlogin + /admin static HTML created')
