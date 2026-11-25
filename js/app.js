// Arranque de la app y navegación entre sus vistas: prioridades de revisión, registro de lote,
// detalle y motivo, decisión, historial e información.
// La navegación usa el fragmento de la dirección (#lista, #detalle/L-001…): no recarga la
// página y el botón "atrás" del teléfono regresa a la vista anterior.

import {
  calcularPrioridad, motivoCorto, avisoProductoGenerico, rellenarTexto, POR_CONFIRMAR,
} from "./prioridad.js";
import * as almacen from "./almacen.js";
import { generarCSV, nombreArchivo, descargarArchivo } from "./exportar.js";

// Código que trae config.json mientras el equipo no asigna el del establecimiento.
const SIN_CODIGO = "SIN-ASIGNAR";

let config; // datos/config.json
let demo; // datos/demo.json
let estado; // { version, establecimiento, lotes, eventos }
let idResaltado = null; // lote recién guardado, se resalta un instante en la lista
let loteEnDecision = null;
let almacenDisponible = true; // pasa a false en cuanto falla una lectura o escritura (ER-04)

const $ = (id) => document.getElementById(id);

function crear(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

const CLASE_NIVEL = { Alta: "nivel-alta", Media: "nivel-media", Baja: "nivel-baja" };
const claseNivel = (nivel) => CLASE_NIVEL[nivel] ?? "nivel-confirmar";

const textoNivel = (resultado) =>
  resultado.puntaje === null ? POR_CONFIRMAR : `${resultado.nivel} · ${resultado.puntaje.toFixed(1)}`;

const formatoKg = (kg) => `${kg.toLocaleString("es-MX")} kg`;

// "2026-11-22" → "22/11/2026"
function formatoFecha(fechaISO) {
  const [anio, mes, dia] = fechaISO.split("-");
  return `${dia}/${mes}/${anio}`;
}

const formatoFechaHora = (fechaHoraISO) =>
  new Date(fechaHoraISO).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });

// Etiqueta visible DEMO, separada por un espacio para que también se lea aparte.
function agregarEtiquetaDemo(elemento, lote) {
  if (lote.origen === "DEMO") elemento.append(" ", crear("span", "etiqueta-demo", "DEMO"));
}

// ER-04: si el navegador bloquea el almacenamiento, el aviso queda fijo y la app sigue en
// memoria. No se vuelve a intentar escribir: el aviso no debe aparecer y desaparecer.
function marcarFallaDeAlmacen() {
  almacenDisponible = false;
  $("aviso-almacen").hidden = false;
}

function persistir() {
  if (!almacenDisponible || !almacen.escribir(estado)) marcarFallaDeAlmacen();
}

// ---------- Arranque ----------

async function leerJSON(ruta) {
  const respuesta = await fetch(ruta);
  if (!respuesta.ok) throw new Error(`${ruta}: ${respuesta.status}`);
  return respuesta.json();
}

async function arrancar() {
  try {
    // Los dos archivos se leen al arrancar, para no hacer peticiones después de la carga.
    [config, demo] = await Promise.all([leerJSON("datos/config.json"), leerJSON("datos/demo.json")]);
  } catch (error) {
    console.error(error);
    $("aviso-carga").hidden = false;
    return;
  }

  const lectura = almacen.leer(config);
  estado = lectura.estado;
  // Manda config.json: si el equipo asigna el código en el alta, los eventos nuevos lo usan.
  estado.establecimiento = config.establecimiento;
  almacenDisponible = lectura.ok;

  for (const elemento of document.querySelectorAll("[data-texto]")) {
    elemento.textContent = config.textos[elemento.dataset.texto];
  }
  prepararRegistro();
  prepararDetalle();
  prepararDecision();
  prepararHistorial();
  prepararInformacion();

  window.addEventListener("hashchange", mostrarVista);
  $("app").hidden = false;
  mostrarVista(); // la lista guarda su evento: así se prueba la escritura desde el inicio

  // Guarda la app en el teléfono para que funcione sin conexión (sw.js).
  navigator.serviceWorker?.register("sw.js").catch((error) => console.error("Sin modo sin conexión:", error));
}

// ---------- Navegación ----------

function ir(destino) {
  if (location.hash === destino) mostrarVista();
  else location.hash = destino;
}

