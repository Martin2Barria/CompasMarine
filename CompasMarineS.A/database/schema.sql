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

-- Registro sincronizaciones API externa

CREATE TABLE sync_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,

    tipo VARCHAR(100) NOT NULL,
    estado ENUM('exitoso', 'fallido') NOT NULL,
    mensaje TEXT,
    registros_procesados INT DEFAULT 0,

    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
