import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 4000;
const uploadsDirectory = fileURLToPath(new URL('./uploads/', import.meta.url));
mkdirSync(uploadsDirectory, { recursive: true });

const imageExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDirectory,
    filename: (req, file, callback) => {
      callback(null, `${randomUUID()}${imageExtensions[file.mimetype]}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!imageExtensions[file.mimetype]) {
      callback(new Error('El formato de la imagen debe ser JPG, PNG o WebP.'));
      return;
    }
    callback(null, true);
  }
});

app.use(cors());
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

if (process.env.DB_CA_PATH) {
  databaseConfig.ssl = { ca: readFileSync(process.env.DB_CA_PATH, 'utf8') };
} else if (process.env.DB_SSL === 'true') {
  databaseConfig.ssl = {};
}

if (!databaseConfig.host || !databaseConfig.user || !databaseConfig.password || !databaseConfig.database) {
  console.warn('Faltan variables DB_HOST, DB_USER, DB_PASSWORD o DB_NAME. Configúralas en el entorno del servicio.');
}

const pool = mysql.createPool(databaseConfig);
let productImagesTablePromise;

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

function uploadedImageUrls(req) {
  return (req.files || []).map((file) => `${req.protocol}://${req.get('host')}/uploads/${file.filename}`);
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
        images.push(image.image_url);
        extraImagesByProduct.set(productId, images);
      }
      for (const product of rows) {
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
app.post('/api/products', upload.array('images', 10), async (req, res) => {
  const { category_id, name, description, price, cost_price, stock } = req.body;
  const images = uploadedImageUrls(req);
  const image_url = images[0] || req.body.image_url;
  try {
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
app.put('/api/products/:id', upload.array('images', 10), async (req, res) => {
  const { id } = req.params;
  const { category_id, name, description, price, cost_price, stock, is_active } = req.body;
  const images = uploadedImageUrls(req);
  const image_url = req.body.image_url || images[0];
  try {
    await ensureProductImagesTable();
    await pool.query(
      `UPDATE products 
       SET category_id = ?, name = ?, description = ?, price = ?, cost_price = ?, image_url = ?, stock = ?, is_active = ?
       WHERE id = ?`,
      [category_id, name, description, price, cost_price, image_url, stock, is_active ?? 1, id]
    );
    if (images.length) {
      await pool.query(
        'INSERT INTO product_images (product_id, image_url) VALUES ?',
        [images.map((url) => [id, url])]
      );
    }
    res.json({ message: 'Producto actualizado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar producto
app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await ensureProductImagesTable();
    await pool.query('DELETE FROM product_images WHERE product_id = ?', [id]);
    await pool.query('DELETE FROM products WHERE id = ?', [id]);
    res.json({ message: 'Producto eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// RUTAS FINANCIERAS Y ADMINISTRATIVAS
// ==========================================

// Métricas de ventas, gastos y ganancia neta
app.get('/api/admin/metrics', async (req, res) => {
  try {
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

    // Valor del inventario actual inmovilizado
    const [stockRow] = await pool.query(`
      SELECT 
        COALESCE(SUM(stock * cost_price), 0) AS inventory_cost_value,
        COALESCE(SUM(stock * price), 0) AS inventory_retail_value,
        COUNT(id) AS total_products,
        SUM(CASE WHEN stock <= 3 THEN 1 ELSE 0 END) AS low_stock_count
      FROM products WHERE is_active = TRUE
    `);

    const revenue = Number(salesRow[0].total_revenue);
    const costOfGoods = Number(salesRow[0].total_cost_of_goods);
    const grossProfit = Number(salesRow[0].gross_profit);
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
      totalOrders: salesRow[0].total_orders,
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
app.post('/api/admin/expenses', async (req, res) => {
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
        ? 'La imagen supera el límite de 5 MB.'
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
