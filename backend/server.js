import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { randomUUID, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || '';
const ADMIN_SESSION_COOKIE = 'alquimia_admin_session';
const ADMIN_SESSION_SECONDS = 60 * 60 * 12;
const uploadsDirectory = process.env.UPLOADS_DIR || fileURLToPath(new URL('./uploads/', import.meta.url));

const imageExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};
const MAX_IMAGE_SIZE_MB = 20;
function getCloudinaryCredentials() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (cloudName && apiKey && apiSecret) return { cloudName, apiKey, apiSecret };

  const cloudinaryUrlValue = process.env.CLOUDINARY_URL;
  if (!cloudinaryUrlValue) return null;
  try {
    const cloudinaryUrl = new URL(cloudinaryUrlValue);
    if (cloudinaryUrl.protocol === 'cloudinary:' && cloudinaryUrl.hostname && cloudinaryUrl.username && cloudinaryUrl.password) {
      return {
        cloudName: cloudinaryUrl.hostname,
        apiKey: decodeURIComponent(cloudinaryUrl.username),
        apiSecret: decodeURIComponent(cloudinaryUrl.password)
      };
    }
  } catch {
    // Ignore malformed URLs; the warning below explains the supported variables.
  }
  console.warn('Cloudinary no está configurado: usa CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET, o una CLOUDINARY_URL completa.');
  return null;
}

const cloudinaryCredentials = getCloudinaryCredentials();
if (!cloudinaryCredentials) mkdirSync(uploadsDirectory, { recursive: true });
const upload = multer({
  storage: cloudinaryCredentials ? multer.memoryStorage() : multer.diskStorage({
    destination: uploadsDirectory,
    filename: (req, file, callback) => {
      callback(null, `${randomUUID()}${imageExtensions[file.mimetype]}`);
    }
  }),
  limits: { fileSize: MAX_IMAGE_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!imageExtensions[file.mimetype]) {
      callback(new Error('El formato de la imagen debe ser JPG, PNG o WebP.'));
      return;
    }
    callback(null, true);
  }
});

function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

const allowedOrigins = new Set([
  normalizeOrigin(process.env.FRONTEND_URL || 'https://alquimia-store-1.onrender.com'),
  normalizeOrigin('http://localhost:5173')
]);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(normalizeOrigin(origin))) return callback(null, true);
    return callback(new Error('Este origen no está habilitado para usar la API.'));
  },
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static(uploadsDirectory));

// Pool de conexiones a MySQL
const databaseConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
};

const isLocalDatabase = ['localhost', '127.0.0.1', '::1'].includes(
  databaseConfig.host?.toLowerCase()
);

if (process.env.DB_SSL === 'false' && !isLocalDatabase) {
  console.warn('DB_SSL=false se ignora para bases remotas; TiDB Cloud requiere una conexión TLS segura.');
}

if (process.env.DB_CA_PATH) {
  databaseConfig.ssl = {
    ca: readFileSync(process.env.DB_CA_PATH, 'utf8'),
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  };
} else if (process.env.DB_SSL === 'true' || !isLocalDatabase) {
  databaseConfig.ssl = {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  };
}

if (!databaseConfig.host || !databaseConfig.user || !databaseConfig.password || !databaseConfig.database) {
  console.warn('Faltan variables DB_HOST, DB_USER, DB_PASSWORD o DB_NAME. Configúralas en el entorno del servicio.');
}

const pool = mysql.createPool(databaseConfig);
let productImagesTablePromise;
let storeOrdersTablePromise;
let productVariantsTablePromise;

