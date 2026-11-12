try {
  const saved = localStorage.getItem('studio-theme')
  document.documentElement.dataset.theme = saved === 'light' || saved === 'dark'
    ? saved
    : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}