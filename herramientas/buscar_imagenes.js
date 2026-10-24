#!/usr/bin/env node
/**
 * Busca en internet la mejor imagen para cada producto del catálogo.
 *
 * - Motores: DuckDuckGo Images (i.js) con fallback Bing Images (murl).
 * - Selección: fuzzy match Jaccard (%) entre el nombre del producto y el
 *   título de cada resultado; gana el de mayor score. Umbral mínimo para
 *   aceptar (evitar fotos de otro perfume).
 * - Verificación real: se DESCARGAN los bytes y se validan magic bytes
 *   (JPEG/PNG/WebP/GIF). Las imágenes válidas se guardan en imagenes/web/
 *   y el CSV referencia la copia local (el hotlink a CDNs se muere).
 * - Cache incremental y reanudable: herramientas/imagenes_encontradas.json
 *
 * Uso:
 *   node herramientas/buscar_imagenes.js --prueba       (muestra por categoría)
 *   node herramientas/buscar_imagenes.js                (busca todo lo faltante)
 *   node herramientas/buscar_imagenes.js --descargar    (descarga+valida lo hallado)
 *   node herramientas/buscar_imagenes.js --aplicar      (escribe catalogo.csv)
 */

const fs = require("fs");
const path = require("path");

const CSV = path.join(__dirname, "..", "catalogo.csv");
const CACHE = path.join(__dirname, "imagenes_encontradas.json");
const DIR_WEB = path.join(__dirname, "..", "imagenes", "web");

const UMBRAL = 0.4;      // score mínimo para aceptar la imagen
const DELAY = 400;       // ms entre queries por worker
const WORKERS = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

/* ---------- CSV (mismo formato que genera generar_catalogo.js) ---------- */

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

function leerCatalogo() {
  const filas = parsearCSV(fs.readFileSync(CSV, "utf8"));
  const head = filas[0];
  const idx = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  return {
    head,
    filas: filas.slice(1).filter((f) => f.length === head.length),
    idx,
  };
}

/* ---------- Fuzzy ---------- */

const quitarAcentos = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const STOP = new Set([
  "perfume", "perfumes", "parfum", "eau", "de", "toilette", "edt", "edp",
  "edc", "ml", "onz", "oz", "hombre", "mujer", "unisex", "the", "for",
  "pour", "spray", "tester", "box", "caja", "and", "by", "la", "el", "le",
]);

function tokens(x) {
  return quitarAcentos(String(x || "").toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Género del producto ("h"/"m"/null) desde el nombre en español
function generoTexto(nombre) {
  const n = quitarAcentos(String(nombre).toLowerCase());
  if (/\bhombres?\b|\bcaballero\b/.test(n)) return "h";
  if (/\bmujeres?\b|\bdamas?\b/.test(n)) return "m";
  return null;
}

const TOK_FEM = new Set(["woman", "women", "womens", "femme", "female", "mujer", "mujeres", "dama", "damas", "ella"]);
const TOK_MASC = new Set(["man", "men", "mens", "homme", "male", "hombre", "hombres", "caballero"]);

// Combina título + slug de la URL (Bing a veces solo tiene el slug).
// Descalifica cruzes de género (perfume Hombre con foto de la versión Woman).
function scoreCandidato(objTokens, c, nombreProducto) {
  let slug = "";
  try {
    const u = new URL(c.url);
    slug = decodeURIComponent(u.pathname + " " + u.hostname.replace(/\./g, " "));
  } catch { slug = c.url; }
  const texto = tokens(c.titulo + " " + slug);
  const g = generoTexto(nombreProducto);
  if (g === "h" && texto.some((t) => TOK_FEM.has(t))) return 0;
  if (g === "m" && texto.some((t) => TOK_MASC.has(t))) return 0;
  return Math.max(jaccard(objTokens, tokens(c.titulo)), jaccard(objTokens, tokens(slug)));
}

function queryPara(nombre) {
  let n = String(nombre)
    .replace(/\s*[-–]\s*\d+\s*(ml|gr)\b.*$/i, "")
    .replace(/\s*[-–]\s*(hombres?|mujer(es)?|unisex|niñ[oa]s?|caballero|dama)\b.*$/i, "")
    .replace(/\b\d+\s*(ml|onz)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (n.length > 80) n = n.slice(0, 80);
  return `${n} perfume bottle`;
}

/* ---------- HTTP ---------- */

async function traer(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 9000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: opts.accept || "text/html,application/json,image/*;q=0.8,*/*;q=0.8",
        "accept-language": "es-es,es;q=0.9,en;q=0.8",
        ...(opts.headers || {}),
      },
    });
    return r;
  } finally { clearTimeout(t); }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Motor DuckDuckGo ---------- */