function constantTimeEqual(value, expected) {
  const valueBuffer = Buffer.from(String(value));
  const expectedBuffer = Buffer.from(String(expected));
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

function getAdminToken(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`));
  if (!cookie) return '';
  try {
    return decodeURIComponent(cookie.slice(ADMIN_SESSION_COOKIE.length + 1));
  } catch {
    return '';
  }
}

function hasAdminSession(req) {
  if (!ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) return false;
  const [expiration, signature] = getAdminToken(req).split('.');
  const expiresAt = Number(expiration);
  if (!expiresAt || expiresAt <= Date.now() || !signature) return false;
  const expectedSignature = createHmac('sha256', ADMIN_SESSION_SECRET).update(String(expiresAt)).digest('hex');
  return constantTimeEqual(signature, expectedSignature);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
    res.status(503).json({ error: 'Configura ADMIN_PASSWORD y ADMIN_SESSION_SECRET en el entorno del backend.' });
    return;
  }
  if (!hasAdminSession(req)) {
    res.status(401).json({ error: 'Inicia sesión para acceder al panel administrativo.' });
    return;
  }
  next();
}

function setAdminCookie(req, res, token) {
  const secureRequest = req.secure || process.env.NODE_ENV === 'production';
  const secure = secureRequest ? '; Secure' : '';
  const sameSite = secureRequest ? 'None' : 'Lax';
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${ADMIN_SESSION_SECONDS}; Path=/; HttpOnly; SameSite=${sameSite}${secure}`);
}

app.get('/api/admin/session', (req, res) => {
  res.json({ configured: Boolean(ADMIN_PASSWORD && ADMIN_SESSION_SECRET), authenticated: hasAdminSession(req) });
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
    res.status(503).json({ error: 'Configura ADMIN_PASSWORD y ADMIN_SESSION_SECRET en el entorno del backend.' });
    return;
  }
  const password = String(req.body?.password || '');
  if (!constantTimeEqual(password, ADMIN_PASSWORD)) {
    res.status(401).json({ error: 'La contraseña no es correcta.' });
    return;
  }
  const expiresAt = Date.now() + ADMIN_SESSION_SECONDS * 1000;
  const signature = createHmac('sha256', ADMIN_SESSION_SECRET).update(String(expiresAt)).digest('hex');
  setAdminCookie(req, res, `${expiresAt}.${signature}`);
  res.json({ authenticated: true });
});

app.post('/api/admin/logout', (req, res) => {
  const secureRequest = req.secure || process.env.NODE_ENV === 'production';
  const secure = secureRequest ? '; Secure' : '';
  const sameSite = secureRequest ? 'None' : 'Lax';
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=${sameSite}${secure}`);
  res.json({ authenticated: false });
});

function ensureStoreOrdersTable() {
  if (!storeOrdersTablePromise) {
    storeOrdersTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS store_orders (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        customer_name VARCHAR(200) NOT NULL,
        delivery_method VARCHAR(100) NOT NULL,
        notes TEXT,
        items_json LONGTEXT NOT NULL,
        total DECIMAL(12,2) NOT NULL,
        total_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_store_orders_status (status),
        INDEX idx_store_orders_created_at (created_at)
      )
    `).catch((error) => {
      storeOrdersTablePromise = null;
      throw error;
    });
  }
  return storeOrdersTablePromise;
}

function ensureProductImagesTable() {
  if (!productImagesTablePromise) {
    productImagesTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        product_id BIGINT NOT NULL,
        image_url TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_product_images_product_id (product_id)
      )
    `).catch((error) => {
      productImagesTablePromise = null;
      throw error;
    });
  }
  return productImagesTablePromise;
}

function ensureProductVariantsTable() {
  if (!productVariantsTablePromise) {
    productVariantsTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS product_variants (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        product_id BIGINT NOT NULL,
        name VARCHAR(200) NOT NULL,
        price DECIMAL(12,2) NOT NULL,
        cost_price DECIMAL(12,2) NOT NULL DEFAULT 0,
        stock INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_product_variants_product_id (product_id)
      )
    `).catch((error) => {
      productVariantsTablePromise = null;
      throw error;
    });
  }
  return productVariantsTablePromise;
}

function parseProductVariants(value) {
  let variants;
  try {
    variants = typeof value === 'string' ? JSON.parse(value || '[]') : value || [];
  } catch {
    throw new Error('Las opciones del producto no tienen un formato válido.');
  }
  if (!Array.isArray(variants) || variants.length > 50) {
    throw new Error('Puedes agregar hasta 50 opciones por producto.');
  }
  return variants.map((variant) => {
    const name = String(variant.name || '').trim();
    const price = Number(variant.price);
    const costPrice = Number(variant.cost_price || 0);
    const stock = Number(variant.stock);
    if (!name || name.length > 200 || !Number.isFinite(price) || price < 0 || !Number.isFinite(costPrice) || costPrice < 0 || !Number.isInteger(stock) || stock < 0) {
      throw new Error('Cada opción necesita nombre, precio, costo válido y stock entero no negativo.');
    }
    const id = variant.id && /^\d+$/.test(String(variant.id)) ? String(variant.id) : null;
    return { id, name, price, cost_price: costPrice, stock };
  });
}

