import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { deadlineLabel, formatDateTimeUtc } from "./labels";
import { publicReference } from "./verification";
import type { ReceiptData } from "./service";

const NAVY_950 = "#071b3d";
const NAVY_900 = "#0b2a5b";
const NAVY_700 = "#1d4380";
const LIME = "#a3e635";
const SKY_50 = "#f0f9ff";
const SKY_100 = "#e0f2fe";
const LINE = "#cfe3f3";
const MUTED = "#475569";

export const DEMO_LEGEND = "SIMULACIÓN — SIN VALIDEZ · PAGO FICTICIO · DEMOSTRACIÓN — SIN VALIDEZ DE COMPRA NI PARTICIPACIÓN";

const W = 595.28;
const H = 841.89;
const X0 = 36;
const CARD_W = W - 2 * X0;

/**
 * Sanea texto de usuario para el PDF: normaliza, quita controles y caracteres de formato/bidi y,
 * si se indica `hasGlyph`, sustituye por `?` lo que la fuente embebida no puede dibujar (emoji, CJK).
 */
export function pdfSafe(input: string, hasGlyph?: (codePoint: number) => boolean): string {
  let out = "";
  for (const ch of input.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufe0e\ufe0f\ufeff]/g, " ")) {
    out += hasGlyph && !hasGlyph(ch.codePointAt(0)!) ? "?" : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Noto Sans y Noto Sans Mono (SIL OFL 1.1, licencia incluida en los paquetes @expo-google-fonts).
 * Se registran con nombres propios (Sans, Sans-Bold, Mono, Mono-Bold).
 */
const FONT_DIR = path.join(process.cwd(), "node_modules", "@expo-google-fonts");
const FONTS: Record<string, string> = {
  Sans: "noto-sans/400Regular/NotoSans_400Regular.ttf",
  "Sans-Bold": "noto-sans/700Bold/NotoSans_700Bold.ttf",
  Mono: "noto-sans-mono/400Regular/NotoSansMono_400Regular.ttf",
  "Mono-Bold": "noto-sans-mono/700Bold/NotoSansMono_700Bold.ttf",
};
const fontCache = new Map<string, Buffer>();
function registerFonts(doc: PDFKit.PDFDocument) {
  for (const [name, rel] of Object.entries(FONTS)) {
    let buf = fontCache.get(rel);
    if (!buf) {
      buf = readFileSync(path.join(FONT_DIR, rel));
      fontCache.set(rel, buf);
    }
    doc.registerFont(name, buf);
  }
}

export const formatUtc = formatDateTimeUtc;

export function formatAmount(cents: number, currency: string): string {
  const zero = currency === "CLP";
  const value = zero ? cents : cents / 100;
  return `${new Intl.NumberFormat("es-CL", { minimumFractionDigits: zero ? 0 : 2, maximumFractionDigits: zero ? 0 : 2 }).format(value)} ${currency}`;
}

export const verificationUrl = (baseUrl: string, code: string) => `${baseUrl.replace(/\/+$/, "")}/verificar/${code}`;

function drawQr(doc: PDFKit.PDFDocument, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 4;
  const cell = size / (n + quiet * 2);
  doc.rect(x, y, size, size).fill("#ffffff");
  doc.fillColor("#000000");
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) { c++; continue; }
      let end = c;
      while (end < n && qr.modules.get(r, end)) end++;
      doc.rect(x + (c + quiet) * cell, y + (r + quiet) * cell, (end - c) * cell + 0.15, cell + 0.15).fill();
      c = end;
    }
  }
}

function perforation(doc: PDFKit.PDFDocument, y: number) {
  doc.save().dash(4, { space: 3 }).lineWidth(1).strokeColor(LINE).moveTo(X0 + 14, y).lineTo(X0 + CARD_W - 14, y).stroke().undash().restore();
  doc.circle(X0, y, 9).fill(SKY_50);
  doc.circle(X0 + CARD_W, y, 9).fill(SKY_50);
}

function pageBase(doc: PDFKit.PDFDocument) {
  doc.rect(0, 0, W, H).fill(SKY_50);
}

function brand(doc: PDFKit.PDFDocument, x: number, y: number) {
  doc.font("Sans-Bold").fontSize(20).fillColor("#ffffff").text("Easy", x, y, { lineBreak: false });
  const w = doc.widthOfString("Easy");
  doc.roundedRect(x + w + 2, y - 2, 36, 25, 5).fill(LIME);
  doc.fillColor(NAVY_950).text("Rif", x + w + 10, y, { lineBreak: false });
}

