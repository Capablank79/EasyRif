import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { assertCan, getActiveRole } from "@/modules/organizations";
import { parseFolioList } from "@/modules/raffles/campaign";
import { hashValue } from "@/modules/reservations/service";
import { recordAuditEvent } from "@/platform/audit";
import { raffles, sellers } from "@/platform/db/schema";
import type { Database } from "@/platform/db/types";
import { deriveSellerToken, CampaignError, MAX_SELLERS_PER_RAFFLE } from "./service";
import { MAX_SELLER_IMPORT_BYTES, MAX_SELLER_IMPORT_ROWS, type SellerImportPreview, type SellerImportPreviewRow, type SellerImportResult, type SellerSpreadsheetRow } from "./import-types";

const asDb = (tx: unknown) => tx as Database;
const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[];
const normalizeName = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es-CL");
const normalizeHeader = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es-CL");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+()\s-]{6,20}$/;

function safeZip(buffer: Buffer): boolean {
  const start = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= start; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return false;
  const entries = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entries < 1 || entries > 100 || directoryOffset + directorySize > eocd) return false;
  let at = directoryOffset;
  let expandedBytes = 0;
  for (let i = 0; i < entries; i++) {
    if (at + 46 > eocd || buffer.readUInt32LE(at) !== 0x02014b50) return false;
    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    const expanded = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) return false;
    expandedBytes += expanded;
    if (expandedBytes > 8 * 1024 * 1024) return false;
    at += 46 + nameLength + extraLength + commentLength;
  }
  return at <= directoryOffset + directorySize;
}

function cellText(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("").trim();
  }
  // Excel puede convertir automáticamente un email en vínculo mailto al editarlo.
  // Aceptamos solo cuando el texto visible coincide con el destino; no seguimos ni
  // importamos enlaces externos o hipervínculos cuyo destino difiere del texto.
  if (typeof value === "object" && "text" in value && typeof value.text === "string" && "hyperlink" in value && typeof value.hyperlink === "string") {
    const text = value.text.trim();
    if (value.hyperlink.trim().toLocaleLowerCase("en-US") === `mailto:${text}`.toLocaleLowerCase("en-US")) return text;
  }
  return null;
}

