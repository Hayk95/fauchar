#!/usr/bin/env python3
"""Build FAUCHAR Instagram launch HTML at exact export sizes."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAP = [
    "01100110",
    "11111111",
    "11111111",
    "11111111",
    "11111111",
    "01111110",
    "01100110",
    "01100110",
    "01100110",
    "00100100",
]

FONT = """
@font-face { font-family: Inter; font-weight: 400; src: url("../fonts/inter-400.woff2") format("woff2"); }
@font-face { font-family: Inter; font-weight: 500; src: url("../fonts/inter-500.woff2") format("woff2"); }
@font-face { font-family: Inter; font-weight: 600; src: url("../fonts/inter-600.woff2") format("woff2"); }
@font-face { font-family: "Space Grotesk"; font-weight: 500; src: url("../fonts/space-grotesk-500.woff2") format("woff2"); }
@font-face { font-family: "Space Grotesk"; font-weight: 600; src: url("../fonts/space-grotesk-600.woff2") format("woff2"); }
"""

BASE = """
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #0b1114; }
body { font-family: Inter, Helvetica, Arial, sans-serif; color: #f5f4ef; }
.sg { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; }
em { font-style: normal; color: #b7f34a; }
"""


def mark(h, on="#F5F4EF", accent="#B7F34A"):
    rects = []
    for r, row in enumerate(MAP):
        for c, v in enumerate(row):
            if v != "1":
                continue
            fill = accent if (r == 1 and c == 4) else on
            rects.append(
                f'<rect x="{c * 7 + 4}" y="{r * 7 + 5}" width="6" height="6" rx="1" fill="{fill}"/>'
            )
    w = round(h * 64 / 80)
    return (
        f'<svg class="mark" viewBox="0 0 64 80" width="{w}" height="{h}" fill="none" '
        f'role="img" aria-label="FAUCHAR logo">{"".join(rects)}</svg>'
    )


def lockup(h=44):
    return (
        f'<div class="lock">{mark(h)}'
        f'<div><div class="word">FAUCHAR</div>'
        f'<div class="desc">DENTAL INTELLIGENCE</div></div></div>'
    )


POST_CSS = BASE + """
body { width: 1080px; height: 1350px; overflow: hidden; }
.post {
  width: 1080px; height: 1350px; position: relative; background: #0b1114; overflow: hidden;
}
.field { position: absolute; inset: 0; z-index: 0; }
.veil {
  position: absolute; inset: 0; z-index: 0;
  background: radial-gradient(ellipse 78% 58% at 50% 40%, rgba(11,17,20,0.94) 0%, rgba(11,17,20,0.72) 46%, rgba(11,17,20,0.28) 100%);
}
.top, .bot, .stage { z-index: 1; }
.top, .bot {
  position: absolute; left: 72px; right: 72px;
  display: flex; align-items: center; justify-content: space-between;
}
.top { top: 156px; }
.bot { bottom: 148px; }
.lock { display: flex; align-items: center; gap: 16px; }
.word { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 26px; letter-spacing: 0.16em; line-height: 1; }
.desc { margin-top: 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.22em; color: #8a929a; }
.num { font-size: 18px; font-weight: 600; letter-spacing: 0.18em; color: #8a929a; }
.bot span { font-size: 16px; font-weight: 600; letter-spacing: 0.18em; color: #8a929a; }
.stage { position: absolute; left: 72px; right: 72px; top: 270px; bottom: 250px; display: flex; flex-direction: column; }
.stage.center { align-items: center; justify-content: center; text-align: center; }
.kicker { display: flex; align-items: center; gap: 12px; font-size: 18px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: #b7f34a; }
.kicker i { width: 10px; height: 10px; background: #b7f34a; border-radius: 2px; display: block; }
h1 { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 76px; letter-spacing: -0.035em; line-height: 0.98; margin-top: 22px; }
.lede { margin-top: 24px; font-size: 28px; line-height: 1.45; color: #b7c0c6; max-width: 860px; }
.stage.center .lede { max-width: 820px; }
.art { margin-top: 36px; display: flex; align-items: center; justify-content: center; }
.reticle { position: relative; width: 520px; height: 520px; display: flex; align-items: center; justify-content: center; }
.reticle svg.ring { position: absolute; inset: 0; }
.steps { margin-top: 34px; display: flex; flex-direction: column; gap: 18px; }
.step { display: grid; grid-template-columns: 72px 1fr; gap: 18px; align-items: start; }
.step b { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 32px; letter-spacing: -0.02em; display: block; }
.step p { margin-top: 4px; font-size: 22px; line-height: 1.35; color: #8a929a; }
.idx { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 28px; color: #b7f34a; padding-top: 4px; }
.layers { margin-top: 32px; display: flex; flex-direction: column; gap: 14px; }
.layer { display: flex; justify-content: space-between; align-items: center; border: 1px solid #26323a; border-radius: 16px; padding: 20px 24px; }
.layer b { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 30px; letter-spacing: -0.02em; }
.layer span { font-size: 16px; font-weight: 600; letter-spacing: 0.16em; color: #b7f34a; }
.trio { margin-top: 40px; display: grid; grid-template-columns: 1fr 48px 1fr 48px 1fr; align-items: stretch; }
.cell { border: 1px solid #26323a; border-radius: 18px; padding: 26px 22px; }
.cell b { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 28px; display: block; letter-spacing: -0.02em; }
.cell p { margin-top: 8px; font-size: 20px; line-height: 1.35; color: #8a929a; }
.arrow { display: flex; align-items: center; justify-content: center; color: #b7f34a; font-size: 28px; }
.margin-label { margin-top: 18px; font-size: 16px; font-weight: 600; letter-spacing: 0.18em; color: #b7f34a; }
.intro-gap { height: 36px; }
"""

STORY_CSS = BASE + """
body { width: 1080px; height: 1920px; overflow: hidden; }
.story { width: 1080px; height: 1920px; position: relative; background: #0b1114; overflow: hidden; }
.top { position: absolute; top: 300px; left: 80px; right: 80px; }
.bot { position: absolute; left: 80px; right: 80px; bottom: 300px; display: flex; justify-content: space-between; align-items: flex-end; }
.lock { display: flex; align-items: center; gap: 16px; }
.word { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 26px; letter-spacing: 0.16em; line-height: 1; }
.desc { margin-top: 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.22em; color: #8a929a; }
.kicker { margin-top: 36px; font-size: 20px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: #b7f34a; }
h1 { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 92px; letter-spacing: -0.04em; line-height: 0.96; margin-top: 16px; }
.mid { position: absolute; left: 80px; right: 80px; top: 640px; }
.support { margin-top: 28px; font-size: 32px; line-height: 1.4; color: #d5dbdf; max-width: 860px; }
.close { margin-top: 28px; font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 36px; letter-spacing: -0.02em; }
.bot span { font-size: 18px; font-weight: 600; letter-spacing: 0.18em; color: #8a929a; }
.reticle { position: relative; width: 460px; height: 460px; margin-top: 12px; display: flex; align-items: center; justify-content: center; }
.reticle svg.ring { position: absolute; inset: 0; }
.points { margin-top: 36px; display: flex; flex-direction: column; gap: 16px; }
.point { display: flex; gap: 16px; align-items: baseline; font-size: 30px; line-height: 1.3; }
.point i { width: 10px; height: 10px; background: #b7f34a; border-radius: 2px; flex: none; transform: translateY(-2px); }
"""


def ring(size=520):
    return f'''<svg class="ring" viewBox="0 0 520 520" width="{size}" height="{size}" fill="none" aria-hidden="true">
      <circle cx="260" cy="260" r="248" stroke="#26323A" stroke-width="1.5"/>
      <circle cx="260" cy="260" r="190" stroke="#1C272D" stroke-width="1.5"/>
      <path d="M260 8 V52 M260 468 V512 M8 260 H52 M468 260 H512" stroke="#26323A" stroke-width="1.5"/>
      <path d="M260 18 A242 242 0 0 1 470 150" stroke="#B7F34A" stroke-width="4" stroke-linecap="round"/>
    </svg>'''


def field(seed):
    x = seed
    rects = []

    def rnd():
        nonlocal x
        x = (x * 9301 + 49297) % 233280
        return x / 233280

    pitch = 34
    for r in range(42):
        for c in range(34):
            v = rnd()
            if v < 0.62:
                continue
            px = c * pitch + 6
            py = r * pitch + 4
            dx = (px - 540) / 540
            dy = (py - 620) / 675
            dist = (dx * dx + dy * dy) ** 0.5
            op = 0.045 + (v - 0.62) * 0.22
            if dist < 0.42:
                op *= 0.28
            elif dist < 0.7:
                op *= 0.62
            lime = v > 0.955 and dist > 0.72
            fill = "#B7F34A" if lime else "#F5F4EF"
            if lime:
                op = 0.55
            rects.append(
                f'<rect x="{px}" y="{py}" width="16" height="16" rx="3" fill="{fill}" opacity="{op:.2f}"/>'
            )
    rings = (
        '<circle cx="540" cy="620" r="470" stroke="#26323A" stroke-width="1.5" fill="none"/>'
        '<circle cx="540" cy="620" r="300" stroke="#1C272D" stroke-width="1.5" fill="none"/>'
        '<path d="M540 80 V150 M540 1090 V1160 M70 620 H140 M940 620 H1010" stroke="#26323A" stroke-width="1.5"/>'
    )
    return (
        f'<svg class="field" viewBox="0 0 1080 1350" width="1080" height="1350" fill="none" aria-hidden="true">'
        f"{rings}{''.join(rects)}</svg>"
    )


def shell_post(num, inner, center=False):
    stage = "stage center" if center else "stage"
    return f'''<article class="post" id="post-{num}" aria-label="Post {num}">
      {field(int(num) * 17 + 3)}
      <div class="veil"></div>
      <header class="top">{lockup(48)}<span class="num">{num} / 09</span></header>
      <div class="{stage}">{inner}</div>
      <footer class="bot"><span>FAUCHAR.COM</span><span>DENTAL INTELLIGENCE</span></footer>
    </article>'''


def shell_story(num, kicker, title, mid, close):
    return f'''<article class="story" id="story-{num}" aria-label="Story {num}">
      <header class="top">
        {lockup(48)}
        <p class="kicker">{kicker}</p>
        <h1>{title}</h1>
      </header>
      <div class="mid">{mid}<p class="close">{close}</p></div>
      <footer class="bot"><span>FAUCHAR.COM</span><span>0{num} / 05</span></footer>
    </article>'''


def page(title, css, body, capture=False):
    script = '<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>' if capture else ""
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>{title}</title>
  {script}
  <style>
    {FONT}
    {css}
  </style>
</head>
<body>
{body}
</body>
</html>
'''


POSTS = []


def add_post(filename, num, inner, center=False):
    POSTS.append((filename, num, shell_post(num, inner, center)))


add_post(
    "01-brand-introduction",
    "01",
    f'''<div class="reticle">{ring(520)}{mark(300)}</div>
        <div class="intro-gap"></div>
        <h1>A tooth,<br>rebuilt from<br><em>data.</em></h1>''',
    center=True,
)

add_post(
    "02-3d-dental-data",
    "02",
    f'''<p class="kicker"><i></i>3D dental data</p>
        <h1>A scan is a volume of voxels.</h1>
        <p class="lede">A voxel is the smallest unit of an intraoral scan or a CBCT volume. FAUCHAR is being built to read that geometry.</p>
        <div class="art">{mark(300)}</div>''',
)

add_post(
    "03-scan-to-restoration",
    "03",
    '''<p class="kicker"><i></i>Scan to restoration</p>
        <h1>From scan to restoration.</h1>
        <div class="steps">
          <div class="step"><span class="idx">01</span><div><b>Scan</b><p>A 3D dental scan enters the workflow.</p></div></div>
          <div class="step"><span class="idx">02</span><div><b>Anatomy</b><p>Preparation, neighbors, and the opposing arch.</p></div></div>
          <div class="step"><span class="idx">03</span><div><b>Proposal</b><p>A crown or bridge design drawn from that scan.</p></div></div>
          <div class="step"><span class="idx">04</span><div><b>Review</b><p>Margin, contacts, and occlusion stay editable.</p></div></div>
          <div class="step"><span class="idx">05</span><div><b>Export</b><p>An STL for the next step in the laboratory.</p></div></div>
        </div>''',
)

add_post(
    "04-industry-challenge",
    "04",
    '''<p class="kicker"><i></i>The work</p>
        <h1>Restoration design is still expert work.</h1>
        <p class="lede">The anatomy is complex. The margin has to close. Contacts and occlusion have to be judged by a trained eye.</p>
        <div class="steps">
          <div class="step"><span class="idx">01</span><div><b>Anatomy</b><p>Real teeth, not a generic surface.</p></div></div>
          <div class="step"><span class="idx">02</span><div><b>Margin</b><p>The line the restoration has to follow.</p></div></div>
          <div class="step"><span class="idx">03</span><div><b>Contacts</b><p>How the case meets the adjacent teeth.</p></div></div>
          <div class="step"><span class="idx">04</span><div><b>Occlusion</b><p>How it meets the opposing arch.</p></div></div>
        </div>''',
)

add_post(
    "05-crown-design",
    "05",
    f'''<p class="kicker"><i></i>Crown design</p>
        <h1>A proposal shaped by the scan.</h1>
        <p class="lede">An anatomic crown, proposed from the preparation and the adjacent teeth. It is a starting point for review, not a finished case.</p>
        <div class="art" style="flex-direction:column">{mark(250)}<div class="margin-label">MARGIN · CONTACTS · OCCLUSION</div></div>''',
)

add_post(
    "06-research-development",
    "06",
    '''<p class="kicker"><i></i>Research</p>
        <h1>Grounded in dental geometry.</h1>
        <p class="lede">The work follows the shape of the scan. Each layer is in development.</p>
        <div class="layers">
          <div class="layer"><b>Mesh understanding</b><span>L1</span></div>
          <div class="layer"><b>Anatomy recognition</b><span>L2</span></div>
          <div class="layer"><b>Restoration proposal</b><span>L3</span></div>
          <div class="layer"><b>Professional editing</b><span>L4</span></div>
        </div>''',
)

add_post(
    "07-laboratory-collaboration",
    "07",
    '''<p class="kicker"><i></i>Laboratories</p>
        <h1>Built for the laboratory.</h1>
        <p class="lede">For technicians and digital dentistry teams who already design the case.</p>
        <div class="trio">
          <div class="cell"><b>Scan in</b><p>The 3D dental file the lab already receives.</p></div>
          <div class="arrow">→</div>
          <div class="cell"><b>Review</b><p>A proposal the professional can edit.</p></div>
          <div class="arrow">→</div>
          <div class="cell"><b>File out</b><p>STL for the next production step.</p></div>
        </div>''',
)

add_post(
    "08-human-control",
    "08",
    '''<p class="kicker"><i></i>Human control</p>
        <h1 style="font-size:84px">AI proposes.<br>The professional<br><em>decides.</em></h1>
        <p class="lede">The model does not approve a case. Margin, contact, and occlusal decisions stay with the person responsible for it.</p>''',
)

add_post(
    "09-our-mission",
    "09",
    f'''<div class="art" style="margin-top:0;margin-bottom:28px">{mark(180)}</div>
        <p class="kicker"><i></i>Our mission</p>
        <h1>Precision, reimagined.</h1>
        <p class="lede">FAUCHAR is building AI-assisted crown and bridge design. The name looks back to Pierre Fauchard. The responsibility stays with the professional using it.</p>''',
)

STORIES = [
    (
        "01-official-launch",
        "01",
        "Introducing",
        "FAUCHAR",
        f'''<div class="reticle">{ring(460)}{mark(250)}</div>
            <p class="support">Building AI for Crown &amp; Bridge Design.</p>
            <p class="support">Transforming 3D dental scans into intelligent restoration workflows.</p>''',
        "The future of digital dentistry starts here.",
    ),
    (
        "02-our-technology",
        "02",
        "Our technology",
        "Read the geometry.",
        f'''<div class="art" style="display:flex">{mark(280)}</div>
            <p class="support">From an intraoral scan toward a crown or bridge proposal. Mesh, anatomy, and restoration form. Not a generic chatbot.</p>''',
        "The professional can still edit the result.",
    ),
    (
        "03-our-vision",
        "03",
        "Our vision",
        "Precision,<br><em>reimagined.</em>",
        '''<p class="support">Software prepares more of the case. The person at the bench remains responsible for the dentistry.</p>
            <div class="points">
              <div class="point"><i></i>Crown and bridge design</div>
              <div class="point"><i></i>3D scans, not flat images</div>
              <div class="point"><i></i>Review before anything is final</div>
            </div>''',
        "fauchar.com",
    ),
    (
        "04-research-development",
        "04",
        "Research",
        "In development,<br>on purpose.",
        '''<div class="points">
              <div class="point"><i></i>Understand the mesh</div>
              <div class="point"><i></i>Recognize the anatomy</div>
              <div class="point"><i></i>Propose the restoration</div>
              <div class="point"><i></i>Leave the edit to the professional</div>
            </div>
            <p class="support">Performance claims wait until the research can support them.</p>''',
        "Research first. Claims later.",
    ),
    (
        "05-laboratory-collaboration",
        "05",
        "Laboratories",
        "For the people who finish the case.",
        '''<div class="points">
              <div class="point"><i></i>The scan the lab already receives</div>
              <div class="point"><i></i>A proposal that can be edited</div>
              <div class="point"><i></i>An STL for the next production step</div>
            </div>
            <p class="support">Dental laboratories, technicians, and digital dentistry teams.</p>''',
        "Talk to us at fauchar.com",
    ),
]


def write(path: Path, html: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html)


def main():
    posts_dir = ROOT / "posts"
    stories_dir = ROOT / "stories"
    pages = ROOT / "pages"
    for filename, num, article in POSTS:
        write(posts_dir / f"{filename}.html", page(f"FAUCHAR post {num}", POST_CSS, article))
    story_articles = []
    for filename, num, kicker, title, mid, close in STORIES:
        article = shell_story(num, kicker, title, mid, close)
        story_articles.append(article)
        write(stories_dir / f"{filename}.html", page(f"FAUCHAR story {num}", STORY_CSS, article))

    feed_css = POST_CSS + """
      body { width: 3544px; height: auto; background: #ecebe6; }
      .board { padding: 72px; }
      h1.page-title { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 56px; letter-spacing: -0.03em; color: #0b1114; }
      .page-lead { margin: 12px 0 40px; color: #4a545b; font-size: 20px; max-width: 900px; }
      .grid { display: grid; grid-template-columns: repeat(3, 1080px); gap: 64px; }
    """
    feed_body = f'''<main class="board">
      <h1 class="page-title">Instagram Feed — 9 Posts</h1>
      <p class="page-lead">Nine editable frames, 1080 × 1350. The profile grid crops each frame to the center square. Headlines and the logo sit inside that crop.</p>
      <div class="grid">{"".join(a for _, _, a in POSTS)}</div>
    </main>'''
    write(pages / "feed.html", page("Instagram Feed — 9 Posts", feed_css, feed_body, capture=True))

    story_css = STORY_CSS + """
      body { width: 5832px; height: auto; background: #ecebe6; }
      .board { padding: 72px; }
      h1.page-title { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 56px; letter-spacing: -0.03em; color: #0b1114; }
      .page-lead { margin: 12px 0 40px; color: #4a545b; font-size: 20px; max-width: 900px; }
      .row { display: flex; gap: 48px; }
    """
    story_body = f'''<main class="board">
      <h1 class="page-title">Instagram Stories</h1>
      <p class="page-lead">Five editable frames, 1080 × 1920. Story 01 is the official launch and is published first. Keep type between the top and bottom interface zones.</p>
      <div class="row">{"".join(story_articles)}</div>
    </main>'''
    write(pages / "stories.html", page("Instagram Stories", story_css, story_body, capture=True))

    brand = brand_page()
    write(pages / "brand.html", page("Brand Guidelines", brand[0], brand[1], capture=True))
    publishing = publishing_page()
    write(pages / "publishing.html", page("Publishing Assets", publishing[0], publishing[1], capture=True))
    grid_css = """
      body { width: 1080px; height: 1350px; overflow: hidden; background: #0b1114; }
      .grid { width: 1080px; height: 1350px; display: grid; grid-template-columns: repeat(3, 360px); grid-template-rows: repeat(3, 450px); }
      .cell { width: 360px; height: 450px; overflow: hidden; }
      .cell .post { transform: scale(0.3333333); transform-origin: top left; }
    """
    cells = "".join(f'<div class="cell">{a}</div>' for _, _, a in POSTS)
    write(pages / "grid.html", page("Instagram grid preview", POST_CSS + grid_css, f'<div class="grid">{cells}</div>'))
    print("wrote", len(POSTS), "posts and", len(STORIES), "stories")


def brand_page():
    css = BASE + """
      body { width: 1600px; background: #ecebe6; color: #0b1114; }
      .board { padding: 80px; }
      .tag { font-size: 14px; font-weight: 600; letter-spacing: 0.2em; color: #5d8a12; }
      h1 { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 64px; letter-spacing: -0.035em; margin-top: 12px; }
      h2 { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 36px; letter-spacing: -0.03em; margin: 48px 0 16px; }
      p { font-size: 18px; line-height: 1.5; color: #333d44; max-width: 860px; }
      .lock { display: flex; align-items: center; gap: 22px; }
      .word { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 42px; letter-spacing: 0.14em; color: #f5f4ef; line-height: 1; }
      .desc { margin-top: 8px; font-size: 13px; font-weight: 600; letter-spacing: 0.22em; color: #8a929a; }
      .light .word { color: #0b1114; }
      .row { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; margin-top: 28px; }
      .panel { border-radius: 24px; min-height: 360px; display: flex; align-items: center; justify-content: center; }
      .dark { background: #0b1114; }
      .light { background: #f5f4ef; border: 1px solid #e1e0da; }
      .swatches { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin-top: 12px; }
      .sw { border-radius: 16px; min-height: 150px; padding: 18px; display: flex; flex-direction: column; justify-content: flex-end; font-size: 14px; line-height: 1.45; }
      .rules { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 12px; }
      .rule { background: #fff; border-radius: 16px; padding: 22px; }
      .rule b { display: block; font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 22px; margin-bottom: 6px; }
      .specimen { margin-top: 8px; background: #fff; border-radius: 16px; padding: 28px; }
      .specimen .big { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 72px; letter-spacing: -0.04em; }
    """
    on_light = mark(220, "#0B1114", "#6f9a1f")
    body = f'''<main class="board">
      <div class="tag">FAUCHAR · INSTAGRAM LAUNCH</div>
      <h1>Brand guidelines</h1>
      <p>Use these rules on every post and story in this file. The mark is the voxel molar: 56 cells, one lime cell. Lime always means the model’s signal, never decoration.</p>
      <div class="row">
        <div class="panel dark">{lockup(120)}</div>
        <div class="panel light">{lockup_light()}</div>
      </div>
      <h2>Color</h2>
      <div class="swatches">
        <div class="sw" style="background:#0b1114;color:#f5f4ef">Graphite<br>#0B1114</div>
        <div class="sw" style="background:#b7f34a;color:#0b1114">Signal lime<br>#B7F34A</div>
        <div class="sw" style="background:#f5f4ef;color:#0b1114">Ivory<br>#F5F4EF</div>
        <div class="sw" style="background:#d9dcd6;color:#0b1114">Mist<br>#D9DCD6</div>
        <div class="sw" style="background:#8a929a;color:#0b1114">Slate<br>#8A929A</div>
      </div>
      <h2>Type</h2>
      <div class="specimen">
        <div class="big">Aa — Space Grotesk</div>
        <p style="margin-top:12px">Headlines. Inter is used for text, labels, and the descriptor.</p>
      </div>
      <h2>Instagram frame</h2>
      <div class="rules">
        <div class="rule"><b>Feed, 1080 × 1350</b><p>The profile grid shows the center 1080 × 1080. The logo and the headline sit inside that square. Outer bands hold only the lockup and the footer.</p></div>
        <div class="rule"><b>Story, 1080 × 1920</b><p>Keep type clear of the top 280 px and the bottom 280 px, where Instagram places the profile and the reply bar.</p></div>
        <div class="rule"><b>Say this</b><p>FAUCHAR is building AI-assisted crown and bridge design. The professional reviews the proposal. Research is in progress.</p></div>
        <div class="rule"><b>Do not say this</b><p>No accuracy percentages, no clinical-validation claims, no “available now.” One lime cell only. Do not redraw the molar.</p></div>
      </div>
      <h2>Mark, on ivory</h2>
      <div class="panel light" style="margin-top:12px">{on_light}</div>
    </main>'''
    return css, body


def lockup_light():
    return (
        f'<div class="lock">{mark(120, "#0B1114", "#6f9a1f")}'
        f'<div><div class="word" style="color:#0b1114">FAUCHAR</div>'
        f'<div class="desc">DENTAL INTELLIGENCE</div></div></div>'
    )


def publishing_page():
    css = BASE + POST_CSS + """
      body { width: 1440px; background: #ecebe6; color: #0b1114; }
      .board { padding: 72px; }
      h1 { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 56px; letter-spacing: -0.03em; }
      .lead { margin: 12px 0 28px; color: #4a545b; font-size: 18px; max-width: 760px; }
      .grid { width: 1080px; height: 1350px; display: grid; grid-template-columns: repeat(3, 360px); grid-template-rows: repeat(3, 450px); background: #0b1114; }
      .cell { width: 360px; height: 450px; overflow: hidden; }
      .cell .post { transform: scale(0.3333333); transform-origin: top left; }
      ol { margin-top: 28px; display: flex; flex-direction: column; gap: 8px; font-size: 18px; }
      h2 { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 500; font-size: 32px; margin-top: 36px; }
    """
    cells = "".join(f'<div class="cell">{a}</div>' for _, _, a in POSTS)
    files = "".join(f"<li>{fn}.png</li>" for fn, _, _ in POSTS)
    stories = "".join(f"<li>{fn}.png — publish story {num} {'first' if num=='01' else ''}</li>" for fn, num, *_ in STORIES)
    body = f'''<main class="board">
      <h1>Publishing assets</h1>
      <p class="lead">Profile grid, in publishing order, left to right, top to bottom. Export each feed frame at 1080 × 1350 and each story at 1080 × 1920.</p>
      <div class="grid">{cells}</div>
      <h2>Feed order</h2>
      <ol>{files}</ol>
      <h2>Story order</h2>
      <ol>{stories}</ol>
    </main>'''
    return css, body


if __name__ == "__main__":
    main()
