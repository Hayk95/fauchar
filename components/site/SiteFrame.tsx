import PlainBoot from "@/components/site/PlainBoot";
import Link from "next/link";
import { VOXEL_CELLS } from "@/lib/brandMark";

const links = [
  { href: "/#vision", label: "Vision" },
  { href: "/#technology", label: "Technology" },
  { href: "/#product", label: "Product" },
  { href: "/#story", label: "Our Story" },
  { href: "/#roadmap", label: "Roadmap" },
  { href: "/#contact", label: "Contact" },
];

const footerLinks = [...links.slice(0, 5), { href: "/news", label: "News" }, links[5]];

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 64 80" aria-hidden="true">
      {VOXEL_CELLS.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x}
          y={cell.y}
          width="6"
          height="6"
          rx="1"
          fill={cell.lime ? "#B7F34A" : "currentColor"}
        />
      ))}
    </svg>
  );
}

function Wordmark() {
  return (
    <span className="logo-lockup" aria-hidden="true">
      <svg className="logo-word" viewBox="-1.5 -1.5 157 23.6" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M1.2 20V1.2H13M1.2 10.4H11" />
          <path d="M22 20.6 29 1 36 20.6" />
          <path d="M45.2 0v12.6a6.8 6.8 0 0 0 13.6 0V0" />
          <path d="M85.5 4.3A9.6 9.6 0 1 0 85.5 15.7" />
          <path d="M94.2 0v20M108.6 0v20M94.2 10.2h14.4" />
          <path d="M117 20.6 124 1 131 20.6" />
          <path d="M141.2 20V1.2h7.6a5.3 5.3 0 0 1 0 10.6h-7.6M147.6 11.8 154 20" />
        </g>
      </svg>
      <span className="logo-descriptor">Dental Intelligence</span>
    </span>
  );
}

export default function SiteFrame({
  children,
  plain = true,
}: {
  children: React.ReactNode;
  plain?: boolean;
}) {
  return (
    <>
      <PlainBoot plain={plain} />
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="site-header" id="header">
        <div className="wrap header-inner">
          <Link className="logo" href="/" aria-label="FAUCHAR, home">
            <Mark />
            <Wordmark />
          </Link>
          <nav className="site-nav" id="site-nav" aria-label="Primary">
            <ul>
              {links.map((link) => (
                <li key={link.href}>
                  <a href={link.href}>{link.label}</a>
                </li>
              ))}
            </ul>
            <div className="nav-foot">
              <a className="btn btn-ghost" href="/signin">
                Sign in
              </a>
              <Link className="btn btn-primary" href="/#contact">
                Get in Touch
              </Link>
            </div>
          </nav>
          <a className="btn btn-ghost header-cta" href="/signin" style={{ marginRight: "0.5rem" }}>
            Sign in
          </a>
          <Link className="btn btn-primary header-cta" href="/#contact">
            Get in Touch
          </Link>
          <button className="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
            <span className="sr-only" data-toggle-label="">
              Open menu
            </span>
            <span className="nav-toggle-icon" aria-hidden="true" />
          </button>
        </div>
      </header>
      <main id="content" className="focus-target" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="wrap footer-grid">
          <div className="footer-brand">
            <Link className="logo" href="/" aria-label="FAUCHAR, home">
              <Mark />
              <Wordmark />
            </Link>
          </div>
          <nav className="footer-nav" aria-label="Footer">
            <ul>
              {footerLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} aria-current={link.href === "/news" ? "page" : undefined}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="legal">
            <p>
              © <span data-year="">2026</span> FAUCHAR. All rights reserved.
            </p>
            <ul>
              <li>
                <a href="/privacy">Privacy Policy</a>
              </li>
              <li>
                <a href="/terms">Terms</a>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </>
  );
}