/** Parsea solo XLSX real y acotado; nunca evalúa fórmulas ni enlaces del libro. */
export async function parseSellerWorkbook(fileName: string, bytes: Buffer): Promise<SellerSpreadsheetRow[]> {
  if (!fileName.toLocaleLowerCase("es-CL").endsWith(".xlsx")) {
    throw new CampaignError("invalid", "Formato no compatible. Usa un archivo .xlsx; .xls no está admitido.");
  }
  if (bytes.length === 0 || bytes.length > MAX_SELLER_IMPORT_BYTES) {
    throw new CampaignError("invalid", "El archivo debe pesar entre 1 byte y 2 MB.");
  }
  if (!safeZip(bytes)) throw new CampaignError("invalid", "El contenido no es un archivo XLSX válido o supera los límites de seguridad.");

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new CampaignError("invalid", "No se pudo leer el Excel. Descarga la plantilla y vuelve a intentarlo.");
  }
  if (workbook.worksheets.length !== 1) throw new CampaignError("invalid", "El archivo debe contener una sola hoja.");
  const sheet = workbook.worksheets[0];
  if (sheet.actualRowCount > MAX_SELLER_IMPORT_ROWS + 1) {
    throw new CampaignError("invalid", `El archivo supera el máximo de ${MAX_SELLER_IMPORT_ROWS} filas.`);
  }
  const headerRow = sheet.getRow(1);
  const columns = new Map<string, number>();
  const accepted: Record<string, string> = { nombre: "nombre", name: "nombre", email: "email", correo: "email", telefono: "telefono", phone: "telefono", folios: "folios" };
  headerRow.eachCell({ includeEmpty: false }, (cell, column) => {
    const text = cellText(cell.value);
    if (text === null) throw new CampaignError("invalid", "Los encabezados deben ser texto simple.");
    const key = accepted[normalizeHeader(text)];
    if (!key) throw new CampaignError("invalid", `Encabezado no reconocido: ${text}. Usa nombre, email, teléfono y folios.`);
    if (columns.has(key)) throw new CampaignError("invalid", `El encabezado «${text}» está repetido.`);
    columns.set(key, column);
  });
  if (!columns.has("nombre")) throw new CampaignError("invalid", "Falta la columna obligatoria «nombre».");

  const output: SellerSpreadsheetRow[] = [];
  for (let line = 2; line <= sheet.actualRowCount; line++) {
    const row = sheet.getRow(line);
    const textAt = (key: string) => {
      const col = columns.get(key);
      if (!col) return "";
      return cellText(row.getCell(col).value);
    };
    const rawName = textAt("nombre");
    const rawEmail = textAt("email");
    const rawPhone = textAt("telefono");
    const rawFolios = textAt("folios");
    const errors: string[] = [];
    if ([rawName, rawEmail, rawPhone, rawFolios].some((v) => v === null)) {
      output.push({ line, displayName: "", email: null, phone: null, folios: [], errors: ["No uses fórmulas, enlaces ni objetos en las celdas."] });
      continue;
    }
    if (![rawName, rawEmail, rawPhone, rawFolios].some((v) => v !== "")) continue;
    const displayName = (rawName ?? "").replace(/\s+/g, " ").trim();
    const email = (rawEmail ?? "").trim().toLocaleLowerCase("en-US") || null;
    const phone = (rawPhone ?? "").trim() || null;
    let folios: number[] = [];
    if (displayName.length < 2 || displayName.length > 80) errors.push("Nombre: usa entre 2 y 80 caracteres.");
    if (email && (email.length > 254 || !EMAIL.test(email))) errors.push("Email no válido.");
    if (phone && !PHONE.test(phone)) errors.push("Teléfono no válido (6 a 20 caracteres permitidos).");
    if (rawFolios) {
      const parsed = parseFolioList(rawFolios);
      if (!parsed) errors.push("Folios no válidos. Ejemplo: 1-3, 5.");
      else folios = parsed;
    }
    output.push({ line, displayName, email, phone, folios, errors });
    if (output.length > MAX_SELLER_IMPORT_ROWS) throw new CampaignError("invalid", `El archivo supera el máximo de ${MAX_SELLER_IMPORT_ROWS} filas con datos.`);
  }
  if (output.length === 0) throw new CampaignError("invalid", "No hay filas con responsables para importar.");
  return output;
}

interface ExistingSeller { id: string; display_name: string; email: string | null; status: "active" | "revoked" }
interface ExistingFolio { folio: number; seller_id: string | null; seller_name: string | null }

async function currentData(db: Database, raffleId: string, organizationId: string) {
  const existing = rowsOf<ExistingSeller>(await db.execute(sql`
    SELECT "id", "display_name", "email", "status" FROM "sellers"
    WHERE "raffle_id" = ${raffleId} AND "organization_id" = ${organizationId}`));
  const folios = rowsOf<ExistingFolio>(await db.execute(sql`
    SELECT bk."folio", s."id" AS seller_id, s."display_name" AS seller_name
    FROM "booklets" bk
    LEFT JOIN "booklet_assignments" a ON a."booklet_id" = bk."id" AND a."ended_at" IS NULL
    LEFT JOIN "sellers" s ON s."id" = a."seller_id" AND s."raffle_id" = ${raffleId} AND s."organization_id" = ${organizationId}
    WHERE bk."raffle_id" = ${raffleId} AND bk."organization_id" = ${organizationId}`));
  return { existing, folios };
}