async function uploadedImageUrls(req) {
  const files = Array.isArray(req.files)
    ? req.files
    : Object.values(req.files || {}).flat();
  if (!cloudinaryCredentials) {
    return files.map((file) => `${req.protocol}://${req.get('host')}/uploads/${file.filename}`);
  }

  const imageUrls = [];
  for (const file of files) {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'alquimia-products';
    const signature = createHash('sha1')
      .update(`folder=${folder}&timestamp=${timestamp}${cloudinaryCredentials.apiSecret}`)
      .digest('hex');
    const formData = new FormData();
    formData.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
    formData.append('api_key', cloudinaryCredentials.apiKey);
    formData.append('timestamp', String(timestamp));
    formData.append('folder', folder);
    formData.append('signature', signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudinaryCredentials.cloudName}/image/upload`,
      { method: 'POST', body: formData }
    );
    const result = await response.json();
    if (!response.ok || !result.secure_url) {
      throw new Error(result.error?.message || 'No se pudo guardar una imagen en Cloudinary.');
    }
    imageUrls.push(result.secure_url);
  }
  return imageUrls;
}

function publicImageUrl(req, imageUrl) {
  if (!imageUrl) return imageUrl;
  const publicOrigin = `${req.protocol}://${req.get('host')}`;
  return imageUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, publicOrigin);
}

