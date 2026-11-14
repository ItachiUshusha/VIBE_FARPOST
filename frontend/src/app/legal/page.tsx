import LegalPage from "@/components/LegalPage";
import { legalMetadata } from "@/lib/legal-server";
export const generateMetadata = () => legalMetadata("legal");
export default function Page() { return <LegalPage slug="legal" />; }
