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
let decisionRecienGuardada = null; // se confirma al llegar al historial
let profundidadActual = 0; // para saber si la transición va hacia adentro o de regreso
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

// Marca de tres cuadros (Alta ■■■, Media ■■□, Baja ■□□, por confirmar □□□). Es solo
// visual: el texto del nivel siempre va al lado.
function crearMarca() {
  const marca = crear("span", "marca");
  marca.setAttribute("aria-hidden", "true");
  marca.append(crear("i"), crear("i"), crear("i"));
  return marca;
}

// Etiqueta de nivel: color de fondo, marca y texto.
function etiquetaNivel(resultado, conPuntaje = true) {
  const etiqueta = crear("span", `nivel ${claseNivel(resultado.nivel)}`);
  etiqueta.append(crearMarca(), conPuntaje ? textoNivel(resultado) : resultado.nivel);
  return etiqueta;
}

function icono(nombre) {
  const elemento = crear("span", `icono icono-${nombre}`);
  elemento.setAttribute("aria-hidden", "true");
  return elemento;
}

// Espacio que no se parte: "5" y "kg" nunca quedan en renglones distintos.
const formatoKg = (kg) => `${kg.toLocaleString("es-MX")}\u00a0kg`;

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

  window.addEventListener("hashchange", cambiarVista);
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

// Qué tan adentro está cada vista: decide si la transición entra por la derecha o la izquierda.
const PROFUNDIDAD = { registro: 1, detalle: 1, historial: 1, informacion: 1, decision: 2 };

// Transición corta entre vistas (View Transitions API). Si el navegador no la tiene o la
// persona pidió menos movimiento, el cambio es instantáneo.
function cambiarVista() {
  const profundidad = PROFUNDIDAD[location.hash.slice(1).split("/")[0]] ?? 0;
  document.documentElement.dataset.sentido = profundidad < profundidadActual ? "atras" : "adelante";
  profundidadActual = profundidad;
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    mostrarVista();
    return;
  }
  document.startViewTransition(mostrarVista);
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

// Los lotes después del primero: renglones de libreta.
function filaDeLote({ lote, resultado }) {
  const enlace = crear("a", "renglon");
  enlace.href = `#detalle/${lote.id_lote}`;
  if (lote.id_lote === idResaltado) enlace.classList.add("resaltado");

  const producto = crear("span", "renglon-producto num", `${lote.producto} · ${formatoKg(lote.cantidad_kg)}`);
  agregarEtiquetaDemo(producto, lote);
  enlace.append(producto, etiquetaNivel(resultado), crear("span", "renglon-motivo", motivoCorto(lote, resultado)));

  const item = crear("li");
  item.append(enlace);
  return item;
}

// El lote que conviene revisar primero: una tarjeta de acción. Si le falta un dato, la
// tarjeta pide ese dato en lugar de sugerir una revisión.
function tarjetaPrincipal({ lote, resultado }) {
  const porConfirmar = resultado.puntaje === null;
  const tarjeta = crear("a", "tarjeta");
  tarjeta.href = `#detalle/${lote.id_lote}`;
  if (lote.id_lote === idResaltado) tarjeta.classList.add("resaltado");

  const franja = crear("span", `nivel franja ${claseNivel(resultado.nivel)}`);
  const nivel = crear("span", "franja-nivel");
  nivel.append(crearMarca(), porConfirmar ? POR_CONFIRMAR : resultado.nivel);
  franja.append(nivel);
  if (!porConfirmar) {
    const puntaje = crear("span", "franja-puntaje", resultado.puntaje.toFixed(1));
    puntaje.setAttribute("aria-label", `puntaje ${resultado.puntaje.toFixed(1)}`);
    franja.append(puntaje);
  }

  const cantidad = crear("span", "tarjeta-cantidad num", formatoKg(lote.cantidad_kg));
  agregarEtiquetaDemo(cantidad, lote);
  const accion = crear("span", "tarjeta-accion", porConfirmar ? "Escribir la fecha" : "Ver por qué");
  accion.append(icono("seguir"));
  const pie = crear("span", "tarjeta-pie");
  pie.append(cantidad, accion);

  const cuerpo = crear("span", "tarjeta-cuerpo");
  cuerpo.append(crear("span", "tarjeta-producto", lote.producto),
    crear("span", "tarjeta-motivo", motivoCorto(lote, resultado)), pie);
  tarjeta.append(franja, cuerpo);
  return tarjeta;
}

