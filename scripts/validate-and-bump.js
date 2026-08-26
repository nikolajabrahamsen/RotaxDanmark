// Brugt af GitHub Action'en (.github/workflows/version-and-release.yml).
//
// KILDE vs. BYGGET FIL:
//   src/index.html  – JSX-kilden. Det er DENNE fil du (eller Claude) redigerer og
//                      uploader. Den er stadig et selvstændigt <script type="text/babel">
//                      dokument med babel-standalone indlæst, så den sagtens kan åbnes
//                      direkte i en browser for hurtig lokal test uden at vente på CI.
//   index.html      – Den fil GitHub Pages rent faktisk viser til brugerne. Denne fil
//                      må IKKE redigeres i hånden – den bliver skrevet af dette script,
//                      hver gang der pushes til main, og indeholder JSX'en fra
//                      src/index.html allerede oversat til almindelig JS. Browseren skal
//                      derfor ikke selv oversætte ~700KB JSX ved hvert opstart (det var
//                      det der gjorde appen langsom at åbne, særligt på telefoner) – den
//                      kan bare køre koden med det samme.
//
// Trin:
//   1) Trækker JSX-koden ud af src/index.html og tjekker at Babel kan parse den
//      (fanger de "Babel/JSX parse error"-fejl vi ellers først opdager i browseren).
//   2) Oversætter samme JSX-kode til almindelig JS (samme værktøj, Babel – det er det
//      der normalt sker i browseren, vi gør det bare én gang her i stedet for på hver
//      eneste telefon/computer der åbner appen).
//   3) Finder den SENESTE version ud fra eksisterende git-tags (ikke fra teksten i
//      filen – den kan sagtens være forældet). Bumper patch-tallet.
//   4) Bygger den endelige index.html: samme HTML som src/index.html, men med den
//      oversatte JS i stedet for JSX, uden babel-standalone (unødvendig nu), med
//      "production"-udgaverne af React (lidt hurtigere og mindre end "development"-
//      udgaverne), og med det nye versionsnummer.
// Printer den nye version på sidste linje, så workflowet kan læse den.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const babel = require("@babel/core");

const srcPath = path.join(__dirname, "..", "src", "index.html");
const outPath = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(srcPath, "utf8");

// ── 1) Udtræk og valider JSX ──────────────────────────────────────
const match = html.match(/<script type="text\/babel">([\s\S]*)<\/script>/);
if (!match) {
  console.error('Kunne ikke finde <script type="text/babel">-blokken i src/index.html');
  process.exit(1);
}
const jsxCode = match[1];

let compiled;
try {
  compiled = babel.transformSync(jsxCode, { presets: [["@babel/preset-react", { runtime: "classic" }]], filename: "index.jsx" });
} catch (e) {
  console.error("❌ JSX/Babel-syntaksfejl fundet – deploy stoppes:");
  console.error(e.message);
  process.exit(1);
}
console.error("✅ JSX-syntaks er OK og oversat til almindelig JS");

// ── 2) Find den reelle nuværende version ud fra git-tags ──────────
// Git-tags er den eneste sandhed her. Teksten i filen bruges KUN som fallback,
// hvis der slet ingen tags findes endnu (allerførste kørsel).
function highestExistingVersion() {
  let tags = [];
  try {
    tags = execSync('git tag -l "v*"', { encoding: "utf8" })
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
  } catch (e) {
    tags = [];
  }
  let best = null;
  for (const t of tags) {
    const m = t.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (!m) continue;
    const tuple = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!best || tuple[0] > best[0] || (tuple[0] === best[0] && tuple[1] > best[1]) || (tuple[0] === best[0] && tuple[1] === best[1] && tuple[2] > best[2])) {
      best = tuple;
    }
  }
  return best; // [major, minor, patch] eller null
}

let base = highestExistingVersion();
if (!base) {
  // Ingen tags fundet endnu – brug det der står i filen som udgangspunkt (bootstrap).
  const versionMatch = html.match(/const APP_VERSION="v(\d+)\.(\d+)\.(\d+)"/);
  if (!versionMatch) {
    console.error("Kunne ikke finde APP_VERSION-konstanten i src/index.html, og ingen git-tags fundet.");
    process.exit(1);
  }
  base = [Number(versionMatch[1]), Number(versionMatch[2]), Number(versionMatch[3])];
  console.error(`ℹ️ Ingen eksisterende git-tags – bruger version fra filen som udgangspunkt: v${base.join(".")}`);
} else {
  console.error(`ℹ️ Højeste eksisterende git-tag: v${base.join(".")}`);
}

const newVersion = `v${base[0]}.${base[1]}.${base[2] + 1}`;

// ── 3) Byg den endelige index.html ────────────────────────────────
let outHtml = html;

// Erstat hele <script type="text/babel">JSX</script>-blokken med almindelig,
// allerede-oversat JS – ingen "text/babel"-type, browseren kører den direkte.
outHtml = outHtml.replace(
  /<script type="text\/babel">[\s\S]*<\/script>/,
  `<script>${compiled.code}</script>`
);

// babel-standalone er ikke nødvendig længere – det var kun det der oversatte JSX i
// browseren ved hvert opstart. At fjerne den sparer også et ekstra scriptdownload.
outHtml = outHtml.replace(
  /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/babel-standalone\/[^"]*"><\/script>\n?/,
  ""
);

// React/ReactDOM "development"-udgaverne har ekstra advarsler/tjek der er nyttige når
// man selv sidder og retter kode (i src/index.html), men bare gør den udgivne app
// langsommere og større uden grund. "production"-udgaverne er hurtigere.
outHtml = outHtml.replace(
  /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react\/([\d.]+)\/umd\/react\.development\.js/,
  "https://cdnjs.cloudflare.com/ajax/libs/react/$1/umd/react.production.min.js"
);
outHtml = outHtml.replace(
  /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react-dom\/([\d.]+)\/umd\/react-dom\.development\.js/,
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/$1/umd/react-dom.production.min.js"
);

outHtml = outHtml.replace(
  /const APP_VERSION="v\d+\.\d+\.\d+"/,
  `const APP_VERSION="${newVersion}"`
);

fs.writeFileSync(outPath, outHtml);
console.error(`🔖 Version bumpet til ${newVersion}, index.html bygget fra src/index.html`);

// Sidste linje på stdout = ren version, så workflowet nemt kan læse den med `tail -n1`
console.log(newVersion);
