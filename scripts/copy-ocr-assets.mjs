// Copies the on-phone text-recognition files (Tesseract.js) into public/ocr so
// the app serves them itself -- no third-party CDN when a bill is scanned.
// Runs after npm install and before every build; public/ocr is not committed.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = join(dirname(new URL(import.meta.url).pathname), "..");
const out = join(root, "public", "ocr");
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

const files = [
  [join(pkgDir("tesseract.js"), "dist", "worker.min.js"), join(out, "worker.min.js")],
  // The LSTM engine only (what "best" language data uses), in each CPU flavour
  // the worker may pick: relaxed SIMD, SIMD, and plain.
  ...["tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"].map((f) => [
    join(pkgDir("tesseract.js-core"), f),
    join(out, f),
  ]),
  [join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"), join(out, "lang", "eng.traineddata.gz")],
];

let copied = 0;
for (const [from, to] of files) {
  if (!existsSync(from)) {
    console.warn(`copy-ocr-assets: missing ${from} -- bill scanning won't work until it's installed`);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  copied++;
}
console.log(`copy-ocr-assets: ${copied}/${files.length} files in public/ocr`);
