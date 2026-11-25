# PMV 0.1 — Priorización de revisión para fruterías

Aplicación web progresiva que le indica a un comerciante de frutas y verduras **qué lote
conviene revisar primero**, antes de que el deterioro sea visible.

La aplicación no diagnostica el estado sanitario del producto, no sustituye la inspección
física y no garantiza reducción de merma. Una prioridad alta significa que conviene revisar,
no que el producto esté dañado: la inspección y la decisión final son siempre del comerciante.

Está pensada para usarse en el teléfono del propio negocio, de pie y con una mano, durante un
piloto de 7 días con 5 establecimientos de Huejutla de Reyes.

## Características

- Una sola página estática (HTML, CSS y JavaScript estándar), sin framework ni compilación.
- Sin servidor, sin cuentas y sin datos personales: todo se guarda en el `localStorage` del
  dispositivo y la aplicación no hace peticiones de red después de la carga inicial.
- Funciona sin conexión gracias a un service worker, y se puede instalar en el teléfono.
- El historial se exporta a CSV (UTF-8 con BOM) para que el equipo lo consolide.

## Cómo se recorre la aplicación

1. **Prioridades de revisión** (inicio). Lista de lotes ordenada de mayor a menor puntaje,
   con su nivel (Alta, Media o Baja), un color y una línea corta con el motivo.
2. **Registrar lote**. Seis campos: producto, cantidad en kilos, fecha de ingreso, condición
   de recepción, condición ambiental y costo aproximado (opcional).
3. **Detalle y motivo**. El nivel en grande y el desglose del puntaje, renglón por renglón.
4. **Decisión**. Priorizar salida, mantener en venta, separar o descartar aviso, con una
   observación opcional de hasta 140 caracteres.
5. **Historial**. Lotes y decisiones con fecha y hora, y el botón para exportar a CSV.

La pantalla de **Información** muestra la versión, la fecha de publicación y la parte del
servicio que hace el equipo a mano. Desde ahí se cargan los datos de demostración (cinco
lotes ficticios, marcados como DEMO) o se borran todos los datos del dispositivo.

## Regla de prioridad

```
P = 50 × (días desde el ingreso ÷ vida útil de referencia del producto)
    + ajuste de recepción (Óptima 0, Normal 5, Con humedad o golpe 20)
    + ajuste ambiental   (Normal 0, Calor o humedad elevada 20)
```

| Nivel | Condición |
|---|---|
| Alta | P ≥ 40 |
| Media | 20 ≤ P < 40 |
| Baja | P < 20 |

Todos los valores, incluida la vida útil de cada producto, están en `datos/config.json`.
El nivel se decide con el puntaje redondeado a un decimal, el mismo que se ve en pantalla.

Un lote sin fecha de ingreso **no** recibe prioridad Baja: se muestra como
«Prioridad por confirmar» y la aplicación pide el dato.

## Cómo abrirla en tu computadora

La aplicación **no funciona con doble clic** sobre `index.html`: al arrancar lee
`datos/config.json`, y el navegador bloquea esa lectura en archivos abiertos desde el disco.
Hay que servirla con un servidor local desde la raíz del proyecto:

```sh
python3 -m http.server
```

- Aplicación: <http://localhost:8000>
- Pruebas: <http://localhost:8000/pruebas.html>

`pruebas.html` corre en el navegador los casos de verificación de la regla, del
almacenamiento y de la exportación, y muestra una tabla de «Pasó» o «Falló». No forma parte
de la aplicación ni se publica.

## Estructura

```
index.html          página única con todas las vistas
css/estilos.css
js/app.js           arranque, navegación y vistas
js/prioridad.js     la regla de cálculo, en funciones puras
js/almacen.js       lectura y escritura en localStorage, y eventos de uso
js/exportar.js      generación del CSV
datos/config.json   parámetros de la regla, decisiones y textos obligatorios
datos/demo.json     cinco lotes ficticios
manifest.json       datos para instalar la aplicación
sw.js               service worker para el uso sin conexión
iconos/
pruebas.html        página de pruebas
```

## Códigos de caso que aparecen en el código

| Código | Caso |
|---|---|
| ER-01 | Falta la fecha de ingreso: «Prioridad por confirmar» y se pide el dato |
| ER-02 | Fecha de ingreso posterior a hoy: se rechaza y no se guarda |
| ER-03 | Cantidad cero o negativa: se rechaza y no se guarda |
| ER-04 | El navegador bloquea el almacenamiento: aviso permanente y la app sigue en memoria |
| ER-05 | Sin conexión: funciona con normalidad |
| ER-06 | Exportación interrumpida: se puede repetir sin perder registros |
| RP-01 a RP-05 | Los cinco lotes de verificación: 46.4 Alta, 30.0 Media, 6.7 Baja, 41.7 Alta y 12.5 Baja |
| RP-06 | Producto «Otro»: usa una vida útil genérica y lo declara en pantalla |

## Publicación

Se publica como sitio estático en Vercel. `vercel.json` y `.vercelignore` dejan fuera todo lo
que no es la aplicación, incluida `pruebas.html`.

Al publicar cualquier cambio, incluido `datos/config.json`, hay que cambiar la constante
`CACHE` de `sw.js`; si no, los teléfonos siguen usando los archivos que ya guardaron.

## Autores

- Irving Aldahir Angeles Romero
- Ivan Francisco Ramírez

Grupo A, bina 06. Materia Integradora, UTHH.