function mostrarLista() {
  // Se recalcula cada vez que se abre, con la fecha actual del dispositivo.
  const hoy = new Date();
  const filas = estado.lotes
    .map((lote) => ({ lote, resultado: calcularPrioridad(lote, config, hoy) }))
    .sort(ordenarPorPrioridad);

  const [primero, ...resto] = filas;
  $("lista-primero").hidden = !primero;
  $("lista-resto").hidden = resto.length === 0;
  $("lista-vacia").hidden = filas.length > 0;
  $("lista-aviso-demo").hidden = !estado.lotes.some((l) => l.origen === "DEMO");
  $("titulo-primero").textContent = primero?.resultado.puntaje === null ? "Falta un dato" : "Revisa primero";
  $("tarjeta-primero").replaceChildren(...(primero ? [tarjetaPrincipal(primero)] : []));
  $("lista-lotes").replaceChildren(...resto.map(filaDeLote));

  if (idResaltado) {
    idResaltado = null;
    const vista = $("vista-lista");
    setTimeout(() => vista.querySelector(".resaltado")?.classList.remove("resaltado"), 1500);
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

// Escala fija de la cascada. Es solo de dibujo, no de la regla: así las líneas de 20 y 40
// quedan en el mismo lugar en todos los lotes. Lo que pasa de 60 se corta con una punta.
const ESCALA_MAXIMA = 60;
const porcentaje = (valor) => `${(Math.min(Math.max(valor, 0), ESCALA_MAXIMA) / ESCALA_MAXIMA) * 100}%`;

// Un renglón de la cascada: su barra empieza donde terminó la del renglón anterior.
function factorDesglose(concepto, explicacion, valor, inicio, clase = "") {
  const item = crear("li", `factor ${clase}`);
  if (inicio + valor > ESCALA_MAXIMA) item.classList.add("desborda");

  const cabeza = crear("span", "factor-cabeza");
  cabeza.append(crear("span", "", concepto), crear("span", "num numero-total", valor.toFixed(1)));

  const pista = crear("span", "pista");
  pista.setAttribute("aria-hidden", "true");
  const barra = crear("span", "barra");
  barra.style.setProperty("--inicio", porcentaje(inicio));
  barra.style.setProperty("--ancho", `calc(${porcentaje(inicio + valor)} - ${porcentaje(inicio)})`);
  pista.append(barra);

  item.append(cabeza, pista);
  if (explicacion) item.append(crear("span", "factor-explicacion", explicacion));
  return item;
}

function factoresDesglose(lote, r) {
  const generica = r.vida_util_generica ? " (genérica)" : "";
  const { antiguedad, recepcion, ambiente } = r.desglose;
  const total = factorDesglose("Puntaje", "", r.puntaje, 0, `factor-total total-${r.nivel.toLowerCase()}`);
  total.querySelector(".factor-cabeza").append(etiquetaNivel(r, false));
  const factores = [
    factorDesglose("Antigüedad", `${r.dias} de ${r.vida_util_dias} días de vida útil de referencia${generica}`,
      antiguedad, 0),
    factorDesglose("Recepción", `Condición ${lote.condicion_recepcion.toLowerCase()}`, recepcion, antiguedad),
    factorDesglose("Ambiente", lote.condicion_ambiental, ambiente, antiguedad + recepcion),
  ];
  // El que más pesa se dice con texto (si hay empate, se marcan los dos).
  const valores = [antiguedad, recepcion, ambiente];
  const mayor = Math.max(...valores);
  valores.forEach((valor, i) => {
    if (valor !== mayor || mayor === 0) return;
    factores[i].classList.add("factor-mayor");
    factores[i].querySelector(".factor-cabeza > span").append(crear("span", "pesa-mas", "pesa más"));
  });
  return [...factores, total];
}

// Marcas de la escala: 0, los dos umbrales de config.json y 60.
function pintarEscala() {
  const { umbral_media: media, umbral_alta: alta } = config.regla;
  const desglose = $("detalle-desglose");
  desglose.style.setProperty("--umbral-media", porcentaje(media));
  desglose.style.setProperty("--umbral-alta", porcentaje(alta));
  const marcas = [[0, "0"], [media, `${media} Media`], [alta, `${alta} Alta`], [ESCALA_MAXIMA, String(ESCALA_MAXIMA)]];
  desglose.querySelector(".escala").replaceChildren(...marcas.map(([valor, texto]) => {
    const marca = crear("span", "num", texto);
    marca.style.left = porcentaje(valor);
    return marca;
  }));
}

// Nivel en grande: "Prioridad Alta" con su marca y, a la derecha, el puntaje.
function pintarNivel(resultado) {
  const nivel = $("detalle-nivel");
  nivel.className = `nivel franja ${claseNivel(resultado.nivel)}`;
  const titulo = crear("span", "nivel-titulo");
  const nombre = crear("strong");
  nombre.append(crearMarca(), resultado.puntaje === null ? "por confirmar" : resultado.nivel);
  titulo.append(crear("small", "", "Prioridad "), nombre);
  nivel.replaceChildren(titulo);
  if (resultado.puntaje !== null) {
    const puntaje = crear("span", "bloque-puntaje num");
    puntaje.append(crear("strong", "", resultado.puntaje.toFixed(1)), crear("small", "", " puntos"));
    nivel.append(puntaje);
  }
}

function pintarDetalle(lote) {
  const resultado = calcularPrioridad(lote, config, new Date());

  $("detalle-producto").textContent = lote.producto;
  const datos = $("detalle-datos");
  datos.textContent = `${lote.id_lote} · ${formatoKg(lote.cantidad_kg)} · ` +
    (lote.fecha_ingreso ? `ingresó el ${formatoFecha(lote.fecha_ingreso)}` : "sin fecha de ingreso");
  agregarEtiquetaDemo(datos, lote);

  pintarNivel(resultado);

  $("detalle-generico").hidden = !resultado.vida_util_generica;
  $("detalle-generico").textContent = avisoProductoGenerico(config);

  // ER-01: sin fecha no se calcula la antigüedad; se pide el dato aquí mismo.
  const formularioFecha = $("form-fecha");
  formularioFecha.hidden = Boolean(lote.fecha_ingreso);
  formularioFecha.reset();
  $("fecha-detalle").max = almacen.fechaLocal(new Date());
  mostrarErrores(formularioFecha, {});

  const desglose = $("detalle-desglose");
  desglose.hidden = resultado.puntaje === null;
  if (resultado.puntaje !== null) {
    pintarEscala();
    desglose.querySelector(".cascada").replaceChildren(...factoresDesglose(lote, resultado));
  }

  const actual = $("detalle-decision-actual");
  actual.hidden = !lote.decision;
  actual.textContent = lote.decision
    ? `Decisión registrada: ${lote.decision} (${formatoFechaHora(lote.fecha_decision)})`
    : "";

  // Sin puntaje no hay prioridad sobre la cual decidir: primero se pide el dato que falta.
  $("detalle-boton-decision").href = `#decision/${lote.id_lote}`;
  $("detalle-boton-decision").hidden = resultado.puntaje === null;
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
  decisionRecienGuardada = decision;
  ir("#historial");
}

// ---------- Vista 5. Historial ----------

function entradaDeHistorial(evento) {
  const lote = estado.lotes.find((l) => l.id_lote === evento.id_lote);
  if (!lote) return null;

  const item = crear("li", "historial-entrada");
  // El código del lote no se parte en el guion ("L-" arriba y "001" abajo).
  const codigo = crear("span", "sin-cortes", lote.id_lote);
  const texto = crear("span", "historial-texto num");
  if (evento.evento === "lote_registrado") {
    texto.append("Lote registrado: ", codigo, ` · ${lote.producto} · ${formatoKg(lote.cantidad_kg)}`);
  } else {
    texto.append(`Decisión: ${evento.decision} · `, codigo, ` · ${lote.producto}`);
  }
  agregarEtiquetaDemo(texto, lote);
  // La observación pertenece a la decisión vigente del lote.
  if (evento.fecha_hora === lote.fecha_decision && lote.observacion) {
    texto.append(crear("span", "historial-observacion", `“${lote.observacion}”`));
  }
  const hora = new Date(evento.fecha_hora).toLocaleTimeString("es-MX", { timeStyle: "short" });
  item.append(crear("span", "historial-hora num", hora), texto);
  return item;
}

// Encabezado de cada día, como en una libreta: "miércoles, 25 de noviembre de 2026".
const diaDeEvento = (evento) => new Date(evento.fecha_hora)
  .toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// Al llegar desde la decisión: aviso breve sobre la barra de abajo y el renglón resaltado.
function confirmarDecision(decision) {
  const aviso = $("confirmacion-decision");
  aviso.style.setProperty("--sobre-barra", `${$("barra-historial").offsetHeight + 12}px`);
  aviso.replaceChildren(icono("palomita"), `Decisión guardada: ${decision}`);
  const entrada = $("lista-historial").querySelector(".historial-entrada");
  entrada?.classList.add("resaltado");
  setTimeout(() => {
    aviso.replaceChildren();
    entrada?.classList.remove("resaltado");
  }, 2500);
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
  const entradas = [];
  let diaAnterior = null;
  for (const evento of estado.eventos
    .filter((e) => e.evento === "lote_registrado" || e.evento === "decision_guardada")
    .reverse()) {
    const entrada = entradaDeHistorial(evento);
    if (!entrada) continue;
    const dia = diaDeEvento(evento);
    if (dia !== diaAnterior) entradas.push(crear("li", "historial-dia", dia));
    diaAnterior = dia;
    entradas.push(entrada);
  }
  $("lista-historial").replaceChildren(...entradas);
  $("historial-vacio").hidden = entradas.length > 0;
  $("confirmacion-decision").replaceChildren();
  if (decisionRecienGuardada) {
    // Se mide la barra cuando la vista ya está a la vista.
    const decision = decisionRecienGuardada;
    requestAnimationFrame(() => confirmarDecision(decision));
    decisionRecienGuardada = null;
  }
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
