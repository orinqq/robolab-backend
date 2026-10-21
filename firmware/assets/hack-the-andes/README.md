# Agradecimiento a Hack the Andes

Material del [kit de marca del evento](https://hacktheandes.com/brand) y de las
capturas proporcionadas por el equipo, adaptado el 21 de octubre de 2026 para la
presentación OLED de RoboLab:

- `hack-the-andes.png`: captura de la marca en mayúsculas proporcionada por el equipo
  (cabecera de https://hacktheandes.com/), conservada tal como se recibió.
- `peru-tech-week.png`: https://hacktheandes.com/sponsors/peru-tech-week-white.png (aliado)
- `chofex.png`: https://hacktheandes.com/sponsors/chofex-white.png (sponsor principal)
- `crafter-station.png`: https://hacktheandes.com/sponsors/crafter-station-white.png (organiza)

Las marcas pertenecen a sus titulares. Se conserva el aspecto original y se
adapta únicamente el tamaño y el color a la OLED monocroma de 128×64.

Para regenerar `EventLogos.h`, los PBM y la vista previa: con Python y Pillow >=10.1
instalados, ejecutar `python3 scripts/generate-oled-logos.py`, seguido de
`npm run firmware:bundle`. Los PBM permiten inspeccionar los píxeles reales.

La presentación empieza cuando se confirma `HELLO`, muestra cada logo durante
tres segundos con una entrada progresiva. Después aparece «Antochela, come tu
comida» en tres líneas durante tres segundos con su propia melodía de buzzer;
esta pantalla no agrega pulsos de ruedas. La presentación completa dura quince segundos.
`PING` no la reinicia. Las órdenes de movimiento, paradas, errores y cambios de emoción la cancelan;
los motores, paradas, sonidos, LED y animaciones de ojos conservan su prioridad.
Una nueva conexión vuelve a mostrarla. No se necesita cambiar la web.

Cada logo incluye una melodía de cuatro notas, destellos del LED sincronizados
y un pulso de rueda de 100 ms (izquierda y derecha alternadas). El pulso ocurre
1,5 segundos después de cada cambio de logo, a PWM 60/255 como máximo y sin
superar la velocidad de avance configurada. El robot puede desplazarse: grabar
en un suelo despejado o con las ruedas levantadas.

Los motores del saludo necesitan al menos una respuesta `PONG` en esa conexión
y latidos de menos de 1,5 segundos de antigüedad. Abrir el puerto o enviar solo
`HELLO` muestra los logos y reproduce el sonido, pero no mueve ruedas. Cualquier
orden activa del reto, parada o pérdida de conexión cancela el saludo y sus
efectos; los sonidos y luces normales vuelven al terminar.
