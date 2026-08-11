# Compas Marine

PWA en React + Vite para revisar documentos, capacitaciones, firmas pendientes y notificaciones de vencimiento.

## Desarrollo

```bash
npm install
npm run dev
```

La app usa `/api` como base por defecto. En desarrollo, Vite proxya esas llamadas según `VITE_DEV_API_PROXY_TARGET` en `vite.config.js`.

## Servidor

```bash
npm run dev:api
```

La sesión permanece iniciada al recargar o volver a abrir la aplicación durante 30 días por defecto. Se puede cambiar con `SESSION_MAX_AGE_SECONDS` y se elimina al cerrar sesión.

Variables importantes:

```env
CONTROLDOC_BASE_URL=
CONTROLDOC_USER_EMAIL=
CONTROLDOC_USER_TOKEN=
CONTROLDOC_CUSTOMER_ID=
CONTROLDOC_DEFAULT_ENTITY_TYPE_ID=
```

## PWA y Notificaciones

Genera llaves VAPID con:

```bash
npm run vapid:keys
```

Luego configura:

```env
VAPID_SUBJECT=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

## Correos automáticos con Resend

El backend usa el SDK oficial de Resend. Configura la API key en el entorno del servidor:

```env
# Reemplaza re_xxxxxxxxx por tu clave real de Resend.
RESEND_API_KEY=re_xxxxxxxxx
```

El remitente está fijado en el backend como `noreply@compasmarinenotificaciones.com`, correspondiente al dominio verificado en Resend.

El estado del scheduler se puede comprobar en `GET /api/health`, dentro de la propiedad `email`. La respuesta indica si Resend está configurado, si el scheduler arrancó y el resultado de su última revisión, sin exponer la API key. Un administrador también puede forzar una revisión inmediata mediante `POST /api/admin/notifications/email-run`.

Los correos automáticos se envían únicamente a usuarios activos registrados en MySQL con rol `12` (pruebas cerradas). Como parche temporal, cada usuario recibe como máximo dos correos-resumen por revisión: uno con todos sus documentos de la categoría de 60 días y otro con todos los de la categoría de 30 días. Los avisos de 1 día no se envían por correo en este flujo. Cada documento y umbral enviado se registra en `email_notification_events` y no vuelve a enviarse para ese mismo registro.

Las notificaciones push mantienen sus propios intervalos: 60 días cada 5 días, 30 días cada día y 1 día o menos cada 6 horas.

Al entrar un usuario compatible, la aplicación intenta solicitar el permiso y registrar automáticamente el dispositivo. Si el navegador bloquea o no completa la activación, la vista Notificaciones muestra el botón `Activar notificaciones`; sólo cuando existe una suscripción activa muestra `Probar push`. Los avisos entregados se respaldan en `push_notification_history` con su contenido y fecha para mostrarlos en esa vista. Al cerrar sesión, la suscripción del dispositivo se elimina para no mezclar avisos entre usuarios.

El endpoint de prueba push está apagado por defecto:

```env
ENABLE_PUSH_TEST_ENDPOINT=false
```

## Verificación

```bash
npm run lint
npm run build
```
