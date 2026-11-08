# Configurar las rutas y la base de datos en Render

Las rutas de la aplicación ya están declaradas en `frontend/src/App.jsx`: `/` muestra la tienda y `/admin` abre el panel. Las solicitudes a datos usan `/api/...`; en desarrollo Vite las envía al backend local y en producción usan `VITE_API_URL`.

## Backend (Web Service)

En Render, abre el servicio Node y ve a **Settings > Environment**. Añade las variables del ejemplo `backend/.env.example` usando los valores de la conexión de MySQL. No subas el archivo `.env` ni pegues la contraseña en el código.

Para TLS, descarga el certificado CA desde el proveedor y agrégalo al proyecto en una ubicación estable, por ejemplo `backend/certs/database-ca.pem`. Define `DB_CA_PATH` con esa ruta dentro del servicio, por ejemplo `./certs/database-ca.pem` (se resuelve desde el directorio de ejecución). Si el proveedor solo requiere TLS sin CA personalizada, deja `DB_CA_PATH` vacío y usa `DB_SSL=true`.

El backend puede guardar las fotos en Cloudinary usando `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET`, o en disco local usando `UPLOADS_DIR`. En Render Free, el disco local es temporal y las fotos se pierden al reiniciar o desplegar; configura Cloudinary o un disco persistente para conservarlas. Guarda las tres variables de Cloudinary solo en el entorno privado del backend. El servidor firma y envía las fotos a Cloudinary; nunca expone el secreto al navegador.

En el entorno del backend configura `ADMIN_PASSWORD` y `ADMIN_SESSION_SECRET` con valores largos y únicos. Configura `FRONTEND_URL` con la URL pública del Static Site. El panel `/admin` y sus rutas para productos, gastos, métricas y pedidos requerirán iniciar sesión; la tienda y el envío de pedidos seguirán siendo públicos.

Para guardar pedidos, el backend crea la tabla `store_orders` automáticamente. Los pedidos nuevos se guardan como `pendiente`; al marcarlos `completado` en el panel, se incluyen en las métricas y se descuentan del stock. El total se calcula con precios leídos de la base de datos.

Configura el directorio raíz del servicio como `backend` si Render despliega desde un monorepo. El comando de inicio debe ejecutar `node server.js`; instala dependencias con `npm install`.

## Frontend (Static Site)

En el Static Site configura `VITE_API_URL` con la URL HTTPS pública del Web Service backend, sin `/` al final. Vite incorpora esta variable durante la compilación, así que vuelve a desplegar el frontend después de cambiarla.

Las variables `VITE_*` son públicas y nunca deben contener contraseñas. `DB_PASSWORD` solo va en el entorno privado del backend.
