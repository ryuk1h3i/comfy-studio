import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/600.css'
import '@fontsource/space-grotesk/500.css'
import 'photoswipe/style.css'
import './style.css'
import './appearance.css'
import App from './App'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5000 }, mutations: { retry: false } } })
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><App /></BrowserRouter></QueryClientProvider></React.StrictMode>)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
	navigator.serviceWorker.register('/sw.js').then(registration => {
		registration.addEventListener('updatefound', () => {
			const worker = registration.installing
			worker?.addEventListener('statechange', () => {
				if (worker.state === 'installed' && navigator.serviceWorker.controller && confirm('Nuova versione disponibile. Aggiornare ora?')) {
					worker.postMessage('ACTIVATE')
					navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
				}
			})
		})
	}).catch(console.error)
}