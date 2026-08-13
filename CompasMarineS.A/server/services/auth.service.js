import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { dbPool } from '../config/db.js';
import { sendJson, readRequestBody } from '../utils/http.js';
import { requireSameOriginRequest } from '../utils/security.js';
import { buildClearSessionCookie, buildSessionCookie, getSessionUserId } from '../utils/session.js';

const PASSWORD_RESET_TOKEN_TTL = 10 * 60 * 1000;
const passwordResetTokens = new Map();

function createPasswordResetToken(email, userId) {
  const now = Date.now();
  for (const [token, tokenData] of passwordResetTokens.entries()) {
    if (tokenData.expiresAt <= now) passwordResetTokens.delete(token);
  }

  const token = randomUUID();
  passwordResetTokens.set(token, {
    email,
    userId,
    expiresAt: now + PASSWORD_RESET_TOKEN_TTL
  });
  return token;
}

function consumePasswordResetToken(token, email) {
  if (!token) return null;
  const tokenData = passwordResetTokens.get(token);
  if (!tokenData) return null;

  passwordResetTokens.delete(token);
  const isExpired = tokenData.expiresAt <= Date.now();
  const sameEmail = tokenData.email === email;
  if (isExpired || !sameEmail) return null;

  return tokenData;
}

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
            // Extraemos también el ID del rol
            const [roles] = await dbPool.execute('SELECT r.id as rol_id, r.nombre as rol FROM usuarios_roles ur JOIN roles r ON ur.rol_id = r.id WHERE ur.usuario_id = ?', [user.id]);
            
            const rol = roles.length > 0 ? roles[0].rol : 'Usuario';
            const rol_id = roles.length > 0 ? roles[0].rol_id : null;
            
            res.setHeader('Set-Cookie', buildSessionCookie(req, user.id));
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

            res.setHeader('Set-Cookie', buildSessionCookie(req, userIdToLogin));
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

export async function handleLogout(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no válido' });
  if (!requireSameOriginRequest(req, res)) return;
  res.setHeader('Set-Cookie', buildClearSessionCookie(req));
  return sendJson(res, 200, { ok: true });
}

export async function handleVerifyResetIdentity(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no válido' });
  if (!requireSameOriginRequest(req, res)) return;

  let payload;
  try { payload = JSON.parse(await readRequestBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }

  const email = (payload.email || '').trim().toLowerCase();
  const currentPassword = payload.password || '';

  if (!email || !currentPassword) {
    return sendJson(res, 400, { error: 'El correo electrónico y la contraseña actual son obligatorios.' });
  }

  try {
    const [rows] = await dbPool.execute('SELECT id, password_hash FROM usuarios WHERE email = ? AND activo = TRUE LIMIT 1', [email]);
    if (rows.length === 0) {
      return sendJson(res, 404, { error: 'No existe un usuario activo registrado con ese correo.' });
    }

    const user = rows[0];
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return sendJson(res, 401, { error: 'La contraseña actual no es válida.' });
    }

    const verificationToken = createPasswordResetToken(email, user.id);
    return sendJson(res, 200, {
      ok: true,
      verificationToken,
      message: 'Identidad validada. Ya puedes definir tu nueva contraseña.'
    });
  } catch (error) {
    console.error('Error validando identidad para restablecer contraseña:', error);
    return sendJson(res, 500, { error: 'No se pudo validar la identidad.' });
  }
}

export async function handleResetPassword(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no válido' });
  if (!requireSameOriginRequest(req, res)) return;

  let payload;
  try { payload = JSON.parse(await readRequestBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }

  const email = (payload.email || '').trim().toLowerCase();
  const nextPassword = payload.password || '';
  const verificationToken = payload.verificationToken || '';

  if (!email || !nextPassword || !verificationToken) {
    return sendJson(res, 400, { error: 'Debes validar tu identidad antes de cambiar la contraseña.' });
  }

  if (nextPassword.length < 8) {
    return sendJson(res, 400, { error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  }

  const verifiedSession = consumePasswordResetToken(verificationToken, email);
  if (!verifiedSession) {
    return sendJson(res, 401, { error: 'La validación expiró o no es válida. Vuelve a verificar tu identidad.' });
  }

  try {
    const [userRows] = await dbPool.execute('SELECT id, password_hash FROM usuarios WHERE email = ? AND activo = TRUE LIMIT 1', [email]);

    if (userRows.length === 0) {
      return sendJson(res, 404, { error: 'El usuario ya no está disponible para actualizar contraseña.' });
    }

    const user = userRows[0];
    const isSamePassword = await bcrypt.compare(nextPassword, user.password_hash);
    if (isSamePassword) {
      return sendJson(res, 400, { error: 'La nueva contraseña no puede ser igual a la actual.' });
    }

    const passwordHash = await bcrypt.hash(nextPassword, 12);
    await dbPool.execute('UPDATE usuarios SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
    return sendJson(res, 200, { ok: true, message: 'La contraseña fue actualizada correctamente.' });
  } catch (error) {
    console.error('Error restableciendo contraseña:', error);
    return sendJson(res, 500, { error: 'No se pudo actualizar la contraseña.' });
  }
}

export async function handleAuthMe(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  const cookieUserId = getSessionUserId(req);
  if (!cookieUserId) return sendJson(res, 401, { error: 'No autorizado' });

  try {
    const [userRows] = await dbPool.execute(`
      SELECT u.id, u.nombre, u.email, r.nombre as rol, r.id as rol_id
      FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id 
      WHERE u.id = ? AND u.activo = TRUE
    `, [cookieUserId]);
    
    if (userRows.length === 0) return sendJson(res, 401, { error: 'Usuario no encontrado o inactivo' });
    res.setHeader('Set-Cookie', buildSessionCookie(req, cookieUserId));
    return sendJson(res, 200, { user: userRows[0] });
  } catch {
    return sendJson(res, 500, { error: 'Error interno' });
  }
}
