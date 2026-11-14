import LegalPage from "@/components/LegalPage";
import { legalMetadata } from "@/lib/legal-server";
export const generateMetadata = () => legalMetadata("cookies");
export default function Page() { return <LegalPage slug="cookies" />; }
