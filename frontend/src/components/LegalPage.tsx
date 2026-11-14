import Link from "next/link";
import { legalDocument, type LegalSlug } from "@/lib/legal-server";
export default async function LegalPage({ slug }: { slug: LegalSlug }) {
  const document = await legalDocument(slug);
  return <div className="service-page"><main className="legal-layout"><Link href="/" className="service-brand">↗ Эффект бабочки</Link><h1>{document.title}</h1>
    {document.published ? <><p className="service-muted">Редакция {document.version}</p><article className="legal-document">{document.text}</article></> : <section className="legal-status"><h2>Документ ещё не опубликован</h2><p>Текст проходит подготовку и утверждение владельцем сервиса. Черновик не является действующими условиями.</p><p className="service-muted">До публикации документов регистрация на публичном сервере закрыта. Локальный демонстрационный режим доступен для проверки приложения.</p></section>}
    <p><Link href="/" className="service-link">← Вернуться к карте</Link></p></main></div>;
}
