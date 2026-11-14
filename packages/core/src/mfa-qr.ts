import qrcode from "qrcode-generator";

/** Light modules left around the code, which a scanner needs to find it. */
const QUIET_ZONE = 4;

/**
 * `text` as a QR code: an SVG in a `data:` URL, for an `<img>`. Made here, on
 * the server, and never by a third party: what it carries is a secret. Always
 * dark on white, whatever the page's theme (scanners expect it).
 */
export function qrDataUrl(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const modules = qr.getModuleCount();
  const side = modules + 2 * QUIET_ZONE;
  let path = "";
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">` +
    `<rect width="${side}" height="${side}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
