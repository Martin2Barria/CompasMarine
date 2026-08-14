import { getApiUrl } from '../config/api';

export const PUSH_STATUS_CHANGED_EVENT = 'compas:push-status-changed';
let pushActivationPromise = null;

export function enablePushNotifications(options = {}) {
  if (pushActivationPromise) return pushActivationPromise;

  pushActivationPromise = activatePushNotifications(options)
    .then((status) => {
      notifyPushStatusChanged(status);
      return status;
    })
    .catch((error) => {
      notifyPushStatusChanged({
        permission: getNotificationPermissionState(),
        active: false,
        error: error.message
      });
      throw error;
    })
    .finally(() => {
      pushActivationPromise = null;
    });

  return pushActivationPromise;
}

export function reactivatePushNotifications() {
  return enablePushNotifications({ forceResubscribe: true });
}

async function activatePushNotifications({ forceResubscribe = false } = {}) {
  if (!('Notification' in window)) {
    throw new Error('Este navegador no soporta notificaciones.');
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Este navegador no soporta push web.');
  }
  if (!isSecurePushContext()) {
    throw new Error('Las notificaciones push requieren HTTPS.');
  }
  if (isIosDevice() && !isStandaloneApp()) {
    throw new Error('En iPhone o iPad debes instalar la app en la pantalla de inicio antes de activar las notificaciones.');
  }

  const publicKeyResponse = await fetch(getApiUrl('/notifications/vapid-public-key'), {
    credentials: 'same-origin',
    cache: 'no-store'
  });
  const publicKeyPayload = await publicKeyResponse.json().catch(() => ({}));
  const { publicKey } = publicKeyPayload;

  if (!publicKeyResponse.ok || !publicKey) {
    throw new Error('El servidor aún no tiene configuradas las notificaciones push (VAPID).');
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    throw new Error(getNotificationPermissionMessage(permission));
  }

  const registration = await getPushServiceWorkerRegistration();
  await registration.update?.().catch(() => null);

  let existingSubscription = await registration.pushManager.getSubscription();
  if (forceResubscribe && existingSubscription) {
    await unregisterPushSubscription(existingSubscription).catch(() => null);
    await existingSubscription.unsubscribe().catch(() => false);
    existingSubscription = await registration.pushManager.getSubscription();
  }

  const subscription = existingSubscription || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });

  const subscriptionResponse = await fetch(getApiUrl('/notifications/subscriptions'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ subscription })
  });

  if (!subscriptionResponse.ok) {
    const payload = await subscriptionResponse.json().catch(() => ({}));
    throw new Error(payload.error || 'No se pudo registrar este celular para recibir notificaciones.');
  }

  return {
    supported: true,
    permission: 'granted',
    active: true
  };
}

async function unregisterPushSubscription(subscription) {
  const response = await fetch(getApiUrl('/notifications/subscriptions'), {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription })
  });

  if (!response.ok) {
    throw new Error('No se pudo retirar la suscripción anterior del servidor.');
  }
}

export function getNotificationPermissionState() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function getPushNotificationStatus() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { supported: false, permission: 'unsupported', active: false };
  }

  const supported = 'serviceWorker' in navigator && 'PushManager' in window && isSecurePushContext();
  const permission = Notification.permission;
  if (!supported || permission !== 'granted') {
    return { supported, permission, active: false };
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return { supported: true, permission, active: Boolean(subscription) };
  } catch {
    return { supported: true, permission, active: false };
  }
}

export async function disablePushNotifications() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) {
    notifyPushStatusChanged(await getPushNotificationStatus());
    return;
  }

  try {
    await fetch(getApiUrl('/notifications/subscriptions'), {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });
  } finally {
    await subscription.unsubscribe().catch(() => false);
    notifyPushStatusChanged(await getPushNotificationStatus());
  }
}

async function getPushServiceWorkerRegistration() {
  const existingRegistration = await navigator.serviceWorker.getRegistration();
  if (existingRegistration) return navigator.serviceWorker.ready;

  try {
    await navigator.serviceWorker.register('/sw.js');
    return await navigator.serviceWorker.ready;
  } catch {
    throw new Error('No se pudo activar el servicio de notificaciones en segundo plano.');
  }
}

function isSecurePushContext() {
  if (window.isSecureContext) return true;
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

function isIosDevice() {
  const userAgent = navigator.userAgent || '';
  const isTouchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(userAgent) || isTouchMac;
}

function isStandaloneApp() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function getNotificationPermissionMessage(permission) {
  if (permission === 'denied') {
    return 'Las notificaciones están bloqueadas. Actívalas en los permisos del sitio desde los ajustes del navegador y vuelve a pulsar el botón.';
  }
  return 'No se concedió el permiso para notificaciones.';
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
      try {
        await registration.showNotification(title, options);
        return true;
      } catch {
        return false;
      }
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

  const payload = await response.json().catch(() => ({}));

  if (response.status === 404) {
    throw new Error('El endpoint de prueba push esta desactivado en el backend.');
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason || payload.error || 'No se pudo enviar la notificación de prueba.');
  }

  return payload;
}

export async function sendEmailAlertDigest(alerts = []) {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return { ok: false, reason: 'No hay alertas para enviar por correo.' };
  }

  const response = await fetch(getApiUrl('/notifications/email-alerts'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ alerts: alerts.slice(0, 200) })
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason || payload.error || 'No se pudo enviar el correo de alertas.');
  }

  return payload;
}

export async function fetchEmailNotificationHistory() {
  const response = await fetch(getApiUrl('/notifications/email-history'), {
    credentials: 'same-origin',
    cache: 'no-store'
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'No se pudo consultar el registro de correos.');
  }

  return Array.isArray(payload.events) ? payload.events : [];
}

export async function fetchPushNotificationHistory() {
  const response = await fetch(getApiUrl('/notifications/push-history'), {
    credentials: 'same-origin',
    cache: 'no-store'
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'No se pudo consultar el respaldo de notificaciones push.');
  }

  return Array.isArray(payload.events) ? payload.events : [];
}

function notifyPushStatusChanged(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PUSH_STATUS_CHANGED_EVENT, { detail }));
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
