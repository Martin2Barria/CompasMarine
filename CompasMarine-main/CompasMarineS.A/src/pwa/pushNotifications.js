import { getApiUrl } from '../config/api';

export async function enablePushNotifications() {
  if (!('Notification' in window)) {
    throw new Error('Este navegador no soporta notificaciones.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Permiso de notificaciones denegado.');
  }

  const publicKeyResponse = await fetch(getApiUrl('/notifications/vapid-public-key'), {
    credentials: 'same-origin'
  });
  const { publicKey } = await publicKeyResponse.json();

  if (!publicKey) {
    await showAppNotification({
      title: 'Compas Marine',
      body: 'Notificaciones locales activadas.'
    });
    return 'local';
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Este navegador no soporta push web.');
  }

  const registration = await navigator.serviceWorker.ready;
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription = existingSubscription || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });

  await fetch(getApiUrl('/notifications/subscriptions'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ subscription })
  });

  return 'push';
}

export async function showAppNotification({ title, body, url = '/', tag }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return false;
  }

  const options = {
    body,
    icon: '/pwa-icon.svg',
    badge: '/pwa-icon.svg',
    tag,
    data: { url }
  };

  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return true;
    }
  }

  try {
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

export async function sendTestPushNotification() {
  const response = await fetch(getApiUrl('/notifications/test'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  const payload = await response.json();

  if (response.status === 404) {
    throw new Error('El endpoint de prueba push esta desactivado en el backend.');
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason || payload.error || 'No se pudo enviar la notificación de prueba.');
  }

  return payload;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}
