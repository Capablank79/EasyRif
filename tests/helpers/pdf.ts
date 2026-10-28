import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/** Utilidades de test: extrae texto, renderiza paginas a PNG y decodifica el QR del PDF. */
export async function openPdf(data: Uint8Array) {
  return pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 }).promise;
}

export async function pageTexts(data: Uint8Array): Promise<string[]> {
  const doc = await openPdf(data);
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return out;
}

export async function renderPage(data: Uint8Array, pageNo: number, scale = 2) {
  const doc = await openPdf(data);
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext("2d");
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport: vp,
  }).promise;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    png: canvas.toBuffer("image/png"),
    rgba: new Uint8ClampedArray(img.data),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function decodeQr(data: Uint8Array, pageNo = 1): Promise<string | null> {
  const r = await renderPage(data, pageNo, 3);
  return jsQR(r.rgba, r.width, r.height)?.data ?? null;
}