function mostrarVista() {
  const [vista, id] = location.hash.slice(1).split("/");
  const lote = estado.lotes.find((l) => l.id_lote === id);
  const conPuntaje = lote && calcularPrioridad(lote, config, new Date()).puntaje !== null;

  for (const seccion of document.querySelectorAll(".vista")) seccion.hidden = true;

  let seccion;
  if (vista === "registro") seccion = mostrarRegistro();
  else if (vista === "detalle" && lote) seccion = mostrarDetalle(lote);
  else if (vista === "decision" && conPuntaje) seccion = mostrarDecision(lote);
  else if (vista === "historial") seccion = mostrarHistorial();
  else if (vista === "informacion") seccion = mostrarInformacion();
  else seccion = mostrarLista();

  seccion.hidden = false;
  window.scrollTo(0, 0);
  seccion.querySelector("h1").focus({ preventScroll: true });
  seccion.querySelector(".resaltado")?.scrollIntoView({ block: "center" });
}

// ---------- Vista 1. Prioridades de revisión ----------

// Primero los lotes por confirmar (les falta un dato), después de mayor a menor puntaje.
function ordenarPorPrioridad(a, b) {
  const puntajeA = a.resultado.puntaje ?? Infinity;
  const puntajeB = b.resultado.puntaje ?? Infinity;
  return puntajeB - puntajeA || a.lote.id_lote.localeCompare(b.lote.id_lote);
}

function filaDeLote({ lote, resultado }) {
  const enlace = crear("a", "fila-lote");
  enlace.href = `#detalle/${lote.id_lote}`;
  if (lote.id_lote === idResaltado) enlace.classList.add("resaltado");

  const producto = crear("span", "fila-producto", `${lote.producto} · ${formatoKg(lote.cantidad_kg)}`);
  agregarEtiquetaDemo(producto, lote);

  const cabeza = crear("span", "fila-cabeza");
  cabeza.append(producto, crear("span", `nivel ${claseNivel(resultado.nivel)}`, textoNivel(resultado)));
  enlace.append(cabeza, crear("span", "fila-motivo", motivoCorto(lote, resultado)));

  const item = crear("li");
  item.append(enlace);
  return item;
}

function mostrarLista() {
  // Se recalcula cada vez que se abre, con la fecha actual del dispositivo.
  const hoy = new Date();
  const filas = estado.lotes
    .map((lote) => ({ lote, resultado: calcularPrioridad(lote, config, hoy) }))
    .sort(ordenarPorPrioridad);

  const lista = $("lista-lotes");
  lista.replaceChildren(...filas.map(filaDeLote));
  $("lista-vacia").hidden = filas.length > 0;
  $("lista-aviso-demo").hidden = !estado.lotes.some((l) => l.origen === "DEMO");

  if (idResaltado) {
    idResaltado = null;
    setTimeout(() => lista.querySelector(".resaltado")?.classList.remove("resaltado"), 1500);
  }

  almacen.registrarEvento(estado, "prioridad_consultada", {}, config, hoy);
  persistir();
  return $("vista-lista");
}

// ---------- Formularios: errores junto al campo ----------

// `errores` es { nombreDeCampo: mensaje }. El campo se marca con borde y con texto,
// y no se toca lo que el usuario ya escribió.
function mostrarErrores(formulario, errores) {
  for (const campo of formulario.querySelectorAll("[data-campo]")) {
    const nombre = campo.dataset.campo;
    const mensaje = errores[nombre];
    const error = $(`error-${nombre}`);
    campo.classList.toggle("con-error", Boolean(mensaje));
    error.hidden = !mensaje;
    error.textContent = mensaje ?? "";
    for (const entrada of campo.querySelectorAll("input, select, textarea")) {
      entrada.setAttribute("aria-invalid", String(Boolean(mensaje)));
    }
  }
  formulario.querySelector(".con-error input, .con-error select")?.focus();
}

// Grupo de opciones de una sola elección, como botones grandes.
function crearOpciones(contenedor, nombre, valores) {
  for (const valor of valores) {
    const etiqueta = crear("label", "opcion");
    const radio = crear("input");
    radio.type = "radio";
    radio.name = nombre;
    radio.value = valor;
    etiqueta.append(radio, crear("span", "", valor));
    contenedor.append(etiqueta);
  }
}

// ---------- Vista 2. Registro de lote ----------

