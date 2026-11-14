import Simulator from "@/components/Simulator";
import { publicOrigin } from "@/lib/server-config";

export function generateMetadata() { return { alternates: { canonical: publicOrigin() + "/" } }; }

export default function Home() {
  return <div className="map-shell-site"><Simulator /></div>;
}
