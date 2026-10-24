#!/usr/bin/env node
/**
 * Genera catalogo.csv para el catálogo Camila a partir de los datos de
 * AppPerfumes (app.clmbilliards.online).
 *
 * Fuentes (backup local de app.clmbilliards.online):
 *   - inventory_data_all.json : catálogo retail (perfumes de marca)
 *   - porcentajes.json        : esencias industriales (IBER/CPL/ANDCO)
 *
 * El CSV sale SIN precios: la columna «precio» queda vacía y la app está
 * configurada en modo catálogo (sin precios).
 *
 * Uso:
 *   node herramientas/generar_catalogo.js [ruta_inventarioapp_server]
 *   (por defecto usa la ruta del backup en Documents)
 */

const fs = require("fs");
const path = require("path");

const RUTA_SERVER =
  process.argv[2] ||
  path.join(
    process.env.HOME,
    "Documents/clmbilliards_backup/inventarioapp 2/server"
  );

const SALIDA = path.join(__dirname, "..", "catalogo.csv");

const inv = JSON.parse(
  fs.readFileSync(path.join(RUTA_SERVER, "inventory_data_all.json"), "utf8")
);
const porcentajes = JSON.parse(
  fs.readFileSync(path.join(RUTA_SERVER, "porcentajes.json"), "utf8")
);
let catalogosLCM = null;
try {
  catalogosLCM = JSON.parse(
    fs.readFileSync(
      path.join(RUTA_SERVER, "..", "dashboard/public/catalogos/catalogos_data.json"),
      "utf8"
    )
  );
} catch { /* sin catálogo LCM: seguimos sin él */ }

/* ---------- helpers ---------- */

const limpiar = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

// Las URLs CDN del catálogo retail (cdn.shopify, perfumesbogota) están muertas
// (verificado 404 en oct 2026): no se exportan.
const normalizarImagen = () => "";

// Género a partir del nombre del retail ("… - 100ml - Hombre")
const generoDesdeNombre = (nombre) => {
  const n = limpiar(nombre).toLowerCase();
  if (/\bhombre[s]?\b/.test(n)) return "Hombre";
  if (/\bmujer(es)?\b/.test(n)) return "Mujer";
  if (/\bunisex\b/.test(n)) return "Unisex";
  if (/\bn(iñ|in)o[s]?\b|\bkids?\b|\bbaby\b/.test(n)) return "Infantil";
  return "";
};

// Categoría "bonita" a partir del tipo del catálogo uniqueessence
const categoriaDesdeTipo = (tipo) => {
  const t = limpiar(tipo);
  if (!t) return "";
  if (/^T[1-4]\s|^Novedades/i.test(t)) return "Novedades";
  if (/Splash/i.test(t)) return "Splash Victoria Secret";
  if (/Masculin/i.test(t)) return "Perfumería Masculina";
  if (/Femenin/i.test(t)) return "Perfumería Femenina";
  if (/unisex/i.test(t)) return "Perfumería Unisex";
  if (/nicho/i.test(t)) return "Perfumería Nicho";
  if (/catálogo|catalogo/i.test(t)) return "Perfumería de Catálogo";
  if (/infantil/i.test(t)) return "Perfumería Infantil";
  return t;
};

const csvCelda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/* ---------- 1) Perfumes retail ---------- */

const retail = inv
  .map((p) => {
    const nombre = limpiar(p.nombre);
    if (!nombre) return null;
    const genero = generoDesdeNombre(nombre);
    const categoria =
      categoriaDesdeTipo(p.tipo) ||
      (genero === "Hombre"
        ? "Perfumería Masculina"
        : genero === "Mujer"
        ? "Perfumería Femenina"
        : genero === "Unisex"
        ? "Perfumería Unisex"
        : genero === "Infantil"
        ? "Perfumería Infantil"
        : "Perfumería");

    const partes = [];
    if (p.contratipo && limpiar(p.contratipo) !== nombre)
      partes.push(`Inspiración ${limpiar(p.contratipo)}`);
    if (p.referencia && limpiar(p.referencia) !== nombre)
      partes.push(`Marca ${limpiar(p.referencia)}`);
    const descripcion = partes.join(" · ");

    return {
      codigo: "",
      nombre,
      descripcion,
      categoria,
      precio: "",
      precioAnterior: "",
      imagen: normalizarImagen(p.imagen),
      stock: "",
    };
  })
  .filter(Boolean);

