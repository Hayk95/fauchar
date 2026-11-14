import { voxelMarkSvg } from "@/lib/brandMark";

const HV_C = 300;

function hvPoint(r: number, deg: number, size: number) {
  const a = (deg * Math.PI) / 180;
  return {
    x: (HV_C + r * Math.cos(a) - size / 2).toFixed(1),
    y: (HV_C + r * Math.sin(a) - size / 2).toFixed(1),
  };
}

/** A lime voxel leading a short trail of fading ivory voxels along a ring. */
function hvComet(r: number, deg: number, dir: 1 | -1) {
  return [0, 1, 2, 3]
    .map((i) => {
      const size = i === 0 ? 7 : 6 - i;
      const p = hvPoint(r, deg - dir * i * 3.2, size);
      const cls = i === 0 ? "hv-vox hv-vox--lead" : "hv-vox";
      return `<rect class="${cls}" x="${p.x}" y="${p.y}" width="${size}" height="${size}" rx="1" style="opacity:${(1 - i * 0.24).toFixed(2)}"/>`;
    })
    .join("");
}

/** Deterministic scatter of voxels in the ring band around the crown. */
function hvCloud() {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const cells: string[] = [];
  for (let i = 0; i < 34; i++) {
    const r = 176 + rnd() * 78;
    const deg = rnd() * 360;
    const size = 3 + Math.round(rnd() * 3);
    const p = hvPoint(r, deg, size);
    const lime = rnd() > 0.82 ? " hv-cell--lime" : "";
    cells.push(
      `<rect class="hv-cell${lime}" x="${p.x}" y="${p.y}" width="${size}" height="${size}" rx="1" style="--t:${(rnd() * 6).toFixed(2)}s"/>`,
    );
  }
  return cells.join("");
}

