// Lectura y escritura en localStorage, y registro de eventos (docs/05-datos.md).
// Todo acceso a localStorage va en try/catch: el navegador puede bloquearlo (modo privado).
// Si falla, la app sigue funcionando en memoria y muestra el aviso de ER-04.

export const CLAVE = "pmv_fruterias_v1";

const dos = (n) => String(n).padStart(2, "0");

// Fecha y hora local con su desfase, por ejemplo "2026-11-25T14:30:05-06:00".
// Se guarda así para que el equipo lea en el CSV la hora real del negocio sin ambigüedad.
export function fechaHoraLocal(fecha) {
  const desfase = -fecha.getTimezoneOffset();
  const signo = desfase >= 0 ? "+" : "-";
  const minutos = Math.abs(desfase);
  return (
    `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}` +
    `T${dos(fecha.getHours())}:${dos(fecha.getMinutes())}:${dos(fecha.getSeconds())}` +
    `${signo}${dos(Math.floor(minutos / 60))}:${dos(minutos % 60)}`
  );
}

// Fecha local "AAAA-MM-DD", el formato de los campos de fecha.
export function fechaLocal(fecha) {
  return fechaHoraLocal(fecha).slice(0, 10);
}

export function estadoVacio(config) {
  return {
    version: config.version_app,
    establecimiento: config.establecimiento,
    lotes: [],
    eventos: [],
  };
}

// Devuelve { estado, ok }. Con ok = false no se pudo leer: la app debe trabajar en memoria
// y no volver a escribir, para no sobrescribir datos que quizá todavía se puedan recuperar.
export function leer(config) {
  try {
    const texto = localStorage.getItem(CLAVE);
    if (texto === null) return { estado: estadoVacio(config), ok: true };
    const estado = JSON.parse(texto);
    if (!Array.isArray(estado.lotes) || !Array.isArray(estado.eventos)) {
      return { estado: estadoVacio(config), ok: false };
    }
    return { estado, ok: true };
  } catch {
    return { estado: estadoVacio(config), ok: false };
  }
}

// Devuelve true si se guardó.
export function escribir(estado) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
    return true;
  } catch {
    return false;
  }
}

// Borra todos los datos de este dispositivo. Devuelve true si se pudo.
export function borrar() {
  try {
    localStorage.removeItem(CLAVE);
    return true;
  } catch {
    return false;
  }
}

// Agrega uno de los cuatro eventos de docs/05-datos.md. Devuelve su fecha y hora.
export function registrarEvento(estado, evento, extra, config, ahora) {
  const fecha_hora = fechaHoraLocal(ahora);
  estado.eventos.push({
    evento,
    version_app: config.version_app,
    establecimiento: config.establecimiento,
    fecha_hora,
    ...extra,
  });
  return fecha_hora;
}

// Correlativo local: L-001, L-002… Sigue al número más alto, aunque haya huecos.
export function siguienteIdLote(lotes) {
  const mayor = Math.max(0, ...lotes.map((l) => Number(l.id_lote.slice(2)) || 0));
  return `L-${String(mayor + 1).padStart(3, "0")}`;
}

// `datos` trae los seis campos capturados y `origen`: "REAL" desde el formulario,
// "DEMO" desde datos/demo.json.
export function agregarLote(estado, datos, config, ahora) {
  const lote = {
    id_lote: siguienteIdLote(estado.lotes),
    producto: datos.producto,
    cantidad_kg: datos.cantidad_kg,
    fecha_ingreso: datos.fecha_ingreso,
    condicion_recepcion: datos.condicion_recepcion,
    condicion_ambiental: datos.condicion_ambiental,
    costo_aproximado: datos.costo_aproximado ?? null,
    decision: null,
    observacion: null,
    fecha_decision: null,
    origen: datos.origen,
  };
  estado.lotes.push(lote);
  registrarEvento(estado, "lote_registrado", { id_lote: lote.id_lote, origen: lote.origen }, config, ahora);
  return lote;
}

// La fecha de la decisión es la misma del evento, para poder enlazarlos en el historial.
export function guardarDecision(estado, lote, decision, observacion, config, ahora) {
  lote.fecha_decision = registrarEvento(
    estado, "decision_guardada", { id_lote: lote.id_lote, decision }, config, ahora,
  );
  lote.decision = decision;
  lote.observacion = observacion || null;
}

// Convierte los lotes de datos/demo.json en datos de captura con fecha real:
// la fecha de ingreso se calcula hacia atrás desde hoy, así los puntajes coinciden
// siempre con la tabla de docs/04-reglas.md.
export function prepararDemo(demo, hoy) {
  return demo.lotes.map(({ dias_desde_ingreso, ...datos }) => {
    const ingreso = new Date(hoy);
    ingreso.setDate(ingreso.getDate() - dias_desde_ingreso);
    return { ...datos, fecha_ingreso: fechaLocal(ingreso) };
  });
}
