import LegalPage from "@/components/LegalPage";
import { legalMetadata } from "@/lib/legal-server";
export const generateMetadata = () => legalMetadata("offer");
export default function Page() { return <LegalPage slug="offer" />; }
