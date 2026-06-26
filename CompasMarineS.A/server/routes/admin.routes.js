import { handleSetupDB, handleSyncUsersToDB } from '../services/controldoc.service.js';

export async function adminRouter(req, res, cleanPath) {
  if (cleanPath === '/api/admin/setup-db') {
    await handleSetupDB(req, res);
    return true;
  }
  
  if (cleanPath === '/api/admin/sync-users') {
    await handleSyncUsersToDB(req, res);
    return true;
  }

  return false;
}