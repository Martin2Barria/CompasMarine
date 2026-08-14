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

La sesión permanece iniciada al recargar o volver a abrir la aplicación durante 30 días por defecto. Se puede cambiar con `SESSION_MAX_AGE_SECONDS` y se elimina al cerrar sesión. En producción, `SESSION_SECRET` es obligatorio y debe contener al menos 32 bytes aleatorios; por ejemplo, puede generarse con `openssl rand -base64 48`.

Las cookies emitidas antes de incorporar la firma HMAC ya no son válidas. Tras este despliegue, los usuarios deberán iniciar sesión nuevamente una vez.

Variables importantes:

```env
CONTROLDOC_BASE_URL=
CONTROLDOC_USER_EMAIL=
CONTROLDOC_USER_TOKEN=
CONTROLDOC_CUSTOMER_ID=
CONTROLDOC_DEFAULT_ENTITY_TYPE_ID=
SESSION_SECRET=
SESSION_MAX_AGE_SECONDS=2592000
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

El remitente está fijado en el backend como `Compas Marine Notificaciones <notificaciones@compasmarinenotificaciones.com>`, correspondiente al dominio verificado en Resend. La dirección se usa solo para enviar y no requiere un buzón asociado.

El estado del scheduler se puede comprobar en `GET /api/health`, dentro de la propiedad `email`. La respuesta indica si Resend está configurado, si el scheduler arrancó y el resultado de su última revisión, sin exponer la API key. Un administrador también puede forzar una revisión inmediata mediante `POST /api/admin/notifications/email-run`.

Los correos automáticos se envían únicamente a usuarios activos registrados en MySQL con rol `12` (pruebas cerradas). Como parche temporal, cada usuario recibe como máximo tres correos-resumen por revisión: uno con todos sus documentos de la categoría de 60 días, otro con los de 30 días y otro con los documentos ya vencidos. Los avisos de 1 día no se envían por correo en este flujo. Cada documento y umbral enviado se registra en `email_notification_events` y no vuelve a enviarse para ese mismo registro.

Las notificaciones push mantienen sus propios intervalos: 60 días cada 5 días, 30 días cada día y 1 día o menos cada 6 horas.

Al entrar un usuario compatible, la aplicación intenta solicitar el permiso y registrar automáticamente el dispositivo. Si el navegador exige una interacción manual, se muestra un aviso de activación dentro de la app. El permiso y la suscripción permanecen activos en ese dispositivo mientras el usuario no los revoque desde el navegador o el sistema operativo. La vista Notificaciones mantiene dos botones separados: `Activar/Reactivar notificaciones`, que vuelve a crear y registrar la suscripción cuando sea necesario, y `Probar push`, habilitado cuando existe una suscripción activa. Cada ocurrencia entregada se respalda como una fila independiente en `push_notification_history`, con su contenido y fecha, para mostrarla en esa vista. Al cerrar sesión, la suscripción del dispositivo se elimina para no mezclar avisos entre usuarios.

El endpoint de prueba push está disponible para el botón `Probar push`. Exige una
sesión autenticada, aplica límite de solicitudes y solo envía a las suscripciones
registradas para el usuario de esa sesión.

## Verificación

```bash
npm test
npm run lint
npm run build
npm audit
```

El servidor y el build requieren Node.js `20.19+` o `22.12+`. Antes de iniciar el
scheduler en una base existente, el usuario MySQL debe poder crear tablas y agregar
las columnas nuevas de historial (`CREATE` y `ALTER`).