let vqdFails = 0;
async function vqd(q) {
  try {
    const r = await traer(
      `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`,
      { accept: "text/html" }
    );
    if (!r.ok) throw new Error("http " + r.status);
    const html = await r.text();
    const m = html.match(/vqd="?([\d-]+)"?/);
    vqdFails = 0;
    return m?.[1] || null;
  } catch {
    vqdFails++;
    return null;
  }
}

async function ddgImagenes(q) {
  if (vqdFails >= 6) return []; // DDG nos está bloqueando: pasa a Bing
  const v = await vqd(q);
  if (!v) return [];
  try {
    const r = await traer(
      `https://duckduckgo.com/i.js?l=es-es&o=json&q=${encodeURIComponent(q)}&vqd=${v}&f=,,,&p=1`,
      { accept: "application/json", referer: "https://duckduckgo.com/" }
    );
    if (!r.ok) { vqdFails++; return []; }
    const j = JSON.parse(await r.text());
    if (j.challenge) { vqdFails++; return []; } // anti-bot: contar como bloqueo
    return (j.results || [])
      .map((x) => ({ url: x.image, titulo: (x.title || "") + " " + (x.source || "") }))
      .filter((x) => /^https?:\/\//.test(x.url));
  } catch {
    vqdFails++;
    return [];
  }
}

/* ---------- Motor Bing (fallback) ---------- */

async function bingImagenes(q) {
  try {
    const r = await traer(
      `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2&first=1&tsc=ImageHoverTitle`,
      { accept: "text/html" }
    );
    if (!r.ok) return [];
    const raw = await r.text();
    // Bing empaqueta cada resultado en class="iusc" con m="{json}" escapado
    const chunks = raw.split(/class="iusc"/).slice(1);
    const urls = new Set();
    const out = [];
    for (const ch of chunks) {
      const dec = ch
        .slice(0, 2000)
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/\\u002f/gi, "/");
      const u = dec.match(/"murl":"(https?:\/\/[^"]+)"/)?.[1];
      if (!u || urls.has(u)) continue;
      urls.add(u);
      const titulo = dec.match(/"t":"([^"]{2,150})"/)?.[1] || "";
      out.push({ url: u, titulo });
      if (out.length >= 25) break;
    }
    return out;
  } catch {
    return [];
  }
}

/* ---------- Descargar y validar magic bytes ---------- */

const MAGIC = [
  { ext: "jpg", b: [0xff, 0xd8, 0xff] },
  { ext: "png", b: [0x89, 0x50, 0x4e, 0x47] },
  { ext: "webp", b: null }, // RIFF....WEBP (se valida aparte)
  { ext: "gif", b: [0x47, 0x49, 0x46, 0x38] },
];

function detectarImagen(buf) {
  if (buf.length < 12) return null;
  for (const m of MAGIC) {
    if (!m.b) {
      if (
        buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
      ) return "webp";
      continue;
    }
    if (m.b.every((v, i) => buf[i] === v)) return m.ext;
  }
  return null;
}

const TAM_MIN = 4 * 1024;   // < 4KB suele ser placeholder
const TAM_MAX = 3 * 1024 * 1024;

async function descargarImagen(url) {
  try {
    const r = await traer(url, { timeout: 12000, accept: "image/*,*/*;q=0.8" });
    if (!r.ok && r.status !== 404) return null; // 404 con body válido (walmart) se acepta
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < TAM_MIN || buf.length > TAM_MAX) return null;
    const tipo = detectarImagen(buf);
    if (!tipo) return null;
    return { buf, tipo };
  } catch { return null; }
}

