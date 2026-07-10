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
  const title = payload.notification?.title || payload.data?.titulo || 'GUEPACK Express'
  const body  = payload.notification?.body  || payload.data?.cuerpo || 'Nueva notificación'
  self.registration.showNotification(title, {
    body,
    icon:    '/logo_icono.png',
    badge:   '/logo_icono.png',
    vibrate: [200, 100, 200]
  })
})

// Push nativo — independiente de sesión, solo usa el payload
self.addEventListener('push', function(event) {
  if (!event.data) return
  let data = {}
  try { data = event.data.json() } catch(e) {}
  const title = data.notification?.title || data.data?.titulo || 'GUEPACK Express'
  const body  = data.notification?.body  || data.data?.cuerpo || 'Nueva notificación'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:    '/logo_icono.png',
      badge:   '/logo_icono.png',
      vibrate: [200, 100, 200]
    })
  )
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
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return

  const url = event.request.url
  // Dejar pasar sin interceptar: APIs externas y assets de Firebase/Supabase
  if (
    url.includes('supabase.co') ||
    url.includes('googleapis.com') ||
    url.includes('firebaseapp.com') ||
    url.includes('firebasestorage.app') ||
    url.includes('gstatic.com') ||
    url.includes('mapbox.com') ||
    url.includes('api.mapbox.com')
  ) return

  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request).catch(function() {
        // Sin caché y sin red — no hay fallback para este recurso
      })
    })
  )
})