function classify(rows: SellerSpreadsheetRow[], current: { existing: ExistingSeller[]; folios: ExistingFolio[] }): SellerImportPreview {
  const inFile = new Map<string, number[]>();
  const folioOwners = new Map<number, number[]>();
  for (const row of rows) {
    const identity = row.email ? `email:${row.email}` : `name:${normalizeName(row.displayName)}`;
    inFile.set(identity, [...(inFile.get(identity) ?? []), row.line]);
    for (const folio of row.folios) folioOwners.set(folio, [...(folioOwners.get(folio) ?? []), row.line]);
  }
  const allFolios = new Set(current.folios.map((f) => Number(f.folio)));
  const assignmentByFolio = new Map(current.folios.map((f) => [Number(f.folio), f]));
  const planned: SellerImportPreviewRow[] = rows.map((row) => {
    const messages = [...row.errors];
    if ((inFile.get(row.email ? `email:${row.email}` : `name:${normalizeName(row.displayName)}`)?.length ?? 0) > 1) {
      messages.push("Responsable duplicado dentro del archivo.");
    }
    const conflictingFolios = row.folios.filter((f) => (folioOwners.get(f)?.length ?? 0) > 1);
    if (conflictingFolios.length) messages.push(`Folios repetidos en el archivo: ${conflictingFolios.join(", ")}.`);
    const missingFolios = row.folios.filter((f) => !allFolios.has(f));
    if (missingFolios.length) messages.push(`Folios inexistentes en esta rifa: ${missingFolios.join(", ")}.`);

    const nameKey = normalizeName(row.displayName);
    const byEmail = row.email ? current.existing.find((s) => s.email?.toLocaleLowerCase("en-US") === row.email) : undefined;
    const sameName = current.existing.filter((s) => normalizeName(s.display_name) === nameKey);
    const existing = byEmail ?? (!row.email && sameName.length === 1 ? sameName[0] : undefined);
    if (!byEmail && row.email && sameName.some((s) => !s.email)) {
      messages.push("Ya existe un responsable con este nombre sin email; revísalo para evitar duplicarlo.");
    }
    if (!byEmail && row.email && sameName.some((s) => s.email && s.email.toLocaleLowerCase("en-US") !== row.email)) {
      messages.push("Ya existe un responsable con este nombre y otro email; revísalo para evitar duplicarlo.");
    }
    if (sameName.length > 1 && !byEmail) messages.push("Hay varios responsables con este nombre; identifica la fila por email.");
    if (existing?.status === "revoked") messages.push("El responsable coincidente está revocado; no se reactivará desde Excel.");
    const heldByOther = existing ? row.folios.filter((f) => {
      const assignment = assignmentByFolio.get(f);
      return assignment?.seller_id && assignment.seller_id !== existing.id;
    }) : row.folios.filter((f) => Boolean(assignmentByFolio.get(f)?.seller_id));
    if (heldByOther.length) messages.push(`Folios ya asignados a otra persona: ${heldByOther.join(", ")}.`);

    let status: SellerImportPreviewRow["status"] = "ready";
    if (row.errors.length) status = "error";
    else if (messages.length) status = "conflict";
    else if (existing) status = "existing";
    return { line: row.line, displayName: row.displayName, email: row.email, phone: row.phone, folios: row.folios, status, messages: messages.length ? messages : existing ? ["El perfil ya existe; se reutilizará y no se duplicará."] : ["Se creará un perfil de responsable para esta rifa."] };
  });
  return {
    rows: planned,
    ready: planned.filter((r) => r.status === "ready").length,
    existing: planned.filter((r) => r.status === "existing").length,
    errors: planned.filter((r) => r.status === "error").length,
    conflicts: planned.filter((r) => r.status === "conflict").length,
  };
}

async function authorizeImport(db: Database, userId: string, raffleId: string) {
  const [raffle] = await db.select().from(raffles).where(sql`${raffles.id} = ${raffleId}`).limit(1);
  if (!raffle || raffle.numberingMode !== "booklets") throw new CampaignError("not_found", "No se encontró una rifa con talonarios.");
  const role = await getActiveRole(db, userId, raffle.organizationId);
  if (!role) throw new CampaignError("not_found", "No se encontró la rifa.");
  assertCan(role, "sellers:manage");
  return raffle;
}

export async function previewSellerImport(db: Database, userId: string, raffleId: string, rows: SellerSpreadsheetRow[]) {
  const raffle = await authorizeImport(db, userId, raffleId);
  return classify(rows, await currentData(db, raffle.id, raffle.organizationId));
}

