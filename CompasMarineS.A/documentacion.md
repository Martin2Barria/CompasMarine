\# Documentación Técnica y Arquitectura de Compas Marine



Esta documentación detalla la arquitectura, el diseño de la base de datos y la estructura del proyecto \*\*Compas Marine\*\*, una aplicación web progresiva (PWA) de nivel empresarial diseñada para la revisión de documentos, capacitaciones, firmas pendientes y notificaciones automatizadas de vencimiento.



\---



\## 1. Resumen y Propósito de la Aplicación



\*\*Compas Marine\*\* es una solución Full-Stack modular que sirve como intermediario y visor local para el personal marítimo y operativo de la empresa. Su propósito principal es sincronizar metadatos y archivos desde una plataforma externa llamada \*\*ControlDoc API\*\*, almacenarlos localmente en una base de datos relacional robusta (MySQL), permitir su consulta eficiente y garantizar la \*\*disponibilidad offline\*\* y el envío de \*\*notificaciones push\*\* y por \*\*correo electrónico\*\* (SMTP/Gmail) antes de que los documentos expiren.



\---



\## 2. Arquitectura de Alto Nivel



La aplicación sigue un patrón de arquitectura \*\*Cliente-Servidor (SPA + API Gateway)\*\* con capacidades PWA (Progressive Web App):



```

&#x20;      \[ Cliente PWA: React + Vite + Tailwind ]

&#x20;                    │             ▲

&#x20;       HTTP/HTTPS   │             │ Notificaciones Push (Web-Push / VAPID)

&#x20;                    ▼             │

&#x20;   \[ Servidor API: Node.js + Express (Proxy / Sync Engine) ]

&#x20;           │                      │

&#x20;           │ Consultas SQL        │ Sincronización HTTP

&#x20;           ▼                      ▼

&#x20;   \[ BD MySQL Local ]     \[ API Externa: ControlDoc ]

```



\### Componentes Clave:

1\. \*\*Frontend PWA (React + Vite + Tailwind):\*\* Interfaz fluida, optimizada para móviles, con soporte para almacenamiento local y Service Workers que gestionan la caché y las notificaciones en segundo plano.

2\. \*\*Backend Gateway (Node.js + Express):\*\* Actúa como proxy seguro frente a la API de ControlDoc para evitar exponer tokens en el cliente, administra la base de datos MySQL, orquesta la lógica de sincronización periódica y gestiona el envío de correos y notificaciones push.

3\. \*\*Motor de Base de Datos (MySQL):\*\* Almacena copias locales de usuarios, credenciales hasheadas, roles de acceso, entidades de la API, tipos de documentos, metadatos y registro de archivos respaldados para visualización offline.

4\. \*\*Sistema de Notificaciones (Web Push \& SMTP):\*\* Implementa el estándar VAPID para notificaciones push push en tiempo real en dispositivos móviles y de escritorio, además de un servicio SMTP para correos resumen.



\---



\## 3. Estructura Detallada del Proyecto



La estructura de directorios se organiza de la siguiente manera dentro del repositorio:



