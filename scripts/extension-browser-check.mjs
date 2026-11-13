import { runExtended } from "./design-functional-check.mjs";
try { const report = await runExtended(); console.log(JSON.stringify({ checks: report.checks.length, errors: report.errors })); }
catch (error) { console.error(error); process.exitCode = 1; }
