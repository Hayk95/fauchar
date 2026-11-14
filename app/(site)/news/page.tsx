import type { Metadata } from "next";
import Link from "next/link";
import SiteFrame from "@/components/site/SiteFrame";
import { formatNewsDate, news, type NewsArticle } from "@/content/news";

export const metadata: Metadata = {
  title: "News",
  description:
    "Notes from FAUCHAR on dental scans, crown and bridge design, and the review that stays with the professional.",
};

function indexLabel(index: number) {
  return String(index + 1).padStart(2, "0");
}

function ReadMark() {
  return (
    <span className="news-go">
      Read
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </span>
  );
}

function ArticleLink({ article, index, featured = false }: { article: NewsArticle; index: number; featured?: boolean }) {
  return (
    <Link className={featured ? "news-feature" : "news-item"} href={`/news/${article.slug}`}>
      <span className="news-num">{indexLabel(index)}</span>
      <span className="news-copy">
        <time dateTime={article.date}>{formatNewsDate(article.date)}</time>
        <h2>{article.title}</h2>
        <p>{article.summary}</p>
      </span>
      <ReadMark />
    </Link>
  );
}

export default function NewsPage() {
  const [featured, ...rest] = news;

  return (
    <SiteFrame>
      <div className="news-page">
        <section className="news-hero">
          <div className="wrap">
            <p className="eyebrow">
              <span className="eyebrow-mark" aria-hidden="true" />
              News
            </p>
            <h1 className="display">Notes on dental design.</h1>
            <p className="lede">
              Writing on scans, crowns, bridges, and the review that sits between a proposal and a file.
            </p>
          </div>
        </section>
        {featured ? (
          <section className="news-board" aria-label="Articles">
            <div className="wrap">
              <ArticleLink article={featured} index={0} featured />
              {rest.length > 0 ? (
                <div className="news-grid">
                  {rest.map((article, index) => (
                    <ArticleLink key={article.slug} article={article} index={index + 1} />
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </SiteFrame>
  );
}
