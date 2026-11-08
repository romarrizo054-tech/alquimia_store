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
const cloudinaryCredentials = process.env.CLOUDINARY_URL
  ? (() => {
      const cloudinaryUrl = new URL(process.env.CLOUDINARY_URL);
      if (cloudinaryUrl.protocol !== 'cloudinary:' || !cloudinaryUrl.hostname || !cloudinaryUrl.username || !cloudinaryUrl.password) {
        throw new Error('CLOUDINARY_URL no tiene el formato cloudinary://API_KEY:API_SECRET@CLOUD_NAME.');
      }
      return {
        cloudName: cloudinaryUrl.hostname,
        apiKey: decodeURIComponent(cloudinaryUrl.username),
        apiSecret: decodeURIComponent(cloudinaryUrl.password)
      };
    })()
  : null;
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

const allowedOrigins = new Set([
  process.env.FRONTEND_URL || 'https://alquimia-store-1.onrender.com',
  'http://localhost:5173'
]);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
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
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${ADMIN_SESSION_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`);
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
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`);
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
  const { category } = req.query;
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

    query += ' ORDER BY p.id DESC';
    const [rows] = await pool.query(query, params);
    await ensureProductImagesTable();
    if (rows.length) {
      const [imageRows] = await pool.query(
        'SELECT product_id, image_url FROM product_images WHERE product_id IN (?) ORDER BY id ASC',
        [rows.map((product) => product.id)]
      );
      const extraImagesByProduct = new Map();
      for (const image of imageRows) {
        const productId = String(image.product_id);
        const images = extraImagesByProduct.get(productId) || [];
        images.push(publicImageUrl(req, image.image_url));
        extraImagesByProduct.set(productId, images);
      }
      for (const product of rows) {
        product.image_url = publicImageUrl(req, product.image_url);
        product.images = [product.image_url, ...(extraImagesByProduct.get(String(product.id)) || [])].filter(Boolean);
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
    const images = await uploadedImageUrls(req);
    const image_url = images[0] || req.body.image_url;
    await ensureProductImagesTable();
    const [result] = await pool.query(
      `INSERT INTO products (category_id, name, description, price, cost_price, image_url, stock, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [category_id, name, description, price, cost_price || 0, image_url, stock || 0]
    );
    if (images.length > 1) {
      await pool.query(
        'INSERT INTO product_images (product_id, image_url) VALUES ?',
        [images.slice(1).map((url) => [result.insertId, url])]
      );
    }
    res.json({ id: result.insertId, message: 'Producto creado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Modificar producto
app.put('/api/products/:id', requireAdmin, productImageUpload, async (req, res) => {
  const { id } = req.params;
  const { category_id, name, description, price, cost_price, stock, is_active } = req.body;
  try {
    const images = await uploadedImageUrls(req);
    const image_url = req.body.image_url || images[0];
    await ensureProductImagesTable();
    await pool.query(
      `UPDATE products 
       SET category_id = ?, name = ?, description = ?, price = ?, cost_price = ?, image_url = ?, stock = ?, is_active = ?
       WHERE id = ?`,
      [category_id, name, description, price, cost_price, image_url, stock, is_active ?? 1, id]
    );
    const additionalImages = req.body.image_url ? images : images.slice(1);
    if (additionalImages.length) {
      await pool.query(
        'INSERT INTO product_images (product_id, image_url) VALUES ?',
        [additionalImages.map((url) => [id, url])]
      );
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
    const quantity = Number(item.quantity);
    if (!/^\d+$/.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      res.status(400).json({ error: 'El pedido contiene un producto o una cantidad inválida.' });
      return;
    }
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }

  try {
    await ensureStoreOrdersTable();
    const productIds = [...quantities.keys()];
    const [products] = await pool.query(
      'SELECT id, name, price, cost_price, stock FROM products WHERE is_active = TRUE AND id IN (?)',
      [productIds]
    );
    if (products.length !== productIds.length) {
      res.status(409).json({ error: 'Uno o más productos ya no están disponibles.' });
      return;
    }
    const unavailableProduct = products.find((product) => {
      const hasStockValue = product.stock !== null && product.stock !== undefined && product.stock !== '';
      return hasStockValue && Number(product.stock) < quantities.get(String(product.id));
    });
    if (unavailableProduct) {
      res.status(409).json({ error: `No hay suficiente stock de ${unavailableProduct.name}.` });
      return;
    }

    const items = products.map((product) => {
      const quantity = quantities.get(String(product.id));
      return {
        product_id: product.id,
        name: product.name,
        quantity,
        unit_price: Number(product.price),
        unit_cost: Number(product.cost_price || 0),
        subtotal: Number(product.price) * quantity
      };
    });
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
        SUM(CASE WHEN stock <= 3 THEN 1 ELSE 0 END) AS low_stock_count
      FROM products WHERE is_active = TRUE
    `);

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
      inventoryCostValue: Number(stockRow[0].inventory_cost_value),
      inventoryRetailValue: Number(stockRow[0].inventory_retail_value),
      totalProducts: stockRow[0].total_products,
      lowStockCount: Number(stockRow[0].low_stock_count)
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
