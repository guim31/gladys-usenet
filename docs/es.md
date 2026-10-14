# SABnzbd / NZBGet

Siga y controle sus descargas de Usenet desde Gladys: [SABnzbd](https://sabnzbd.org) y
[NZBGet](https://nzbget.com), los dos clientes de descarga que funcionan en la mayoría de los
servidores domésticos (Docker, Unraid, Synology, Proxmox…). La integración habla con la API local
del cliente: la velocidad, la cola y el tiempo restante aparecen en el panel, una escena puede
pausar las descargas durante una videollamada y limitar la velocidad por la noche, y Gladys puede
avisarle cuando una descarga ha terminado o ha fallado.

Probada con instalaciones reales de SABnzbd (4.2 y 5.1) y NZBGet (21 y 26), aún no en un Gladys
real: sus comentarios son bienvenidos en
[GitHub](https://github.com/guim31/gladys-usenet/issues).

## Requisitos

- Gladys 5.1.0 o posterior.
- SABnzbd 3 o posterior, o NZBGet 21 o posterior, accesible desde el servidor Gladys (misma red).
- Para SABnzbd: su **clave de API** (Config → General → Security → API Key). La clave NZB, justo
  debajo, no basta: solo sirve para añadir tareas.
- Para NZBGet: el **nombre de usuario y la contraseña de control** (Settings → Security →
  ControlUsername y ControlPassword, `nzbget` / `tegbzn6789` mientras no los cambie).

## Configuración

Hasta dos clientes, cada uno con:

- **Programa**: SABnzbd o NZBGet.
- **Dirección**: la dirección IP o el nombre, con el puerto: `192.168.1.10:8080` (SABnzbd) o
  `192.168.1.10:6789` (NZBGet). Sin puerto, se añade el puerto por defecto del programa. Escriba
  `https://` para HTTPS, y la ruta si el cliente está detrás de un proxy inverso
  (`https://nas.example.org/sabnzbd`).
- **Clave de API (SABnzbd)**, o **Nombre de usuario (NZBGet)** y **Contraseña (NZBGet)**.
- **Nombre**: el nombre del dispositivo en Gladys (vacío: el programa seguido de la dirección).
- **Velocidad de la línea (Mbit/s)**: su velocidad de descarga, necesaria para limitar la
  velocidad en porcentaje con NZBGet, y con SABnzbd cuando su «Maximum line speed» (Config →
  General) no está definido. 0: desconocida.

Opciones:

- **Aceptar certificados autofirmados**: para las direcciones `https://` con el certificado que
  genera SABnzbd. Márquelo solo para sus propios servidores.
- **Intervalo de actualización**: con qué frecuencia se leen los clientes, 30 segundos por
  defecto.
- **Idioma de los nombres de funciones**: los nombres de las funciones al añadir un dispositivo, y
  los textos de estado (francés por defecto).

El botón **Probar la conexión** lee cada cliente e indica lo que ha encontrado: versión, estado,
cola, errores recientes.

## Dispositivos

Un dispositivo por cliente, en la pestaña Descubrimiento. Sus funciones:

| Función                | Lo que muestra                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Descargas en pausa     | interruptor: encendido pausa las descargas hasta que lo apague, apagado las reanuda.          |
| Límite de velocidad    | control deslizante, la parte de la línea en %, 100 = sin límite. Moverlo limita la velocidad. |
| Velocidad de descarga  | en MB/s.                                                                                      |
| Tareas en la cola      | las tareas en espera o en curso (sin el posprocesado).                                        |
| Pendiente de descargar | en GB.                                                                                        |
| Tiempo restante        | en minutos a la velocidad actual, 0 cuando no se descarga nada.                               |
| Espacio libre en disco | en GB, de las carpetas de descarga (la menor entre la carpeta temporal y la final).           |
| Estado                 | Descargando, En pausa, Posprocesado, En espera, Inactivo o Inaccesible.                       |
| Última descarga        | el nombre de la última descarga completada.                                                   |
| Errores (24 h)         | los errores y avisos que el cliente ha indicado en las últimas 24 horas.                      |

Tamaños y velocidades están en unidades binarias, como las muestran los clientes (1 MB = 1024 ×
1024 bytes). Solo se envían a Gladys los cambios, y cada valor de nuevo tras 6 horas.

## Widget

El widget **Descargas Usenet** muestra la velocidad, la cola y el tiempo restante de todos los
clientes (o del elegido en su configuración), una línea por cliente (estado, fin de una pausa
temporizada, límite, espacio libre, última descarga, errores), y tres botones:

- **Pausa**: pausa las descargas hasta que las reanude;
- **Pausa 30 min**: las pausa durante 30 minutos;
- **Reanudar**: las reanuda.

La marca de verificación muestra el estado actual: en **Pausa** cuando todo está en pausa, en
**Reanudar** cuando todo se descarga.

## Disparadores de escena

- **Descarga completada**: una tarea ha terminado su descarga y posprocesado con éxito. Filtros:
  el cliente, la categoría (tal como está escrita en el cliente, `tv`, `Movies`…). Variables:
  nombre, categoría, tamaño en MB, nombre del cliente.
- **Descarga fallida**: una tarea ha fallado (artículos ausentes, reparación o extracción
  imposible). Mismos filtros; variables: nombre, categoría, motivo indicado por el cliente, nombre
  del cliente.

Cada tarea dispara una sola vez. Las tareas terminadas mientras la integración estaba detenida
(una actualización, un reinicio) disparan al reiniciarse, si tienen menos de una hora.

No hay disparador de «poco espacio en disco»: la función **Espacio libre en disco** es un valor,
y el disparador de dispositivo de Gladys ya lo compara con un umbral («Espacio libre en disco
inferior a 20 GB»).

## Acciones de escena

- **Pausar las descargas**: un cliente o todos, durante unos minutos (0: hasta reanudar). Salidas:
  número de clientes en pausa, duración.
- **Reanudar las descargas**: un cliente o todos.
- **Limitar la velocidad de descarga**: una parte de la línea en %, 100 para quitar el límite.
  Requiere la velocidad de la línea (ver Configuración).

## Ejemplos de escenas

- Videollamada: cuando empieza el evento de calendario «Reunión», **Pausar las descargas**
  durante 60 minutos.
- Noche: a las 19 h, **Limitar la velocidad de descarga** al 30 %; a las 23 h, vuelta al 100 %.
- Notificación: con **Descarga completada** y la categoría `tv`, enviar
  «{{triggerEvent.data.name}} está lista para ver» a la familia.
- Problema: con **Descarga fallida**, enviar el nombre y el motivo al administrador.
- Disco: cuando **Espacio libre en disco** baja de 20 GB, pausar y enviar un mensaje.

## Solución de problemas

- «no responde»: compruebe la dirección y el puerto, y que el servidor Gladys alcanza el cliente
  (cortafuegos, red Docker).
- «clave de API o contraseña rechazada»: corrija la clave o la contraseña y guarde. La
  integración no vuelve a intentarlo sola: cada clave rechazada añade un aviso en SABnzbd.
- «certificado rechazado»: marque «Aceptar certificados autofirmados», o use `http://`.
- «no hay SABnzbd ni NZBGet en esta dirección»: programa equivocado o puerto equivocado.
- «la dirección redirige»: introduzca la dirección `https://`.
- Un límite en % rechazado: indique la **Velocidad de la línea (Mbit/s)**, o defina «Maximum line
  speed» en SABnzbd.
- Más detalles: los registros de la integración, con `LOG_LEVEL=debug` para cada lectura.

## Limitaciones

- Cada actualización lee la cola: cada 30 segundos por defecto, unas pocas peticiones pequeñas.
  NZBGet envía todo su historial de una vez: solo se vuelve a leer cuando algo ha cambiado, como
  mucho cada 15 minutos en otro caso.
- NZBGet reanuda una pausa temporizada con hasta unos 25 segundos de retraso (comprueba su
  temporizador periódicamente).
- Sin gestión de tareas: la integración no añade, quita ni reordena descargas, y no borra nada.
- Los «Errores (24 h)» de NZBGet cuentan los mensajes desde que la integración lee su registro
  (los 100 últimos al arrancar).
- Sin relación con SABnzbd ni NZBGet.
