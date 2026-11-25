// Exportación del historial a CSV: un renglón por lote, 16 columnas, UTF-8 con BOM.
// Se genera en el navegador, sin red.

import { calcularPrioridad } from "./prioridad.js";
import { fechaLocal } from "./almacen.js";

export const COLUMNAS = [
  "establecimiento", "version_app", "id_lote", "producto", "cantidad_kg", "fecha_ingreso",
  "dias_desde_ingreso", "condicion_recepcion", "condicion_ambiental", "costo_aproximado",
  "puntaje", "nivel", "decision", "observacion", "fecha_decision", "origen",
];

// Campos con coma, comillas o salto de línea van entre comillas dobles; las comillas se duplican.
function celda(valor) {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

// Todos los lotes, incluidos los DEMO. Días, puntaje y nivel se recalculan con la fecha `hoy`:
// no se guardan como dato fijo.
export function generarCSV(estado, config, hoy) {
  const filas = estado.lotes.map((lote) => {
    const resultado = calcularPrioridad(lote, config, hoy);
    const fila = {
      ...lote,
      establecimiento: config.establecimiento,
      version_app: config.version_app,
      dias_desde_ingreso: resultado.dias,
      puntaje: resultado.puntaje?.toFixed(1),
      nivel: resultado.nivel,
    };
    return COLUMNAS.map((columna) => celda(fila[columna])).join(",");
  });
  // El BOM (﻿) hace que Excel reconozca UTF-8 y muestre bien los acentos.
  return "﻿" + [COLUMNAS.join(","), ...filas].join("\r\n") + "\r\n";
}

export function nombreArchivo(config, hoy) {
  return `pmv_${config.establecimiento}_${fechaLocal(hoy)}.csv`;
}

// Descarga con un Blob y un enlace temporal. No modifica el historial, así que se puede repetir.
export function descargarArchivo(texto, nombre) {
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  // Algunos navegadores móviles leen el Blob después del clic; se libera más tarde.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
