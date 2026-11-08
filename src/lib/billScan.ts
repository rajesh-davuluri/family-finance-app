// Scanning a bill on the phone: shrink the photo, read its text with
// Tesseract.js (runs in the browser -- the image never leaves the device to
// be read), and turn the text into a transaction guess. Browser-only.

import { parseReceipt, type ReceiptGuess } from "@/lib/receiptParse";

const MAX_SIDE = 1600; // enough for text recognition, a few hundred KB as JPEG

// The photo as a JPEG no larger than MAX_SIDE on its longest side. Safari
// decodes HEIC and applies the camera's rotation when it draws the image.
export async function shrinkPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't encode the photo"))), "image/jpeg", 0.82),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

type OcrWorker = { recognize: (image: Blob) => Promise<{ data: { text: string } }> };
let workerPromise: Promise<OcrWorker> | null = null;
let onProgress: ((p: number) => void) | null = null;

// One recognizer per page visit; the engine and English data (~7 MB) come
// from this app's own /ocr folder and are cached by the browser after the
// first scan.
function getWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const base = `${window.location.origin}/ocr`;
      const worker = await createWorker("eng", 1 /* LSTM engine */, {
        workerPath: `${base}/worker.min.js`,
        corePath: base,
        langPath: `${base}/lang`,
        workerBlobURL: false,
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") onProgress?.(m.progress);
        },
      });
      return worker as unknown as OcrWorker;
    })().catch((e) => {
      workerPromise = null; // let the next scan try again
      throw e;
    });
  }
  return workerPromise;
}

export type ScanResult = { photo: Blob; guess: ReceiptGuess; text: string };

export async function scanBill(
  file: File,
  today: string,
  progress?: (stage: "preparing" | "loading" | "reading", fraction: number) => void,
): Promise<ScanResult> {
  progress?.("preparing", 0);
  const photo = await shrinkPhoto(file);
  progress?.("loading", 0);
  onProgress = (p) => progress?.("reading", p);
  const worker = await getWorker();
  progress?.("reading", 0);
  const { data } = await worker.recognize(photo);
  onProgress = null;
  return { photo, text: data.text, guess: parseReceipt(data.text, today) };
}
