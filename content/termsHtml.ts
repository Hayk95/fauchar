import { voxelMarkSvg } from "@/lib/brandMark";

export const termsHtml = `<a class="skip" href="#content">Skip to content</a>

  <header class="site-header" id="header">
    <div class="wrap header-inner">
      <a class="logo" href="/" aria-label="FAUCHAR, home">
        ${voxelMarkSvg("mark")}
        <span class="logo-lockup" aria-hidden="true">
          <svg class="logo-word" viewBox="-1.5 -1.5 157 23.6" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4"><path d="M1.2 20V1.2H13M1.2 10.4H11"/><path d="M22 20.6 29 1 36 20.6"/><path d="M45.2 0v12.6a6.8 6.8 0 0 0 13.6 0V0"/><path d="M85.5 4.3A9.6 9.6 0 1 0 85.5 15.7"/><path d="M94.2 0v20M108.6 0v20M94.2 10.2h14.4"/><path d="M117 20.6 124 1 131 20.6"/><path d="M141.2 20V1.2h7.6a5.3 5.3 0 0 1 0 10.6h-7.6M147.6 11.8 154 20"/></g></svg>
          <span class="logo-descriptor">Dental Intelligence</span>
        </span>
      </a>

      <nav class="site-nav" id="site-nav" aria-label="Primary">
        <ul>
          <li><a href="/#vision">Vision</a></li>
          <li><a href="/#technology">Technology</a></li>
          <li><a href="/#product">Product</a></li>
          <li><a href="/#roadmap">Roadmap</a></li>
          <li><a href="/#story">Our Story</a></li>
          <li><a href="/#contact">Contact</a></li>
        </ul>
        <div class="nav-foot">
          <a class="btn btn-primary" href="/#contact">Get in Touch</a>
        </div>
      </nav>

      <a class="btn btn-primary header-cta" href="/#contact">Get in Touch</a>

      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
        <span class="sr-only" data-toggle-label>Open menu</span>
        <span class="nav-toggle-icon" aria-hidden="true"></span>
      </button>
    </div>
  </header>

  <main id="content" class="focus-target" tabindex="-1">
    <article class="wrap policy">
      <p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>Placeholder</p>
      <h1>Terms</h1>
      <p>This page is a placeholder. FAUCHAR has not yet published terms of use.</p>
      <p>The content on this site describes a product vision and research direction. The workflow, interface preview, and roadmap are conceptual. They are not an offer of a commercially available product, and nothing on this site is a claim of clinical validation, regulatory clearance, or medical advice.</p>
      <p>Company and legal-entity details will be added here when available.</p>
      <a class="text-link" href="/">Back to FAUCHAR
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8H3M7 4 3 8l4 4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
      </a>
    </article>
  </main>

  <footer class="site-footer">
    <div class="wrap footer-grid">
      <div class="footer-brand">
        <a class="logo" href="/" aria-label="FAUCHAR, home">
          ${voxelMarkSvg("mark")}
        <span class="logo-lockup" aria-hidden="true">
          <svg class="logo-word" viewBox="-1.5 -1.5 157 23.6" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4"><path d="M1.2 20V1.2H13M1.2 10.4H11"/><path d="M22 20.6 29 1 36 20.6"/><path d="M45.2 0v12.6a6.8 6.8 0 0 0 13.6 0V0"/><path d="M85.5 4.3A9.6 9.6 0 1 0 85.5 15.7"/><path d="M94.2 0v20M108.6 0v20M94.2 10.2h14.4"/><path d="M117 20.6 124 1 131 20.6"/><path d="M141.2 20V1.2h7.6a5.3 5.3 0 0 1 0 10.6h-7.6M147.6 11.8 154 20"/></g></svg>
          <span class="logo-descriptor">Dental Intelligence</span>
        </span>
        </a>
      </div>
      <nav class="footer-nav" aria-label="Footer">
        <ul>
          <li><a href="/#vision">Vision</a></li>
          <li><a href="/#technology">Technology</a></li>
          <li><a href="/#product">Product</a></li>
          <li><a href="/#roadmap">Roadmap</a></li>
          <li><a href="/#story">Our Story</a></li>
          <li><a href="/news">News</a></li>
          <li><a href="/#contact">Contact</a></li>
        </ul>
      </nav>
      <div class="legal">
        <p>© <span data-year>2026</span> FAUCHAR. All rights reserved.</p>
        <ul>
          <li><a href="/privacy">Privacy Policy</a></li>
          <li><a href="/terms" aria-current="page">Terms</a></li>
        </ul>
      </div>
    </div>
  </footer>

  `;
