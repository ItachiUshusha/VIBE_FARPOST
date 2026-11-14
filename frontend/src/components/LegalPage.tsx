import Link from "next/link";
import { LEGAL_TITLES, legalDocument, type LegalSlug } from "@/lib/legal-server";

function documentText(text: string) {
  return text.split(/\n\s*\n/).map((paragraph, index) => /^\d+\. [^\n]+$/.test(paragraph)
    ? <h2 key={index}>{paragraph}</h2>
    : <p key={index}>{paragraph.split(/(https?:\/\/[^\s]+|\/(?:legal|offer|privacy|cookies|analytics-consent)(?![\w/-])|\/fonts\/Manrope-LICENSE\.txt)/g).map((part, partIndex) => {
      if (!/^(https?:\/\/|\/)/.test(part)) return part;
      const href = part.replace(/[.,;:!?]+$/, "");
      return <span key={partIndex}><a href={href}>{href}</a>{part.slice(href.length)}</span>;
    })}</p>);
}

export default async function LegalPage({ slug }: { slug: LegalSlug }) {
  const document = await legalDocument(slug);
  return <div className="service-page"><main className="legal-layout"><Link href="/" className="service-brand">↗ 402x402</Link><h1>{document.title}</h1>
    {document.published ? <><p className="service-muted">Редакция {document.version}</p><article className="legal-document">{documentText(document.text || "")}</article></> : <section className="legal-status"><h2>Документ ещё не опубликован</h2><p>Текст проходит подготовку и утверждение владельцем сервиса. Черновик не является действующими условиями.</p><p className="service-muted">До публикации документов регистрация на публичном сервере закрыта. Локальный демонстрационный режим доступен для проверки приложения.</p></section>}
    <nav className="legal-nav" aria-label="Правовые документы">{(Object.entries(LEGAL_TITLES) as [LegalSlug, string][]).map(([key, title]) => <Link key={key} href={`/${key}`} aria-current={key === slug ? "page" : undefined}>{title}</Link>)}</nav>
    <p><Link href="/" className="service-link">← Вернуться к карте</Link></p></main></div>;
}
