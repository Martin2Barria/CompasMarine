import bcrypt from 'bcryptjs';
import { dbPool } from '../config/db.js';
import { sendJson, readRequestBody, getCookie } from '../utils/http.js';

export async function handleRegister(req, res) {
  sendJson(res, 403, { error: 'El registro manual está deshabilitado.' });
}

export async function handleLogin(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const rawBody = await readRequestBody(req);
  let payload;

  try { payload = JSON.parse(rawBody || '{}'); } 
  catch { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password || ''; 

  if (!email || !password) return sendJson(res, 400, { error: 'El correo electrónico y la contraseña son obligatorios.' });

  try {
    const [rows] = await dbPool.execute('SELECT * FROM usuarios WHERE email = ? AND activo = TRUE', [email]);
    
    // 1. Validar contra usuarios existentes (Admin o Tripulantes ya activados)
    if (rows.length > 0) {
        const user = rows[0];
        if (await bcrypt.compare(password, user.password_hash)) {
            // AQUÍ ESTÁ EL CAMBIO: Extraemos también el ID del rol
            const [roles] = await dbPool.execute('SELECT r.id as rol_id, r.nombre as rol FROM usuarios_roles ur JOIN roles r ON ur.rol_id = r.id WHERE ur.usuario_id = ?', [user.id]);
            
            const rol = roles.length > 0 ? roles[0].rol : 'Usuario';
            const rol_id = roles.length > 0 ? roles[0].rol_id : null;
            
            res.setHeader('Set-Cookie', `compas_user_id=${user.id}; Path=/; HttpOnly; SameSite=Lax`);
            return sendJson(res, 200, { 
                ok: true, 
                message: 'Inicio de sesión correcto.', 
                user: { id: user.id, nombre: user.nombre, email: user.email, rol, rol_id } 
            });
        }
    }

    // 2. Primer inicio de sesión para Tripulantes (Auto-creación)
    const [entityRows] = await dbPool.execute(`SELECT * FROM entidades_api WHERE email = ? OR data_json LIKE ?`, [email, `%"${email}"%`]);
    
    if (entityRows.length > 0) {
        let matchedEntidad = null;
        for (const entidad of entityRows) {
            const rutDB = entidad.rut ? entidad.rut.replace(/[^0-9kK]/g, '').toLowerCase().replace(/^0+/, '') : null;
            const inputPasswordRut = password.replace(/[^0-9kK]/g, '').toLowerCase().replace(/^0+/, '');
            if (rutDB && rutDB === inputPasswordRut) { matchedEntidad = entidad; break; }
        }

        if (matchedEntidad) {
            const hash = await bcrypt.hash(password, 12); 
            const [insertResult] = await dbPool.execute('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)', [matchedEntidad.nombre || email, email, hash]);
            const userIdToLogin = insertResult.insertId;
            let assignedRolId = null;
            
            try {
                const [roles] = await dbPool.execute('SELECT id FROM roles WHERE nombre = "Usuario" LIMIT 1');
                if (roles.length > 0) {
                    assignedRolId = roles[0].id;
                    await dbPool.execute('INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES (?, ?)', [userIdToLogin, assignedRolId]);
                }
            } catch(e) { console.error("Error asignando rol automático:", e); }

            res.setHeader('Set-Cookie', `compas_user_id=${userIdToLogin}; Path=/; HttpOnly; SameSite=Lax`);
            return sendJson(res, 200, { 
                ok: true, 
                message: 'Cuenta activada e inicio de sesión correcto.', 
                user: { id: userIdToLogin, nombre: matchedEntidad.nombre, email: email, rol: 'Usuario', rol_id: assignedRolId } 
            });
        } else {
            return sendJson(res, 401, { error: 'Para activar tu cuenta por primera vez, tu contraseña debe ser tu RUT.' });
        }
    }

    sendJson(res, 401, { error: 'Credenciales incorrectas o correo no registrado en la empresa.' });
  } catch (error) {
    console.error('Error validando usuario:', error);
    sendJson(res, 500, { error: 'No se pudo iniciar sesión.' });
  }
}

export async function handleAuthMe(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  const cookieUserId = getCookie(req, 'compas_user_id');
  if (!cookieUserId) return sendJson(res, 401, { error: 'No autorizado' });

  try {
    const [userRows] = await dbPool.execute(`
      SELECT u.id, u.nombre, u.email, r.nombre as rol, r.id as rol_id
      FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id 
      WHERE u.id = ? AND u.activo = TRUE
    `, [cookieUserId]);
    
    if (userRows.length === 0) return sendJson(res, 401, { error: 'Usuario no encontrado o inactivo' });
    return sendJson(res, 200, { user: userRows[0] });
  } catch (error) {
    return sendJson(res, 500, { error: 'Error interno' });
  }
}