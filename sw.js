importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: "AIzaSyBG3EDbiS-0uswcGGBN9NyrlzpyJFOGnKo",
  authDomain: "guepack-app.firebaseapp.com",
  projectId: "guepack-app",
  storageBucket: "guepack-app.firebasestorage.app",
  messagingSenderId: "912683525841",
  appId: "1:912683525841:web:a67f014362160ea29b87f0"
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || payload.data?.title || 'GUEPACK Express'
  const body  = payload.notification?.body  || payload.data?.body  || 'Tienes una nueva notificación'
  self.registration.showNotification(title, {
    body,
    icon:    '/logo_icono.png',
    badge:   '/logo_icono.png',
    vibrate: [200, 100, 200],
    data:    payload.data || {},
    actions: [
      { action: 'open',  title: '👁️ Ver'    },
      { action: 'close', title: '✕ Cerrar' }
    ]
  })
})

// Push nativo — cubre casos donde el mensaje no llega por el canal FCM del SDK
self.addEventListener('push', function(event) {
  if (!event.data) return
  let data = {}
  try { data = event.data.json() } catch(e) { data = { title: 'GUEPACK', body: event.data.text() } }
  const title = data.notification?.title || data.title || 'GUEPACK Express'
  const options = {
    body:    data.notification?.body || data.body || 'Tienes una nueva notificación',
    icon:    '/logo_icono.png',
    badge:   '/logo_icono.png',
    vibrate: [200, 100, 200],
    data:    data.data || {},
    actions: [
      { action: 'open',  title: '👁️ Ver'    },
      { action: 'close', title: '✕ Cerrar' }
    ]
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  if (event.action === 'close') return
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url.includes('guepack') && 'focus' in client) return client.focus()
      }
      if (clients.openWindow) return clients.openWindow('https://guepack.com/repartidor.html')
    })
  )
})
const CACHE_NAME = 'guepack-v7'

self.addEventListener('install', () => { /* espera a que el cliente solicite la activación */ })
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  if (event.request.url.includes('app.html')) {
    event.respondWith(fetch(event.request))
  }
})