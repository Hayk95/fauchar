import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFrame from "@/components/site/SiteFrame";
import { formatNewsDate, getArticle, news } from "@/content/news";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return news.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return { title: "News" };
  return {
    title: article.title,
    description: article.summary,
  };
}

export default async function NewsArticlePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const others = news.filter((item) => item.slug !== article.slug);

  return (
    <SiteFrame>
      <div className="news-page">
        <article className="news-story">
          <div className="wrap">
            <Link className="news-back" href="/news">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13 8H3M7 4 3 8l4 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
              All news
            </Link>
            <time dateTime={article.date}>{formatNewsDate(article.date)}</time>
            <h1 className="display">{article.title}</h1>
            <p className="lede">{article.summary}</p>
            <div className="news-body">
              {article.sections.map((section) => (
                <section key={section.heading ?? section.paragraphs[0]}>
                  {section.heading ? <h2>{section.heading}</h2> : null}
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </article>
        {others.length > 0 ? (
          <aside className="news-board" aria-label="More from News">
            <div className="wrap">
              <p className="eyebrow">
                <span className="eyebrow-mark" aria-hidden="true" />
                More from News
              </p>
              <div className="news-grid">
                {others.map((item) => (
                  <Link key={item.slug} className="news-item" href={`/news/${item.slug}`}>
                    <span className="news-copy">
                      <time dateTime={item.date}>{formatNewsDate(item.date)}</time>
                      <h2>{item.title}</h2>
                      <p>{item.summary}</p>
                    </span>
                    <span className="news-go">
                      Read
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </SiteFrame>
  );
}
