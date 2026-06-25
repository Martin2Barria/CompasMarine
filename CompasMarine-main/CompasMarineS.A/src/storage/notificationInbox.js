const STORAGE_KEY = 'compasMarineNotificationInbox';
const MAX_NOTIFICATIONS = 50;

export function readNotificationInbox() {
  try {
    const notifications = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(notifications) ? notifications : [];
  } catch {
    return [];
  }
}

export function addNotificationToInbox(notification) {
  const entry = {
    id: createNotificationId(),
    title: notification.title,
    body: notification.body,
    url: notification.url || '/',
    createdAt: new Date().toISOString()
  };
  const notifications = [entry, ...readNotificationInbox()].slice(0, MAX_NOTIFICATIONS);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  } catch {
    // La tarjeta sigue visible durante la sesión aunque el almacenamiento no esté disponible.
  }

  return notifications;
}

function createNotificationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