function prepararRegistro() {
  const producto = $("producto");
  for (const p of config.productos) producto.append(new Option(p.nombre, p.nombre));
  crearOpciones($("opciones-recepcion"), "recepcion", Object.keys(config.regla.ajuste_recepcion));
  crearOpciones($("opciones-ambiental"), "ambiental", Object.keys(config.regla.ajuste_ambiental));

  // "Otro" usa la vida útil genérica y se declara en pantalla (RP-06).
  producto.addEventListener("change", () => {
    const generico = config.productos.find((p) => p.nombre === producto.value)?.generico;
    $("nota-producto").hidden = !generico;
    $("nota-producto").textContent = avisoProductoGenerico(config);
  });

  $("fecha").addEventListener("input", actualizarNotaFecha);
  $("fecha").addEventListener("change", actualizarNotaFecha);
  $("form-lote").addEventListener("submit", guardarLote);
  reiniciarRegistro();
}

function actualizarNotaFecha() {
  const fecha = $("fecha");
  $("nota-fecha").hidden = fecha.value !== "" || fecha.validity.badInput;
}

function reiniciarRegistro() {
  const formulario = $("form-lote");
  formulario.reset();
  $("fecha").value = almacen.fechaLocal(new Date()); // se preselecciona hoy
  $("nota-producto").hidden = true;
  actualizarNotaFecha();
  mostrarErrores(formulario, {});
}

function mostrarRegistro() {
  $("fecha").max = almacen.fechaLocal(new Date());
  return $("vista-registro");
}

// Mensaje de error de un campo de fecha, o undefined si está bien.
function errorDeFecha(entrada, obligatoria) {
  if (entrada.validity.badInput) return "Escribe la fecha completa.";
  if (entrada.value === "") return obligatoria ? "Escribe la fecha de ingreso." : undefined;
  // Las fechas "AAAA-MM-DD" se pueden comparar como texto.
  if (entrada.value > almacen.fechaLocal(new Date())) return "La fecha no puede ser posterior a hoy.";
  return undefined;
}

function validarLote(formulario) {
  const { producto, cantidad, fecha, recepcion, ambiental, costo } = formulario.elements;
  const errores = {};

  if (!producto.value) errores.producto = "Elige un producto.";

  const kilos = Number(cantidad.value);
  if (cantidad.validity.badInput) errores.cantidad = "Escribe la cantidad solo con números.";
  else if (cantidad.value === "") errores.cantidad = "Escribe la cantidad en kilos.";
  else if (!(Number.isFinite(kilos) && kilos > 0)) errores.cantidad = "La cantidad debe ser mayor que cero.";

  // ER-01: sin fecha sí se guarda, como "Prioridad por confirmar"; el detalle la pide después.
  const mensajeFecha = errorDeFecha(fecha, false);
  if (mensajeFecha) errores.fecha = mensajeFecha;

  if (!recepcion.value) errores.recepcion = "Elige la condición de recepción.";
  if (!ambiental.value) errores.ambiental = "Elige la condición ambiental.";

  const pesos = Number(costo.value);
  if (costo.validity.badInput) errores.costo = "Escribe el costo solo con números.";
  else if (costo.value !== "" && !(Number.isFinite(pesos) && pesos >= 0)) errores.costo = "El costo no puede ser negativo.";

  return errores;
}

function guardarLote(evento) {
  evento.preventDefault();
  const formulario = evento.target;
  const errores = validarLote(formulario);
  mostrarErrores(formulario, errores);
  if (Object.keys(errores).length > 0) return; // no se guarda hasta corregirlo

  const { producto, cantidad, fecha, recepcion, ambiental, costo } = formulario.elements;
  const lote = almacen.agregarLote(estado, {
    producto: producto.value,
    cantidad_kg: Number(cantidad.value),
    fecha_ingreso: fecha.value,
    condicion_recepcion: recepcion.value,
    condicion_ambiental: ambiental.value,
    costo_aproximado: costo.value === "" ? null : Number(costo.value),
    origen: "REAL",
  }, config, new Date());
  persistir();

  idResaltado = lote.id_lote;
  reiniciarRegistro();
  ir("#lista");
}

// ---------- Vista 3. Detalle y motivo ----------

function filaDesglose(concepto, explicacion, valor, clase) {
  const fila = crear("tr", clase);
  const encabezado = crear("th", "", concepto);
  encabezado.scope = "row";
  fila.append(encabezado, crear("td", "", explicacion), crear("td", "numero", valor));
  return fila;
}