function slugArchivo(nombre) {
  const s = quitarAcentos(String(nombre).toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  const h = require("crypto").createHash("sha1").update(nombre).digest("hex").slice(0, 8);
  return `${s}-${h}`;
}

/* ---------- Buscar la mejor imagen de un producto ---------- */

async function mejorImagen(nombre) {
  const q = queryPara(nombre);
  const obj = tokens(nombre);
  if (!obj.length) return null;

  let candidatos = await ddgImagenes(q);
  let motor = "ddg";
  if (!candidatos.length) {
    await dormir(200);
    candidatos = await bingImagenes(q);
    motor = "bing";
  }
  if (!candidatos.length) return { url: null, score: 0, motor };

  const puntados = candidatos
    .map((c) => ({ ...c, score: scoreCandidato(obj, c, nombre) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  for (const c of puntados) {
    if (c.score < UMBRAL) break;
    const d = await descargarImagen(c.url);
    if (d) return { url: c.url, score: c.score, motor, tipo: d.tipo, bytes: d.buf.length };
  }
  return { url: null, score: puntados[0]?.score || 0, motor };
}

/* ---------- Cache ---------- */

let cache = {};
function cargarCache() {
  try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { cache = {}; }
}
let dirty = 0;
function guardarCache(nombre, r) {
  cache[nombre] = r;
  if (++dirty >= 15) { dirty = 0; fs.writeFileSync(CACHE, JSON.stringify(cache)); }
}
function flushCache() { fs.writeFileSync(CACHE, JSON.stringify(cache)); }

/* ---------- Main ---------- */

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const descargar = args.includes("--descargar");
  const prueba = args.includes("--prueba");

  const { head, filas, idx } = leerCatalogo();
  cargarCache();

  /* ---- Fase: descargar bytes de lo hallado y guardarlas en imagenes/web/ ---- */
  if (descargar) {
    fs.mkdirSync(DIR_WEB, { recursive: true });
    const pend = filas.filter((f) => {
      const c = cache[f[idx.nombre]];
      return c && c.url && !c.local && !f[idx.imagen];
    });
    console.log(`Descargar: ${pend.length} imágenes`);
    let n = 0;
    for (const f of pend) {
      const nombre = f[idx.nombre];
      const c = cache[nombre];
      const d = await descargarImagen(c.url);
      const base = slugArchivo(nombre);
      const archivo = d ? `${base}.${d.tipo}` : `${base}.na`;
      if (d) {
        fs.writeFileSync(path.join(DIR_WEB, archivo), d.buf);
        c.local = `imagenes/web/${archivo}`;
        n++;
      } else {
        c.local = null; // URL murió tras la búsqueda: descartada
      }
      dirty++;
    }
    flushCache();
    console.log(`✔ ${n} imágenes descargadas en ${DIR_WEB}`);
    return;
  }

  /* ---- Fase: aplicar al CSV ---- */
  if (aplicar) {
    let n = 0;
    const out = filas.map((f) => {
      const c = cache[f[idx.nombre]];
      if (c && c.local && !f[idx.imagen]) { f[idx.imagen] = c.local; n++; }
      return f;
    });
    const lineas = [head.join(";"), ...out.map((f) => f.map(csvCelda).join(";"))];
    fs.writeFileSync(CSV, "\uFEFF" + lineas.join("\r\n") + "\r\n", "utf8");
    console.log(`✔ catalogo.csv actualizado: ${n} imágenes aplicadas`);
    return;
  }

  /* ---- Fase: buscar ---- */
  let pendientes = filas.filter((f) => !f[idx.imagen] && !cache[f[idx.nombre]]);

  if (prueba) {
    // 1 producto por categoría (los primeros), para validar calidad
    const vistos = new Set(); const muestra = [];
    for (const f of pendientes) {
      const c = f[idx.categoria];
      if (!vistos.has(c)) { vistos.add(c); muestra.push(f); }
    }
    pendientes = muestra.slice(0, 8);
  }

  console.log(`Productos a buscar: ${pendientes.length}`);

  let i = 0, ok = 0;
  const total = pendientes.length;
  const t0 = Date.now();

  async function worker(id) {
    while (true) {
      const k = i++;
      if (k >= total) return;
      const f = pendientes[k];
      const nombre = f[idx.nombre];
      try {
        const r = await mejorImagen(nombre);
        guardarCache(nombre, r);
        if (r.url) {
          ok++;
          if (total <= 12 || ok % 25 === 0)
            console.log(`[${ok}/${k + 1}/${total}] ${(r.score * 100).toFixed(0)}% ${r.motor} ${nombre} -> ${r.url.slice(0, 90)}`);
        }
      } catch (e) {
        guardarCache(nombre, { url: null, score: 0, error: String(e.message || e) });
      }
      if ((k + 1) % 50 === 0) {
        const vel = ((k + 1) / ((Date.now() - t0) / 60000)).toFixed(1);
        console.log(`… ${k + 1}/${total} (${vel}/min, ${ok} con imagen)`);
      }
      await dormir(DELAY + Math.random() * 150);
    }
  }

  await Promise.all(Array.from({ length: Math.min(WORKERS, Math.max(1, total)) }, (_, w) => worker(w)));
  flushCache();

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n✔ Listo en ${mins} min: ${ok}/${total} con imagen (${((ok / total) * 100).toFixed(1)}%)`);
  console.log(`Cache: ${Object.keys(cache).length} entradas en ${path.basename(CACHE)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
