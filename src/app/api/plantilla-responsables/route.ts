import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EasyRif";
  workbook.subject = "Plantilla para importar responsables de una rifa";
  const sheet = workbook.addWorksheet("Responsables");
  sheet.columns = [
    { header: "nombre", key: "nombre", width: 30 },
    { header: "email", key: "email", width: 34 },
    { header: "teléfono", key: "telefono", width: 20 },
    { header: "folios", key: "folios", width: 24 },
  ];
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FF0B2A5B" } };
  sheet.getRow(1).eachCell((cell) => { cell.note = "Nombre obligatorio; email, teléfono y folios son opcionales. Para varios folios usa 1-3, 5."; });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-responsables-easyrif.xlsx"',
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