function filasDesglose(lote, r) {
  const generica = r.vida_util_generica ? " (genérica)" : "";
  return [
    filaDesglose("Antigüedad", `${r.dias} de ${r.vida_util_dias} días de vida útil de referencia${generica}`,
      r.desglose.antiguedad.toFixed(1)),
    filaDesglose("Recepción", `Condición ${lote.condicion_recepcion.toLowerCase()}`, r.desglose.recepcion.toFixed(1)),
    filaDesglose("Ambiente", lote.condicion_ambiental, r.desglose.ambiente.toFixed(1)),
    filaDesglose("Puntaje", `Nivel: ${r.nivel}`, r.puntaje.toFixed(1), "total"),
  ];
}

function pintarDetalle(lote) {
  const resultado = calcularPrioridad(lote, config, new Date());

  $("detalle-producto").textContent = lote.producto;
  const datos = $("detalle-datos");
  datos.textContent = `${lote.id_lote} · ${formatoKg(lote.cantidad_kg)} · ` +
    (lote.fecha_ingreso ? `ingresó el ${formatoFecha(lote.fecha_ingreso)}` : "sin fecha de ingreso");
  agregarEtiquetaDemo(datos, lote);

  const nivel = $("detalle-nivel");
  nivel.className = `nivel nivel-grande ${claseNivel(resultado.nivel)}`;
  nivel.textContent = resultado.puntaje === null ? POR_CONFIRMAR : `Prioridad ${resultado.nivel}`;

  $("detalle-generico").hidden = !resultado.vida_util_generica;
  $("detalle-generico").textContent = avisoProductoGenerico(config);

  // ER-01: sin fecha no se calcula la antigüedad; se pide el dato aquí mismo.
  const formularioFecha = $("form-fecha");
  formularioFecha.hidden = Boolean(lote.fecha_ingreso);
  formularioFecha.reset();
  $("fecha-detalle").max = almacen.fechaLocal(new Date());
  mostrarErrores(formularioFecha, {});

  const tabla = $("detalle-desglose");
  tabla.hidden = resultado.puntaje === null;
  if (resultado.puntaje !== null) tabla.tBodies[0].replaceChildren(...filasDesglose(lote, resultado));

  const actual = $("detalle-decision-actual");
  actual.hidden = !lote.decision;
  actual.textContent = lote.decision
    ? `Decisión registrada: ${lote.decision} (${formatoFechaHora(lote.fecha_decision)})`
    : "";

  // Sin puntaje no hay prioridad sobre la cual decidir: primero se pide el dato que falta.
  $("detalle-boton-decision").href = `#decision/${lote.id_lote}`;
  $("detalle-acciones").hidden = resultado.puntaje === null;
}

function prepararDetalle() {
  $("form-fecha").addEventListener("submit", (evento) => {
    evento.preventDefault();
    const entrada = $("fecha-detalle");
    const mensaje = errorDeFecha(entrada, true);
    mostrarErrores(evento.target, mensaje ? { "fecha-detalle": mensaje } : {});
    if (mensaje) return;

    const lote = estado.lotes.find((l) => l.id_lote === location.hash.split("/")[1]);
    lote.fecha_ingreso = entrada.value;
    persistir();
    pintarDetalle(lote);
  });
}

function mostrarDetalle(lote) {
  pintarDetalle(lote);
  almacen.registrarEvento(estado, "detalle_abierto", { id_lote: lote.id_lote }, config, new Date());
  persistir();
  return $("vista-detalle");
}

// ---------- Vista 4. Decisión ----------

function actualizarContador() {
  const usados = $("observacion").value.length;
  $("contador-observacion").textContent = `${usados} de ${config.limite_observacion} caracteres`;
}

function prepararDecision() {
  crearOpciones($("opciones-decision"), "decision", config.decisiones);
  $("observacion").maxLength = config.limite_observacion;
  $("observacion").addEventListener("input", actualizarContador);
  $("form-decision").addEventListener("submit", guardarDecision);
}

function mostrarDecision(lote) {
  loteEnDecision = lote;
  const formulario = $("form-decision");
  formulario.reset();
  mostrarErrores(formulario, {});
  actualizarContador();

  $("decision-lote").textContent = `${lote.id_lote} · ${lote.producto} · ${formatoKg(lote.cantidad_kg)}`;
  agregarEtiquetaDemo($("decision-lote"), lote);
  $("decision-volver").href = `#detalle/${lote.id_lote}`;
  return $("vista-decision");
}

function guardarDecision(evento) {
  evento.preventDefault();
  const formulario = evento.target;
  const decision = formulario.elements.decision.value;
  mostrarErrores(formulario, decision ? {} : { decision: "Elige una decisión." });
  if (!decision) return;

  const observacion = formulario.elements.observacion.value.trim().slice(0, config.limite_observacion);
  almacen.guardarDecision(estado, loteEnDecision, decision, observacion, config, new Date());
  persistir();
  ir("#historial");
}