```

CompasMarine/

├── CompasMarineS.A/                 # Carpeta raíz del proyecto principal

│   ├── database/                    # Scripts SQL y base de datos

│   │   └── schema.sql               # Esquema de tablas y relaciones MySQL

│   ├── dist/                        # Directorio de producción compilado (Vite)

│   ├── public/                      # Assets estáticos de la app (iconos, manifest.json)

│   ├── server/                      # Servidor backend (Node.js + Express)

│   │   ├── config/                  # Configuraciones del servidor

│   │   │   ├── db.js                # Inicialización del Pool de conexión MySQL

│   │   │   └── env.js               # Cargador dinámico de archivos .env

│   │   ├── routes/                  # Enrutadores de Express (Puntos de acceso)

│   │   │   ├── admin.routes.js      # Rutas para administración y logs de sincronización

│   │   │   ├── api.routes.js        # Rutas de proxy para documentos y entidades

│   │   │   └── auth.routes.js       # Rutas de login, registro y recuperación de contraseña

│   │   ├── services/                # Capa de lógica de negocio (Servicios)

│   │   │   ├── auth.service.js      # Control de sesiones, JWT y hashes de contraseñas

│   │   │   ├── controldoc.service.js# Comunicación y polling con la API de ControlDoc

│   │   │   └── notifications.service.js # Orquestador de alertas por Email y Push

│   │   ├── utils/                   # Helpers generales del servidor

│   │   ├── index.js                 # Punto de entrada principal del backend Express

│   │   └── users.json               # Semilla/Respaldo inicial de usuarios

│   ├── src/                         # Código fuente del Frontend (React + Vite)

│   │   ├── assets/                  # Estilos, imágenes y fuentes del cliente

│   │   ├── Components/              # Componentes React reutilizables

│   │   │   ├── BottomNav.jsx        # Barra de navegación móvil persistente

│   │   │   ├── Header.jsx           # Cabecera con perfiles y estados de conexión

│   │   │   ├── login.jsx            # Formulario de inicio de sesión con Tailwind

│   │   │   ├── olvidastePassword.jsx# Formulario de restauración con envío SMTP

│   │   │   ├── PwaInstallPrompt.jsx # Alerta para instalar la aplicación en el dispositivo

│   │   │   └── SyncProgressOverlay.jsx # Pantalla de carga para sincronización manual

│   │   ├── controldoc/              # Módulos cliente para formateo de datos

│   │   │   ├── api.js               # Endpoints locales de consumo frontend

│   │   │   └── fields.js            # Mapeadores de campos dinámicos de ControlDoc

│   │   ├── pwa/                     # Configuración de Progressive Web App

│   │   │   ├── notificationRules.js # Reglas lógicas y cooldowns de envío de notificaciones

│   │   │   ├── pushNotifications.js # Suscripción y registro Push Manager

│   │   │   └── registerServiceWorker.js # Inicializador de Service Workers

│   │   ├── Views/                   # Vistas principales de pantalla completa

│   │   │   ├── ApiDocumentCard.jsx  # Tarjeta renderizadora de cada documento/certificado

│   │   │   ├── ViewDocumentos.jsx   # Gestor de documentos sincronizados y filtros offline

│   │   │   ├── ViewInicio.jsx       # Panel de bienvenida con widgets y accesos rápidos

│   │   │   ├── ViewNotificaciones.jsx # Centro de alertas, suscripción push y logs

│   │   │   └── ViewPanelAdmin.jsx   # Tablero de control de sincronización y logs para administradores

│   │   ├── App.jsx                  # Enrutador cliente y gestor de estado global

│   │   ├── index.css                # Estilos globales y Tailwind CSS

│   │   └── main.jsx                 # Punto de entrada de renderizado React

│   ├── EndPoints.js                 # Script de pruebas para verificar disponibilidad de la API

│   ├── eslint.config.js             # Configuración de formateo de código ESLint

│   ├── package.json                 # Manifesto de dependencias de Node.js y NPM

│   ├── postcss.config.js            # Preprocesamiento de CSS

│   ├── tailwind.config.js           # Personalización y variables de Tailwind v3

│   └── vite.config.js               # Configuración de empaquetado Vite con proxy dev integrado

└── node\_modules/                    # Dependencias externas del entorno (omitida del despliegue)

```



\---



\## 4. Diseño y Esquema de Base de Datos



La base de datos MySQL relacional almacena en caché la información crítica para asegurar que las llamadas sean rápidas y puedan ser descargadas de forma offline. 



A continuación se detalla el modelo de datos implementado en `database/schema.sql`:



\### Tablas e Interacciones:



\#### A. Usuarios y Roles (`usuarios`, `roles`, `usuarios\_roles`)

Soporta un sistema de control de acceso basado en roles (RBAC).

\- `usuarios`: Almacena el correo electrónico, nombre, estado (activo/inactivo) y `password\_hash` (encriptado con Bcrypt).

\- `roles`: Registra los privilegios de usuario (por ejemplo, `ADMIN`, `OPERADOR`).

\- `usuarios\_roles`: Tabla intermedia de muchos-a-muchos con restricciones de integridad referencial `ON DELETE CASCADE` para usuarios y `ON DELETE RESTRICT` para roles.



\#### B. Caché de API Externa (`entidades\_api`, `tipos\_documento\_api`, `documentos\_api`)

Mapea la información extraída de ControlDoc para evitar consultar la API en cada interacción del cliente.

\- `entidades\_api`: Copia local de los datos personales (RUT, email, teléfono, sexo) de tripulantes y contratistas obtenidos desde el servicio externo. Utiliza una columna de tipo `JSON` (`data\_json`) para almacenar metadatos flexibles sin alterar la estructura fija.

\- `tipos\_documento\_api`: Tipos de certificados existentes en el sistema (por ejemplo, "Curso de Supervivencia en el Mar").

\- `documentos\_api`: Metadatos de certificados específicos asociados a un usuario. Almacena fechas clave (`fecha\_emision`, `fecha\_vencimiento`), estado ("Aprobado", "Vencido") y una bandera `disponible\_offline` que controla el respaldo físico.



\#### C. Gestión Offline (`respaldos\_documentos`)

Para garantizar el acceso en alta mar sin conexión a Internet.

\- `respaldos\_documentos`: Guarda la ruta de almacenamiento local en el servidor (`ruta\_archivo`), su peso en bytes, el tipo MIME, y un hash SHA para verificar la integridad del documento en las descargas offline.



\#### D. PWA y Mensajería Push (`push\_subscriptions`, `push\_notification\_events`)

Controla la entrega y evita el envío duplicado de alertas.

\- `push\_subscriptions`: Suscripciones PWA del navegador de los dispositivos de los usuarios. Guarda la suscripción completa en formato `JSON` y el `endpoint\_hash` como llave primaria.

\- `push\_notification\_events`: Registro de eventos de notificación enviados. Almacena marcas de tiempo (`sent\_at`, `last\_sent\_at`) para implementar ventanas de cooldown (evitando que el sistema envíe múltiples notificaciones push por el mismo vencimiento).



