import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist", "server");

const textFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/lucky.html": ["lucky.html", "text/html; charset=utf-8"],
  "/config": ["config/index.html", "text/html; charset=utf-8"],
  "/config/": ["config/index.html", "text/html; charset=utf-8"],
  "/config/index.html": ["config/index.html", "text/html; charset=utf-8"],
  "/admin": ["admin/index.html", "text/html; charset=utf-8"],
  "/admin/": ["admin/index.html", "text/html; charset=utf-8"],
  "/admin/index.html": ["admin/index.html", "text/html; charset=utf-8"],
  "/assets/app.css": ["assets/app.css", "text/css; charset=utf-8"],
  "/assets/app.js": ["assets/app.js", "text/javascript; charset=utf-8"],
  "/assets/admin.js": ["assets/admin.js", "text/javascript; charset=utf-8"],
};

const binaryFiles = {
  "/logo.png": ["logo.png", "image/png"],
  "/color.png": ["color.png", "image/png"],
};

const textRoutes = [];
for (const [urlPath, [filePath, contentType]] of Object.entries(textFiles)) {
  const content = await readFile(resolve(root, filePath), "utf8");
  textRoutes.push([urlPath, { body: content, contentType }]);
}

const binaryRoutes = [];
for (const [urlPath, [filePath, contentType]] of Object.entries(binaryFiles)) {
  const content = await readFile(resolve(root, filePath));
  binaryRoutes.push([urlPath, { body: content.toString("base64"), contentType }]);
}

const runtimeTemplate = await readFile(resolve(root, "worker", "runtime.js"), "utf8");
const worker = runtimeTemplate
  .replace("__TEXT_ROUTES__", JSON.stringify(textRoutes))
  .replace("__BINARY_ROUTES__", JSON.stringify(binaryRoutes));

await rm(resolve(root, "dist"), { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "index.js"), worker, "utf8");
console.log("Built dist/server/index.js");
