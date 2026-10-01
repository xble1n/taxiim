export type EarningsPdf = {
  period: string;
  generated: string;
  driver?: string;
  vehicle?: string;
  trips: number;
  completed: number;
  cancelled: number;
  revenue: string;
  rows: Array<{ date: string; trips: string; revenue: string }>;
  note: string;
};

function latin(value: string) {
  return value
    .replaceAll("ë", "e")
    .replaceAll("Ë", "E")
    .replaceAll("ç", "c")
    .replaceAll("Ç", "C")
    .replace(/[^\x20-\x7E]/g, " ");
}

function esc(value: string) {
  return latin(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

export function buildEarningsPdf(report: EarningsPdf): Blob {
  const pages: string[] = [];
  let commands: string[] = [];
  let y = 800;
  const page = () => {
    if (commands.length) pages.push(commands.join("\n"));
    commands = ["BT", "/F2 9 Tf", "48 28 Td", `(TAXI IM  ·  Driver earnings  ·  ${esc(report.period)}) Tj`, "ET"];
    y = 780;
  };
  const text = (size: number, x: number, value: string, bold = false) => {
    commands.push("BT", `/${bold ? "F2" : "F1"} ${size} Tf`, `1 0 0 1 ${x} ${y} Tm`, `(${esc(value)}) Tj`, "ET");
  };
  const rule = () => {
    commands.push("0.18 0.18 0.2 RG", `48 ${y - 4} m`, "500 0 l", "S");
  };
  page();
  text(18, 48, "TAXI IM", true);
  y -= 22;
  text(13, 48, "Driver earnings report", true);
  y -= 18;
  text(10, 48, `Period  ${report.period}`);
  y -= 14;
  text(10, 48, `Generated  ${report.generated}`);
  if (report.driver) {
    y -= 14;
    text(10, 48, `Driver  ${report.driver}`);
  }
  if (report.vehicle) {
    y -= 14;
    text(10, 48, `Vehicle  ${report.vehicle}`);
  }
  y -= 22;
  text(10, 48, `Trips ${report.trips}     Completed ${report.completed}     Cancelled ${report.cancelled}     Revenue ${report.revenue}`, true);
  y -= 18;
  text(8, 48, report.note);
  y -= 22;
  text(9, 48, "Date", true);
  text(9, 220, "Trips", true);
  text(9, 320, "Revenue", true);
  rule();
  y -= 16;
  const body = report.rows.length ? report.rows : [{ date: "No completed trips in this period", trips: "0", revenue: report.revenue }];
  for (const row of body) {
    if (y < 64) {
      page();
      text(9, 48, "Date", true);
      text(9, 220, "Trips", true);
      text(9, 320, "Revenue", true);
      rule();
      y -= 16;
    }
    text(9, 48, row.date);
    text(9, 220, row.trips);
    text(9, 320, row.revenue);
    y -= 16;
  }
  y -= 10;
  text(10, 48, `Total trips  ${report.completed}`, true);
  y -= 14;
  text(10, 48, `Total revenue  ${report.revenue}`, true);
  pages.push(commands.join("\n"));

  const objects: string[] = [];
  const kids = pages.map((_, index) => `${5 + index * 2} 0 R`).join(" ");
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  objects.push(`2 0 obj << /Type /Pages /Count ${pages.length} /Kids [${kids}] >> endobj\n`);
  objects.push("3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n");
  objects.push("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n");
  pages.forEach((content, index) => {
    const pageId = 5 + index * 2;
    const streamId = pageId + 1;
    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >> endobj\n`,
    );
    objects.push(`${streamId} 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj\n`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}
