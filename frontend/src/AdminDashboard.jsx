import React, { useState, useEffect, useRef } from 'react';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Package, 
  AlertTriangle, 
  Plus, 
  Trash2, 
  Edit3, 
  CheckCircle, 
  RefreshCw, 
  Sparkles,
  ArrowLeft,
  LockKeyhole,
  LogOut,
  CheckCircle2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from './api';

async function readApiJson(response, label) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`${label}: ${response.url} devolvió HTML en lugar de JSON. Revisa VITE_API_URL en el Static Site.`);
  }

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(`${label}: ${data.error || response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export default function AdminDashboard({ onBackToStore }) {
  const navigate = useNavigate();
  const [authStatus, setAuthStatus] = useState('checking');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [orders, setOrders] = useState([]);
  
  const [metrics, setMetrics] = useState({
    revenue: 0,
    costOfGoods: 0,
    grossProfit: 0,
    expenses: 0,
    netProfit: 0,
    profitMargin: 0,
    totalOrders: 0,
    inventoryCostValue: 0,
    inventoryRetailValue: 0,
    totalProducts: 0,
    lowStockCount: 0
  });

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dataError, setDataError] = useState('');

  // Formulario de Producto
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);
  const [selectedImages, setSelectedImages] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [existingImages, setExistingImages] = useState([]);
  const [productVariants, setProductVariants] = useState([]);
  const imageInputRef = useRef(null);
  const imagePreviewUrlsRef = useRef([]);
  const [productForm, setProductForm] = useState({
    name: '',
    category_id: 1,
    description: '',
    price: '',
    cost_price: '',
    stock: 10,
    image_url: ''
  });

  // Formulario rápido de Gastos
  const [expenseForm, setExpenseForm] = useState({
    concept: '',
    category: 'Packaging',
    amount: ''
  });

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [prodRes, catRes, metRes, ordersRes] = await Promise.all([
        fetch(apiUrl('/api/products'), { credentials: 'include' }),
        fetch(apiUrl('/api/categories'), { credentials: 'include' }),
        fetch(apiUrl('/api/admin/metrics'), { credentials: 'include' }),
        fetch(apiUrl('/api/admin/orders'), { credentials: 'include' })
      ]);

      const results = await Promise.allSettled([
        readApiJson(prodRes, 'Productos'),
        readApiJson(catRes, 'Categorías'),
        readApiJson(metRes, 'Métricas'),
        readApiJson(ordersRes, 'Pedidos')
      ]);
      const errors = [];
      if (results[0].status === 'fulfilled') setProducts(results[0].value);
      else errors.push(results[0].reason.message);
      if (results[1].status === 'fulfilled') setCategories(results[1].value);
      else errors.push(results[1].reason.message);
      if (results[2].status === 'fulfilled') setMetrics(results[2].value);
      else errors.push(results[2].reason.message);
      if (results[3].status === 'fulfilled') setOrders(results[3].value);
      else errors.push(results[3].reason.message);
      if (results.some((result) => result.status === 'rejected' && result.reason.status === 401)) {
        setAuthStatus('anonymous');
      }
      setDataError(errors.join(' · '));
    } catch (err) {
      setDataError(err.message || 'No se pudo conectar con el backend.');
      console.warn('No se pudieron cargar los datos del backend.', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/admin/session'), { credentials: 'include' })
      .then(async (response) => {
        const session = await response.json();
        if (!response.ok) throw new Error(session.error || 'No se pudo comprobar la sesión.');
        if (cancelled) return;
        if (!session.configured) {
          setLoginError('El administrador todavía no configuró la contraseña en Render.');
          setAuthStatus('anonymous');
          return;
        }
        if (session.authenticated) {
          setAuthStatus('authenticated');
          loadData();
        } else {
          setAuthStatus('anonymous');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoginError(error.message);
          setAuthStatus('anonymous');
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    imagePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const handleImageChange = (e) => {
    imagePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    const files = Array.from(e.target.files || []).slice(0, 10);
    const previewUrls = files.map((file) => URL.createObjectURL(file));
    imagePreviewUrlsRef.current = previewUrls;
    setSelectedImages(files);
    setImagePreviews(previewUrls);
    if (e.target.files?.length > 10) {
      alert('Puedes subir hasta 10 fotos por vez.');
    }
  };

  const clearSelectedImage = () => {
    imagePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    imagePreviewUrlsRef.current = [];
    setSelectedImages([]);
    setImagePreviews([]);
    setExistingImages([]);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  // Guardar o Editar Producto
  const handleSubmitProduct = async (e) => {
    e.preventDefault();
    if (!productForm.name || (!productForm.price && !productVariants.length) || (!productForm.image_url && selectedImages.length === 0)) {
      alert('Completa el nombre, un precio o las opciones, y selecciona al menos una foto.');
      return;
    }

    try {
      const method = isEditing ? 'PUT' : 'POST';
      const endpoint = isEditing 
        ? apiUrl(`/api/products/${editId}`)
        : apiUrl('/api/products');
      const formData = new FormData();
      Object.entries(productForm).forEach(([key, value]) => formData.append(key, value));
      formData.append('variants', JSON.stringify(productVariants));
      selectedImages.forEach((image) => formData.append('images', image));

      const res = await fetch(endpoint, {
        method,
        credentials: 'include',
        body: formData
      });

      if (!res.ok) {
        const result = await res.json();
        alert(result.error || 'No se pudo guardar el producto.');
        return;
      }

      alert(isEditing ? '¡Producto actualizado!' : '¡Producto agregado con éxito!');
      resetProductForm();
      await loadData();
    } catch (err) {
      alert('No se pudo conectar con el servidor.');
    }
  };

  // Registrar un Gasto Operativo
  const handleSubmitExpense = async (e) => {
    e.preventDefault();
    if (!expenseForm.concept || !expenseForm.amount) return;

    try {
      const res = await fetch(apiUrl('/api/admin/expenses'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expenseForm)
      });

      if (res.ok) {
        alert('Gasto registrado con éxito');
        setExpenseForm({ concept: '', category: 'Packaging', amount: '' });
        loadData();
      }
    } catch (err) {
      alert('Error registrando el gasto.');
    }
  };

  const startEditProduct = (prod) => {
    setIsEditing(true);
    setEditId(prod.id);
    setProductForm({
      name: prod.name,
      category_id: prod.category_id || 1,
      description: prod.description || '',
      price: prod.price,
      cost_price: prod.cost_price || 0,
      stock: prod.stock,
      image_url: prod.image_url
    });
    setProductVariants((prod.variants || []).map((variant) => ({
      id: variant.id,
      name: variant.name,
      price: String(variant.price),
      cost_price: String(variant.cost_price || 0),
      stock: String(variant.stock)
    })));
    clearSelectedImage();
    setExistingImages(prod.images || (prod.image_url ? [prod.image_url] : []));
    window.scrollTo({ top: 350, behavior: 'smooth' });
  };

  const resetProductForm = () => {
    setIsEditing(false);
    setEditId(null);
    clearSelectedImage();
    setProductVariants([]);
    setProductForm({
      name: '',
      category_id: categories[0]?.id || 1,
      description: '',
      price: '',
      cost_price: '',
      stock: 10,
      image_url: ''
    });
  };

  const deleteProduct = async (id) => {
    if (!window.confirm('¿Seguro que deseas eliminar este producto?')) return;
    try {
      const res = await fetch(apiUrl(`/api/products/${id}`), { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const result = await res.json();
        alert(result.error || 'No se pudo eliminar el producto.');
        return;
      }

      setProducts((prev) => prev.filter((p) => p.id !== id));
      await loadData();
    } catch (err) {
      alert(err.message || 'No se pudo conectar con el servidor para eliminar el producto.');
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError('');
    try {
      const response = await fetch(apiUrl('/api/admin/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo iniciar sesión.');
      const sessionResponse = await fetch(apiUrl('/api/admin/session'), { credentials: 'include' });
      const session = await sessionResponse.json();
      if (!sessionResponse.ok || !session.authenticated) {
        throw new Error('El navegador no conservó la sesión. Revisa FRONTEND_URL en el backend y vuelve a desplegar.');
      }
      setLoginPassword('');
      setAuthStatus('authenticated');
      await loadData();
    } catch (error) {
      setLoginError(error.message || 'No se pudo conectar con el servidor.');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(apiUrl('/api/admin/logout'), { method: 'POST', credentials: 'include' });
    } finally {
      setProducts([]);
      setOrders([]);
      setAuthStatus('anonymous');
      setLoginError('');
    }
  };

  const updateOrderStatus = async (orderId, status) => {
    try {
      const response = await fetch(apiUrl(`/api/admin/orders/${orderId}/status`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo actualizar el pedido.');
      await loadData();
    } catch (error) {
      alert(error.message || 'No se pudo actualizar el pedido.');
    }
  };

  if (authStatus === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#faf5ff] text-purple-800">
        Comprobando acceso al panel…
      </div>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#faf5ff] p-4 text-purple-950">
        <form onSubmit={handleLogin} className="w-full max-w-sm rounded-2xl border border-purple-100 bg-white p-7 shadow-lg">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-purple-700">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold font-serif">Administración</h1>
          <p className="mt-1 text-sm text-purple-600">Ingresa tu contraseña para continuar.</p>
          <label htmlFor="admin-password" className="mt-6 block text-sm font-semibold text-purple-900">
            Contraseña
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            required
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            className="mt-2 w-full rounded-xl border border-purple-200 px-4 py-3 outline-none focus:ring-2 focus:ring-purple-400"
          />
          {loginError && <p className="mt-3 text-sm text-rose-700">{loginError}</p>}
          <button type="submit" className="mt-5 w-full rounded-xl bg-purple-700 py-3 font-semibold text-white hover:bg-purple-800">
            Entrar al panel
          </button>
          <button type="button" onClick={() => navigate('/')} className="mt-3 w-full py-2 text-sm text-purple-700 hover:underline">
            Volver a la tienda
          </button>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf5ff] text-[#2e1065] p-4 sm:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Encabezado */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-purple-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-600 text-white rounded-2xl shadow-sm">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold font-serif text-purple-950">
                Alquimia Beauty's • Administración
              </h1>
              <p className="text-xs text-purple-600">
                Control de Stock, Finanzas, Gastos y Catálogo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="p-2.5 bg-white border border-purple-200 rounded-xl hover:bg-purple-100 text-purple-700 transition"
              title="Actualizar datos"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-xl border border-purple-200 bg-white px-3 py-2.5 text-sm font-semibold text-purple-700 transition hover:bg-purple-100"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Salir</span>
            </button>
            {onBackToStore && (
              <button
  onClick={() => navigate('/')}
  className="flex items-center gap-2 px-4 py-2.5 bg-purple-100 hover:bg-purple-200 text-purple-900 rounded-xl text-sm font-semibold transition"
>
  <ArrowLeft className="w-4 h-4" />
  Ir a la Tienda
</button>
            )}
          </div>
        </div>

        {/* Tarjetas de Métricas Financieras */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Ingresos Totales */}
          <div className="bg-white p-5 rounded-2xl border border-purple-100 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-purple-600">
                Ingresos (Ventas)
              </span>
              <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-purple-950">
              ${Number(metrics.revenue).toLocaleString('es-AR')}
            </div>
            <p className="text-xs text-purple-500 mt-1">{metrics.totalOrders} pedidos cerrados</p>
          </div>

          {/* Gastos Totales */}
          <div className="bg-white p-5 rounded-2xl border border-purple-100 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-purple-600">
                Gastos Operativos
              </span>
              <div className="p-2 bg-rose-100 text-rose-700 rounded-xl">
                <TrendingDown className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-purple-950">
              ${Number(metrics.expenses).toLocaleString('es-AR')}
            </div>
            <p className="text-xs text-purple-500 mt-1">Packaging, envíos, difusión</p>
          </div>

          {/* Ganancia Neta Real */}
          <div className="bg-white p-5 rounded-2xl border border-purple-200 shadow-sm bg-gradient-to-br from-white to-purple-50/60">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-purple-700">
                Ganancia Neta Real
              </span>
              <div className="p-2 bg-purple-600 text-white rounded-xl">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-purple-950">
              ${Number(metrics.netProfit).toLocaleString('es-AR')}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs px-2 py-0.5 bg-purple-200 text-purple-900 rounded-md font-semibold">
                Margen: {metrics.profitMargin}%
              </span>
            </div>
          </div>

          {/* Valor de Inventario */}
          <div className="bg-white p-5 rounded-2xl border border-purple-100 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-purple-600">
                Capital en Mercadería
              </span>
              <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
                <Package className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-purple-950">
              ${Number(metrics.inventoryCostValue).toLocaleString('es-AR')}
            </div>
            <p className="text-xs text-purple-500 mt-1">
              Valor de venta: ${Number(metrics.inventoryRetailValue).toLocaleString('es-AR')}
            </p>
          </div>
        </div>

        {/* Sección Dividida: Formulario de Carga y Registro de Gastos */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Formulario de Producto (2 Columnas) */}
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-purple-100 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-purple-950 flex items-center gap-2">
                {isEditing ? <Edit3 className="w-5 h-5 text-purple-600" /> : <Plus className="w-5 h-5 text-purple-600" />}
                {isEditing ? 'Editar Producto' : 'Cargar Nuevo Producto'}
              </h2>
              {isEditing && (
                <button
                  onClick={resetProductForm}
                  className="text-xs text-purple-600 hover:underline font-semibold"
                >
                  Cancelar Edición
                </button>
              )}
            </div>

            <form onSubmit={handleSubmitProduct} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-purple-800 mb-1">
                    Nombre del Producto *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Body Mist Rosa Silvestre 100ml"
                    value={productForm.name}
                    onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                    className="w-full text-sm px-3.5 py-2 rounded-xl bg-purple-50/50 border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-purple-800 mb-1">
                    Rubro / Categoría *
                  </label>
                  <select
                    value={productForm.category_id}
                    onChange={(e) => setProductForm({ ...productForm, category_id: e.target.value })}
                    className="w-full text-sm px-3.5 py-2 rounded-xl bg-purple-50/50 border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400 text-purple-950"
                  >
                    {categories.length > 0 ? (
                      categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="1">Perfumes</option>
                        <option value="2">Maquillaje</option>
                        <option value="3">Uñas & Manicura</option>
                        <option value="4">Cuidado Facial</option>
                        <option value="5">Accesorios</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-purple-800 mb-1">
                  Descripción Corta
                </label>
                <input
                  type="text"
                  placeholder="Detalles, notas olfativas o acabados..."
                  value={productForm.description}
                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                  className="w-full text-sm px-3.5 py-2 rounded-xl bg-purple-50/50 border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-purple-800 mb-1">
                    Costo de Proveedor ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={productForm.cost_price}
                    onChange={(e) => setProductForm({ ...productForm, cost_price: e.target.value })}
                    className="w-full text-sm px-3.5 py-2 rounded-xl bg-purple-50/50 border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-purple-800 mb-1">
                    Precio de Venta ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required={productVariants.length === 0}
                    placeholder="0.00"
                    value={productForm.price}
                    onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                    className="w-full text-sm px-3.5 py-2 rounded-xl bg-purple-50/50 border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-purple-800 mb-1">
                    Stock Disponible
                  </label>
                  <input
                    type="number"
                    value={productForm.stock}
                    onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                    className="w-full text-sm px-3.5 py-2 rounded-xl bg-purple-50/50 border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
              </div>

              <section className="space-y-3 rounded-xl border border-purple-200 bg-purple-50/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-purple-950">Opciones del producto</h3>
                    <p className="text-xs text-purple-600">Por ejemplo, tonos, colores o tamaños. Cada opción puede tener precio y stock propios.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setProductVariants((variants) => [...variants, { name: '', price: '', cost_price: '', stock: '0' }])}
                    className="rounded-lg bg-purple-100 px-3 py-2 text-xs font-semibold text-purple-800 hover:bg-purple-200"
                  >
                    + Agregar opción
                  </button>
                </div>
                {productVariants.length > 0 && (
                  <div className="space-y-3">
                    {productVariants.map((variant, index) => (
                      <div key={index} className="grid grid-cols-1 gap-2 rounded-lg bg-white p-3 sm:grid-cols-[1.2fr_1fr_1fr_0.8fr_auto]">
                        <input aria-label={`Nombre de opción ${index + 1}`} required type="text" placeholder="Nombre (Rosa, 50 ml…)" value={variant.name} onChange={(event) => setProductVariants((all) => all.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} className="min-w-0 rounded-lg border border-purple-200 px-3 py-2 text-sm" />
                        <input aria-label={`Precio de opción ${index + 1}`} required type="number" min="0" step="0.01" placeholder="Precio $" value={variant.price} onChange={(event) => setProductVariants((all) => all.map((item, i) => i === index ? { ...item, price: event.target.value } : item))} className="min-w-0 rounded-lg border border-purple-200 px-3 py-2 text-sm" />
                        <input aria-label={`Costo de opción ${index + 1}`} type="number" min="0" step="0.01" placeholder="Costo $" value={variant.cost_price} onChange={(event) => setProductVariants((all) => all.map((item, i) => i === index ? { ...item, cost_price: event.target.value } : item))} className="min-w-0 rounded-lg border border-purple-200 px-3 py-2 text-sm" />
                        <input aria-label={`Stock de opción ${index + 1}`} required type="number" min="0" step="1" placeholder="Stock" value={variant.stock} onChange={(event) => setProductVariants((all) => all.map((item, i) => i === index ? { ...item, stock: event.target.value } : item))} className="min-w-0 rounded-lg border border-purple-200 px-3 py-2 text-sm" />
                        <button type="button" aria-label={`Quitar opción ${index + 1}`} onClick={() => setProductVariants((all) => all.filter((_, i) => i !== index))} className="rounded-lg px-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div>
                <label className="block text-xs font-semibold text-purple-800 mb-1">
                  Fotos del producto {isEditing ? '' : '*'}
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  required={!isEditing && !productForm.image_url && selectedImages.length === 0}
                  ref={imageInputRef}
                  onChange={handleImageChange}
                  className="w-full text-sm px-3.5 py-2 rounded-xl bg-purple-50/50 border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400 file:mr-3 file:rounded-lg file:border-0 file:bg-purple-100 file:px-3 file:py-1.5 file:text-purple-800"
                />
                <p className="mt-1 text-xs text-purple-500">
                  Seleccioná hasta 10 imágenes JPG, PNG o WebP, de hasta 20 MB cada una.
                  {isEditing && ' Las fotos nuevas se agregan a las actuales.'}
                </p>
                {(existingImages.length > 0 || imagePreviews.length > 0) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[...existingImages, ...imagePreviews].map((src, index) => (
                      <img
                        key={`${src}-${index}`}
                        src={src}
                        alt={`Foto ${index + 1} del producto`}
                        className="h-20 w-20 rounded-xl border border-purple-200 object-cover"
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Cálculo automático de Ganancia por Unidad */}
              {productForm.price > 0 && (
                <div className="p-3 bg-purple-50 rounded-xl text-xs flex justify-between items-center text-purple-900 font-medium">
                  <span>Ganancia estimada por unidad vendida:</span>
                  <span className="font-bold text-sm text-purple-950">
                    ${(Number(productForm.price) - Number(productForm.cost_price || 0)).toLocaleString('es-AR')}
                    {productForm.price > 0 && productForm.cost_price > 0 && (
                      <span className="ml-1 text-purple-700">
                        ({(((productForm.price - productForm.cost_price) / productForm.price) * 100).toFixed(0)}% margen)
                      </span>
                    )}
                  </span>
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-purple-700 hover:bg-purple-800 text-white font-semibold py-2.5 rounded-xl text-sm transition-all shadow-sm"
              >
                {isEditing ? 'Guardar Cambios del Producto' : 'Publicar Producto en Catálogo'}
              </button>
            </form>
          </div>

          {/* Registro Rápido de Gastos (1 Columna) */}
          <div className="bg-white p-6 rounded-2xl border border-purple-100 shadow-sm flex flex-col justify-between">
            <div>
              <h2 className="text-lg font-bold text-purple-950 mb-3 flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-rose-500" />
                Anotar Gasto del Negocio
              </h2>
              <p className="text-xs text-purple-600 mb-4">
                Lleva el control de packaging, viáticos o materiales para saber la ganancia neta exacta.
              </p>

              <form onSubmit={handleSubmitExpense} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-purple-800 mb-1">
                    Concepto
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Cintas lila, bolsas, envíos..."
                    value={expenseForm.concept}
                    onChange={(e) => setExpenseForm({ ...expenseForm, concept: e.target.value })}
                    className="w-full text-sm px-3.5 py-2 rounded-xl bg-purple-50/50 border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-purple-800 mb-1">
                    Rubro de Gasto
                  </label>
                  <select
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                    className="w-full text-sm px-3.5 py-2 rounded-xl bg-purple-50/50 border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400 text-purple-950"
                  >
                    <option value="Packaging">Packaging & Bolsas</option>
                    <option value="Envíos">Envíos / Cadetería</option>
                    <option value="Insumos">Insumos & Materiales</option>
                    <option value="Publicidad">Publicidad / Difusión</option>
                    <option value="Otros">Otros</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-purple-800 mb-1">
                    Monto Gastado ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                    className="w-full text-sm px-3.5 py-2 rounded-xl bg-purple-50/50 border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold py-2 rounded-xl text-sm transition"
                >
                  Registrar Gasto
                </button>
              </form>
            </div>

            <div className="mt-6 p-3 bg-purple-50 rounded-xl text-xs text-purple-700">
              💡 <strong>Regla administrativa:</strong> Los gastos se descuentan automáticamente de la ganancia bruta para darte el balance neto real.
            </div>
          </div>
        </div>

        {/* Pedidos iniciados por WhatsApp */}
        <section className="overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-sm">
          <div className="border-b border-purple-100 p-5">
            <h2 className="text-lg font-bold text-purple-950">Pedidos de WhatsApp ({orders.length})</h2>
            <p className="text-xs text-purple-600">Los pedidos se guardan como pendientes; marca completados cuando confirmes el pago.</p>
          </div>
          {orders.length === 0 ? (
            <p className="p-5 text-sm text-purple-500">Todavía no hay pedidos registrados.</p>
          ) : (
            <div className="divide-y divide-purple-100">
              {orders.map((order) => (
                <article key={order.id} className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-purple-950">Pedido #{order.id} · {order.customer_name}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        order.status === 'pendiente' ? 'bg-amber-100 text-amber-800' :
                          order.status === 'completado' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {order.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-purple-500">
                      {new Date(order.created_at).toLocaleString('es-AR')} · {order.delivery_method}
                    </p>
                    <ul className="mt-3 space-y-1 text-sm text-purple-800">
                      {order.items.map((item, index) => (
                        <li key={`${item.product_id}-${index}`}>
                          {item.name}{item.variant_name ? ` (${item.variant_name})` : ''} × {item.quantity} — ${Number(item.subtotal).toLocaleString('es-AR')}
                        </li>
                      ))}
                    </ul>
                    {order.notes && <p className="mt-2 text-sm text-purple-600">Nota: {order.notes}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
                    <span className="text-lg font-bold text-purple-950">${Number(order.total).toLocaleString('es-AR')}</span>
                    {order.status === 'pendiente' && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => updateOrderStatus(order.id, 'completado')}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="h-4 w-4" /> Marcar completado
                        </button>
                        <button
                          type="button"
                          onClick={() => updateOrderStatus(order.id, 'cancelado')}
                          className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Tabla de Inventario y Control de Stock */}
        <div className="bg-white rounded-2xl border border-purple-100 shadow-sm overflow-hidden">
          {dataError && (
            <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-800">
              No se pudieron cargar todos los datos: {dataError}
            </div>
          )}
          <div className="p-5 border-b border-purple-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-purple-950">
                Inventario Activo ({products.length} productos)
              </h2>
              <p className="text-xs text-purple-600">
                Supervisa stock disponible, costos y márgenes de cada artículo.
              </p>
            </div>
            {metrics.lowStockCount > 0 && (
              <span className="flex items-center gap-1.5 text-xs bg-amber-100 text-amber-800 px-3 py-1.5 rounded-full font-semibold">
                <AlertTriangle className="w-3.5 h-3.5" />
                {metrics.lowStockCount} con stock bajo
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-purple-50/60 text-purple-900 text-xs font-semibold uppercase">
                <tr>
                  <th className="p-4">Producto</th>
                  <th className="p-4">Categoría</th>
                  <th className="p-4">Costo</th>
                  <th className="p-4">Precio Venta</th>
                  <th className="p-4">Ganancia Unit.</th>
                  <th className="p-4">Stock</th>
                  <th className="p-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-100">
                {products.map((p) => {
                  const unitGain = Number(p.price) - Number(p.cost_price || 0);
                  const isLow = Number(p.stock) <= 3;

                  return (
                    <tr key={p.id} className="hover:bg-purple-50/30 transition">
                      <td className="p-4 flex items-center gap-3">
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="w-10 h-10 rounded-lg object-cover bg-purple-100"
                        />
                        <div>
                          <div className="font-semibold text-purple-950">{p.name}</div>
                          <div className="text-xs text-purple-500 line-clamp-1">{p.description}</div>
                        </div>
                      </td>
                      <td className="p-4 text-purple-800 text-xs">
                        {p.category_name || 'General'}
                      </td>
                      <td className="p-4 text-purple-700">
                        ${Number(p.cost_price || 0).toLocaleString('es-AR')}
                      </td>
                      <td className="p-4 font-bold text-purple-950">
                        ${Number(p.price).toLocaleString('es-AR')}
                      </td>
                      <td className="p-4">
                        <span className="text-emerald-700 font-semibold">
                          +${unitGain.toLocaleString('es-AR')}
                        </span>
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                            isLow
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {p.stock} un.
                        </span>
                      </td>
                      <td className="p-4 text-right space-x-2">
                        <button
                          onClick={() => startEditProduct(p)}
                          className="p-1.5 text-purple-600 hover:bg-purple-100 rounded-lg transition"
                          title="Editar"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteProduct(p.id)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
