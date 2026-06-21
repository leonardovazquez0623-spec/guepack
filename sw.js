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
  const { title, body } = payload.notification
  self.registration.showNotification(title, {
    body,
    icon: '/Icono_gp.png',
    badge: '/Icono_gp.png'
  })
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