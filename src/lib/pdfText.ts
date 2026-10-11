import { getDocumentProxy } from "unpdf";

type TextItem = { str: string; transform: number[]; width: number };

export async function extractPdfLines(bytes: Uint8Array): Promise<{ lines: string[]; pageCount: number }> {
  const pdf = await getDocumentProxy(bytes);
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    lines.push(...groupIntoLines(content.items as TextItem[]));
  }
  const pageCount = pdf.numPages;
  await pdf.cleanup();
  return { lines, pageCount };
}

// PDF text comes out as positioned fragments, not lines. Fragments sharing
// (roughly) the same baseline are one visual line; within a line they're
// ordered left to right, with a space wherever there's a visible gap.
function groupIntoLines(items: TextItem[]): string[] {
  const rows: { y: number; items: TextItem[] }[] = [];
  for (const item of items) {
    if (!item.str?.trim() || !item.transform) continue;
    const y = item.transform[5];
    const row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (row) row.items.push(item);
    else rows.push({ y, items: [item] });
  }
  rows.sort((a, b) => b.y - a.y);

  return rows.map((row) => {
    row.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let text = "";
    let prevEnd: number | null = null;
    for (const item of row.items) {
      const x = item.transform[4];
      if (prevEnd !== null && x - prevEnd > 1) text += " ";
      text += item.str;
      prevEnd = x + item.width;
    }
    return text.replace(/\s+/g, " ").trim();
  });
}
