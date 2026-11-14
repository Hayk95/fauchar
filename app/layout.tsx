import type { Metadata, Viewport } from "next";
import Script from "next/script";

const siteUrl = "https://fauchar.com";

export const viewport: Viewport = {
  themeColor: "#0B1114",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "FAUCHAR — Dental Intelligence | AI-Powered Crown & Bridge Design",
    template: "%s — FAUCHAR",
  },
  description:
    "FAUCHAR is building AI-powered dental design technology that turns 3D dental scans into intelligent, professionally reviewable crown and bridge design workflows.",
  openGraph: {
    type: "website",
    siteName: "FAUCHAR",
    title: "FAUCHAR — Dental Intelligence | AI-Powered Crown & Bridge Design",
    description:
      "AI-powered dental design technology for crown and bridge workflows.",
    url: siteUrl,
    images: [
      {
        url: "/assets/hero-crowns.jpg",
        width: 1280,
        height: 720,
        alt: "Ceramic dental crowns and veneers beside a wireframe form on a dark background.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FAUCHAR — Dental Intelligence | AI-Powered Crown & Bridge Design",
    description: "AI-powered dental design technology for crown and bridge workflows.",
    images: ["/assets/hero-crowns.jpg"],
  },
  icons: {
    icon: [
      { url: "/assets/favicon.svg", type: "image/svg+xml" },
      { url: "/assets/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/assets/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="mark-js" strategy="beforeInteractive">
          {`document.documentElement.classList.add("js")`}
        </Script>
        <link rel="preload" href="/assets/fonts/space-grotesk-500.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/assets/fonts/inter-400.woff2" as="font" type="font/woff2" crossOrigin="" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "FAUCHAR",
              description:
                "FAUCHAR is building AI-powered dental design technology for crown and bridge restoration workflows.",
              url: siteUrl,
              logo: `${siteUrl}/assets/apple-touch-icon.png`,
            }),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
