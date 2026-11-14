import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // These existing imperative MapLibre/Framework7 adapters are not React Compiler inputs.
  // Keep compiler-only diagnostics visible without making them the baseline for unrelated feature work.
  { files: ["src/components/{RoadMap,DesignSystem,Simulator,ParkingSettings}.tsx"], rules: {
    "react-hooks/refs": "warn", "react-hooks/set-state-in-effect": "warn",
  } },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
