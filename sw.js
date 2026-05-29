const CACHE_NAME = 'guepack-v2'
const urlsToCache = [
  '/',
  '/index.html',
  '/login.html',
  '/splash.html',
  '/manifest.json',
  '/Icono_gp.png',
  '/Splash_icon.png'
]
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  )
})

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  )
})