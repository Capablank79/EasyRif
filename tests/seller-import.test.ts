import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseSellerWorkbook } from "@/modules/campaigns/seller-import";
import { MAX_SELLER_IMPORT_BYTES } from "@/modules/campaigns/import-types";

async function workbook(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Responsables");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("importación XLSX de responsables", () => {
  it("lee solo .xlsx real y normaliza datos, acentos y rangos de folios", async () => {
    const bytes = await workbook([
      ["nombre", "email", "teléfono", "folios"],
      ["  Ana   Pérez ", "ANA@example.cl", "+56 9 1234 5678", "1-3, 5"],
      [null, null, null, null],
    ]);
    await expect(parseSellerWorkbook("responsables.xlsx", bytes)).resolves.toEqual([
      { line: 2, displayName: "Ana Pérez", email: "ana@example.cl", phone: "+56 9 1234 5678", folios: [1, 2, 3, 5], errors: [] },
    ]);
  });

  it("acepta emails que Excel convirtió en mailto coincidente y rechaza enlaces externos", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Responsables");
    sheet.addRow(["nombre", "email", "telefono", "folios"]);
    sheet.addRow(["Ana Pérez", { text: "ana@example.cl", hyperlink: "mailto:ana@example.cl" }, null, null]);
    sheet.addRow(["Luis Pérez", { text: "luis@example.cl", hyperlink: "https://example.cl/luis" }, null, null]);
    const rows = await parseSellerWorkbook("contactos.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(rows[0]).toMatchObject({ displayName: "Ana Pérez", email: "ana@example.cl", errors: [] });
    expect(rows[1].displayName).toBe("");
    expect(rows[1].errors).toContain("No uses fórmulas, enlaces ni objetos en las celdas.");
  });

  it("rechaza .xls, contenido ZIP falso, archivos sobre el límite y encabezados inválidos", async () => {
    await expect(parseSellerWorkbook("antiguo.xls", Buffer.from("PK\u0003\u0004"))).rejects.toThrow(/\.xlsx/);
    await expect(parseSellerWorkbook("falso.xlsx", Buffer.from("PK\u0003\u0004"))).rejects.toThrow(/XLSX válido/);
    await expect(parseSellerWorkbook("grande.xlsx", Buffer.alloc(MAX_SELLER_IMPORT_BYTES + 1))).rejects.toThrow(/2 MB/);
    await expect(parseSellerWorkbook("cabecera.xlsx", await workbook([["name", "name"]]))).rejects.toThrow(/repetido/);
  });

  it("devuelve errores por fila para fórmulas y datos inválidos", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Responsables");
    sheet.addRow(["nombre", "email", "telefono", "folios"]);
    sheet.addRow(["A", "mal-correo", "123", "8-4"]);
    sheet.addRow([{ formula: "1+1", result: 2 }, null, null, null]);
    const rows = await parseSellerWorkbook("datos.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(rows[0].errors).toEqual(expect.arrayContaining(["Nombre: usa entre 2 y 80 caracteres.", "Email no válido.", "Teléfono no válido (6 a 20 caracteres permitidos).", "Folios no válidos. Ejemplo: 1-3, 5."]));
    expect(rows[1].errors).toContain("No uses fórmulas, enlaces ni objetos en las celdas.");
  });
});
