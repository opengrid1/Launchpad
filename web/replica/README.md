# Site replica build

Builds the launchpad front end (home, token, launch, profile, leaderboard, docs, admin) from the captured
reference markup and compiled stylesheet in `ref/`, re-skinned with our palette and content.

```
pip install beautifulsoup4
cd web/replica && python3 build2.py      # writes *.html, o1.css next to this file
python3 checkcls.py index.html token.html # reports utility classes missing from the stylesheet
```

Deploy the generated `*.html`, `o1.css`, `extra.css`, `app.js`, `pages.js`, `data.js` as a static site.
Behaviour lives in `app.js` (header menus, search, wallet, chart, trades, swap, feed) and `pages.js`
(launch wizard, profile, leaderboard, docs, admin). Mock data is in `data.js`.