function field(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, w: number) {
  doc.font("Sans").fontSize(8).fillColor(MUTED).text(label.toUpperCase(), x, y, { width: w, lineBreak: false });
  doc.font("Sans-Bold").fontSize(11).fillColor(NAVY_900).text(value, x, y + 12, { width: w, lineBreak: false, ellipsis: true });
}

const CELL_W = 64;
const CELL_H = 26;
const GAP = 6;

/** Genera el comprobante A4. Solo recibe datos ya persistidos y saneados; no acepta HTML ni URLs remotas. */
export async function buildReceiptPdf(data: ReceiptData, baseUrl: string): Promise<Buffer> {
  const url = verificationUrl(baseUrl, data.verificationCode);
  const ref = publicReference(data.orderId);
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: true,
    compress: true,
    info: {
      Title: pdfSafe(`Comprobante digital de demostración ${ref}`),
      Author: "EasyRif",
      Subject: DEMO_LEGEND,
      Producer: "EasyRif",
      Creator: "EasyRif",
      CreationDate: data.issuedAt,
      ModDate: data.issuedAt,
    },
  });
  const chunks: Buffer[] = [];
  registerFonts(doc);
  const fontForGlyphs = doc.font("Sans") as unknown as { _font: { font: { hasGlyphForCodePoint(c: number): boolean } } };
  const safe = (s: string) => pdfSafe(s, (c) => fontForGlyphs._font.font.hasGlyphForCodePoint(c));
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ---- Pagina 1: entrada ----
  pageBase(doc);
  const top = 36;
  doc.roundedRect(X0, top, CARD_W, 754, 16).fill("#ffffff");
  doc.save().roundedRect(X0, top, CARD_W, 754, 16).lineWidth(1).stroke(LINE).restore();
  doc.save();
  doc.roundedRect(X0, top, CARD_W, 96, 16).clip();
  doc.rect(X0, top, CARD_W, 96).fill(NAVY_950);
  doc.rect(X0, top + 84, CARD_W, 12).fill(LIME);
  doc.restore();
  brand(doc, X0 + 22, top + 20);
  doc.font("Sans-Bold").fontSize(17).fillColor("#ffffff").text("Comprobante digital — demostración", X0 + 22, top + 52, { lineBreak: false });
  doc.font("Sans-Bold").fontSize(9).fillColor(LIME).text("REFERENCIA", X0 + CARD_W - 150, top + 22, { width: 128, align: "right", lineBreak: false });
  doc.font("Mono-Bold").fontSize(18).fillColor("#ffffff").text(ref, X0 + CARD_W - 150, top + 36, { width: 128, align: "right", lineBreak: false });

  const bx = X0 + 22;
  const bw = CARD_W - 44;
  let y = top + 116;
  doc.font("Sans").fontSize(8).fillColor(MUTED).text("CAMPAÑA", bx, y, { lineBreak: false });
  doc.font("Sans-Bold").fontSize(18).fillColor(NAVY_900).text(safe(data.raffleTitle), bx, y + 12, { width: bw, height: 44, ellipsis: true });
  y += 62;
  field(doc, "Organizador", safe(data.organizerName), bx, y, bw);
  y += 36;
  const colW = bw / 3;
  field(doc, "Emitido", formatUtc(data.issuedAt), bx, y, colW * 1.5);
  field(doc, deadlineLabel(data.status), formatUtc(data.expiresAt), bx + colW * 1.5, y, colW * 1.5);
  y += 38;
  field(doc, "Cantidad de números", String(data.numbers.length), bx, y, colW);
  field(doc, "Precio unitario (informativo)", formatAmount(data.unitPriceCents, data.currency), bx + colW, y, colW);
  field(doc, "Total (no cobrado)", formatAmount(data.totalCents, data.currency), bx + colW * 2, y, colW);
  if (data.simulationConfirmedAt) {
    const simulationDate = data.simulationPaidAt ?? data.simulationConfirmedAt;
    field(doc, "Compra/pago ficticios · sin validez", formatUtc(simulationDate), bx, y + 38, bw);
  }

  perforation(doc, top + 296);

  // ---- Numeros ----
  const wide = data.numbers.some((n) => n.length > 8);
  const cellW = wide ? 112 : CELL_W;
  const cellFont = wide ? 10 : 12;
  const gridCols = Math.max(1, Math.floor((bw + GAP) / (cellW + GAP)));
  const gridOffset = (bw - (gridCols * cellW + (gridCols - 1) * GAP)) / 2;
  const page1Bottom = top + 556;
  const contBottom = 770;
  let gy = top + 312;
  doc.font("Sans-Bold").fontSize(10).fillColor(NAVY_900).text(`${wide ? "Participaciones" : "Números"} de esta reserva (${data.numbers.length})`, bx, gy, { lineBreak: false });
  gy += 20;
  let col = 0;
  let limit = page1Bottom;
  const drawCell = (n: string) => {
    const cx = bx + gridOffset + col * (cellW + GAP);
    doc.roundedRect(cx, gy, cellW, CELL_H, 6).fill(SKY_100);
    doc.roundedRect(cx, gy, cellW, CELL_H, 6).lineWidth(0.8).stroke(NAVY_700);
    doc.font("Mono-Bold").fontSize(cellFont).fillColor(NAVY_950).text(n, cx, gy + (wide ? 9 : 8), { width: cellW, align: "center", lineBreak: false });
  };
  const contPage = () => {
    doc.addPage();
    pageBase(doc);
    doc.roundedRect(X0, 36, CARD_W, 744, 16).fill("#ffffff");
    doc.save().roundedRect(X0, 36, CARD_W, 744, 16).lineWidth(1).stroke(LINE).restore();
    doc.save().roundedRect(X0, 36, CARD_W, 44, 16).clip().rect(X0, 36, CARD_W, 44).fill(NAVY_950).restore();
    brand(doc, X0 + 22, 46);
    doc.font("Sans-Bold").fontSize(9).fillColor(LIME).text(`Continuación · referencia ${ref}`, X0 + CARD_W - 250, 52, { width: 228, align: "right", lineBreak: false });
    gy = 100;
    limit = contBottom;
    col = 0;
  };
  for (const n of data.numbers) {
    if (gy + CELL_H > limit) contPage();
    drawCell(n);
    col++;
    if (col === gridCols) { col = 0; gy += CELL_H + GAP; }
  }

  // ---- Participantes por numero (solo en el PDF privado) ----
  const people = data.participants ?? [];
  if (people.length > 0) {
    contPage();
    const heading = () => doc.font("Sans-Bold").fontSize(11).fillColor(NAVY_900).text("Participante de cada número", bx, gy, { lineBreak: false });
    heading();
    gy += 22;
    for (const p of people) {
      if (gy + 18 > limit) {
        contPage();
        heading();
        gy += 22;
      }
      doc.font("Mono-Bold").fontSize(9).fillColor(NAVY_950).text(p.label, bx, gy, { width: 110, lineBreak: false });
      doc.font("Sans").fontSize(9).fillColor(NAVY_900).text(safe(`${p.name} · ${p.email}${p.phone ? ` · ${p.phone}` : ""}`), bx + 118, gy, { width: bw - 118, height: 12, ellipsis: true });
      gy += 18;
    }
  }

  // ---- Talon con QR (siempre en la pagina 1) ----
  doc.switchToPage(0);
  perforation(doc, top + 580);
  const qy = top + 600;
  const qrSize = 140;
  drawQr(doc, url, bx, qy, qrSize);
  doc.save().roundedRect(bx, qy, qrSize, qrSize, 4).lineWidth(0.8).stroke(LINE).restore();
  const tx = bx + qrSize + 20;
  const tw = bw - qrSize - 20;
  doc.font("Sans-Bold").fontSize(12).fillColor(NAVY_900).text("Consultar estado de esta reserva de demostración", tx, qy + 4, { width: tw });
  doc.font("Sans").fontSize(9).fillColor(MUTED).text("Escanee el código QR o abra el enlace. La página muestra el estado actual de la reserva; este PDF no se actualiza por sí mismo.", tx, qy + 38, { width: tw });
  doc.font("Mono").fontSize(7.2).fillColor(NAVY_700);
  const half = Math.ceil(url.length / 2);
  doc.text(url.slice(0, half), tx, qy + 86, { width: tw, lineBreak: false });
  doc.text(url.slice(half), tx, qy + 96, { width: tw, lineBreak: false });
  doc.font("Sans-Bold").fontSize(8).fillColor(NAVY_900).text("Reserva temporal de demostración. No acredita pago, compra ni participación en la rifa.", tx, qy + 114, { width: tw });

  // ---- Marca de agua y pie en todas las paginas ----
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.save();
    doc.rotate(-32, { origin: [W / 2, H / 2] });
    doc.fillColor(NAVY_900).fillOpacity(0.07).font("Sans-Bold").fontSize(62);
    const label = "DEMOSTRACIÓN";
    doc.text(label, W / 2 - doc.widthOfString(label) / 2, H / 2 - 30, { lineBreak: false });
    doc.restore();
    doc.fillOpacity(1);
    doc.font("Sans-Bold").fontSize(9).fillColor(NAVY_900).text(DEMO_LEGEND, 0, H - 40, { width: W, align: "center", lineBreak: false });
    doc.font("Sans").fontSize(8).fillColor(MUTED).text(`Página ${i + 1} de ${range.count}`, 0, H - 26, { width: W, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}
