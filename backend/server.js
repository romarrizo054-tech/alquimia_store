import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

dotenv.config();

const app = express();
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
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '2003',
  database: process.env.DB_NAME || 'alquimia_beautys',
  waitForConnections: true,
  connectionLimit: 10,
});

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
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// RUTAS DE GESTIÓN DE PRODUCTOS (CRUD)
// ==========================================

// Crear producto
app.post('/api/products', upload.single('image'), async (req, res) => {
  const { category_id, name, description, price, cost_price, stock } = req.body;
  const image_url = req.file
    ? `http://localhost:${PORT}/uploads/${req.file.filename}`
    : req.body.image_url;
  try {
    const [result] = await pool.query(
      `INSERT INTO products (category_id, name, description, price, cost_price, image_url, stock) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [category_id, name, description, price, cost_price || 0, image_url, stock || 0]
    );
    res.json({ id: result.insertId, message: 'Producto creado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Modificar producto
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { category_id, name, description, price, cost_price, stock, is_active } = req.body;
  const image_url = req.file
    ? `http://localhost:${PORT}/uploads/${req.file.filename}`
    : req.body.image_url;
  try {
    await pool.query(
      `UPDATE products 
       SET category_id = ?, name = ?, description = ?, price = ?, cost_price = ?, image_url = ?, stock = ?, is_active = ?
       WHERE id = ?`,
      [category_id, name, description, price, cost_price, image_url, stock, is_active, id]
    );
    res.json({ message: 'Producto actualizado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar producto
app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
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