export async function importSellerRows(db: Database, userId: string, raffleId: string, rows: SellerSpreadsheetRow[]): Promise<SellerImportResult> {
  const raffle = await authorizeImport(db, userId, raffleId);
  return db.transaction(async (rawTx) => {
    const tx = asDb(rawTx);
    await tx.execute(sql`SELECT "id" FROM "raffles" WHERE "id" = ${raffle.id} AND "organization_id" = ${raffle.organizationId} FOR UPDATE`);
    const current = await currentData(tx, raffle.id, raffle.organizationId);
    const preview = classify(rows, current);
    const [{ n }] = rowsOf<{ n: string }>(await tx.execute(sql`SELECT count(*) AS n FROM "sellers" WHERE "raffle_id" = ${raffle.id} AND "organization_id" = ${raffle.organizationId}`));
    let sellerCount = +n;
    const result: SellerImportResult = { created: 0, updated: 0, skipped: 0, errors: 0, messages: [] };
    for (const row of preview.rows) {
      if (row.status === "error" || row.status === "conflict") {
        result.skipped++;
        if (row.status === "error") result.errors++;
        result.messages.push(`Fila ${row.line}: ${row.messages.join(" ")}`);
        continue;
      }
      const source = rows.find((x) => x.line === row.line)!;
      const nameKey = normalizeName(source.displayName);
      const existing = source.email
        ? current.existing.find((s) => s.email?.toLocaleLowerCase("en-US") === source.email)
        : current.existing.find((s) => normalizeName(s.display_name) === nameKey && s.status === "active");
      let sellerId = existing?.id;
      if (!sellerId) {
        if (sellerCount >= MAX_SELLERS_PER_RAFFLE) {
          result.errors++;
          result.skipped++;
          result.messages.push(`Fila ${row.line}: se alcanzó el máximo de ${MAX_SELLERS_PER_RAFFLE} responsables.`);
          continue;
        }
        sellerId = crypto.randomUUID();
        await tx.insert(sellers).values({
          id: sellerId,
          organizationId: raffle.organizationId,
          raffleId: raffle.id,
          displayName: source.displayName,
          email: source.email,
          phone: source.phone,
          tokenHash: hashValue(deriveSellerToken(sellerId)),
        });
        sellerCount++;
        result.created++;
        current.existing.push({ id: sellerId, display_name: source.displayName, email: source.email, status: "active" });
        await recordAuditEvent(tx, { organizationId: raffle.organizationId, actorId: userId, entityType: "seller", entityId: sellerId, action: "seller.imported", metadata: { raffleId: raffle.id, imported: true } });
      }
      const assign = source.folios.filter((folio) => !current.folios.some((f) => Number(f.folio) === folio && f.seller_id === sellerId));
      if (assign.length) {
        const ids = current.folios.filter((f) => assign.includes(Number(f.folio))).map((f) => String(f.folio));
        for (const folio of ids) {
          await tx.execute(sql`
            INSERT INTO "booklet_assignments" ("raffle_id", "organization_id", "booklet_id", "seller_id", "assigned_by")
            SELECT ${raffle.id}, ${raffle.organizationId}, bk."id", ${sellerId}::uuid, ${userId}::uuid
            FROM "booklets" bk WHERE bk."raffle_id" = ${raffle.id} AND bk."organization_id" = ${raffle.organizationId} AND bk."folio" = ${Number(folio)}`);
          const found = current.folios.find((f) => Number(f.folio) === Number(folio))!;
          found.seller_id = sellerId;
          found.seller_name = source.displayName;
        }
        result.updated += existing ? 1 : 0;
        await recordAuditEvent(tx, { organizationId: raffle.organizationId, actorId: userId, entityType: "seller", entityId: sellerId, action: "booklets.assigned", metadata: { raffleId: raffle.id, folios: assign, imported: true } });
      } else if (existing) {
        result.skipped++;
      }
    }
    result.messages.unshift(`Importación terminada: ${result.created} creados, ${result.updated} perfiles reutilizados con folios nuevos, ${result.skipped} omitidos, ${result.errors} con errores.`);
    return result;
  });
}

export function summarizeSellerImport(rows: SellerImportPreviewRow[]): Pick<SellerImportPreview, "ready" | "existing" | "errors" | "conflicts"> {
  return {
    ready: rows.filter((r) => r.status === "ready").length,
    existing: rows.filter((r) => r.status === "existing").length,
    errors: rows.filter((r) => r.status === "error").length,
    conflicts: rows.filter((r) => r.status === "conflict").length,
  };
}
