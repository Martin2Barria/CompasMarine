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

Para enviar resúmenes por correo usando Gmail, configura una contraseña de aplicación de Google y agrega:

```env
GMAIL_USER=tu-correo@gmail.com
GMAIL_APP_PASSWORD=tu-app-password
SMTP_FROM_NAME=Compas Marine
```

También puedes usar un SMTP compatible:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=tu-correo@gmail.com
SMTP_PASS=tu-app-password
SMTP_FROM=tu-correo@gmail.com
SMTP_FROM_NAME=Compas Marine
```

El endpoint de prueba push está apagado por defecto:

```env
ENABLE_PUSH_TEST_ENDPOINT=false
```

## Verificación

```bash
npm run lint
npm run build
```
