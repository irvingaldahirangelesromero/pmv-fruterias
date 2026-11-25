// Service worker: la primera vez guarda todos los archivos de la app en el teléfono y
// después los sirve desde ahí. Así funciona sin conexión (ER-05) y no hace peticiones de red.
//
// IMPORTANTE: al publicar cualquier cambio (incluido datos/config.json), cambia CACHE.
// Si no cambia, los teléfonos siguen usando los archivos viejos que ya guardaron.
const CACHE = "pmv-fruterias-0.1-publicacion-2026-11-25-rediseno";

const ARCHIVOS = [
  "./",
  "index.html",
  "css/estilos.css",
  "js/app.js",
  "js/prioridad.js",
  "js/almacen.js",
  "js/exportar.js",
  "datos/config.json",
  "datos/demo.json",
  "manifest.json",
  "iconos/icono.svg",
  "iconos/icono-192.png",
  "iconos/icono-512.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)));
  self.skipWaiting();
});

// Borra las copias de versiones anteriores.
self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Primero la copia guardada; solo si no está, la red.
self.addEventListener("fetch", (evento) => {
  if (evento.request.method !== "GET") return;
  evento.respondWith(
    caches.match(evento.request, { ignoreSearch: true }).then((guardado) => guardado ?? fetch(evento.request)),
  );
});
