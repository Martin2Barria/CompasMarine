import mysql from 'mysql2/promise';

// Aseguramos que las variables de entorno estén cargadas antes de usar este archivo
if (!process.env.MYSQLHOST) {
  console.warn("Advertencia: Variables de entorno de MySQL no detectadas al iniciar el pool.");
}

export const dbPool = mysql.createPool({
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Probamos la conexión al iniciar
dbPool.getConnection()
  .then(connection => {
    console.log('✅ Conexión exitosa al pool de MySQL');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Error al conectar al pool de MySQL:', err.message);
  });