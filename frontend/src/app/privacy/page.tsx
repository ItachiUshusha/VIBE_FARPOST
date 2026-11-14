import LegalPage from "@/components/LegalPage";
import { legalMetadata } from "@/lib/legal-server";
export const generateMetadata = () => legalMetadata("privacy");
export default function Page() { return <LegalPage slug="privacy" />; }
