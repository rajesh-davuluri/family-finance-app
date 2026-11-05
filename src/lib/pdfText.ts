// Reads the text of a PDF statement in the browser (pdf.js), line by line, so
// it can go through parseStatementLines. The file never leaves the device.
// Browser-only: imported dynamically from the Import page.

export class PdfPasswordError extends Error {
  constructor(public incorrect: boolean) {
    super(incorrect ? "Incorrect PDF password." : "This PDF is password-protected.");
  }
}

type TextItem = { str: string; transform: number[]; width: number };

// Text items on (almost) the same baseline form one line.
const SAME_LINE_TOLERANCE = 2;

export async function extractPdfLines(data: ArrayBuffer, password?: string): Promise<string[]> {
  // Legacy build: works in older Safari/Chrome versions too.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data), password });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy();
    const e = err as { name?: string; code?: number };
    // pdf.js: code 1 = password needed, 2 = wrong password.
    if (e?.name === "PasswordException") throw new PdfPasswordError(e.code === 2);
    throw err;
  }

  const lines: string[] = [];
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const items = (content.items as unknown[]).filter(
        (i): i is TextItem => typeof (i as TextItem).str === "string" && (i as TextItem).str.trim() !== ""
      );

      // Top of the page first (PDF y grows upward), then left to right.
      items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
      const rows: TextItem[][] = [];
      for (const item of items) {
        const row = rows[rows.length - 1];
        if (row && Math.abs(row[0].transform[5] - item.transform[5]) <= SAME_LINE_TOLERANCE) row.push(item);
        else rows.push([item]);
      }
      for (const row of rows) {
        row.sort((a, b) => a.transform[4] - b.transform[4]);
        lines.push(row.map((i) => i.str.trim()).join(" "));
      }
    }
  } finally {
    await loadingTask.destroy();
  }
  return lines;
}