/* ---------- 2) Catálogo LCM (fotos locales + notas) ---------- */

// Viene de dashboard/public/catalogos: dama / caballero / arabe.
// Sus fotos están copiadas en imagenes/<dir>/ del repo.
const CATEGORIA_LCM = {
  dama: "Perfumería Femenina",
  caballero: "Perfumería Masculina",
  arabe: "Perfumería Árabe",
};

const lcm = [];
const vistosLCM = new Set();
if (catalogosLCM) {
  for (const [dir, bloque] of Object.entries(catalogosLCM)) {
    for (const it of bloque.items || []) {
      const nombre = limpiar(it.name);
      if (!nombre) continue;
      const clave = nombre.toLowerCase();
      if (vistosLCM.has(clave)) continue;
      vistosLCM.add(clave);

      const notas = (it.notes || []).map(limpiar).filter(Boolean);
      const descripcion = notas.length
        ? `Notas: ${notas.join(", ")}`
        : "";

      lcm.push({
        codigo: "",
        nombre,
        descripcion,
        categoria: CATEGORIA_LCM[dir] || "Perfumería",
        precio: "",
        precioAnterior: "",
        imagen: `imagenes/${dir}/${it.img}`,
        stock: "",
      });
    }
  }
}

/* ---------- 3) Esencias industriales ---------- */

const esencias = porcentajes
  .map((e) => {
    const nombre = limpiar(e.nombre);
    if (!nombre) return null;

    const partes = [];
    if (e.nombre_comercial && e.nombre_comercial !== nombre)
      partes.push(limpiar(e.nombre_comercial));
    const provs = [];
    if (e.porcentaje_iber != null) provs.push(`IBER ${e.porcentaje_iber}%`);
    if (e.porcentaje_cpl != null) provs.push(`CPL ${e.porcentaje_cpl}%`);
    if (e.porcentaje_andco != null) provs.push(`ANDCO ${e.porcentaje_andco}%`);
    if (provs.length) partes.push(provs.join(" · "));
    const descripcion = partes.join(" · ");

    return {
      codigo: "",
      nombre,
      descripcion,
      categoria: "Esencias Industriales",
      precio: "",
      precioAnterior: "",
      imagen: "",
      stock: "",
    };
  })
  .filter(Boolean);

/* ---------- 3) Mezclar y deduplicar ---------- */

const vistos = new Set();
const final = [];
for (const p of [...lcm, ...retail, ...esencias]) {
  const clave = `${p.categoria}|${p.nombre.toLowerCase()}`;
  if (vistos.has(clave)) continue;
  vistos.add(clave);
  final.push(p);
}

/* ---------- 4) CSV ---------- */

const ENCABEZADOS = [
  "codigo", "nombre", "descripcion", "categoria",
  "precio", "precio anterior", "imagen", "stock",
];

const lineas = [
  ENCABEZADOS.join(";"),
  ...final.map((p) =>
    [p.codigo, p.nombre, p.descripcion, p.categoria, p.precio, p.precioAnterior, p.imagen, p.stock]
      .map(csvCelda)
      .join(";")
  ),
];

fs.writeFileSync(SALIDA, "\uFEFF" + lineas.join("\r\n") + "\r\n", "utf8");

/* ---------- Resumen ---------- */

const porCategoria = {};
final.forEach((p) => (porCategoria[p.categoria] = (porCategoria[p.categoria] || 0) + 1));
const conImagen = final.filter((p) => p.imagen).length;

console.log(`✔ catalogo.csv generado: ${final.length} productos`);
console.log(`  - con imagen: ${conImagen}`);
console.log(`  - categorías:`);
Object.entries(porCategoria)
  .sort((a, b) => b[1] - a[1])
  .forEach(([c, n]) => console.log(`      ${c}: ${n}`));
