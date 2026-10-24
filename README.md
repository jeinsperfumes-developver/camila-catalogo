# Camila · Catálogo y Precios

Sitio estático para GitHub Pages: catálogo de productos con precios, importación de **Excel (.xlsx)** o **CSV**, filtros por categoría/precio/búsqueda y menú hamburguesa. Sin backend, sin build: solo HTML + CSS + JS.

## 🚀 Publicar en GitHub Pages (2 minutos)

1. Creá un repositorio nuevo en GitHub, por ejemplo `camila-catalogo`.
2. Subí los archivos `index.html`, `styles.css`, `app.js`, `README.md` (y opcionalmente `catalogo.csv`).
3. En el repo: **Settings → Pages → Source: Deploy from a branch → Branch: `main` → Save**.
4. En 1–2 minutos el sitio queda vivo en `https://TU-USUARIO.github.io/camila-catalogo/`.

## 📦 Cómo cargar el catálogo

### Opción A — desde la página (local al navegador)
1. Botón **Importar** (o menú hamburguesa → *Importar Excel / CSV*, o arrastrá el archivo a la página).
2. Los datos quedan guardados en ese navegador (localStorage).

### Opción B — publicada para todos (recomendada)
1. En la página: menú → **Exportar catálogo (CSV)**.
2. Subí el `catalogo.csv` generado a la raíz del repositorio y hacé commit.
3. Todos los visitantes verán ese catálogo automáticamente al entrar.

## 📋 Formato del archivo

Primera fila = encabezados. Reconoce sinónimos en español/inglés:

| Campo | Acepta también |
|---|---|
| `nombre` * | producto, artículo, item, título |
| `precio` * | price, valor, precio unitario, pvp |
| `codigo` | sku, código, ref, id |
| `descripcion` | detalle, notas |
| `categoria` | rubro, tipo, línea, grupo |
| `precio anterior` | precio tachado, oferta |
| `imagen` | foto, URL de imagen (opcional) |
| `stock` | disponible, cantidad (Sí/No) |

\* obligatorios

Separador `,` `;` o tab. Precios con `1.234,56` o `1,234.56`. Plantilla lista para llenar: menú → **Descargar plantilla**, o desde el estado vacío.

## ✨ Features

- Búsqueda con debounce (ignora acentos), atajo `/`
- Chips de categoría con conteo
- Filtro de precio máximo por slider + ordenamiento
- Tarjetas con foto (si hay columna imagen), inicial como fallback
- Modal de detalle, precios tachados en oferta, badge de stock
- Menú hamburguesa animado, accesible (teclado, ARIA, `Esc`)
- Moneda configurable, opción ocultar precios (modo "consultar")
- Drag & drop de archivos, export CSV (separador `;`, listo para Excel ES)
- 100% client-side, cero dependencias más allá de SheetJS por CDN
