import { handleRegister, handleLogin, handleLogout, handleVerifyResetIdentity, handleResetPassword, handleAuthMe } from '../services/auth.service.js';

export async function authRouter(req, res, cleanPath) {
  if (cleanPath === '/api/auth/register') {
    await handleRegister(req, res);
    return true;
  }
  
  if (cleanPath === '/api/auth/login') {
    await handleLogin(req, res);
    return true;
  }

  if (cleanPath === '/api/auth/logout') {
    await handleLogout(req, res);
    return true;
  }

  if (cleanPath === '/api/auth/verify-reset-identity') {
    await handleVerifyResetIdentity(req, res);
    return true;
  }

  if (cleanPath === '/api/auth/reset-password') {
    await handleResetPassword(req, res);
    return true;
  }
  
  if (cleanPath === '/api/auth/me') {
    await handleAuthMe(req, res);
    return true;
  }

  return false; // Indica que la ruta no correspondía a este archivo
}