\#### E. Auditoría y Diagnóstico (`sync\_logs`)

\- `sync\_logs`: Auditoría que almacena cada intento de sincronización periódica, registrando el estado (`exitoso` o `fallido`), la cantidad de registros modificados y el mensaje de error en caso de fallo.



\---



\## 5. Módulos Críticos y Flujo de Datos



\### A. Sincronización de Datos (Sync Engine)

El servicio en `server/services/controldoc.service.js` actúa como el motor de sincronización. Consiste en consultas periódicas controladas a los endpoints de ControlDoc usando autenticación por token:

1\. El backend levanta peticiones HTTP con paginación a la API externa.

2\. Compara los registros entrantes con la base de datos MySQL local.

3\. Inserta nuevos registros o actualiza los modificados (utilizando operaciones `ON DUPLICATE KEY UPDATE` implícitas a nivel lógigo).

4\. Guarda un reporte detallado en `sync\_logs`.



\### B. Notificaciones Push (PWA)

1\. El navegador del usuario solicita permiso de notificaciones push a través de `pushNotifications.js`.

2\. Al otorgarse, se genera una suscripción del navegador que es enviada al servidor e insertada en `push\_subscriptions` asociada al ID del usuario.

3\. Diariamente, una tarea programada en `notifications.service.js` evalúa las fechas de vencimiento en `documentos\_api`.

4\. Si un documento está a menos de 30, 15 o 5 días de expirar, el servidor genera un payload y utiliza la librería `web-push` firmada con la clave privada VAPID para enviar la alerta push.

5\. El Service Worker de la PWA recibe el evento push en segundo plano y muestra la notificación en el sistema operativo del usuario.



\### C. Almacenamiento Offline y Service Worker

\- Las rutas estáticas de la aplicación (HTML, CSS compilado, JS, iconos de la interfaz) se almacenan en la caché del navegador para acceso instantáneo.

\- El visor de documentos (`ViewDocumentos.jsx`) consulta el endpoint `/api/controldoc/documents`. Si el usuario marca un archivo para descarga offline, el servidor descarga el archivo PDF o imagen original desde ControlDoc, lo almacena en disco dentro de `server/storage/` (o similar), e inserta el metadato en `respaldos\_documentos`.

\- Cuando no hay señal, el Service Worker intercepta la petición del archivo y sirve directamente la versión guardada localmente desde el servidor o la caché de la API del navegador.



\---



\## 6. Configuración de Entornos y Despliegue



La aplicación se puede desplegar fácilmente en plataformas como Railway, Render, VPS o contenedores Docker gracias a su naturaleza desacoplada.



\### Variables de Entorno del Servidor (`.env`):

```env

\# Configuración del servidor Express

PORT=3000

NODE\_ENV=production



\# Base de datos MySQL local/remota

MYSQLHOST=127.0.0.1

MYSQLPORT=3306

MYSQLUSER=root

MYSQLPASSWORD=tu\_contraseña\_segura

MYSQLDATABASE=compas\_marine\_db



\# Credenciales de API de ControlDoc

CONTROLDOC\_BASE\_URL=https://api.controldoc.cl/v1

CONTROLDOC\_USER\_EMAIL=usuario@compasmarine.cl

CONTROLDOC\_USER\_TOKEN=token\_seguro\_controldoc

CONTROLDOC\_CUSTOMER\_ID=id\_cliente



\# Credenciales VAPID para Notificaciones Push (generadas con npm run vapid:keys)

VAPID\_SUBJECT=mailto:soporte@compasmarine.cl

VAPID\_PUBLIC\_KEY=tu\_clave\_publica\_vapid

VAPID\_PRIVATE\_KEY=tu\_clave\_privada\_vapid



\# Configuración de Correos (SMTP / Gmail)

SMTP\_HOST=smtp.gmail.com

SMTP\_PORT=465

SMTP\_SECURE=true

SMTP\_USER=alertas@compasmarine.cl

SMTP\_PASS=contraseña\_de\_aplicacion\_gmail

SMTP\_FROM=alertas@compasmarine.cl

SMTP\_FROM\_NAME="Compas Marine Alertas"

```



\### Scripts de NPM Disponibles:

\- `npm run dev`: Inicia el cliente React localmente con recarga rápida.

\- `npm run dev:api`: Inicia únicamente el servidor Express en modo desarrollo.

\- `npm run dev:local`: Ejecuta el cliente apuntando a un proxy de desarrollo local (Cloudflare/Wrangler local en puerto 8787).

\- `npm run build`: Compila los archivos del frontend de React y Tailwind en la carpeta `dist/` para optimización en producción.

\- `npm run start`: Inicia el servidor backend Express en producción, el cual además sirve la carpeta estática `dist/` compilada.

\- `npm run vapid:keys`: Utilidad CLI para autogenerar las claves criptográficas públicas y privadas para el protocolo de notificaciones push VAPID.



