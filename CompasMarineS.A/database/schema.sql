CREATE DATABASE IF NOT EXISTS compas_marine_db
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE compas_marine_db;

-- Login

CREATE TABLE usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Niveles acceso

CREATE TABLE roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion VARCHAR(255)
);

-- Relación usuarios y roles

CREATE TABLE usuarios_roles (
    usuario_id INT NOT NULL,
    rol_id INT NOT NULL,

    PRIMARY KEY (usuario_id, rol_id),

    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    FOREIGN KEY (rol_id) REFERENCES roles(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

-- Copia local entidades obtenidas desde API externa

CREATE TABLE entidades_api (
    id INT AUTO_INCREMENT PRIMARY KEY,

    external_id VARCHAR(100) NOT NULL,
    identifier VARCHAR(150),

    nombre VARCHAR(255),
    sexo VARCHAR(50),
    rut VARCHAR(50),
    email VARCHAR(150),
    telefono VARCHAR(50),

    customer_id VARCHAR(50),
    entity_type_id VARCHAR(50),

    data_json JSON NOT NULL,

    sincronizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (external_id, customer_id, entity_type_id)
);

-- Tipos de documento obtenidos desde API externa

CREATE TABLE tipos_documento_api (
    id INT AUTO_INCREMENT PRIMARY KEY,

    external_id VARCHAR(100) NOT NULL UNIQUE,
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,

    data_json JSON NOT NULL,

    sincronizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Metadata documentos obtenidos desde API externa

CREATE TABLE documentos_api (
    id INT AUTO_INCREMENT PRIMARY KEY,

    usuario_id INT NOT NULL,
    tipo_documento_id INT NULL,

    external_id VARCHAR(100) NOT NULL UNIQUE,
    entidad_external_id VARCHAR(100),

    nombre VARCHAR(255),
    estado VARCHAR(100),

    fecha_emision DATE NULL,
    fecha_vencimiento DATE NULL,

    data_json JSON NOT NULL,

    disponible_offline BOOLEAN NOT NULL DEFAULT FALSE,
    sincronizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    FOREIGN KEY (tipo_documento_id) REFERENCES tipos_documento_api(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

-- Ruta local archivos respaldados uso offline

CREATE TABLE respaldos_documentos (
    id INT AUTO_INCREMENT PRIMARY KEY,

    documento_id INT NOT NULL,

    ruta_archivo VARCHAR(500) NOT NULL,
    nombre_archivo VARCHAR(255),
    mime_type VARCHAR(100),
    peso_bytes BIGINT,
    hash_archivo VARCHAR(128),

    descargado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (documento_id) REFERENCES documentos_api(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- Suscripciones push Web/PWA por dispositivo

CREATE TABLE push_subscriptions (
    endpoint_hash CHAR(64) PRIMARY KEY,
    user_id INT NULL,
    endpoint TEXT NOT NULL,
    subscription_json JSON NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,

    INDEX idx_push_subscriptions_user_id (user_id)
);

-- Cooldowns de notificaciones push ya enviadas

CREATE TABLE push_notification_events (
    event_hash CHAR(64) PRIMARY KEY,
    user_id INT NULL,
    event_key TEXT NOT NULL,
    event_id TEXT NOT NULL,
    rule_version INT NOT NULL DEFAULT 1,
    sent_at DATETIME NOT NULL,
    last_sent_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_push_notification_events_user_id (user_id)
);

-- Historial visible de alertas push efectivamente enviadas al usuario

CREATE TABLE push_notification_history (
    event_hash CHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    event_id VARCHAR(1024) NOT NULL,
    notification_group VARCHAR(32) NOT NULL,
    threshold TINYINT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    doc_name VARCHAR(255) NOT NULL,
    expiration_date VARCHAR(100) NULL,
    days_remaining INT NULL,
    sent_at DATETIME NOT NULL,
    last_sent_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_push_notification_history_user_id (user_id),
    INDEX idx_push_notification_history_last_sent_at (last_sent_at)
);

-- Registro de correos automáticos enviados por Resend.
-- El evento es único por usuario, documento y umbral (parche de correo: 60 o 30 días).
CREATE TABLE email_notification_events (
    event_hash CHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    event_key VARCHAR(1024) NOT NULL,
    event_id VARCHAR(1024) NOT NULL,
    threshold TINYINT NOT NULL,
    provider_id VARCHAR(255) NULL,
    sent_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_email_notification_events_user_id (user_id),
    INDEX idx_email_notification_events_sent_at (sent_at)
);

-- Registro sincronizaciones API externa

CREATE TABLE sync_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,

    tipo VARCHAR(100) NOT NULL,
    estado ENUM('exitoso', 'fallido') NOT NULL,
    mensaje TEXT,
    registros_procesados INT DEFAULT 0,

    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
