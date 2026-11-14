import LegalPage from "@/components/LegalPage";
import { legalMetadata } from "@/lib/legal-server";
export const generateMetadata = () => legalMetadata("analytics-consent");
export default function Page() { return <LegalPage slug="analytics-consent" />; }
