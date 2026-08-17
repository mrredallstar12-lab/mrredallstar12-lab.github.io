import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".wav", "audio/wav"],
  [".mp3", "audio/mpeg"]
]);

function safePath(staticRoot, pathname) {
  const decoded = decodeURIComponent(pathname);
  const cleanPath = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(staticRoot, cleanPath === "/" ? "index.html" : cleanPath));
  const root = resolve(staticRoot);
  return filePath.startsWith(root) ? filePath : "";
}

export function serveStatic(request, response, staticRoot) {
  const url = new URL(request.url, "http://localhost");
  let filePath = safePath(staticRoot, url.pathname);
  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return true;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return true;
  }

  const type = MIME_TYPES.get(extname(filePath).toLowerCase()) || "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(response);
  return true;
}