export const landingHtml = `<svg class="sprite" aria-hidden="true" focusable="false">
    <symbol id="i-ai" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5"/><path d="m12 8.6.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></symbol>
    <symbol id="i-cube" viewBox="0 0 24 24"><path d="M12 2.75 20.25 7.5v9L12 21.25 3.75 16.5v-9z"/><path d="M3.75 7.5 12 12.25l8.25-4.75M12 12.25v9"/></symbol>
    <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 7h8M16 7h4M4 17h3M11 17h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></symbol>
    <symbol id="i-mesh" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.25"/><ellipse cx="12" cy="12" rx="8.25" ry="3.25"/><ellipse cx="12" cy="12" rx="3.25" ry="8.25"/></symbol>
    <symbol id="i-scan" viewBox="0 0 24 24"><path d="M3.75 8V5.25a1.5 1.5 0 0 1 1.5-1.5H8M16 3.75h2.75a1.5 1.5 0 0 1 1.5 1.5V8M20.25 16v2.75a1.5 1.5 0 0 1-1.5 1.5H16M8 20.25H5.25a1.5 1.5 0 0 1-1.5-1.5V16"/><path transform="translate(12 12.3) scale(.6) translate(-12 -12.3)" vector-effect="non-scaling-stroke" d="M7 8.2C7 5.6 9.2 4.4 11 5.4l1 .55 1-.55c1.8-1 4 .2 4 2.8 0 3.1-1.1 4.6-1.6 6.9l-.75 4.3c-.2 1.1-1.75 1.1-1.95 0L12.5 15h-1l-.95 4.4c-.2 1.1-1.75 1.1-1.95 0l-.75-4.3C7.1 12.8 7 11.3 7 8.2z"/></symbol>
    <symbol id="i-tooth" viewBox="0 0 24 24"><path transform="translate(-1.25 .75)" d="M7 8.2C7 5.6 9.2 4.4 11 5.4l1 .55 1-.55c1.8-1 4 .2 4 2.8 0 3.1-1.1 4.6-1.6 6.9l-.75 4.3c-.2 1.1-1.75 1.1-1.95 0L12.5 15h-1l-.95 4.4c-.2 1.1-1.75 1.1-1.95 0l-.75-4.3C7.1 12.8 7 11.3 7 8.2z"/><path d="m19 2 .7 1.8 1.8.7-1.8.7L19 7l-.7-1.8-1.8-.7 1.8-.7z"/></symbol>
    <symbol id="i-bezier" viewBox="0 0 24 24"><path d="M5 19C6.5 10 17.5 14 19 5"/><path d="M5 19 8.5 11.5M19 5l-3.5 7.5" stroke-dasharray="1.5 2.5"/><rect x="3" y="17" width="4" height="4" rx="1"/><rect x="17" y="3" width="4" height="4" rx="1"/></symbol>
    <symbol id="i-cycle" viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-13.66 5.66M4 12a8 8 0 0 1 13.66-5.66"/><path d="M14.5 6.3h3.2V3.1M9.5 17.7H6.3v3.2"/><circle cx="12" cy="12" r="2"/></symbol>
    <symbol id="i-section" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M3 15.5 21 8.5"/><path d="M6 15c1.5 2.4 3.6 3.5 6 3.5 3.2 0 5.6-2 6.6-4.8" opacity=".45"/></symbol>
    <symbol id="i-wire" viewBox="0 0 24 24"><path d="M12 3.5 20.5 19h-17z"/><path d="M7.75 11.25h8.5L12 19z"/></symbol>
    <symbol id="i-xray" viewBox="0 0 24 24"><path d="M6.5 9.5c0-3.2 2.4-5.5 5.5-5.5s5.5 2.3 5.5 5.5c0 4.4-1.8 10-5.5 10s-5.5-5.6-5.5-10z" stroke-dasharray="2.2 2.4"/><path d="M9.5 12.5c0-1.6 1.1-2.6 2.5-2.6s2.5 1 2.5 2.6v3.5h-5z"/></symbol>
    <symbol id="i-close" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></symbol>
    <symbol id="i-undo" viewBox="0 0 24 24"><path d="M9 7 4.5 11.5 9 16"/><path d="M4.5 11.5H15a4.5 4.5 0 0 1 0 9h-2"/></symbol>
    <symbol id="i-redo" viewBox="0 0 24 24"><path d="M15 7l4.5 4.5L15 16"/><path d="M19.5 11.5H9a4.5 4.5 0 0 0 0 9h2"/></symbol>
    <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m8 10 4 4 4-4"/></symbol>
    <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></symbol>
    <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></symbol>
    <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M4 4l16 16M9.9 6A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.6 16.6 0 0 1-2.9 3.6M6.1 7.9A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 3.6-.7"/></symbol>
    <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="i-minus" viewBox="0 0 24 24"><path d="M5 12h14"/></symbol>
    <symbol id="i-fit" viewBox="0 0 24 24"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><circle cx="12" cy="12" r="2.5"/></symbol>
  </svg>
  <a class="skip" href="#content">Skip to content</a>

  <header class="site-header" id="header">
    <div class="wrap header-inner">
      <a class="logo" href="#top" aria-label="FAUCHAR, home">
        ${voxelMarkSvg("mark")}
        <span class="logo-lockup" aria-hidden="true">
          <svg class="logo-word" viewBox="-1.5 -1.5 157 23.6" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4"><path d="M1.2 20V1.2H13M1.2 10.4H11"/><path d="M22 20.6 29 1 36 20.6"/><path d="M45.2 0v12.6a6.8 6.8 0 0 0 13.6 0V0"/><path d="M85.5 4.3A9.6 9.6 0 1 0 85.5 15.7"/><path d="M94.2 0v20M108.6 0v20M94.2 10.2h14.4"/><path d="M117 20.6 124 1 131 20.6"/><path d="M141.2 20V1.2h7.6a5.3 5.3 0 0 1 0 10.6h-7.6M147.6 11.8 154 20"/></g></svg>
          <span class="logo-descriptor">Dental Intelligence</span>
        </span>
      </a>

      <nav class="site-nav" id="site-nav" aria-label="Primary">
        <ul>
          <li><a href="#vision">Vision</a></li>
          <li><a href="#technology">Technology</a></li>
          <li><a href="#product">Product</a></li>
          <li><a href="#story">Our Story</a></li>
          <li><a href="#roadmap">Roadmap</a></li>
          <li><a href="#contact">Contact</a></li>
        </ul>
        <div class="nav-foot">
          <a class="btn btn-ghost" href="/signin">Sign in</a>
          <a class="btn btn-primary" href="#contact" data-focus="contact-name">Get in Touch</a>
        </div>
      </nav>

      <a class="btn btn-ghost header-cta" href="/signin" style="margin-right:0.5rem">Sign in</a>
      <a class="btn btn-primary header-cta" href="#contact" data-focus="contact-name">Get in Touch</a>

      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
        <span class="sr-only" data-toggle-label>Open menu</span>
        <span class="nav-toggle-icon" aria-hidden="true"></span>
      </button>
    </div>
  </header>

  <main id="content" class="focus-target" tabindex="-1">

    <!-- ============ HERO ============ -->
    <section class="hero band-dark" id="top" aria-labelledby="hero-title">
      <div class="hero-grid-bg" aria-hidden="true"></div>
      <div class="hero-glow" aria-hidden="true"></div>

      <div class="wrap hero-wrap">
        <div class="hero-layout">
          <div class="hero-copy">
            <h1 id="hero-title" class="hero-in" style="--d:1">The Future of Dental Design Is <em>Intelligent.</em></h1>
            <p class="hero-lead hero-in" style="--d:2">FAUCHAR is building a new generation of AI-powered dental design technology, transforming complex 3D dental scans into intelligent crown and bridge design workflows.</p>
            <div class="actions hero-in" style="--d:3">
              <a class="btn btn-primary" href="#technology">Explore Our Technology
                <svg class="btn-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
              </a>
              <a class="btn btn-ghost" href="#vision">Discover FAUCHAR</a>
            </div>

            <ul class="hero-descriptors hero-in" style="--d:4">
              <li><span class="desc-ico"><svg class="ico" aria-hidden="true"><use href="#i-ai"/></svg></span>AI-Powered Design</li>
              <li><span class="desc-ico"><svg class="ico" aria-hidden="true"><use href="#i-cube"/></svg></span>3D Dental Intelligence</li>
              <li><span class="desc-ico"><svg class="ico" aria-hidden="true"><use href="#i-sliders"/></svg></span>Professional Workflows</li>
            </ul>
          </div>

          <div class="hero-visual" aria-hidden="true">
            <div class="hv-glow"></div>
            <svg class="hv-rings" viewBox="0 0 600 600">
              <circle class="hv-ring hv-ring--outer" cx="300" cy="300" r="268"/>
              <circle class="hv-ring hv-ring--ticks" cx="300" cy="300" r="276"/>
              <circle class="hv-ring hv-ring--sweep" cx="300" cy="300" r="268"/>
              <circle class="hv-ring hv-ring--mid" cx="300" cy="300" r="212"/>
              <circle class="hv-ring hv-ring--inner" cx="300" cy="300" r="156"/>
              <circle class="hv-ring hv-ring--arc" cx="300" cy="300" r="156"/>
              <circle class="hv-ping" cx="300" cy="300" r="240"/>
              <circle class="hv-ping hv-ping--2" cx="300" cy="300" r="240"/>
              <g class="hv-cloud">${hvCloud()}</g>
              <g class="hv-orbit hv-orbit--outer">${hvComet(268, -90, 1)}${hvComet(268, 90, 1)}</g>
              <g class="hv-orbit hv-orbit--mid">${hvComet(212, 30, -1)}</g>
              <path class="hv-cross" d="M300 14v26M300 560v26M14 300h26M560 300h26"/>
            </svg>
            <div class="hv-shadow"></div>
            <div class="hv-stage">
              <div class="hv-float">
                <div class="hv-scene hv-scene--crown">
                <div class="hv-object">
                  <img class="hv-scan" src="/assets/crown-rawscan.webp" width="820" height="820" alt="" decoding="async">
                  <img class="hv-crown" src="/assets/crown-float.png" width="820" height="820" alt="" fetchpriority="high" decoding="async">
                  <span class="hv-sheen"></span>
                  <span class="hv-beam"><i></i></span>
                </div>
                <svg class="hv-callouts" viewBox="0 0 600 600">
                  <path class="hv-line" d="M297 262 382 172H520"/>
                  <path class="hv-line" d="M372 350 450 420H560"/>
                  <path class="hv-line" d="M258 380 180 462H44"/>
                  <path class="hv-flow" style="--f:0s" d="M297 262 382 172H520"/>
                  <path class="hv-flow" style="--f:1.4s" d="M372 350 450 420H560"/>
                  <path class="hv-flow" style="--f:2.8s" d="M258 380 180 462H44"/>
                  <circle class="hv-ripple" style="--f:0s" cx="297" cy="262" r="4"/>
                  <circle class="hv-ripple" style="--f:1.4s" cx="372" cy="350" r="4"/>
                  <circle class="hv-ripple" style="--f:2.8s" cx="258" cy="380" r="4"/>
                  <circle class="hv-pt" cx="297" cy="262" r="4"/>
                  <circle class="hv-pt" cx="372" cy="350" r="4"/>
                  <circle class="hv-pt" cx="258" cy="380" r="4"/>
                  <text class="hv-tag" x="388" y="162">OCCLUSAL ANATOMY</text>
                  <text class="hv-tag" x="456" y="410">CONTOUR</text>
                  <text class="hv-tag" x="44" y="452">MARGIN</text>
                </svg>
                </div>
                <div class="hv-scene hv-scene--bridge">
                  <div class="hv-bridge">
                    <img class="hv-bridge-scan" src="/assets/bridge-rawscan.webp" width="691" height="485" alt="" loading="lazy" decoding="async">
                    <img class="hv-bridge-img" src="/assets/bridge-float.png" width="691" height="485" alt="" loading="lazy" decoding="async">
                    <span class="hv-sheen hv-sheen--bridge"></span>
                    <span class="hv-beam hv-beam--bridge"><i></i></span>
                  </div>
                  <svg class="hv-callouts hv-callouts--bridge" viewBox="0 0 600 600">
                    <path class="hv-line" d="M228 300 186 150H86"/>
                    <path class="hv-line" d="M365 300 417 150H517"/>
                    <path class="hv-line" d="M434 352 470 440H560"/>
                    <path class="hv-flow" style="--f:0s" d="M228 300 186 150H86"/>
                    <path class="hv-flow" style="--f:1.4s" d="M365 300 417 150H517"/>
                    <path class="hv-flow" style="--f:2.8s" d="M434 352 470 440H560"/>
                    <circle class="hv-pt" cx="228" cy="300" r="4"/>
                    <circle class="hv-pt" cx="365" cy="300" r="4"/>
                    <circle class="hv-pt" cx="434" cy="352" r="4"/>
                    <text class="hv-tag" x="90" y="140">CONNECTOR</text>
                    <text class="hv-tag" x="423" y="140">CONNECTOR</text>
                    <text class="hv-tag" x="456" y="430">3-UNIT BRIDGE</text>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="hero-foot">
          <span>Crown &amp; Bridge · Scan to Design</span>
          <a class="scroll-cue" href="#vision"><span class="sr-only">Scroll to vision</span><span aria-hidden="true">Scroll</span><span class="scroll-line" aria-hidden="true"></span></a>
        </div>
      </div>
    </section>

    <!-- ============ BIG IDEA ============ -->
    <section class="section band-light idea" id="vision" aria-labelledby="vision-title" tabindex="-1">
      <div class="wrap idea-grid">
        <div class="idea-copy reveal">
          <h2 id="vision-title" class="display">We Believe Dental Design Can Be Different.</h2>
          <p class="lead">Digital dentistry has evolved significantly, but complex restoration design still requires extensive specialized work.</p>
          <p>FAUCHAR aims to introduce a new approach by combining dental expertise, computational geometry, and artificial intelligence.</p>
          <p>We are building technology that can understand dental anatomy and assist professionals in creating restoration designs, with the professional always reviewing, refining, and deciding.</p>
          <dl class="idea-pillars">
            <div><dt>Dental expertise</dt><dd>Workflows shaped around how restorations are actually designed.</dd></div>
            <div><dt>Computational geometry</dt><dd>Reading 3D scan meshes as structured anatomy, not just triangles.</dd></div>
            <div><dt>Artificial intelligence</dt><dd>Models that propose restoration geometry for expert review.</dd></div>
          </dl>
        </div>

        <figure class="idea-figure reveal" style="--d:1">
          <div class="idea-frame">
            <img src="/assets/crown-macro.jpg" width="1280" height="720" alt="Macro render of a ceramic molar crown showing occlusal anatomy, with fine technical construction lines." loading="lazy" decoding="async">
            <svg class="idea-annot" viewBox="0 0 1280 720" aria-hidden="true">
              <g fill="none" stroke="#B7F34A" stroke-width="2">
                <path class="draw" d="M560 320 L400 150 H70"/>
                <path class="draw" d="M800 560 L880 640 H1150"/>
                <path class="draw" d="M350 470 L220 560 H90"/>
              </g>
              <g fill="#B7F34A"><circle cx="560" cy="320" r="7"/><circle cx="800" cy="560" r="7"/><circle cx="350" cy="470" r="7"/></g>
              <g font-family="Inter, sans-serif" font-size="22" letter-spacing="3.5" fill="#F5F4EF">
                <text x="70" y="136">OCCLUSAL ANATOMY</text>
                <text x="900" y="626">MARGIN REGION</text>
                <text x="90" y="546">CONTACT AREA</text>
              </g>
            </svg>
            <span class="frame-corner tl" aria-hidden="true"></span>
            <span class="frame-corner br" aria-hidden="true"></span>
          </div>
          <figcaption>Illustrative render. Annotations indicate the kinds of anatomical features a design system must understand.</figcaption>
        </figure>
      </div>
    </section>

    <!-- ============ PROBLEM ============ -->
    <section class="section band-light problem" id="problem" aria-labelledby="problem-title">
      <div class="wrap">
        <header class="section-head split-head reveal">
          <div>
            <h2 id="problem-title" class="display">A Complex Process. An Opportunity for Intelligence.</h2>
          </div>
          <p class="lede">Turning a 3D dental scan into a production-ready crown or bridge is precise, expert work. Every stage, from reading the anatomy to exporting the file, is an opportunity for intelligent assistance.</p>
        </header>

        <div class="problem-grid">
          <article class="pcard pcard--wide reveal">
            <div class="pcard-art pcard-art--img" aria-hidden="true">
              <img src="/assets/crown-macro-float.png" width="820" height="585" alt="" loading="lazy" decoding="async">
            </div>
            <h3>Complex 3D Anatomy</h3>
            <p>Dental scans contain complex anatomical structures that must be understood before restoration design.</p>
          </article>

          <article class="pcard reveal" style="--d:1">
            <div class="pcard-art pcard-art--photo" aria-hidden="true">
              <img src="/assets/cad-bridge.jpg" width="1280" height="720" alt="" loading="lazy" decoding="async">
            </div>
            <h3>Specialized Design Work</h3>
            <p>Crown and bridge design requires specialized expertise and careful attention to detail.</p>
          </article>

          <article class="pcard reveal" style="--d:1">
            <div class="pcard-art pcard-art--cycle" aria-hidden="true">
              <div class="cycle">
                <svg class="cycle-ring" viewBox="-70 -8 340 216">
                  <circle class="cycle-glow" cx="100" cy="100" r="62"/>
                  <circle class="cycle-track" cx="100" cy="100" r="78"/>
                  <circle class="cycle-arc" cx="100" cy="100" r="78" transform="rotate(-130.4 100 100)"/>
                  <circle class="cycle-arc" cx="100" cy="100" r="78" transform="rotate(-40.4 100 100)"/>
                  <circle class="cycle-arc" cx="100" cy="100" r="78" transform="rotate(49.6 100 100)"/>
                  <circle class="cycle-arc cycle-arc--key" cx="100" cy="100" r="78" transform="rotate(139.6 100 100)"/>
                  <circle class="cycle-inner" cx="100" cy="100" r="92"/>
                  <g class="cycle-orbit"><circle class="cycle-dot" cx="100" cy="22" r="4"/></g>
                  <g class="cycle-labels">
                    <text x="100" y="4" text-anchor="middle">Analysis</text>
                    <text x="200" y="104">Modeling</text>
                    <text x="100" y="206" text-anchor="middle">Adjustment</text>
                    <text class="is-key" x="0" y="104" text-anchor="end">Review</text>
                  </g>
                </svg>
                <img class="cycle-crown" src="/assets/crown-float.png" width="820" height="820" alt="" loading="lazy" decoding="async">
              </div>
            </div>
            <h3>Time-Intensive Workflows</h3>
            <p>Manual processes can require multiple stages of analysis, modeling, adjustment, and review.</p>
          </article>

          <article class="pcard pcard--wide reveal" style="--d:2">
            <div class="pcard-art pcard-art--tools" aria-hidden="true">
              <div class="tools">
                <div class="tool">
                  <div class="tool-bar"><i></i><i></i><i></i><span>Scan viewer</span></div>
                  <div class="tool-view"><img class="tool-img--scan" src="/assets/crown-rawscan.webp" width="820" height="820" alt="" loading="lazy" decoding="async"></div>
                </div>
                <div class="tool-hop"><b>STL</b></div>
                <div class="tool tool--mid">
                  <div class="tool-bar"><i></i><i></i><i></i><span>CAD</span></div>
                  <div class="tool-view"><img src="/assets/step-design.webp" width="1280" height="720" alt="" loading="lazy" decoding="async"></div>
                </div>
                <div class="tool-hop"><b>STL</b></div>
                <div class="tool">
                  <div class="tool-bar"><i></i><i></i><i></i><span>Export</span></div>
                  <div class="tool-view"><img class="tool-img--export" src="/assets/step-export.webp" width="1280" height="720" alt="" loading="lazy" decoding="async"></div>
                </div>
              </div>
            </div>
            <h3>Fragmented Digital Processes</h3>
            <p>Professionals often work across several specialized tools and workflow stages.</p>
          </article>
        </div>
      </div>
    </section>

    <!-- ============ SOLUTION ============ -->
    <section class="section band-dark solution" id="technology" aria-labelledby="technology-title" tabindex="-1">
      <div class="wrap">
        <header class="section-head section-head--center reveal">
          <h2 id="technology-title" class="display">From 3D Scan to Intelligent Restoration Design.</h2>
          <p class="lede">One continuous workflow, from a raw dental scan to an editable, exportable restoration proposal. AI does the heavy geometric lifting. The professional stays in control.</p>
        </header>

        <div class="process" data-progress>
          <div class="process-track" aria-hidden="true"><span class="process-fill"></span></div>
          <ol class="process-steps">
            <li class="pstep reveal">
              <span class="pstep-node" aria-hidden="true"></span>
              <div class="pstep-art" aria-hidden="true">
                <img class="is-cutout" src="/assets/step-scan.webp" width="1280" height="720" alt="" loading="lazy" decoding="async">
                <span class="pstep-tag">Imported scan</span>
              </div>
              <span class="pstep-num">01</span>
              <h3>Upload</h3>
              <p>Upload dental STL scans. The platform accepts supported 3D dental scan files.</p>
            </li>
            <li class="pstep reveal" style="--d:1">
              <span class="pstep-node" aria-hidden="true"></span>
              <div class="pstep-art" aria-hidden="true">
                <img class="is-cutout" src="/assets/step-analysis.webp" width="1280" height="720" alt="" loading="lazy" decoding="async">
                <span class="pstep-tag">Segmented</span>
              </div>
              <span class="pstep-num">02</span>
              <h3>AI Analysis</h3>
              <p>The AI analyzes the 3D geometry and identifies relevant dental structures.</p>
              <ul class="pstep-list">
                <li>Tooth segmentation</li>
                <li>Preparation detection</li>
                <li>Adjacent tooth identification</li>
                <li>Anatomical structure analysis</li>
                <li>Geometry assessment</li>
              </ul>
            </li>
            <li class="pstep pstep--feature reveal" style="--d:2">
              <span class="pstep-node" aria-hidden="true"></span>
              <div class="pstep-art" aria-hidden="true">
                <img src="/assets/step-design.webp" width="1280" height="720" alt="" loading="lazy" decoding="async">
                <span class="pstep-tag">Proposal</span>
              </div>
              <span class="pstep-num">03</span>
              <h3>AI Design Generation</h3>
              <p>Generate an AI-assisted crown or bridge design proposal based on the available scan geometry.</p>
            </li>
            <li class="pstep reveal" style="--d:3">
              <span class="pstep-node" aria-hidden="true"></span>
              <div class="pstep-art" aria-hidden="true">
                <img src="/assets/step-edit.webp" width="1280" height="720" alt="" loading="lazy" decoding="async">
                <span class="pstep-tag">Editable mesh</span>
              </div>
              <span class="pstep-num">04</span>
              <h3>Professional Editing</h3>
              <p>The dental professional reviews the generated design and can refine relevant geometry.</p>
              <ul class="pstep-list">
                <li>Margin adjustment</li>
                <li>Contact adjustment</li>
                <li>Occlusal adjustment</li>
                <li>Surface modification</li>
                <li>Restoration geometry editing</li>
              </ul>
            </li>
            <li class="pstep reveal" style="--d:4">
              <span class="pstep-node" aria-hidden="true"></span>
              <div class="pstep-art" aria-hidden="true">
                <img class="is-cutout" src="/assets/step-export.webp" width="1280" height="720" alt="" loading="lazy" decoding="async">
                <span class="pstep-tag">Ready to export</span>
              </div>
              <span class="pstep-num">05</span>
              <h3>Export</h3>
              <p>Export supported 3D files, including STL, for the next step in the lab workflow.</p>
            </li>
          </ol>
        </div>

        <figure class="transform reveal">
          <div class="transform-row">
            <div class="transform-item">
              <img src="/assets/crown-rawscan.webp" width="820" height="820" alt="Grey scanned tooth surface with its triangle mesh, representing raw scan geometry." loading="lazy" decoding="async">
              <span>Raw scan geometry</span>
            </div>
            <span class="transform-arrow" aria-hidden="true"><svg viewBox="0 0 60 12"><path d="M0 6h56M50 1l6 5-6 5" fill="none" stroke="currentColor" stroke-width="1"/></svg></span>
            <div class="transform-item">
              <img src="/assets/crown-scan-float.png" width="820" height="820" alt="Crown with a lime surface mesh, representing AI-assisted analysis and generation." loading="lazy" decoding="async">
              <span>Analysis &amp; generation</span>
            </div>
            <span class="transform-arrow" aria-hidden="true"><svg viewBox="0 0 60 12"><path d="M0 6h56M50 1l6 5-6 5" fill="none" stroke="currentColor" stroke-width="1"/></svg></span>
            <div class="transform-item">
              <img src="/assets/crown-float.png" width="820" height="820" alt="Finished ceramic crown design, representing the reviewed restoration." loading="lazy" decoding="async">
              <span>Reviewed restoration design</span>
            </div>
          </div>
          <figcaption class="note"><span class="tag">Product vision</span> This is the planned FAUCHAR workflow. It is not presented as a commercially available or clinically validated product.</figcaption>
        </figure>
      </div>
    </section>

    <!-- ============ PRODUCT EXPERIENCE ============ -->
    <section class="section band-light product" id="product" aria-labelledby="product-title" tabindex="-1">
      <div class="wrap">
        <header class="section-head split-head reveal">
          <div>
            <h2 id="product-title" class="display">A New Kind of Dental Design Workspace.</h2>
          </div>
          <p class="lede">A focused CAD environment where AI proposes and the technician decides. Step through the workflow below, rotate the case, open a section, and inspect contacts, occlusion and wall thickness. Every map and measurement is computed from the geometry.</p>
        </header>

        <figure class="cad reveal" id="cad" data-step="design">
          <div class="cad-frame">
            <!-- Title bar -->
            <div class="cad-titlebar">
              <span class="cad-dots" aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="cad-app">
                ${voxelMarkSvg("mark")}
                FAUCHAR Design
              </span>
              <span class="cad-tab" aria-hidden="true">
                <svg class="ico"><use href="#i-tooth"/></svg>
                <span class="cad-tab-name">Crown 22</span><span class="cad-tab-meta">Demo case · Upper</span>
                <span class="cad-tab-x"><svg class="ico"><use href="#i-close"/></svg></span>
              </span>
              <span class="cad-titlebar-end">
                <span class="cad-save" aria-hidden="true"><span class="cad-save-dot"></span>Demo session · not saved</span>
                <span class="tag tag--lime">Conceptual interface</span>
              </span>
            </div>

            <!-- Menu bar -->
            <div class="cad-menubar" aria-hidden="true">
              <span>File</span><span>Edit</span><span>View</span><span>Design</span><span>Analysis</span><span>Tools</span><span>Window</span><span>Help</span>
              <span class="cad-menubar-end">
                <svg class="ico"><use href="#i-undo"/></svg><svg class="ico"><use href="#i-redo"/></svg>
                <span class="cad-menubar-sep"></span>
                <span>FDI</span><span>mm</span>
              </span>
            </div>

            <!-- Command ribbon -->
            <div class="cad-ribbon" role="toolbar" aria-label="Design tools">
              <div class="rb-group">
                <div class="rb-items">
                  <button type="button" class="rb-btn" data-tool="fit"><svg class="ico"><use href="#i-fit"/></svg><span>Fit</span></button>
                  <button type="button" class="rb-btn" data-tool="zoom-in"><svg class="ico"><use href="#i-plus"/></svg><span>Zoom in</span></button>
                  <button type="button" class="rb-btn" data-tool="zoom-out"><svg class="ico"><use href="#i-minus"/></svg><span>Zoom out</span></button>
                </div>
                <span class="rb-label">Navigate</span>
              </div>
              <div class="rb-group">
                <div class="rb-items">
                  <button type="button" class="rb-btn" data-cam="occlusal"><span class="rb-glyph">O</span><span>Occlusal</span></button>
                  <button type="button" class="rb-btn" data-cam="buccal"><span class="rb-glyph">F</span><span>Facial</span></button>
                  <button type="button" class="rb-btn" data-cam="lingual"><span class="rb-glyph">P</span><span>Palatal</span></button>
                  <button type="button" class="rb-btn" data-cam="mesial"><span class="rb-glyph">M</span><span>Mesial</span></button>
                  <button type="button" class="rb-btn" data-cam="distal"><span class="rb-glyph">D</span><span>Distal</span></button>
                </div>
                <span class="rb-label">Views</span>
              </div>
              <div class="rb-group">
                <div class="rb-items">
                  <button type="button" class="rb-btn" data-tool="section" aria-pressed="false"><svg class="ico"><use href="#i-section"/></svg><span>Section</span></button>
                  <button type="button" class="rb-btn" data-tool="mesh" aria-pressed="false"><svg class="ico"><use href="#i-wire"/></svg><span>Mesh</span></button>
                  <button type="button" class="rb-btn" data-tool="xray" aria-pressed="false"><svg class="ico"><use href="#i-xray"/></svg><span>X-ray</span></button>
                </div>
                <span class="rb-label">Display</span>
              </div>
              <div class="rb-group">
                <div class="rb-items">
                  <div class="cad-analysis" role="group" aria-label="Analysis map">
                    <button type="button" data-map="none" aria-pressed="true">Off</button>
                    <button type="button" data-map="contacts" aria-pressed="false">Contacts</button>
                    <button type="button" data-map="occlusion" aria-pressed="false">Occlusion</button>
                    <button type="button" data-map="thickness" aria-pressed="false">Thickness</button>
                  </div>
                </div>
                <span class="rb-label">Analysis map</span>
              </div>
              <div class="rb-group rb-group--end">
                <div class="rb-items">
                  <button type="button" class="cad-auto" id="cad-auto">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8 6.4 6.4Z" fill="currentColor"/></svg>
                    <span>AI auto-design</span>
                  </button>
                </div>
                <span class="rb-label">Simulated</span>
              </div>
            </div>

            <!-- Workflow stepper -->
            <div class="cad-stepbar">
              <ol class="cad-steps" aria-label="Design workflow steps">
                <li><button type="button" data-step="scan" aria-current="false"><span class="n">1</span>Scan</button></li>
                <li><button type="button" data-step="margin" aria-current="false"><span class="n">2</span>Margin</button></li>
                <li><button type="button" data-step="axis" aria-current="false"><span class="n">3</span>Insertion axis</button></li>
                <li><button type="button" data-step="design" aria-current="step"><span class="n">4</span>Design</button></li>
                <li><button type="button" data-step="contacts" aria-current="false"><span class="n">5</span>Contacts</button></li>
                <li><button type="button" data-step="occlusion" aria-current="false"><span class="n">6</span>Occlusion</button></li>
                <li><button type="button" data-step="export" aria-current="false"><span class="n">7</span>Export</button></li>
              </ol>
            </div>

            <div class="cad-body">
              <!-- Left: scene, odontogram, guidance -->
              <aside class="cad-left" aria-label="Scene">
                <section class="cad-group">
                  <h3 class="cad-heading"><span>Scene</span><span class="cad-count">5 objects</span></h3>
                  <div class="cad-tree">
                    <p class="tree-folder"><svg class="ico"><use href="#i-chevron"/></svg><svg class="ico"><use href="#i-folder"/></svg>Scans</p>
                    <button type="button" class="tree-item" data-layer="jaw" aria-pressed="true"><span class="tree-eye" aria-hidden="true"><svg class="ico on"><use href="#i-eye"/></svg><svg class="ico off"><use href="#i-eye-off"/></svg></span><span class="swatch swatch--jaw" aria-hidden="true"></span><span class="tree-name">Upper jaw</span><span class="tree-meta">Prep 22</span></button>
                    <button type="button" class="tree-item" data-layer="antagonist" aria-pressed="false"><span class="tree-eye" aria-hidden="true"><svg class="ico on"><use href="#i-eye"/></svg><svg class="ico off"><use href="#i-eye-off"/></svg></span><span class="swatch swatch--ant" aria-hidden="true"></span><span class="tree-name">Lower jaw</span><span class="tree-meta">Antagonist</span></button>
                    <p class="tree-folder"><svg class="ico"><use href="#i-chevron"/></svg><svg class="ico"><use href="#i-folder"/></svg>Restoration 22</p>
                    <button type="button" class="tree-item" data-layer="crown" aria-pressed="true"><span class="tree-eye" aria-hidden="true"><svg class="ico on"><use href="#i-eye"/></svg><svg class="ico off"><use href="#i-eye-off"/></svg></span><span class="swatch swatch--crown" aria-hidden="true"></span><span class="tree-name">Anatomic crown</span><span class="tree-meta">Reference</span></button>
                    <p class="tree-folder"><svg class="ico"><use href="#i-chevron"/></svg><svg class="ico"><use href="#i-folder"/></svg>Annotations</p>
                    <button type="button" class="tree-item" data-layer="margin" aria-pressed="false"><span class="tree-eye" aria-hidden="true"><svg class="ico on"><use href="#i-eye"/></svg><svg class="ico off"><use href="#i-eye-off"/></svg></span><span class="swatch swatch--lime" aria-hidden="true"></span><span class="tree-name">Margin line</span><span class="tree-meta">163 pts</span></button>
                    <button type="button" class="tree-item" data-layer="axis" aria-pressed="false"><span class="tree-eye" aria-hidden="true"><svg class="ico on"><use href="#i-eye"/></svg><svg class="ico off"><use href="#i-eye-off"/></svg></span><span class="swatch swatch--lime" aria-hidden="true"></span><span class="tree-name">Insertion axis</span><span class="tree-meta">Design file</span></button>
                  </div>
                </section>

                <section class="cad-group">
                  <h3 class="cad-heading"><span>Maxillary arch</span><span class="cad-count">FDI</span></h3>
                  <svg class="odo" viewBox="-58.8 -12.2 117.6 53.5" role="img" aria-label="Upper arch chart: crown on 22, adjacent teeth 21 and 23">
<g class="odo-tooth"><rect x="-4.50" y="-4.50" width="9.00" height="9.00" rx="2.25" transform="translate(-45.94 33.77) rotate(-55.8)"/><text x="-53.79" y="29.92">17</text></g>
<g class="odo-tooth"><rect x="-4.73" y="-4.50" width="9.45" height="9.00" rx="2.25" transform="translate(-39.22 24.61) rotate(-51.5)"/><text x="-46.65" y="20.19">16</text></g>
<g class="odo-tooth"><rect x="-3.15" y="-3.60" width="6.30" height="7.20" rx="2.20" transform="translate(-32.77 17.18) rotate(-46.4)"/><text x="-38.99" y="12.75">15</text></g>
<g class="odo-tooth"><rect x="-3.15" y="-3.60" width="6.30" height="7.20" rx="2.20" transform="translate(-26.91 11.59) rotate(-40.7)"/><text x="-32.52" y="6.57">14</text></g>
<g class="odo-tooth"><rect x="-3.42" y="-3.38" width="6.84" height="6.75" rx="2.70" transform="translate(-20.21 6.54) rotate(-32.9)"/><text x="-24.76" y="1.00">13</text></g>
<g class="odo-tooth"><rect x="-2.93" y="-2.70" width="5.85" height="5.40" rx="1.49" transform="translate(-13.03 2.72) rotate(-22.6)"/><text x="-15.99" y="-2.89">12</text></g>
<g class="odo-tooth"><rect x="-3.83" y="-2.70" width="7.65" height="5.40" rx="1.49" transform="translate(-4.78 0.37) rotate(-8.7)"/><text x="-5.94" y="-5.75">11</text></g>
<g class="odo-tooth is-adj"><rect x="-3.83" y="-2.70" width="7.65" height="5.40" rx="1.49" transform="translate(4.79 0.37) rotate(8.7)"/><text x="5.96" y="-5.74">21</text></g>
<g class="odo-tooth is-key"><rect x="-2.93" y="-2.70" width="5.85" height="5.40" rx="1.49" transform="translate(13.04 2.72) rotate(22.6)"/><text x="16.01" y="-2.89">22</text></g>
<g class="odo-tooth is-adj"><rect x="-3.42" y="-3.38" width="6.84" height="6.75" rx="2.70" transform="translate(20.22 6.54) rotate(32.9)"/><text x="24.77" y="1.01">23</text></g>
<g class="odo-tooth"><rect x="-3.15" y="-3.60" width="6.30" height="7.20" rx="2.20" transform="translate(26.92 11.59) rotate(40.7)"/><text x="32.53" y="6.58">24</text></g>
<g class="odo-tooth"><rect x="-3.15" y="-3.60" width="6.30" height="7.20" rx="2.20" transform="translate(32.78 17.19) rotate(46.4)"/><text x="39.00" y="12.76">25</text></g>
<g class="odo-tooth"><rect x="-4.73" y="-4.50" width="9.45" height="9.00" rx="2.25" transform="translate(39.23 24.62) rotate(51.5)"/><text x="46.66" y="20.20">26</text></g>
<g class="odo-tooth"><rect x="-4.50" y="-4.50" width="9.00" height="9.00" rx="2.25" transform="translate(45.95 33.78) rotate(55.8)"/><text x="53.81" y="29.94">27</text></g>
                  </svg>
                  <p class="cad-chart-key"><span><i class="k-crown"></i>Crown</span><span><i class="k-adj"></i>Adjacent</span></p>
                </section>

                <section class="cad-group cad-step-info">
                  <h3 class="cad-heading"><span>Step · <span id="cad-step-title">Design</span></span><svg class="ico"><use href="#i-info"/></svg></h3>
                  <p id="cad-hint">Reference crown, designed in CAD software, seated on 22 in its recorded position. The AI auto-design run is a simulation.</p>
                </section>
              </aside>

              <!-- Viewport -->
              <div class="cad-viewport">
                <canvas id="cad-canvas" role="img" aria-label="Interactive 3D view of an upper jaw scan with a prepared left lateral incisor (22) and a seated anatomic crown. Drag to rotate."></canvas>
                <div class="cad-labels" id="cad-labels" aria-hidden="true"></div>

                <div class="cad-vp-head">
                  <div class="cad-ai" id="cad-ai" data-state="idle">
                    <span class="cad-ai-dot" aria-hidden="true"></span>
                    <span id="cad-ai-text">Loading case</span>
                  </div>
                </div>
                <p class="sr-only" id="cad-live" aria-live="polite"></p>

                <div class="cad-legend" id="cad-legend" hidden>
                  <p id="cad-legend-title">Occlusal distance (mm)</p>
                  <div class="cad-legend-bar" aria-hidden="true"></div>
                  <div class="cad-legend-scale"></div>
                </div>

                <div class="cad-scale" aria-hidden="true"><span class="cad-scale-bar" id="cad-scale-bar"></span><span id="cad-scale-label">5 mm</span></div>
                <div class="cad-gizmo-plate" aria-hidden="true"><canvas class="cad-gizmo" id="cad-gizmo"></canvas></div>

                <div class="cad-loading" id="cad-loading" hidden>
                  <p id="cad-loading-text">Loading 3D case</p>
                  <div class="cad-loading-track" aria-hidden="true"><span id="cad-loading-bar"></span></div>
                </div>

                <div class="cad-fallback">
                  <img src="/assets/crown-scan-float.png" width="820" height="820" alt="Ceramic crown with a surface mesh." loading="lazy" decoding="async">
                  <p>The interactive 3D view needs WebGL, which is not available in this browser.</p>
                </div>
              </div>

              <!-- Right: properties -->
              <aside class="cad-right" aria-label="Restoration properties">
                <div class="cad-props-head">
                  <span class="cad-props-tooth">22</span>
                  <span><strong>Anatomic crown</strong><small>Upper left lateral incisor</small></span>
                </div>

                <section class="cad-group">
                  <h3 class="cad-heading"><span>Restoration</span></h3>
                  <dl class="cad-props">
                    <div><dt>Type</dt><dd>Full-contour crown</dd></div>
                    <div><dt>Source</dt><dd>Reference CAD design</dd></div>
                    <div><dt>Material</dt><dd>Zirconia</dd></div>
                  </dl>
                </section>

                <section class="cad-group">
                  <h3 class="cad-heading"><span>Design parameters</span><span class="cad-count">Design file</span></h3>
                  <dl class="cad-props cad-props--num">
                    <div><dt>Cement gap</dt><dd id="d-cement">—</dd></div>
                    <div><dt>Min. thickness</dt><dd id="d-thickness">—</dd></div>
                    <div><dt>Min. thickness at margin</dt><dd id="d-margin-thickness">—</dd></div>
                    <div><dt>Distance to antagonist</dt><dd id="d-antagonist">—</dd></div>
                  </dl>
                </section>

                <section class="cad-group">
                  <h3 class="cad-heading"><span>Measurements</span><span class="cad-count">mm</span></h3>
                  <dl class="cad-props cad-props--num">
                    <div><dt>Mesiodistal width</dt><dd id="m-md">—</dd></div>
                    <div><dt>Faciolingual width</dt><dd id="m-bl">—</dd></div>
                    <div><dt>Height above margin</dt><dd id="m-h">—</dd></div>
                    <div><dt>Margin fit to scan</dt><dd id="m-fit">—</dd></div>
                    <div id="m-thick-row" class="cad-thick"><dt>Min. wall thickness</dt><dd id="m-thick">—</dd></div>
                    <div><dt>Material minimum</dt><dd id="m-min">—</dd></div>
                  </dl>
                </section>

                <section class="cad-group">
                  <h3 class="cad-heading"><span>Design check</span><span class="cad-count" id="v-summary">—</span></h3>
                  <ul class="cad-checks">
                    <li id="v-thick"><span class="chk" aria-hidden="true"></span><span>Wall thickness</span><em>—</em></li>
                    <li id="v-contact"><span class="chk" aria-hidden="true"></span><span>Proximal contacts</span><em>—</em></li>
                    <li id="v-occl"><span class="chk" aria-hidden="true"></span><span>Occlusal clearance</span><em>—</em></li>
                    <li id="v-cement"><span class="chk" aria-hidden="true"></span><span>Cement gap</span><em>—</em></li>
                    <li id="v-margin"><span class="chk" aria-hidden="true"></span><span>Margin line</span><em>—</em></li>
                  </ul>
                </section>

                <div class="cad-export">
                  <button type="button" class="btn btn-primary btn-block" id="cad-export">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
                    Export STL
                  </button>
                  <p class="cad-export-sub">Demo case · not for clinical use</p>
                  <p class="cad-export-note" id="cad-export-note" role="status" hidden>Downloaded the demo crown as STL, in scan coordinates. Not for clinical use.</p>
                </div>
              </aside>
            </div>

            <!-- Status bar -->
            <div class="cad-statusbar">
              <span class="sb-item sb-status"><span class="sb-dot" aria-hidden="true"></span><span id="cad-status">Design · tooth 22</span></span>
              <span class="sb-item" id="cad-tris"></span>
              <span class="sb-item sb-hint">Drag to rotate · Ctrl + scroll to zoom · Double-click to fit</span>
              <span class="sb-end">
                <span class="sb-item" id="cad-material-label">Zirconia</span>
                <span class="sb-item">mm · FDI</span>
                <span class="sb-item">Conceptual interface · demo case</span>
              </span>
            </div>
          </div>
        </figure>
      </div>
    </section>

    <!-- ============ TECHNOLOGY VISION ============ -->
    <section class="section band-dark tech" id="tech-vision" aria-labelledby="tech-title">
      <div class="wrap">
        <header class="section-head split-head reveal">
          <div>
            <h2 id="tech-title" class="display">Intelligence Built Around Dental Geometry.</h2>
          </div>
          <p class="lede">FAUCHAR's research and engineering roadmap is grounded in the geometry of real dental anatomy, not generic AI. Each layer builds on the one before it.</p>
        </header>

        <div class="pipeline reveal">
          <div class="pipe-io pipe-in"><span>Input</span>Dental STL mesh</div>
          <ol class="pipe-nodes">
            <li class="pnode">
              <span class="pnode-idx">L1</span>
              <span class="pnode-ico"><svg class="ico" aria-hidden="true"><use href="#i-mesh"/></svg></span>
              <h3>3D Geometry Understanding</h3>
              <p>Processing and understanding complex dental STL meshes.</p>
            </li>
            <li class="pnode">
              <span class="pnode-idx">L2</span>
              <span class="pnode-ico"><svg class="ico" aria-hidden="true"><use href="#i-scan"/></svg></span>
              <h3>Dental Anatomy Recognition</h3>
              <p>Identifying relevant teeth, preparation geometry, and surrounding structures.</p>
            </li>
            <li class="pnode pnode--core">
              <span class="pnode-idx">L3</span>
              <span class="pnode-ico"><svg class="ico" aria-hidden="true"><use href="#i-tooth"/></svg></span>
              <h3>AI-Based Restoration Generation</h3>
              <p>Developing AI models that generate restoration geometry from dental scan data.</p>
            </li>
            <li class="pnode">
              <span class="pnode-idx">L4</span>
              <span class="pnode-ico"><svg class="ico" aria-hidden="true"><use href="#i-bezier"/></svg></span>
              <h3>Interactive CAD Workflows</h3>
              <p>Combining automated design with professional manual editing.</p>
            </li>
            <li class="pnode">
              <span class="pnode-idx">L5</span>
              <span class="pnode-ico"><svg class="ico" aria-hidden="true"><use href="#i-cycle"/></svg></span>
              <h3>Continuous Model Improvement</h3>
              <p>Improving the system through carefully curated, reviewed dental datasets.</p>
            </li>
          </ol>
          <div class="pipe-io pipe-out"><span>Output</span>Editable restoration</div>
          <svg class="pipe-loop" viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true">
            <path d="M900 6 V40 Q900 70 870 70 H130 Q100 70 100 40 V6" fill="none" stroke="#B7F34A" stroke-width="1" stroke-dasharray="4 6" vector-effect="non-scaling-stroke"/>
          </svg>
          <p class="pipe-loop-label">Professional review feeds curated data back into model improvement</p>
        </div>
        <p class="note note--dark"><span class="tag">Roadmap</span> Intended research and engineering direction. Capabilities are in development and are not claims of present performance.</p>
      </div>
    </section>

    <!-- ============ WHY NOW ============ -->
    <section class="section band-light whynow" id="why-now" aria-labelledby="whynow-title">
      <div class="wrap whynow-grid">
        <div class="whynow-head reveal">
          <h2 id="whynow-title" class="display">The Next Evolution of Digital Dentistry.</h2>
          <p class="lede">Several long-running industry trends are converging. Together they make restoration design one of the most compelling places to apply specialized AI.</p>
        </div>
        <ol class="trends">
          <li class="reveal"><span class="trend-num">01</span><div><h3>Scanning made dentistry three-dimensional.</h3><p>Digital dental scanning has created extensive 3D data workflows across clinics and laboratories.</p></div></li>
          <li class="reveal"><span class="trend-num">02</span><div><h3>CAD/CAM is now core infrastructure.</h3><p>Dental CAD/CAM has become an important part of modern dentistry and laboratory production.</p></div></li>
          <li class="reveal"><span class="trend-num">03</span><div><h3>AI has learned to read shape.</h3><p>AI is creating new opportunities in medical image and 3D geometry analysis.</p></div></li>
          <li class="reveal"><span class="trend-num">04</span><div><h3>Restoration design is a focused frontier.</h3><p>Restoration design represents an opportunity for specialized, domain-specific AI applications.</p></div></li>
          <li class="reveal"><span class="trend-num">05</span><div><h3>Automation, with human expertise.</h3><p>Dental laboratories and professionals need workflows that combine automation with expert judgment.</p></div></li>
        </ol>
      </div>
      <figure class="cinema reveal">
        <img src="/assets/hero-crowns.jpg" width="1280" height="720" alt="Ceramic molar and premolar crowns and two veneers on a dark surface beside a wireframe geometric form." loading="lazy" decoding="async">
        <figcaption><span>Restoration forms</span><span>Conceptual render</span></figcaption>
      </figure>
    </section>

    <!-- ============ ORIGIN ============ -->
    <section class="section band-light origin" id="story" aria-labelledby="story-title" tabindex="-1">
      <div class="wrap">
        <header class="origin-head reveal">
          <p class="kicker">From a pioneer’s legacy to the future of dental design.</p>
          <h2 id="story-title" class="display display--xl">Inspired by the Foundations of Modern Dentistry.</h2>
        </header>

        <div class="origin-grid">
          <figure class="portrait reveal">
            <img src="/assets/fauchard.jpg" width="680" height="846" alt="Engraved portrait of Pierre Fauchard, the eighteenth-century French dental practitioner." loading="lazy" decoding="async">
            <figcaption>
              <span class="years"><span>1678</span><span>1761</span></span>
              Pierre Fauchard. Engraving by Jean-Baptiste Scotin after J. Le Bel. Cropped from the original plate.
              <a href="https://wellcomecollection.org/works/mk86bn7s" target="_blank" rel="noopener noreferrer">Wellcome Collection</a>,
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>.
            </figcaption>
          </figure>

          <div class="origin-copy reveal" style="--d:1">
            <p class="lead dropcap">Pierre Fauchard (1678–1761) was a pioneering French dental practitioner and an important figure in the development of modern dentistry.</p>
            <p>His 1728 publication, <cite>Le Chirurgien Dentiste</cite>, helped systematize dental knowledge and professional practice.</p>
            <p>FAUCHAR takes inspiration from this legacy. The name is a modern brand adaptation inspired by Fauchard, not his actual surname, and it represents a simple idea:</p>
            <blockquote class="origin-statement">
              <p>Dentistry has always advanced through knowledge, precision, and innovation.</p>
            </blockquote>
            <p>We believe artificial intelligence can become another important chapter in that evolution.</p>

            <div class="eras" aria-label="From 1728 to today">
              <div class="era">
                <span class="era-year">1728</span>
                <span class="era-label">Knowledge, systematized in print</span>
              </div>
              <span class="era-line" aria-hidden="true"></span>
              <div class="era era--now">
                <img src="/assets/crown-float.png" width="820" height="820" alt="" loading="lazy" decoding="async">
                <span class="era-year">Today</span>
                <span class="era-label">Geometry, understood by AI</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ ROADMAP ============ -->
    <section class="section band-dark roadmap" id="roadmap" aria-labelledby="roadmap-title" tabindex="-1">
      <div class="wrap">
        <header class="section-head split-head reveal">
          <div>
            <h2 id="roadmap-title" class="display">Building More Than a Single AI Tool.</h2>
          </div>
          <p class="lede">A deliberate path from one well-defined task to a broader dental intelligence platform. Sequenced by capability, not by promised dates.</p>
        </header>

        <div class="timeline" data-progress>
          <div class="timeline-track" aria-hidden="true"><span class="timeline-fill"></span></div>
          <ol>
            <li class="phase is-current reveal">
              <span class="phase-node" aria-hidden="true"></span>
              <span class="phase-tag">Phase 1 · Current focus</span>
              <h3>AI Crown Design</h3>
              <p>Focus on analyzing dental scans and generating single-crown design proposals.</p>
            </li>
            <li class="phase reveal" style="--d:1">
              <span class="phase-node" aria-hidden="true"></span>
              <span class="phase-tag">Phase 2 · Planned</span>
              <h3>Advanced Restoration Design</h3>
              <p>Expand toward bridges and more complex restoration workflows.</p>
            </li>
            <li class="phase reveal" style="--d:2">
              <span class="phase-node" aria-hidden="true"></span>
              <span class="phase-tag">Phase 3 · Planned</span>
              <h3>Interactive Dental CAD</h3>
              <p>Develop professional geometry editing and refinement capabilities.</p>
            </li>
            <li class="phase reveal" style="--d:3">
              <span class="phase-node" aria-hidden="true"></span>
              <span class="phase-tag">Phase 4 · Exploratory</span>
              <h3>Dental Intelligence Platform</h3>
              <p>Explore additional AI capabilities for dental laboratories and digital dentistry.</p>
            </li>
          </ol>
        </div>
        <p class="note note--dark"><span class="tag">Roadmap</span> Direction of development, not a commitment to specific features or delivery dates.</p>
      </div>
    </section>

    <!-- ============ INVESTMENT ============ -->
    <section class="section band-light invest" id="investors" aria-labelledby="invest-title" tabindex="-1">
      <div class="wrap">
        <header class="section-head reveal">
          <h2 id="invest-title" class="display display--wide">A New Opportunity at the Intersection of AI and Digital Dentistry.</h2>
        </header>

        <div class="thesis">
          <article class="thesis-item reveal">
            <span class="thesis-num">A</span>
            <h3>Large Specialized Industry</h3>
            <p>Digital dental restoration is a specialized professional market with established workflows and demand for advanced design tools.</p>
          </article>
          <article class="thesis-item reveal" style="--d:1">
            <span class="thesis-num">B</span>
            <h3>AI and 3D Technology</h3>
            <p>FAUCHAR combines artificial intelligence, 3D geometry processing, and domain-specific dental workflows.</p>
          </article>
          <article class="thesis-item reveal" style="--d:2">
            <span class="thesis-num">C</span>
            <h3>Scalable Software Vision</h3>
            <p>The platform is designed with a long-term opportunity to expand beyond single-crown design into broader restoration workflows.</p>
          </article>
          <article class="thesis-item reveal" style="--d:3">
            <span class="thesis-num">D</span>
            <h3>Professional Customer Base</h3>
            <p>Potential customers include:</p>
            <ul class="tick-list">
              <li>Dental laboratories</li>
              <li>Dental technicians</li>
              <li>Digital dentistry professionals</li>
              <li>Dental clinics</li>
              <li>Dental CAD/CAM service providers</li>
            </ul>
          </article>
        </div>

        <div class="building reveal">
          <p class="building-statement">An AI-powered dental design platform that aims to make complex restoration workflows more <em>intelligent</em>, <em>accessible</em>, and <em>efficient</em>.</p>
        </div>

        <aside class="invest-cta band-dark reveal" aria-labelledby="invest-cta-title">
          <span class="invest-cta-rings" aria-hidden="true"><i></i><i></i><i></i></span>
          <div class="invest-cta-copy">
            <span class="invest-cta-tag"><span class="invest-cta-dot" aria-hidden="true"></span>Investors &amp; partners</span>
            <h3 id="invest-cta-title">Interested in the Future of Dental AI?</h3>
            <p>We welcome conversations with investors, dental laboratories, and digital dentistry professionals.</p>
          </div>
          <a class="btn btn-primary" href="#contact" data-focus="contact-name" data-topic="Investor">Contact FAUCHAR
            <svg class="btn-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
          </a>
        </aside>
      </div>
    </section>

    <!-- ============ FINAL CTA + CONTACT ============ -->
    <section class="section band-dark finale" id="contact" aria-labelledby="contact-title" tabindex="-1">
      <div class="finale-glow" aria-hidden="true"></div>
      <div class="wrap">
        <div class="finale-hero reveal">
          <div class="finale-visual" aria-hidden="true">
            <svg class="finale-rings" viewBox="0 0 600 600">
              <g fill="none">
                <circle cx="300" cy="300" r="280" stroke="rgba(245,244,239,0.07)"/>
                <circle cx="300" cy="300" r="220" stroke="rgba(183,243,74,0.35)" stroke-dasharray="1 8" class="spin-slow"/>
                <circle cx="300" cy="300" r="160" stroke="rgba(245,244,239,0.1)"/>
                <path d="M300 0v60M300 540v60M0 300h60M540 300h60" stroke="rgba(245,244,239,0.2)"/>
              </g>
            </svg>
            <img src="/assets/crown-scan-float.png" width="820" height="820" alt="" loading="lazy" decoding="async">
          </div>
          <p class="lede" id="contact-title">FAUCHAR is building the next generation of AI-assisted dental restoration design.</p>
          <div class="actions actions--center">
            <a class="btn btn-primary" href="#contact-form" data-focus="contact-name">Get in Touch</a>
            <a class="btn btn-ghost" href="#vision">Explore Our Vision</a>
          </div>
        </div>

        <div class="contact-grid">
          <div class="contact-intro reveal">
            <h3>Start a conversation.</h3>
            <p>Whether you are an investor, a dental laboratory, or a digital dentistry professional, we would like to hear from you.</p>
            <p class="contact-direct" data-mailto-wrap>Prefer email? <a data-mailto href="#contact">Email FAUCHAR</a></p>
          </div>

          <div class="contact-form-wrap reveal" style="--d:1">
            <form id="contact-form" action="#contact" method="get" novalidate>
              <p class="form-note" id="form-intro">Name, email, and a short message are required.</p>
              <div class="field-row">
                <div class="field">
                  <label for="contact-name">Name</label>
                  <input id="contact-name" name="name" type="text" autocomplete="name" required maxlength="80" aria-describedby="name-error">
                  <p class="field-error" id="name-error" hidden></p>
                </div>
                <div class="field">
                  <label for="contact-org">Organization <span class="optional">(optional)</span></label>
                  <input id="contact-org" name="organization" type="text" autocomplete="organization" maxlength="120">
                </div>
              </div>
              <div class="field-row">
                <div class="field">
                  <label for="contact-email">Email</label>
                  <input id="contact-email" name="email" type="email" autocomplete="email" inputmode="email" required maxlength="120" aria-describedby="email-error">
                  <p class="field-error" id="email-error" hidden></p>
                </div>
                <div class="field">
                  <label for="contact-topic">I am</label>
                  <select id="contact-topic" name="topic">
                    <option value="Investor">An investor</option>
                    <option value="Dental laboratory">A dental laboratory</option>
                    <option value="Dental professional">A dental professional</option>
                    <option value="Other" selected>Something else</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label for="contact-message">Message</label>
                <textarea id="contact-message" name="message" rows="4" required maxlength="2000" aria-describedby="message-error"></textarea>
                <p class="field-error" id="message-error" hidden></p>
              </div>
              <div class="hp" aria-hidden="true">
                <label for="company-website">Website</label>
                <input id="company-website" name="company_website" type="text" tabindex="-1" autocomplete="off">
              </div>
              <button class="btn btn-primary" type="submit">Send Message</button>
            </form>

            <div class="form-success focus-target" id="form-success" tabindex="-1" hidden>
              <h3>Thank you.</h3>
              <p id="form-success-text"></p>
              <button class="btn btn-ghost" type="button" id="form-reset">Write another note</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap footer-grid">
      <div class="footer-brand">
        <a class="logo" href="#top" aria-label="FAUCHAR, home">
          ${voxelMarkSvg("mark")}
          <span class="logo-lockup" aria-hidden="true">
            <svg class="logo-word" viewBox="-1.5 -1.5 157 23.6" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4"><path d="M1.2 20V1.2H13M1.2 10.4H11"/><path d="M22 20.6 29 1 36 20.6"/><path d="M45.2 0v12.6a6.8 6.8 0 0 0 13.6 0V0"/><path d="M85.5 4.3A9.6 9.6 0 1 0 85.5 15.7"/><path d="M94.2 0v20M108.6 0v20M94.2 10.2h14.4"/><path d="M117 20.6 124 1 131 20.6"/><path d="M141.2 20V1.2h7.6a5.3 5.3 0 0 1 0 10.6h-7.6M147.6 11.8 154 20"/></g></svg>
            <span class="logo-descriptor">Dental Intelligence</span>
          </span>
        </a>
      </div>
      <nav class="footer-nav" aria-label="Footer">
        <ul>
          <li><a href="#vision">Vision</a></li>
          <li><a href="#technology">Technology</a></li>
          <li><a href="#product">Product</a></li>
          <li><a href="#story">Our Story</a></li>
          <li><a href="#roadmap">Roadmap</a></li>
          <li><a href="/news">News</a></li>
          <li><a href="#contact">Contact</a></li>
        </ul>
      </nav>
      <div class="legal">
        <p>© <span data-year>2026</span> FAUCHAR. All rights reserved.</p>
        <ul>
          <li><a href="/privacy">Privacy Policy</a></li>
          <li><a href="/terms">Terms</a></li>
        </ul>
      </div>
    </div>
  </footer>

  <dialog class="sent-modal" id="sent-modal" aria-labelledby="sent-title">
    <div class="sent-card">
      <span class="frame-corner tl" aria-hidden="true"></span>
      <span class="frame-corner br" aria-hidden="true"></span>
      <span class="sent-signal" aria-hidden="true"></span>
      <p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>Inquiry received</p>
      <h3 id="sent-title">Message sent.</h3>
      <p id="sent-modal-text"></p>
      <button class="btn btn-primary" type="button" id="sent-close">Close</button>
    </div>
  </dialog>
  `;