// Endpoint para traer categorías
app.get('/api/categories', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para listar productos (con filtro de categoría opcional)
app.get('/api/products', async (req, res) => {
  const { category, search } = req.query;
  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, Number.parseInt(req.query.limit, 10) || 12));
  try {
    let query = `
      SELECT p.*, c.name AS category_name, c.slug AS category_slug 
      FROM products p 
      JOIN categories c ON p.category_id = c.id 
      WHERE p.is_active = TRUE
    `;
    const params = [];

    if (category && category !== 'todos') {
      query += ' AND c.slug = ?';
      params.push(category);
    }

    if (search?.trim()) {
      query += ' AND p.name LIKE ?';
      params.push(`%${search.trim()}%`);
    }

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM products p JOIN categories c ON p.category_id = c.id WHERE p.is_active = TRUE${category && category !== 'todos' ? ' AND c.slug = ?' : ''}${search?.trim() ? ' AND p.name LIKE ?' : ''}`,
      params
    );
    const total = Number(countRows[0].total);

    query += ' ORDER BY p.id DESC';
    const rowsParams = [...params];
    if (isPaginated) {
      query += ' LIMIT ? OFFSET ?';
      rowsParams.push(limit, (page - 1) * limit);
    }
    const [rows] = await pool.query(query, rowsParams);
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
    await ensureProductImagesTable();
    await ensureProductVariantsTable();
    if (rows.length) {
      const [imageRows] = await pool.query(
        'SELECT product_id, image_url FROM product_images WHERE product_id IN (?) ORDER BY id ASC',
        [rows.map((product) => product.id)]
      );
      const [variantRows] = await pool.query(
        'SELECT id, product_id, name, price, cost_price, stock FROM product_variants WHERE is_active = TRUE AND product_id IN (?) ORDER BY id ASC',
        [rows.map((product) => product.id)]
      );
      const extraImagesByProduct = new Map();
      for (const image of imageRows) {
        const productId = String(image.product_id);
        const images = extraImagesByProduct.get(productId) || [];
        images.push(publicImageUrl(req, image.image_url));
        extraImagesByProduct.set(productId, images);
      }
      const variantsByProduct = new Map();
      for (const variant of variantRows) {
        const productId = String(variant.product_id);
        const variants = variantsByProduct.get(productId) || [];
        variants.push({ ...variant, price: Number(variant.price), cost_price: Number(variant.cost_price), stock: Number(variant.stock) });
        variantsByProduct.set(productId, variants);
      }
      for (const product of rows) {
        product.image_url = publicImageUrl(req, product.image_url);
        product.images = [product.image_url, ...(extraImagesByProduct.get(String(product.id)) || [])].filter(Boolean);
        product.variants = variantsByProduct.get(String(product.id)) || [];
      }
    }
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// RUTAS DE GESTIÓN DE PRODUCTOS (CRUD)
// ==========================================

// Crear producto
const productImageUpload = upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'image', maxCount: 1 },
]);

app.post('/api/products', requireAdmin, productImageUpload, async (req, res) => {
  const { category_id, name, description, price, cost_price, stock } = req.body;
  try {
    const variants = parseProductVariants(req.body.variants);
    const defaultPrice = price || variants[0]?.price;
    const defaultCost = cost_price || variants[0]?.cost_price || 0;
    const defaultStock = stock || variants[0]?.stock || 0;
    if (!defaultPrice) throw new Error('Ingresa un precio o agrega al menos una opción con precio.');
    const images = await uploadedImageUrls(req);
    const image_url = images[0] || req.body.image_url;
    await ensureProductImagesTable();
    await ensureProductVariantsTable();
    const connection = await pool.getConnection();
    let productId;
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(
        `INSERT INTO products (category_id, name, description, price, cost_price, image_url, stock, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [category_id, name, description, defaultPrice, defaultCost, image_url, defaultStock]
      );
      productId = result.insertId;
      if (images.length > 1) {
        await connection.query('INSERT INTO product_images (product_id, image_url) VALUES ?', [images.slice(1).map((url) => [productId, url])]);
      }
      if (variants.length) {
        await connection.query('INSERT INTO product_variants (product_id, name, price, cost_price, stock) VALUES ?', [variants.map((variant) => [productId, variant.name, variant.price, variant.cost_price, variant.stock])]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.json({ id: productId, message: 'Producto creado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Modificar producto
app.put('/api/products/:id', requireAdmin, productImageUpload, async (req, res) => {
  const { id } = req.params;
  const { category_id, name, description, price, cost_price, stock, is_active } = req.body;
  try {
    const variants = parseProductVariants(req.body.variants);
    const defaultPrice = price || variants[0]?.price;
    const defaultCost = cost_price || variants[0]?.cost_price || 0;
    const defaultStock = stock || variants[0]?.stock || 0;
    if (!defaultPrice) throw new Error('Ingresa un precio o agrega al menos una opción con precio.');
    const images = await uploadedImageUrls(req);
    const hasImageSelection = Object.hasOwn(req.body, 'existing_images');
    let retainedImages = [];
    if (hasImageSelection) {
      retainedImages = JSON.parse(req.body.existing_images);
      if (!Array.isArray(retainedImages) || retainedImages.some((url) => typeof url !== 'string')) {
        throw new Error('La lista de fotos del producto no es válida.');
      }
    }
    await ensureProductImagesTable();
    await ensureProductVariantsTable();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      let imageUrl = req.body.image_url || images[0] || '';
      let additionalImages = req.body.image_url ? images : images.slice(1);
      if (hasImageSelection) {
        const [currentProducts] = await connection.query('SELECT image_url FROM products WHERE id = ? FOR UPDATE', [id]);
        if (!currentProducts.length) throw new Error('No se encontró el producto que quieres editar.');
        const [currentExtraImages] = await connection.query('SELECT image_url FROM product_images WHERE product_id = ?', [id]);
        const currentImageUrls = new Set(
          [currentProducts[0].image_url, ...currentExtraImages.map((row) => row.image_url)]
            .filter(Boolean)
            .map((url) => publicImageUrl(req, url))
        );
        if (retainedImages.some((url) => !currentImageUrls.has(url))) {
          throw new Error('Una de las fotos seleccionadas ya no pertenece a este producto. Recarga el panel e intenta nuevamente.');
        }
        const allImages = [...new Set([...retainedImages, ...images])];
        imageUrl = allImages[0] || '';
        additionalImages = allImages.slice(1);
      }
      await connection.query(
        `UPDATE products SET category_id = ?, name = ?, description = ?, price = ?, cost_price = ?, image_url = ?, stock = ?, is_active = ? WHERE id = ?`,
        [category_id, name, description, defaultPrice, defaultCost, imageUrl, defaultStock, is_active ?? 1, id]
      );
      if (hasImageSelection) await connection.query('DELETE FROM product_images WHERE product_id = ?', [id]);
      if (additionalImages.length) await connection.query('INSERT INTO product_images (product_id, image_url) VALUES ?', [additionalImages.map((url) => [id, url])]);
      const retainedVariantIds = variants.filter((variant) => variant.id).map((variant) => variant.id);
      if (retainedVariantIds.length) {
        await connection.query('UPDATE product_variants SET is_active = FALSE WHERE product_id = ? AND id NOT IN (?)', [id, retainedVariantIds]);
      } else {
        await connection.query('UPDATE product_variants SET is_active = FALSE WHERE product_id = ?', [id]);
      }
      for (const variant of variants) {
        if (variant.id) {
          await connection.query('UPDATE product_variants SET name = ?, price = ?, cost_price = ?, stock = ?, is_active = TRUE WHERE id = ? AND product_id = ?', [variant.name, variant.price, variant.cost_price, variant.stock, variant.id, id]);
        } else {
          await connection.query('INSERT INTO product_variants (product_id, name, price, cost_price, stock) VALUES (?, ?, ?, ?, ?)', [id, variant.name, variant.price, variant.cost_price, variant.stock]);
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.json({ message: 'Producto actualizado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar producto
app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query(
      'UPDATE products SET is_active = FALSE WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'No se encontró el producto.' });
      return;
    }
    res.json({ message: 'Producto eliminado del catálogo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Guardar el pedido antes de abrir WhatsApp. Los precios se calculan en el backend.
app.post('/api/orders', async (req, res) => {
  const customerName = String(req.body?.customer_name || '').trim();
  const deliveryMethod = String(req.body?.delivery_method || '').trim();
  const notes = String(req.body?.notes || '').trim();
  const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!customerName || customerName.length > 200 || !deliveryMethod || !requestedItems.length || requestedItems.length > 50) {
    res.status(400).json({ error: 'Faltan datos válidos para registrar el pedido.' });
    return;
  }

  const quantities = new Map();
  for (const item of requestedItems) {
    const productId = String(item.product_id || '');
    const variantId = item.variant_id ? String(item.variant_id) : '';
    const quantity = Number(item.quantity);
    if (!/^\d+$/.test(productId) || (variantId && !/^\d+$/.test(variantId)) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      res.status(400).json({ error: 'El pedido contiene un producto o una cantidad inválida.' });
      return;
    }
    const key = `${productId}:${variantId}`;
    const entry = quantities.get(key) || { product_id: productId, variant_id: variantId, quantity: 0 };
    entry.quantity += quantity;
    quantities.set(key, entry);
  }

  try {
    await ensureStoreOrdersTable();
    await ensureProductVariantsTable();
    const productIds = [...new Set([...quantities.values()].map((entry) => entry.product_id))];
    const [products] = await pool.query(
      'SELECT id, name, price, cost_price, stock FROM products WHERE is_active = TRUE AND id IN (?)',
      [productIds]
    );
    if (products.length !== productIds.length) {
      res.status(409).json({ error: 'Uno o más productos ya no están disponibles.' });
      return;
    }
    const [variantRows] = await pool.query('SELECT id, product_id, name, price, cost_price, stock FROM product_variants WHERE is_active = TRUE AND product_id IN (?)', [productIds]);
    const variantsByProduct = new Map();
    const variantsById = new Map();
    for (const variant of variantRows) {
      variantsByProduct.set(String(variant.product_id), (variantsByProduct.get(String(variant.product_id)) || 0) + 1);
      variantsById.set(String(variant.id), variant);
    }
    const productById = new Map(products.map((product) => [String(product.id), product]));
    const items = [];
    for (const entry of quantities.values()) {
      const product = productById.get(entry.product_id);
      const variant = entry.variant_id ? variantsById.get(entry.variant_id) : null;
      if (variantsByProduct.has(entry.product_id) && !entry.variant_id) {
        res.status(400).json({ error: `Selecciona una opción para ${product.name}.` });
        return;
      }
      if (entry.variant_id && (!variant || String(variant.product_id) !== entry.product_id)) {
        res.status(409).json({ error: `La opción elegida para ${product.name} ya no está disponible.` });
        return;
      }
      const stockValue = variant ? variant.stock : product.stock;
      const hasStockValue = stockValue !== null && stockValue !== undefined && stockValue !== '';
      if (hasStockValue && Number(stockValue) < entry.quantity) {
        res.status(409).json({ error: `No hay suficiente stock de ${product.name}${variant ? ` (${variant.name})` : ''}.` });
        return;
      }
      const unitPrice = Number(variant?.price ?? product.price);
      const unitCost = Number(variant?.cost_price ?? product.cost_price ?? 0);
      items.push({
        product_id: product.id,
        variant_id: variant?.id || null,
        variant_name: variant?.name || null,
        name: product.name,
        quantity: entry.quantity,
        unit_price: unitPrice,
        unit_cost: unitCost,
        subtotal: unitPrice * entry.quantity
      });
    }
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    const totalCost = items.reduce((sum, item) => sum + item.unit_cost * item.quantity, 0);
    const [result] = await pool.query(
      `INSERT INTO store_orders
        (customer_name, delivery_method, notes, items_json, total, total_cost, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pendiente')`,
      [customerName, deliveryMethod, notes, JSON.stringify(items), total, totalCost]
    );
    res.status(201).json({ id: result.insertId, total, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// RUTAS FINANCIERAS Y ADMINISTRATIVAS
// ==========================================

// Métricas de ventas, gastos y ganancia neta
app.get('/api/admin/metrics', requireAdmin, async (req, res) => {
  try {
    await ensureStoreOrdersTable();
    await ensureProductVariantsTable();
    // Total facturado y ganancia bruta
    const [salesRow] = await pool.query(`
      SELECT 
        COALESCE(SUM(total_revenue), 0) AS total_revenue,
        COALESCE(SUM(total_cost), 0) AS total_cost_of_goods,
        COALESCE(SUM(gross_profit), 0) AS gross_profit,
        COUNT(id) AS total_orders
      FROM orders 
      WHERE status = 'completado'
    `);

    // Total de gastos operativos
    const [expensesRow] = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM expenses
    `);

    const [storeSalesRow] = await pool.query(`
      SELECT
        COALESCE(SUM(total), 0) AS total_revenue,
        COALESCE(SUM(total_cost), 0) AS total_cost_of_goods,
        COALESCE(SUM(total - total_cost), 0) AS gross_profit,
        COUNT(id) AS total_orders
      FROM store_orders
      WHERE status = 'completado'
    `);

    // Valor del inventario actual inmovilizado
    const [stockRow] = await pool.query(`
      SELECT 
        COALESCE(SUM(stock * cost_price), 0) AS inventory_cost_value,
        COALESCE(SUM(stock * price), 0) AS inventory_retail_value,
        COUNT(id) AS total_products,
        SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END) AS low_stock_count
      FROM products p WHERE is_active = TRUE
        AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = TRUE)
    `);
    const [variantStockRow] = await pool.query(`
      SELECT COALESCE(SUM(v.stock * v.cost_price), 0) AS inventory_cost_value,
        COALESCE(SUM(v.stock * v.price), 0) AS inventory_retail_value,
        COALESCE(SUM(CASE WHEN v.stock = 0 THEN 1 ELSE 0 END), 0) AS low_stock_count
      FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.is_active = TRUE AND v.is_active = TRUE
    `);
    const [productCountRow] = await pool.query('SELECT COUNT(*) AS total_products FROM products WHERE is_active = TRUE');

    const revenue = Number(salesRow[0].total_revenue) + Number(storeSalesRow[0].total_revenue);
    const costOfGoods = Number(salesRow[0].total_cost_of_goods) + Number(storeSalesRow[0].total_cost_of_goods);
    const grossProfit = Number(salesRow[0].gross_profit) + Number(storeSalesRow[0].gross_profit);
    const expenses = Number(expensesRow[0].total_expenses);
    const netProfit = grossProfit - expenses; // Ganancia neta real en mano
    const profitMargin = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : 0;

    res.json({
      revenue,
      costOfGoods,
      grossProfit,
      expenses,
      netProfit,
      profitMargin,
      totalOrders: Number(salesRow[0].total_orders) + Number(storeSalesRow[0].total_orders),
      inventoryCostValue: Number(stockRow[0].inventory_cost_value) + Number(variantStockRow[0].inventory_cost_value),
      inventoryRetailValue: Number(stockRow[0].inventory_retail_value) + Number(variantStockRow[0].inventory_retail_value),
      totalProducts: Number(productCountRow[0].total_products),
      lowStockCount: Number(stockRow[0].low_stock_count) + Number(variantStockRow[0].low_stock_count)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Registrar un gasto
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    await ensureStoreOrdersTable();
    const [rows] = await pool.query(
      'SELECT id, customer_name, delivery_method, notes, items_json, total, status, created_at FROM store_orders ORDER BY created_at DESC, id DESC'
    );
    res.json(rows.map((row) => ({
      ...row,
      items: JSON.parse(row.items_json),
      total: Number(row.total)
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['completado', 'cancelado'].includes(status)) {
    res.status(400).json({ error: 'Estado de pedido inválido.' });
    return;
  }
  const connection = await pool.getConnection();
  try {
    await ensureStoreOrdersTable();
    await connection.beginTransaction();
    const [orders] = await connection.query(
      'SELECT status, items_json FROM store_orders WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!orders.length) {
      await connection.rollback();
      res.status(404).json({ error: 'No se encontró el pedido.' });
      return;
    }
    const order = orders[0];
    if (order.status === 'completado' && status !== 'completado') {
      await connection.rollback();
      res.status(409).json({ error: 'Un pedido completado no se puede cancelar desde aquí.' });
      return;
    }
    if (status === 'completado' && order.status !== 'completado') {
      const items = JSON.parse(order.items_json);
      for (const item of items) {
          if (item.variant_id) {
            const [variants] = await connection.query('SELECT stock FROM product_variants WHERE id = ? AND product_id = ? FOR UPDATE', [item.variant_id, item.product_id]);
            if (!variants.length) throw new Error(`No se encontró la opción elegida de ${item.name} al completar el pedido.`);
            if (Number(variants[0].stock) < Number(item.quantity)) {
              await connection.rollback();
              res.status(409).json({ error: `No hay suficiente stock de ${item.name} (${item.variant_name}) para completar el pedido.` });
              return;
            }
            await connection.query('UPDATE product_variants SET stock = stock - ? WHERE id = ?', [item.quantity, item.variant_id]);
            continue;
          }
        const [products] = await connection.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
        if (!products.length) throw new Error(`No se encontró ${item.name} al completar el pedido.`);
        const stock = products[0].stock;
        if (stock !== null && stock !== undefined && stock !== '') {
          if (Number(stock) < Number(item.quantity)) {
            await connection.rollback();
            res.status(409).json({ error: `No hay suficiente stock de ${item.name} para completar el pedido.` });
            return;
          }
          await connection.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product_id]);
        }
      }
    }
    await connection.query('UPDATE store_orders SET status = ? WHERE id = ?', [status, req.params.id]);
    await connection.commit();
    res.json({ message: 'Estado del pedido actualizado.' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

app.post('/api/admin/expenses', requireAdmin, async (req, res) => {
  const { concept, category, amount, expense_date } = req.body;
  try {
    const [result] = await pool.query(
      `INSERT INTO expenses (concept, category, amount, expense_date) VALUES (?, ?, ?, ?)`,
      [concept, category, amount, expense_date || new Date().toISOString().slice(0, 10)]
    );
    res.json({ id: result.insertId, message: 'Gasto registrado correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({
      error: status === 413
        ? `La imagen supera el límite de ${MAX_IMAGE_SIZE_MB} MB.`
        : 'No se pudo procesar la imagen seleccionada.'
    });
    return;
  }

  if (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor de Alquimia Beauty's corriendo en http://localhost:${PORT}`);
});
