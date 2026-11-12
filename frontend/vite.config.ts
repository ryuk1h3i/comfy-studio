import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), {
    name: 'private-shell-cache',
    generateBundle(_, bundle) {
      const assets = ['/', '/index.html', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', ...Object.keys(bundle).map(name => '/' + name)]
      const version = JSON.stringify(Object.keys(bundle).filter(name => name.endsWith('.js')).join('-'))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const VERSION = ${version};
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS))));
self.addEventListener('message', event => { if (event.data === 'ACTIVATE') self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});` })
    },
  }],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } } },
})