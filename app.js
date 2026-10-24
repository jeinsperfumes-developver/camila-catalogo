/* ============================================================
   Camila · Catálogo y Precios — lógica de la app
   Sin backend: todo corre en el navegador del visitante.
   ============================================================ */

(() => {
  "use strict";

  /* ---------------- Estado ---------------- */

  const CLAVE_DATOS = "camila_catalogo_v1";
  const CLAVE_PREFS = "camila_prefs_v1";
  const CSV_REPO = "catalogo.csv";

  /** @type {Producto[]} */
  let productos = [];
  let categoriaActiva = "todas";
  let prefs = { moneda: "$ USD", mostrarPrecios: true };

  /**
   * @typedef {Object} Producto
   * @property {string} codigo
   * @property {string} nombre
   * @property {string} descripcion
   * @property {string} categoria
   * @property {number} precio
   * @property {number|null} precioAnterior
   * @property {string} imagen
   * @property {string} stock
   */

  /* ---------------- Utilidades DOM ---------------- */

  const $ = (id) => document.getElementById(id);

  const elementos = {
    btnMenu: $("btnMenu"),
    drawer: $("drawer"),
    drawerBackdrop: $("drawerBackdrop"),
    btnCerrarDrawer: $("btnCerrarDrawer"),
    inputBusqueda: $("inputBusqueda"),
    btnLimpiarBusqueda: $("btnLimpiarBusqueda"),
    btnImportarTop: $("btnImportarTop"),
    btnImportarMenu: $("btnImportarMenu"),
    btnImportarVacio: $("btnImportarVacio"),
    btnExportar: $("btnExportar"),
    btnPlantilla: $("btnPlantilla"),
    btnPlantillaVacio: $("btnPlantillaVacio"),
    btnVaciar: $("btnVaciar"),
    btnDemo: $("btnDemo"),
    chkPrecios: $("chkPrecios"),
    selMoneda: $("selMoneda"),
    chipsCategorias: $("chipsCategorias"),
    selOrden: $("selOrden"),
    inputPrecioMax: $("inputPrecioMax"),
    outPrecioMax: $("outPrecioMax"),
    infoResultados: $("infoResultados"),
    grid: $("gridProductos"),
    estadoVacio: $("estadoVacio"),
    sinResultados: $("sinResultados"),
    modalBackdrop: $("modalBackdrop"),
    btnCerrarModal: $("btnCerrarModal"),
    inputArchivo: $("inputArchivo"),
    cargando: $("cargando"),
    toast: $("toast"),
    statTotal: $("statTotal"),
    statCategorias: $("statCategorias"),
    heroSub: $("heroSub"),
    modalMedia: $("modalMedia"),
    modalCategoria: $("modalCategoria"),
    modalTitulo: $("modalTitulo"),
    modalPrecio: $("modalPrecio"),
    modalDescripcion: $("modalDescripcion"),
    modalMeta: $("modalMeta"),
  };

  let temporizadorToast = null;

  function toast(mensaje, esError = false) {
    elementos.toast.textContent = mensaje;
    elementos.toast.classList.toggle("error", esError);
    elementos.toast.hidden = false;
    requestAnimationFrame(() => elementos.toast.classList.add("visible"));
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(() => {
      elementos.toast.classList.remove("visible");
      setTimeout(() => (elementos.toast.hidden = true), 300);
    }, 3400);
  }

  const escapar = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  /* ---------------- Normalización de columnas ---------------- */

  // Mapeos flexibles: el Excel puede venir en español o inglés,
  // con acentos, mayúsculas o espacios.
  const CAMPOS = {
    codigo: ["codigo", "código", "sku", "code", "id", "referencia", "ref", "cod"],
    nombre: ["nombre", "producto", "name", "titulo", "título", "descripcion corta", "articulo", "artículo", "item"],
    descripcion: ["descripcion", "descripción", "description", "detalle", "detalles", "notas", "observaciones"],
    categoria: ["categoria", "categoría", "category", "rubro", "tipo", "linea", "línea", "grupo", "coleccion", "colección"],
    precio: ["precio", "price", "valor", "preciounitario", "precio unitario", "costo", "pvp", "venta", "importe"],
    precioAnterior: ["precioanterior", "precio anterior", "precio viejo", "oldprice", "old price", "preciotachado", "precio tachado", "oferta", "preciooferta", "precio oferta"],
    imagen: ["imagen", "image", "foto", "url imagen", "urlimagen", "img", "imageurl", "image url", "link imagen", "linkimagen", "imagenurl", "foto url"],
    stock: ["stock", "disponible", "cantidad", "inventory", "inventario", "existencia", "existencias"],
  };

  const normalizarClave = (s) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_\-\.]+/g, " ")
      .replace(/\s+/g, " ");

  function detectarCampo(encabezado) {
    const clave = normalizarClave(encabezado);
    if (!clave) return null;
    for (const [campo, aliases] of Object.entries(CAMPOS)) {
      if (aliases.some((a) => a === clave)) return campo;
    }
    for (const [campo, aliases] of Object.entries(CAMPOS)) {
      if (aliases.some((a) => clave.startsWith(a) || a.startsWith(clave))) return campo;
    }
    return null;
  }

  /* ---------------- Parseo de precios ---------------- */

  function parsearPrecio(valor) {
    if (valor === null || valor === undefined || valor === "") return NaN;
    if (typeof valor === "number") return valor;
    let s = String(valor).trim();
    if (!s) return NaN;
    // Formatos: "1.234,56" (es) | "1,234.56" (en) | "1234.56" | "$ 1234"
    const tieneComa = s.includes(","),
      tienePunto = s.includes(".");
    s = s.replace(/[^\d.,\-]/g, "");
    if (tieneComa && tienePunto) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (tieneComa) {
      // Coma decimal si tiene 1-2 decimales al final, sino separador de miles
      const partes = s.split(",");
      if (partes.length === 2 && partes[1].length <= 2) s = partes.join(".");
      else s = s.replace(/,/g, "");
    } else if (tienePunto) {
      // Punto de miles si cada grupo tras el punto tiene exactamente 3 dígitos
      // (formato es: 15.500, 1.299.000); con 1-2 dígitos es decimal (15.5)
      const partes = s.split(".");
      const esMiles = partes.length > 1 && partes.slice(1).every((p) => /^\d{3}$/.test(p)) && /^\d+$/.test(partes[0]);
      if (esMiles) s = partes.join("");
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  /* ---------------- Lectura de archivos ---------------- */

  function leerLibro(archivo) {
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
      lector.onload = (e) => {
        try {
          if (/\.csv$/i.test(archivo.name)) {
            resolve({ csv: e.target.result });
          } else {
            resolve({ binario: e.target.result });
          }
        } catch (err) {
          reject(err);
        }
      };
      lector.readAsArrayBuffer(archivo);
    });
  }

  function csvABjetos(textoOVacio) {
    const texto = typeof textoOVacio === "string"
      ? textoOVacio
      : new TextDecoder().decode(textoOVacio);

    // Quitar BOM de Excel
    const limpio = texto.replace(/^\uFEFF/, "");
    const filas = parsearCSV(limpio);
    if (!filas.length) return [];

    const encabezados = filas[0];
    const mapa = encabezados.map(detectarCampo);
    const idxNombre = mapa.indexOf("nombre");
    const idxPrecio = mapa.indexOf("precio");

    return filas
      .slice(1)
      .filter((f) => f.some((c) => String(c ?? "").trim() !== ""))
      .map((f) => {
        const obj = {};
        mapa.forEach((campo, i) => {
          if (campo && !(campo in obj)) obj[campo] = String(f[i] ?? "").trim();
        });
        return {
          codigo: obj.codigo || "",
          nombre: obj.nombre || (idxNombre >= 0 ? String(f[idxNombre] ?? "").trim() : ""),
          descripcion: obj.descripcion || "",
          categoria: obj.categoria || "Sin categoría",
          precio: parsearPrecio(obj.precio),
          precioAnterior: obj.precioAnterior ? parsearPrecio(obj.precioAnterior) : NaN,
          imagen: obj.imagen || "",
          stock: obj.stock || "",
        };
      })
      .filter((p) => p.nombre !== "");
  }

  // Parser CSV robusto: soporta comillas, comas dentro de comillas,
  // saltos de línea dentro de comillas, ; y tabulaciones.
  function parsearCSV(texto) {
    const separador = detectarSeparador(texto);
    const filas = [];
    let fila = [], celda = "", enComillas = false;

    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (enComillas) {
        if (ch === '"') {
          if (texto[i + 1] === '"') { celda += '"'; i++; }
          else enComillas = false;
        } else celda += ch;
      } else if (ch === '"') {
        enComillas = true;
      } else if (ch === separador) {
        fila.push(celda); celda = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && texto[i + 1] === "\n") i++;
        fila.push(celda); celda = "";
        if (fila.length > 1 || fila[0] !== "") filas.push(fila);
        fila = [];
      } else {
        celda += ch;
      }
    }
    fila.push(celda);
    if (fila.length > 1 || fila[0] !== "") filas.push(fila);
    return filas;
  }

  function detectarSeparador(texto) {
    const muestra = texto.slice(0, 4000);
    const conteo = { ",": 0, ";": 0, "\t": 0 };
    let enComillas = false;
    for (const ch of muestra) {
      if (ch === '"') enComillas = !enComillas;
      else if (!enComillas && ch in conteo) conteo[ch]++;
    }
    return Object.entries(conteo).sort((a, b) => b[1] - a[1])[0][0];
  }

  async function importarArchivo(archivo) {
    elementos.cargando.hidden = false;
    try {
      const { csv, binario } = await leerLibro(archivo);
      let nuevos;

      if (csv !== undefined) {
        nuevos = csvABjetos(csv);
      } else if (window.XLSX) {
        const libro = XLSX.read(binario, { type: "array" });
        const hoja = libro.Sheets[libro.SheetNames[0]];
        nuevos = csvABjetos(XLSX.utils.sheet_to_csv(hoja));
      } else {
        throw new Error("La librería de Excel no cargó. Revisa tu conexión.");
      }

      if (!nuevos.length) {
        throw new Error("No encontré filas válidas. Asegúrate de que haya una columna «nombre» o «producto».");
      }

      const conPrecio = nuevos.filter((p) => Number.isFinite(p.precio));
      if (!conPrecio.length) {
        throw new Error("No encontré la columna de precios. Debe llamarse «precio», «price», «valor»…");
      }

      productos = nuevos;
      guardarDatos();
      categoriaActiva = "todas";
      elementos.inputBusqueda.value = "";
      elementos.btnLimpiarBusqueda.hidden = true;
      renderizarTodo();
      toast(`Importados ${conPrecio.length} productos${conPrecio.length < nuevos.length ? ` (${nuevos.length - conPrecio.length} sin precio válido)` : ""}.`);
    } catch (err) {
      toast(err.message || "Error al importar el archivo.", true);
    } finally {
      elementos.cargando.hidden = true;
      elementos.inputArchivo.value = "";
    }
  }

  /* ---------------- Persistencia ---------------- */

  function guardarDatos() {
    try {
      localStorage.setItem(CLAVE_DATOS, JSON.stringify(productos));
    } catch {
      /* cuota llena: seguimos en memoria */
    }
  }

  function cargarPrefs() {
    try {
      const crudo = localStorage.getItem(CLAVE_PREFS);
      if (crudo) prefs = { ...prefs, ...JSON.parse(crudo) };
    } catch { /* ignorar */ }
    elementos.selMoneda.value = prefs.moneda;
    elementos.chkPrecios.checked = prefs.mostrarPrecios;
  }

  function guardarPrefs() {
    try {
      localStorage.setItem(CLAVE_PREFS, JSON.stringify(prefs));
    } catch { /* ignorar */ }
  }

  /* ---------------- Datos demo / plantilla ---------------- */

  const DEMO = [
    ["COD-001", "Vestido Flor Midi", "Vestido midi estampado con flores, tela fluida y forro interior.", "Vestidos", 45900, 52000, "", "Sí"],
    ["COD-002", "Blusa Seda Natural", "Blusa de seda con cuello vuelo y manga globo.", "Blusas", 28500, "", "", "Sí"],
    ["COD-003", "Pantalón Wide Leg Lino", "Pantalón de lino corte amplio, cintura elástica invisible.", "Pantalones", 39800, "", "", "No"],
    ["COD-004", "Falda Plisada Midi", "Falda plisada efecto satinado con cierre invisible.", "Faldas", 31500, 36000, "", "Sí"],
    ["COD-005", "Trench Clásico Beige", "Trench coat clásico con botones forjados y cinturón.", "Abrigos", 89900, "", "", "Sí"],
    ["COD-006", "Sweater Punto Grande", "Suéter de punto grueso cuello alto, 40% lana.", "Abrigos", 42500, "", "", "Sí"],
    ["COD-007", "Vestido Negro Cocktail", "Vestido corto de cocktail en crep negro.", "Vestidos", 54900, 62000, "", "No"],
    ["COD-008", "Camisa Oversize Blanca", "Camisa algodón popelina corte oversize.", "Blusas", 26900, "", "", "Sí"],
    ["COD-009", "Bolso Tote Cuero Eco", "Tote amplio en cuero ecológico con bolsillo interno.", "Accesorios", 51200, 58000, "", "Sí"],
    ["COD-010", "Bufanda Pashmina", "Bufanda pashmina estampada, 180×70 cm.", "Accesorios", 18900, "", "", "Sí"],
    ["COD-011", "Cinturón Hebilla Dorada", "Cinturón ancho con hebilla dorada mate.", "Accesorios", 15800, "", "", "No"],
    ["COD-012", "Falda Denim Button Up", "Falta jean media con botones frontales.", "Faldas", 34200, "", "", "Sí"],
  ];

  function cargarDemo() {
    productos = DEMO.map(([codigo, nombre, descripcion, categoria, precio, precioAnterior, imagen, stock]) => ({
      codigo, nombre, descripcion, categoria,
      precio, precioAnterior: precioAnterior || NaN,
      imagen: imagen || "", stock,
    }));
    guardarDatos();
    categoriaActiva = "todas";
    renderizarTodo();
    toast("Catálogo de demostración cargado (12 productos).");
  }

  function plantillaCSV() {
    const filas = [
      ["codigo", "nombre", "descripcion", "categoria", "precio", "precio anterior", "imagen", "stock"],
      ["EJ-001", "Producto de ejemplo", "Descripción del producto", "Categoría", "9999", "", "https://… (opcional)", "Sí"],
      ["EJ-002", "Otro producto", "Con precio anterior se muestra tachado", "Categoría", "7999", "9999", "", "No"],
    ];
    return filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  }

  function descargar(nombre, contenido, tipo = "text/csv;charset=utf-8") {
    const blob = new Blob(["\uFEFF" + contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function exportarCSV() {
    if (!productos.length) return toast("No hay productos para exportar.", true);
    const filas = [["codigo", "nombre", "descripcion", "categoria", "precio", "precio anterior", "imagen", "stock"]];
    for (const p of productos) {
      filas.push([
        p.codigo, p.nombre, p.descripcion, p.categoria,
        Number.isFinite(p.precio) ? String(p.precio).replace(".", ",") : "",
        Number.isFinite(p.precioAnterior) ? String(p.precioAnterior).replace(".", ",") : "",
        p.imagen, p.stock,
      ]);
    }
    descargar("catalogo.csv", filas.map((f) => f.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n"));
    toast("catalogo.csv descargado. Súbelo a la raíz del repo para publicarlo.");
  }

  /* ---------------- Filtrado y render ---------------- */

  function normalizarTexto(s) {
    return String(s ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function productosFiltrados() {
    const q = normalizarTexto(elementos.inputBusqueda.value.trim());
    const orden = elementos.selOrden.value;
    const conPrecio = productos.filter((p) => Number.isFinite(p.precio));
    const precioMaxReal = Math.max(...conPrecio.map((p) => p.precio), 0);
    const umbral = (elementos.inputPrecioMax.value / 100) * precioMaxReal;
    const filtroActivo = elementos.inputPrecioMax.value < 100;

    let lista = productos.filter((p) => {
      if (categoriaActiva !== "todas" && p.categoria !== categoriaActiva) return false;
      if (filtroActivo && Number.isFinite(p.precio) && p.precio > umbral) return false;
      if (q) {
        const blob = normalizarTexto(`${p.nombre} ${p.descripcion} ${p.categoria} ${p.codigo}`);
        if (!blob.includes(q)) return false;
      }
      return true;
    });

    const comparadores = {
      "precio-asc": (a, b) => a.precio - b.precio,
      "precio-desc": (a, b) => b.precio - a.precio,
      "nombre-asc": (a, b) => a.nombre.localeCompare(b.nombre, "es"),
      "nombre-desc": (a, b) => b.nombre.localeCompare(a.nombre, "es"),
    };
    if (orden !== "relevante") lista.sort(comparadores[orden] || (() => 0));
    return lista;
  }

  function formatearPrecio(n) {
    if (!prefs.mostrarPrecios) return "—";
    if (!Number.isFinite(n)) return "Consultar";
    const esEntero = Number.isInteger(n);
    const numero = new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: esEntero ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n);
    return `${prefs.moneda} ${numero}`;
  }

  function inicialChulis(nombre) {
    for (const palabra of String(nombre).split(/\s+/)) {
      if (palabra.length) return palabra[0].toUpperCase();
    }
    return "•";
  }

  function renderizarCategorias() {
    const conteo = new Map();
    for (const p of productos) conteo.set(p.categoria, (conteo.get(p.categoria) || 0) + 1);

    const categorias = [...conteo.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"));
    elementos.chipsCategorias.replaceChildren();

    const chipTodas = crearChip("todas", "Todas", productos.length);
    elementos.chipsCategorias.appendChild(chipTodas);
    for (const [cat, n] of categorias) {
      elementos.chipsCategorias.appendChild(crearChip(cat, cat, n));
    }
    elementos.statCategorias.textContent = categorias.length;
  }

  function crearChip(valor, etiqueta, n) {
    const b = document.createElement("button");
    b.className = "chip" + (categoriaActiva === valor ? " activo" : "");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", categoriaActiva === valor ? "true" : "false");
    b.innerHTML = `${escapar(etiqueta)}<span class="n">${n}</span>`;
    b.addEventListener("click", () => {
      categoriaActiva = valor;
      renderizarCategorias();
      renderizarGrid();
    });
    return b;
  }

  function tarjetaProducto(p, i) {
    const art = document.createElement("article");
    art.className = "tarjeta";
    art.style.animationDelay = `${Math.min(i, 12) * 30}ms`;
    art.tabIndex = 0;
    art.setAttribute("aria-label", p.nombre);

    const tieneFoto = /^https?:\/\/.+/.test(p.imagen);
    const agotado = /^(no|0|sin|false|agotado)/i.test(p.stock.trim());

    const media = tieneFoto
      ? `<img src="${escapar(p.imagen)}" alt="${escapar(p.nombre)}" loading="lazy" onerror="this.remove()" />`
      : `<span class="sin-foto">${escapar(inicialChulis(p.nombre))}</span>`;

    const badge = p.categoria && p.categoria !== "Sin categoría"
      ? `<span class="tarjeta-badge">${escapar(p.categoria)}</span>` : "";

    const anterior = Number.isFinite(p.precioAnterior) && p.precioAnterior > p.precio
      ? `<small>${escapar(formatearPrecio(p.precioAnterior))}</small>` : "";

    const stock = p.stock.trim()
      ? `<span class="tarjeta-stock${agotado ? " agotado" : ""}">${agotado ? "Agotado" : "Disponible"}</span>` : "";

    art.innerHTML = `
      <div class="tarjeta-media" data-ver>${media}${badge}</div>
      <div class="tarjeta-cuerpo">
        <h3 class="tarjeta-nombre">${escapar(p.nombre)}</h3>
        ${p.codigo ? `<span class="tarjeta-codigo">${escapar(p.codigo)}</span>` : ""}
        ${p.descripcion ? `<p class="tarjeta-descripcion">${escapar(p.descripcion)}</p>` : ""}
        <div class="tarjeta-pie">
          <span class="tarjeta-precio">${escapar(formatearPrecio(p.precio))}${anterior}</span>
          ${stock}
        </div>
      </div>`;

    art.addEventListener("click", () => abrirModal(p));
    art.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirModal(p); }
    });
    return art;
  }

  function renderizarGrid() {
    const lista = productosFiltrados();
    elementos.grid.replaceChildren();
    lista.forEach((p, i) => elementos.grid.appendChild(tarjetaProducto(p, i)));

    const hayDatos = productos.length > 0;
    elementos.estadoVacio.hidden = hayDatos;
    elementos.grid.hidden = !hayDatos;
    elementos.sinResultados.hidden = !(hayDatos && lista.length === 0);
    elementos.infoResultados.textContent = hayDatos
      ? `Mostrando ${lista.length} de ${productos.length} productos`
      : "";

    const conPrecio = productos.filter((p) => Number.isFinite(p.precio));
    const precioMax = conPrecio.length ? Math.max(...conPrecio.map((p) => p.precio)) : 0;
    elementos.inputPrecioMax.disabled = !conPrecio.length;
    actualizarEtiquetaPrecio(precioMax);
  }

  function actualizarEtiquetaPrecio(precioMaxReal) {
    const v = Number(elementos.inputPrecioMax.value);
    if (v >= 100) {
      elementos.outPrecioMax.textContent = "Todos";
    } else if (!precioMaxReal) {
      elementos.outPrecioMax.textContent = "Todos";
    } else {
      const hasta = Math.round((v / 100) * precioMaxReal);
      elementos.outPrecioMax.textContent = `hasta ${prefs.moneda} ${new Intl.NumberFormat("es-AR").format(hasta)}`;
    }
  }

  function renderizarTodo() {
    renderizarCategorias();
    renderizarGrid();
    elementos.statTotal.textContent = productos.length;
    elementos.heroSub.textContent = productos.length
      ? `${productos.length} productos · precios actualizados al ${new Date().toLocaleDateString("es", { day: "numeric", month: "long" })}`
      : "Importa tu Excel o CSV y tendrás tu catálogo con precios listo para compartir.";
  }

  /* ---------------- Modal detalle ---------------- */

  function abrirModal(p) {
    const tieneFoto = /^https?:\/\/.+/.test(p.imagen);
    elementos.modalMedia.innerHTML = tieneFoto
      ? `<img src="${escapar(p.imagen)}" alt="${escapar(p.nombre)}" />`
      : `<span class="sin-foto">${escapar(inicialChulis(p.nombre))}</span>`;

    elementos.modalCategoria.textContent = p.categoria || "";
    elementos.modalTitulo.textContent = p.nombre;
    elementos.modalPrecio.textContent = formatearPrecio(p.precio);
    elementos.modalDescripcion.textContent = p.descripcion || "";

    const metas = [];
    if (p.codigo) metas.push(`Código: ${p.codigo}`);
    if (p.stock.trim()) metas.push(`Stock: ${p.stock}`);
    if (Number.isFinite(p.precioAnterior) && p.precioAnterior > p.precio)
      metas.push(`Antes: ${formatearPrecio(p.precioAnterior)}`);
    elementos.modalMeta.innerHTML = metas.map(escapar).join("<br/>");

    elementos.modalBackdrop.hidden = false;
    requestAnimationFrame(() => elementos.modalBackdrop.classList.add("visible"));
    document.body.style.overflow = "hidden";
    elementos.btnCerrarModal.focus();
  }

  function cerrarModal() {
    elementos.modalBackdrop.classList.remove("visible");
    document.body.style.overflow = "";
    setTimeout(() => (elementos.modalBackdrop.hidden = true), 280);
  }

  /* ---------------- Drawer (menú hamburguesa) ---------------- */

  function abrirDrawer() {
    elementos.drawerBackdrop.hidden = false;
    elementos.drawer.classList.add("abierto");
    elementos.drawer.setAttribute("aria-hidden", "false");
    elementos.btnMenu.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => elementos.drawerBackdrop.classList.add("visible"));
    elementos.btnCerrarDrawer.focus();
  }

  function cerrarDrawer() {
    elementos.drawerBackdrop.classList.remove("visible");
    elementos.drawer.classList.remove("abierto");
    elementos.drawer.setAttribute("aria-hidden", "true");
    elementos.btnMenu.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
    setTimeout(() => (elementos.drawerBackdrop.hidden = true), 340);
    elementos.btnMenu.focus();
  }

  const abierto = () => elementos.drawer.classList.contains("abierto");

  /* ---------------- Inicialización ---------------- */

  function conectarEventos() {
    // Menú
    elementos.btnMenu.addEventListener("click", () => (abierto() ? cerrarDrawer() : abrirDrawer()));
    elementos.btnCerrarDrawer.addEventListener("click", cerrarDrawer);
    elementos.drawerBackdrop.addEventListener("click", cerrarDrawer);

    // Búsqueda con debounce
    let debounce;
    elementos.inputBusqueda.addEventListener("input", () => {
      elementos.btnLimpiarBusqueda.hidden = !elementos.inputBusqueda.value;
      clearTimeout(debounce);
      debounce = setTimeout(renderizarGrid, 130);
    });
    elementos.btnLimpiarBusqueda.addEventListener("click", () => {
      elementos.inputBusqueda.value = "";
      elementos.btnLimpiarBusqueda.hidden = true;
      renderizarGrid();
      elementos.inputBusqueda.focus();
    });

    // Filtros
    elementos.selOrden.addEventListener("change", renderizarGrid);
    elementos.inputPrecioMax.addEventListener("input", () => {
      const conPrecio = productos.filter((p) => Number.isFinite(p.precio));
      const max = conPrecio.length ? Math.max(...conPrecio.map((p) => p.precio)) : 0;
      actualizarEtiquetaPrecio(max);
      renderizarGrid();
    });

    // Preferencias
    elementos.chkPrecios.addEventListener("change", () => {
      prefs.mostrarPrecios = elementos.chkPrecios.checked;
      guardarPrefs();
      renderizarGrid();
    });
    elementos.selMoneda.addEventListener("change", () => {
      prefs.moneda = elementos.selMoneda.value;
      guardarPrefs();
      renderizarGrid();
    });

    // Importar
    const dispararImport = () => {
      if (abierto()) cerrarDrawer();
      elementos.inputArchivo.click();
    };
    [elementos.btnImportarTop, elementos.btnImportarMenu, elementos.btnImportarVacio].forEach((b) =>
      b.addEventListener("click", dispararImport)
    );
    elementos.inputArchivo.addEventListener("change", () => {
      const f = elementos.inputArchivo.files[0];
      if (f) importarArchivo(f);
    });

    // Drag & drop sobre toda la página
    ["dragover", "drop"].forEach((ev) =>
      document.addEventListener(ev, (e) => {
        e.preventDefault();
        if (ev === "drop" && e.dataTransfer.files[0]) importarArchivo(e.dataTransfer.files[0]);
      })
    );

    // Exportar / plantilla / vaciar / demo
    elementos.btnExportar.addEventListener("click", () => { cerrarDrawer(); exportarCSV(); });
    elementos.btnPlantilla.addEventListener("click", () => {
      cerrarDrawer();
      descargar("plantilla-camila.csv", plantillaCSV());
      toast("Plantilla descargada: complétala y vuelvela a importar.");
    });
    elementos.btnPlantillaVacio.addEventListener("click", () => {
      descargar("plantilla-camila.csv", plantillaCSV());
      toast("Plantilla descargada.");
    });
    elementos.btnDemo.addEventListener("click", cargarDemo);
    elementos.btnVaciar.addEventListener("click", () => {
      if (!productos.length) return toast("El catálogo ya está vacío.");
      if (confirm("¿Vaciar el catálogo completo? Esta acción no se puede deshacer.")) {
        productos = [];
        guardarDatos();
        categoriaActiva = "todas";
        renderizarTodo();
        cerrarDrawer();
        toast("Catálogo vaciado.");
      }
    });

    // Modal
    elementos.btnCerrarModal.addEventListener("click", cerrarModal);
    elementos.modalBackdrop.addEventListener("click", (e) => {
      if (e.target === elementos.modalBackdrop) cerrarModal();
    });

    // Teclado global
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!elementos.modalBackdrop.hidden) cerrarModal();
        else if (abierto()) cerrarDrawer();
      }
      // Atajos: / enfoca búsqueda
      if (e.key === "/" && document.activeElement !== elementos.inputBusqueda) {
        e.preventDefault();
        elementos.inputBusqueda.focus();
      }
    });

    // Cerrar el menú al navegar con hashes internos si hiciera falta
    window.addEventListener("hashchange", cerrarDrawer);
  }

  function cargarInicial() {
    cargarPrefs();

    // 1) Datos guardados en este navegador
    try {
      const crudo = localStorage.getItem(CLAVE_DATOS);
      if (crudo) {
        const datos = JSON.parse(crudo);
        if (Array.isArray(datos) && datos.length) productos = datos;
      }
    } catch { /* ignorar */ }

    // 2) Si no hay nada local, intentar catalogo.csv del repo (GitHub Pages)
    if (!productos.length) {
      fetch(CSV_REPO, { headers: { Accept: "text/csv" } })
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .then((texto) => {
          const nuevos = csvABjetos(texto);
          if (nuevos.length) {
            const previo = productos.length;
            productos = nuevos;
            renderizarTodo();
            if (!previo) toast(`Catálogo cargado desde ${CSV_REPO} (${nuevos.length} productos).`);
          }
        })
        .catch(() => { /* sin CSV publicado: se muestra estado vacío */ });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    conectarEventos();
    cargarInicial();
    renderizarTodo();
  });
})();
