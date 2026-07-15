# Documentacion Tecnica y Arquitectura de Compas Marine

Esta documentacion describe el estado actual del proyecto Compas Marine segun el codigo existente en este repositorio.

## 1. Resumen de la Aplicacion

Compas Marine es una aplicacion web tipo SPA (React + Vite + Tailwind) con capacidades PWA y backend Node.js sobre servidor HTTP nativo. Su objetivo es:

- Consumir y filtrar datos de ControlDoc desde el backend.
- Persistir datos locales en MySQL para autenticacion, roles y cache operacional.
- Soportar uso offline principalmente mediante cache del navegador (Service Worker, LocalStorage e IndexedDB).
- Gestionar alertas push (VAPID) y envio de correos SMTP en escenarios controlados.

## 2. Arquitectura Real de Alto Nivel

```text
[ Cliente PWA: React + Vite + Tailwind ]
              |
           HTTP/HTTPS
              v
[ Backend Node.js (node:http, rutas manuales) ]
        |                        \
        | SQL                     \ HTTP
        v                         v
[ MySQL local/remoto ]      [ API ControlDoc ]
```

Puntos clave:

- El backend activo no usa Express como runtime principal.
- El entrypoint activo es server/index.js con createServer de node:http.
- El frontend consume rutas /api/* y el backend sirve dist en produccion.

## 3. Estructura del Proyecto

```text
CompasMarine/
└── CompasMarineS.A/
    ├── database/
    │   └── schema.sql
    ├── dist/
    ├── public/
    │   ├── manifest.webmanifest
    │   └── sw.js
    ├── server/
    │   ├── config/
    │   │   ├── db.js
    │   │   └── env.js
    │   ├── routes/
    │   │   ├── admin.routes.js
    │   │   ├── api.routes.js
    │   │   └── auth.routes.js
    │   ├── services/
    │   │   ├── auth.service.js
    │   │   ├── controldoc.service.js
    │   │   └── notifications.service.js
    │   ├── utils/
    │   ├── index.js
    │   └── users.json
    ├── src/
    │   ├── Components/
    │   ├── Views/
    │   ├── assets/
    │   ├── auth/
    │   ├── config/
    │   │   └── api.js
    │   ├── controldoc/
    │   ├── pwa/
    │   ├── storage/
    │   │   └── controlDocOffline.js
    │   ├── App.jsx
    │   ├── index.css
    │   └── main.jsx
    ├── EndPoints.js
    ├── eslint.config.js
    ├── index.html
    ├── package-lock.json
    ├── package.json
    ├── postcss.config.js
    ├── README.md
    ├── tailwind.config.js
    └── vite.config.js
```

Nota importante:

- Existen rutas modulares en server/routes, pero el flujo activo principal de API esta definido directamente en server/index.js.

## 4. Backend y API

### 4.1 Runtime y enrutamiento

- Runtime: servidor HTTP nativo (node:http).
- Entry point: server/index.js.
- Rutas implementadas inline para auth, admin, ControlDoc y assets estaticos.

Endpoints relevantes observados:

- /api/health
- /api/auth/login
- /api/auth/logout
- /api/auth/verify-reset-identity
- /api/auth/reset-password
- /api/auth/me
- /api/admin/users
- /api/admin/users/role
- /api/admin/users/reset-password
- /api/admin/setup-db
- /api/admin/sync-users
- /api/controldoc/document-types
- /api/controldoc/entities
- /api/controldoc/documents
- /api/controldoc/documents/sync

### 4.2 Autenticacion

- No se utiliza JWT en el flujo principal actual.
- Se usa cookie de sesion HttpOnly (compas_user_id).
- Passwords con bcrypt.
- Recuperacion de contrasena con token temporal en memoria del proceso.

### 4.3 ControlDoc y cache de backend

- El backend consulta endpoints abstract de ControlDoc con paginacion.
- Mantiene cache en RAM para document-types, entities y documents.
- Aplica filtrado estricto por rol para usuarios no admin.
- Sincroniza entidades a MySQL con operaciones ON DUPLICATE KEY UPDATE.

## 5. Base de Datos (MySQL)

El esquema en database/schema.sql incluye:

- usuarios, roles, usuarios_roles
- entidades_api
- tipos_documento_api
- documentos_api
- respaldos_documentos
- push_subscriptions
- push_notification_events
- sync_logs

Aspectos relevantes:

- FK con ON DELETE CASCADE y ON DELETE RESTRICT donde corresponde.
- Campos JSON para metadatos flexibles.
- Tablas de push para suscripciones y cooldown de eventos.

## 6. PWA, Offline y Service Worker

### 6.1 Registro del Service Worker

- registerServiceWorker solo registra en modo produccion.
- SW en public/sw.js.

### 6.2 Estrategia offline real

- Cache del app shell en Service Worker.
- Navegacion con fallback a index.html.
- Snapshot de datos ControlDoc en cliente:
  - LocalStorage para copia liviana.
  - IndexedDB para copia grande.
- El snapshot elimina campos URL sensibles de descarga antes de persistir.

### 6.3 Alcance offline actual

- El offline real hoy es principalmente de datos y shell de aplicacion.
- No hay evidencia de un flujo activo consolidado de descarga fisica de archivos en server/storage como camino principal en el frontend actual.

## 7. Notificaciones y Correos

### 7.1 Push (VAPID)

- Flujo de suscripcion push implementado en frontend.
- Persistencia de suscripciones/eventos en MySQL y respaldo JSON.
- Reglas de alerta en backend y frontend con cooldown.

Umbrales observados en reglas actuales:

- Vencido
- Critico (<= 30 dias)
- Advertencia (<= 60 dias)
- Firma pendiente

### 7.2 Scheduler

- Existe logica de scheduler en notifications.service.js.
- El scheduler es invocable desde funciones exportadas.
- Debe ser activado explicitamente por el runtime para ejecutar periodicamente.

### 7.3 Correo SMTP

- Implementado con cliente SMTP sobre TLS (sin nodemailer).
- Variables soportadas: SMTP_* y fallback GMAIL_*.
- Endpoint de envio de alertas por correo con restricciones de rol.

## 8. Variables de Entorno

Variables habituales observadas en codigo:

```env
# Servidor
SERVER_PORT=8787
SERVER_HOST=0.0.0.0
NODE_ENV=production
APP_ALLOWED_ORIGINS=https://compasmarine-production.up.railway.app/

# MySQL
MYSQLHOST=127.0.0.1
MYSQLPORT=3306
MYSQLUSER=root
MYSQLPASSWORD=pedirla
MYSQLDATABASE=compas_marine_db

# ControlDoc
CONTROLDOC_BASE_URL=https://compliance.controldoc.legal
CONTROLDOC_USER_EMAIL=usuario@compasmarine.cl
CONTROLDOC_USER_TOKEN=token_seguro
CONTROLDOC_CUSTOMER_ID=id_cliente

# Push VAPID
VAPID_SUBJECT=mailto:soporte@compasmarine.cl
VAPID_PUBLIC_KEY=clave_publica
VAPID_PRIVATE_KEY=clave_privada

# SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=alertas@compasmarine.cl
SMTP_PASS=app_password
SMTP_FROM=alertas@compasmarine.cl
SMTP_FROM_NAME=Compas Marine Alertas
```

Nota:

- El servidor carga .env.server.local, .env.server, .env.local y .env.

## 9. Scripts NPM

Scripts actuales declarados:

- npm run dev: levanta Vite.
- npm run dev:api: ejecuta node server/index.js.
- npm run dev:local: levanta Vite con VITE_DEV_API_PROXY_TARGET.
- npm run build: construye frontend.
- npm run start: ejecuta backend.
- npm run vapid:keys: genera claves VAPID.

Observacion de compatibilidad:

- Existe prebuild con chmod +x node_modules/.bin/vite, lo cual puede fallar en Windows al ser comando Unix-only.

## 10. Estado de fidelidad de esta documentacion

Esta version fue ajustada para representar el comportamiento actual del repositorio y evitar supuestos que no estan activos en runtime.
