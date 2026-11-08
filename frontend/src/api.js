// En producción, VITE_API_URL debe apuntar al Web Service del backend.
// El valor de respaldo evita enviar /api al Static Site si falta esa variable.
// En desarrollo, Vite redirige /api al backend local mediante vite.config.js.
const DEFAULT_PRODUCTION_API_URL = 'https://alquimia-store.onrender.com';
const API_BASE_URL = (
  import.meta.env.VITE_API_URL || (import.meta.env.PROD ? DEFAULT_PRODUCTION_API_URL : '')
).replace(/\/$/, '');

export const apiUrl = (path) => `${API_BASE_URL}${path}`;
