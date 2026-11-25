// Regla de prioridad: P = 50 × (días desde el ingreso ÷ vida útil de referencia del producto)
// + ajuste de recepción + ajuste ambiental. Alta si P ≥ 40, Media si 20 ≤ P < 40, Baja si P < 20.
// Esos números son los valores actuales de datos/config.json: el código no los tiene escritos,
// los lee de ahí. Funciones puras: reciben datos y devuelven valores, sin tocar el DOM ni localStorage.

export const POR_CONFIRMAR = "Prioridad por confirmar";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Redondeo a un decimal, como se muestra en la interfaz.
export function redondear1(numero) {
  return Math.round(numero * 10) / 10;
}

// Días completos entre la fecha de ingreso ("AAAA-MM-DD") y hoy, según el calendario local.
// Devuelve null si la fecha falta, no es válida o es posterior a hoy:
// en esos casos no se calcula antigüedad (ER-01, ER-02).
export function diasDesdeIngreso(fechaIngreso, hoy) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaIngreso ?? "");
  if (!partes) return null;

  const [, anio, mes, dia] = partes.map(Number);
  const ingreso = Date.UTC(anio, mes - 1, dia);
  // Date.UTC normaliza fechas imposibles (31 de febrero); si cambió, la fecha no existe.
  if (new Date(ingreso).getUTCDate() !== dia) return null;

  // Se comparan solo las fechas de calendario, sin horas, para no depender de la zona horaria.
  const hoySinHora = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const dias = Math.round((hoySinHora - ingreso) / MS_POR_DIA);
  return dias < 0 ? null : dias;
}

// Vida útil de referencia del producto. Si no está en la lista, se usa la del producto
// genérico ("Otro") y se marca para declararlo en pantalla.
export function vidaUtil(producto, config) {
  const generico = config.productos.find((p) => p.generico);
  const encontrado = config.productos.find((p) => p.nombre === producto && !p.generico);
  const elegido = encontrado ?? generico;
  return { dias: elegido.vida_util_dias, generica: !encontrado };
}

// Reemplaza {nombre} en un texto de config.json por su valor, para que ningún aviso lleve
// un número escrito a mano que pueda quedar desactualizado.
export function rellenarTexto(texto, valores) {
  return texto.replace(/\{(\w+)\}/g, (marca, nombre) => String(valores[nombre] ?? marca));
}

// Aviso que se declara en pantalla cuando el producto usa la vida útil genérica (RP-06).
export function avisoProductoGenerico(config) {
  const generico = config.productos.find((p) => p.generico);
  return rellenarTexto(config.textos.aviso_producto_otro, { dias: generico.vida_util_dias });
}

const NOMBRES_FALTANTES = {
  fecha_ingreso: "la fecha de ingreso",
  condicion_recepcion: "la condición de recepción",
  condicion_ambiental: "la condición ambiental",
};

// Línea corta para la lista: los factores que elevaron el puntaje, en lenguaje llano.
// Ejemplo: "3 días desde el ingreso · recepción normal · calor o humedad elevada".
export function motivoCorto(lote, resultado) {
  if (resultado.faltantes.length > 0) {
    return "Falta " + resultado.faltantes.map((f) => NOMBRES_FALTANTES[f]).join(" y ");
  }
  const partes = [];
  if (resultado.dias === 0) partes.push("Ingresó hoy");
  else partes.push(`${resultado.dias} ${resultado.dias === 1 ? "día" : "días"} desde el ingreso`);
  if (resultado.desglose.recepcion > 0) partes.push(`recepción ${lote.condicion_recepcion.toLowerCase()}`);
  if (resultado.desglose.ambiente > 0) partes.push(lote.condicion_ambiental.toLowerCase());
  if (resultado.vida_util_generica) partes.push(`vida útil genérica de ${resultado.vida_util_dias} días`);
  return partes.join(" · ");
}

export function nivelDePuntaje(puntaje, regla) {
  if (puntaje >= regla.umbral_alta) return "Alta";
  if (puntaje >= regla.umbral_media) return "Media";
  return "Baja";
}

// Calcula puntaje, nivel y desglose de un lote para la fecha `hoy`.
// Si falta cualquier dato de la fórmula, el nivel es "Prioridad por confirmar",
// el puntaje es null y `faltantes` dice qué pedir. Nunca se rellena con un supuesto.
export function calcularPrioridad(lote, config, hoy) {
  const regla = config.regla;
  const vida = vidaUtil(lote.producto, config);
  const dias = diasDesdeIngreso(lote.fecha_ingreso, hoy);
  const ajusteRecepcion = regla.ajuste_recepcion[lote.condicion_recepcion];
  const ajusteAmbiental = regla.ajuste_ambiental[lote.condicion_ambiental];

  const faltantes = [];
  if (dias === null) faltantes.push("fecha_ingreso");
  if (ajusteRecepcion === undefined) faltantes.push("condicion_recepcion");
  if (ajusteAmbiental === undefined) faltantes.push("condicion_ambiental");

  const resultado = {
    dias,
    vida_util_dias: vida.dias,
    vida_util_generica: vida.generica,
    faltantes,
    puntaje: null,
    nivel: POR_CONFIRMAR,
    desglose: null,
  };
  if (faltantes.length > 0) return resultado;

  const antiguedad = (regla.peso_antiguedad * dias) / vida.dias;
  // DECISIÓN APROBADA, NO LA REVIERTAS: el nivel se decide con el puntaje YA REDONDEADO a un
  // decimal, no con el valor exacto. Así lo que ve el comerciante y el nivel siempre coinciden:
  // con 39.96 sin redondear la pantalla diría "40.0 · Media", que contradice el umbral de Alta.
  const puntaje = redondear1(antiguedad + ajusteRecepcion + ajusteAmbiental);

  resultado.puntaje = puntaje;
  resultado.nivel = nivelDePuntaje(puntaje, regla);
  resultado.desglose = {
    antiguedad: redondear1(antiguedad),
    recepcion: ajusteRecepcion,
    ambiente: ajusteAmbiental,
  };
  return resultado;
}
