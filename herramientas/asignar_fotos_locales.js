#!/usr/bin/env node
/**
 * Asigna las fotos locales (imagenes/web2, nomenclatura slug+sha1) al CSV.
 *
 * Regla de orden (carrusel invertido en app.js — .reverse()):
 *   - La foto NUEVA (web2) va en `imagen` para mostrarse PRIMERA;
 *     la que había antes pasa a `imagen2` (se alcanza deslizando).
 *   - Producto sin foto: la nueva entra en `imagen`.
 *
 * Uso:
 *   node herramientas/asignar_fotos_locales.js            (aplicar)
 *   node herramientas/asignar_fotos_locales.js --dry       (solo conteo)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CSV = path.join(__dirname, "..", "catalogo.csv");
const DIR = path.join(__dirname, "..", "imagenes", "web2");

/* ---------- CSV ---------- */
function parsearCSV(texto) {
  const filas = [];
  let fila = [], celda = "", enComillas = false;
  const s = texto.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (enComillas) {
      if (c === '"') {
        if (s[i + 1] === '"') { celda += '"'; i++; }
        else enComillas = false;
      } else celda += c;
    } else if (c === '"') enComillas = true;
    else if (c === ";") { fila.push(celda); celda = ""; }
    else if (c === "\n") { fila.push(celda.replace(/\r$/, "")); filas.push(fila); fila = []; celda = ""; }
    else celda += c;
  }
  if (celda || fila.length) { fila.push(celda.replace(/\r$/, "")); filas.push(fila); }
  return filas;
}
const csvCelda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/* ---------- slug igual a buscar_imagenes.js ---------- */
const quitarAcentos = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function slugArchivo(nombre) {
  const s = quitarAcentos(String(nombre).toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  const h = crypto.createHash("sha1").update(nombre).digest("hex").slice(0, 8);
  return `${s}-${h}`;
}

/* ---------- main ---------- */
const dry = process.argv.includes("--dry");

// índice: base sin extensión -> ruta relativa
const porBase = new Map();
for (const f of fs.readdirSync(DIR)) {
  const m = f.match(/^(.+)\.(jpe?g|png|webp|gif)$/i);
  if (m) porBase.set(m[1], `imagenes/web2/${f}`);
}

const filas = parsearCSV(fs.readFileSync(CSV, "utf8"));
const head = filas[0];
const idx = Object.fromEntries(head.map((h, i) => [h.trim(), i]));

let sinFoto = 0, conUna = 0, asignadasNuevas = 0, promovidas = 0, sinMatch = 0;

const out = filas.slice(1).filter((f) => f.length === head.length).map((f) => {
  const nombre = f[idx.nombre];
  const img = String(f[idx.imagen] || "").trim();
  const img2 = String(f[idx.imagen2] || "").trim();
  const nueva = porBase.get(slugArchivo(nombre));

  if (!img && !img2) {
    sinFoto++;
    if (nueva) { f[idx.imagen] = nueva; asignadasNuevas++; }
    else sinMatch++;
  } else if (img && !img2) {
    conUna++;
    if (nueva && nueva !== img) {
      f[idx.imagen2] = img;      // la vieja pasa a segunda
      f[idx.imagen] = nueva;     // la nueva se muestra primera (carrusel invertido)
      promovidas++;
    }
  }
  return f;
});

console.log(`Productos sin foto: ${sinFoto} → ${asignadasNuevas} asignadas, ${sinMatch} sin archivo local`);
console.log(`Productos con 1 foto: ${conUna} → ${promovidas} ahora con carrusel (nueva primera)`);

if (!dry) {
  const lineas = [head.join(";"), ...out.map((f) => f.map(csvCelda).join(";"))];
  fs.writeFileSync(CSV, "\uFEFF" + lineas.join("\r\n") + "\r\n", "utf8");
  console.log("✔ catalogo.csv actualizado");
} else {
  console.log("(dry run: CSV no modificado)");
}