// ---------- Vista 5. Historial ----------

function entradaDeHistorial(evento) {
  const lote = estado.lotes.find((l) => l.id_lote === evento.id_lote);
  if (!lote) return null;

  const item = crear("li");
  item.append(crear("span", "historial-fecha", formatoFechaHora(evento.fecha_hora)));
  item.append(evento.evento === "lote_registrado"
    ? `Lote registrado: ${lote.id_lote} · ${lote.producto} · ${formatoKg(lote.cantidad_kg)}`
    : `Decisión: ${evento.decision} · ${lote.id_lote} · ${lote.producto}`);
  agregarEtiquetaDemo(item, lote);
  // La observación pertenece a la decisión vigente del lote.
  if (evento.fecha_hora === lote.fecha_decision && lote.observacion) {
    item.append(crear("span", "historial-observacion", `“${lote.observacion}”`));
  }
  return item;
}

// ER-06: exportar no modifica nada; si se interrumpe, se puede repetir sin perder registros.
function exportar() {
  const mensaje = $("mensaje-exportar");
  try {
    const ahora = new Date();
    const nombre = nombreArchivo(config, ahora);
    descargarArchivo(generarCSV(estado, config, ahora), nombre);
    mensaje.textContent = `Se generó el archivo ${nombre}. Si no aparece en tus descargas, ` +
      "vuelve a exportar: tu historial sigue intacto.";
  } catch (error) {
    console.error(error);
    mensaje.textContent = "No se pudo exportar. Tu historial sigue intacto; vuelve a intentarlo.";
  }
}

function prepararHistorial() {
  $("boton-exportar").addEventListener("click", exportar);
}

function mostrarHistorial() {
  $("mensaje-exportar").textContent = "";
  // Los eventos se guardan en orden; al revés quedan del más reciente al más antiguo.
  const entradas = estado.eventos
    .filter((e) => e.evento === "lote_registrado" || e.evento === "decision_guardada")
    .reverse()
    .map(entradaDeHistorial)
    .filter(Boolean);
  $("lista-historial").replaceChildren(...entradas);
  $("historial-vacio").hidden = entradas.length > 0;
  return $("vista-historial");
}

// ---------- Pantalla de información ----------

function cargarDemo(evento) {
  const mensaje = evento.currentTarget.nextElementSibling;
  if (estado.lotes.some((l) => l.origen === "DEMO")) {
    mensaje.textContent = "Los datos de demostración ya están cargados.";
    return;
  }
  const ahora = new Date();
  for (const datos of almacen.prepararDemo(demo, ahora)) almacen.agregarLote(estado, datos, config, ahora);
  persistir();
  ir("#lista");
}

function cerrarConfirmacion() {
  $("confirmar-borrar").hidden = true;
  $("boton-borrar").hidden = false;
}

function borrarTodo() {
  if (!almacen.borrar()) marcarFallaDeAlmacen();
  estado = almacen.estadoVacio(config);
  cerrarConfirmacion();
  $("mensaje-borrar").textContent = "Se borraron todos los datos de este dispositivo.";
}

function prepararInformacion() {
  for (const boton of document.querySelectorAll('[data-accion="cargar-demo"]')) {
    boton.addEventListener("click", cargarDemo);
  }
  $("boton-borrar").addEventListener("click", () => {
    $("confirmar-borrar").hidden = false;
    $("boton-borrar").hidden = true;
    $("boton-borrar-no").focus();
  });
  $("boton-borrar-no").addEventListener("click", cerrarConfirmacion);
  $("boton-borrar-si").addEventListener("click", borrarTodo);
}

function mostrarInformacion() {
  $("info-version").textContent = config.version_app;
  $("info-fecha").textContent = config.fecha_publicacion ? formatoFecha(config.fecha_publicacion) : "Sin publicar";
  $("info-establecimiento").textContent = config.establecimiento;

  const aviso = $("info-aviso-establecimiento");
  aviso.hidden = config.establecimiento !== SIN_CODIGO;
  aviso.textContent = rellenarTexto(config.textos.aviso_establecimiento, { codigo: config.establecimiento });

  cerrarConfirmacion();
  $("mensaje-borrar").textContent = "";
  for (const mensaje of document.querySelectorAll("[data-mensaje-demo]")) mensaje.textContent = "";
  return $("vista-informacion");
}

arrancar();
