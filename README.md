# Mapa de Primer Nivel IMO, IMB y CSA

Aplicación web para consultar y localizar unidades de primer nivel por CLUES, nombre e institución.

## Desarrollo

```bash
npm install
npm run dev
```

## Compilación

```bash
npm run build
```

## Cartografia OpenStreetMap

El visor cubre Mexico con teselas vectoriales de OpenFreeMap (datos de
OpenStreetMap). No requiere claves API ni servicios de pago; necesita conexion
a Internet para cargar la cartografia. Se conservan las etiquetas de lugares,
negocios, edificios y carreteras disponibles en los datos.

`npm run prepare:map` genera contornos web simplificados sin modificar el archivo
original. Se ejecuta automaticamente antes de iniciar y compilar. El motor Three.js
se descarga solamente al entrar a una vista urbana, no durante la vista nacional.

Desde zoom 15, Three.js genera edificios y carreteras de la zona visible.
Las alturas usan `height` o `render_height` de las teselas; estas ultimas pueden
incluir estimaciones del proveedor. Si faltan, se estiman con los niveles
(3 metros por nivel) o 8 metros como valor de respaldo. Las anchuras de
carreteras son aproximadas. No se inventan nombres ni edificios ausentes.

El visor permite elegir solo dos modos de vista: 0 grados y 60 grados. La vista
inicial es de 0 grados y no hay controles de inclinacion libre, descarga,
actualizacion manual ni regreso a la vista nacional.

El generador interno conserva la capacidad de exportar GLB mediante
`OsmSceneController.exportGlb()`, sin boton en el visor. La geometria esta en
metros, con eje Z vertical y metadatos de centro, limites y atribucion OSM/ODbL.
Incluye edificios y carreteras recortados a la vista, no etiquetas, terreno,
unidades sanitarias ni todo el pais en un solo archivo. La cobertura depende
de lo que exista en OpenStreetMap.