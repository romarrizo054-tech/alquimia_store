// En producción, VITE_API_URL debe ser la URL pública del backend (sin / al final).
// En desarrollo, Vite redirige /api al backend local mediante vite.config.js.
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const apiUrl = (path) => `${API_BASE_URL}${path}`;
