import React, { useState, useEffect } from 'react';
import { apiUrl } from './api';
import { 
  ShoppingBag, 
  Trash2, 
  Plus, 
  Minus, 
  X, 
  Search, 
  Sparkles, 
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Eye
} from 'lucide-react';
const WHATSAPP_PHONE = '5493834964896'; // Tu número de WhatsApp sin el +

const INITIAL_CATEGORIES = [
  { id: 1, name: 'Perfumes', slug: 'perfumes' },
  { id: 2, name: 'Maquillaje', slug: 'maquillaje' },
  { id: 3, name: 'Uñas & Manicura', slug: 'unas' },
  { id: 4, name: 'Cuidado Facial', slug: 'cuidado-facial' }
];

function ProductImageGallery({ product, eager = false }) {
  const images = product.images?.length ? product.images : [product.image_url].filter(Boolean);
  const hasVariants = (product.variants || []).length > 0;
  const hasAvailableVariant = (product.variants || []).some((variant) => Number(variant.stock) > 0);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeImage = images[activeIndex] || images[0];

  return (
    <>
      <div className="relative aspect-square overflow-hidden bg-purple-50">
        {activeImage && (
          <img
            src={activeImage}
            alt={`${product.name}${images.length > 1 ? ` - foto ${activeIndex + 1}` : ''}`}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        )}
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setActiveIndex((index) => (index - 1 + images.length) % images.length)}
              aria-label="Ver foto anterior"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1.5 text-purple-800 shadow hover:bg-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setActiveIndex((index) => (index + 1) % images.length)}
              aria-label="Ver foto siguiente"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1.5 text-purple-800 shadow hover:bg-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-1 text-xs font-medium text-purple-800">
              {activeIndex + 1} / {images.length}
            </span>
          </>
        )}
        <span className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm text-purple-800 text-xs px-2.5 py-1 rounded-full font-medium">
          {product.category_name}
        </span>
        {(hasVariants ? !hasAvailableVariant : Number(product.stock) <= 0 && product.stock !== null && product.stock !== undefined && product.stock !== '') && (
          <span className="absolute top-2 right-2 bg-red-600 text-white text-xs px-2.5 py-1 rounded-full font-semibold">
            Sin stock
          </span>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto border-b border-purple-100 bg-white px-3 py-2">
          {images.map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`Mostrar foto ${index + 1} de ${product.name}`}
              aria-pressed={activeIndex === index}
              className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 ${
                activeIndex === index ? 'border-purple-600' : 'border-purple-100 opacity-75'
              }`}
            >
              <img src={image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ProductDetailModal({ product, onClose, onAddToCart }) {
  const images = product.images?.length ? product.images : [product.image_url].filter(Boolean);
  const [activeIndex, setActiveIndex] = useState(0);
  const variants = product.variants || [];
  const firstAvailableVariant = variants.find((variant) => Number(variant.stock) > 0) || variants[0];
  const [selectedVariantId, setSelectedVariantId] = useState(firstAvailableVariant?.id ? String(firstAvailableVariant.id) : '');
  const selectedVariant = variants.find((variant) => String(variant.id) === selectedVariantId);
  const stock = Number(selectedVariant?.stock ?? product.stock);
  const hasStock = (selectedVariant || product.stock !== null && product.stock !== undefined && product.stock !== '') && Number.isFinite(stock);
  const isOutOfStock = hasStock && stock <= 0;

  useEffect(() => {
    setActiveIndex(0);
    const firstAvailable = variants.find((variant) => Number(variant.stock) > 0) || variants[0];
    setSelectedVariantId(firstAvailable?.id ? String(firstAvailable.id) : '');
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [product.id, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-purple-950/60 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle de ${product.name}`}
        className="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar detalle del producto"
          className="absolute right-3 top-3 z-10 rounded-full bg-white/95 p-2 text-purple-800 shadow hover:bg-purple-100"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="grid md:grid-cols-2">
          <div className="bg-purple-50 p-4 sm:p-6">
            <div className="relative aspect-square overflow-hidden rounded-xl bg-white">
              {images[activeIndex] ? (
                <img
                  src={images[activeIndex]}
                  alt={`${product.name} - foto ${activeIndex + 1}`}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-purple-400">Sin foto</div>
              )}
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveIndex((index) => (index - 1 + images.length) % images.length)}
                    aria-label="Ver foto anterior"
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-purple-800 shadow"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveIndex((index) => (index + 1) % images.length)}
                    aria-label="Ver foto siguiente"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-purple-800 shadow"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
            {images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {images.map((image, index) => (
                  <button
                    key={`${image}-${index}`}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    aria-label={`Ver foto ${index + 1}`}
                    aria-pressed={activeIndex === index}
                    className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${
                      activeIndex === index ? 'border-purple-600' : 'border-purple-200'
                    }`}
                  >
                    <img src={image} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col p-6 sm:p-8">
            <span className="mb-3 w-fit rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-800">
              {product.category_name || 'Belleza'}
            </span>
            <h2 className="text-2xl font-bold text-purple-950">{product.name}</h2>
            <p className="mt-4 flex-1 whitespace-pre-line text-sm leading-6 text-purple-700">
              {product.description || 'Consultanos para más detalles sobre este producto.'}
            </p>
            {variants.length > 0 && (
              <label className="mt-5 block text-sm font-semibold text-purple-900">
                Elegí una opción
                <select
                  value={selectedVariantId}
                  onChange={(event) => setSelectedVariantId(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-purple-200 bg-white px-3 py-3 text-sm font-normal text-purple-950 focus:outline-none focus:ring-2 focus:ring-purple-400"
                >
                  {variants.map((variant) => (
                    <option key={variant.id} value={variant.id} disabled={Number(variant.stock) <= 0}>
                      {variant.name} · ${Number(variant.price).toLocaleString('es-AR')} {Number(variant.stock) <= 0 ? '(sin stock)' : `· ${variant.stock} disponibles`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className={`mt-5 text-sm font-medium ${isOutOfStock ? 'text-red-600' : 'text-green-700'}`}>
              {isOutOfStock ? 'Sin stock' : hasStock ? `Stock: ${stock} unidades` : 'Stock no informado'}
            </p>
            <p className="mt-2 text-3xl font-bold text-purple-950">
              ${Number(selectedVariant?.price ?? product.price).toLocaleString('es-AR')}
            </p>
            <button
              type="button"
              onClick={() => {
                onAddToCart(selectedVariant ? { ...product, ...selectedVariant, id: product.id, variant_id: selectedVariant.id, variant_name: selectedVariant.name } : product);
                onClose();
              }}
              disabled={isOutOfStock}
              className="mt-5 w-full rounded-xl bg-purple-700 py-3 font-semibold text-white transition hover:bg-purple-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
            >
              {isOutOfStock ? 'Sin stock' : 'Agregar al carrito'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function StoreView() {
  const [products, setProducts] = useState([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productPage, setProductPage] = useState(1);
  const [isProductsLoading, setIsProductsLoading] = useState(true);
  const [categories, setCategories] = useState(INITIAL_CATEGORIES);
  const [selectedCategory, setSelectedCategory] = useState('todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('Envío a Domicilio');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    fetch(apiUrl('/api/categories'))
      .then((response) => response.ok ? response.json() : [])
      .then((data) => { if (data.length > 0) setCategories(data); })
      .catch(() => console.warn('No se pudieron cargar las categorías.'));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsProductsLoading(true);
      const params = new URLSearchParams({ page: String(productPage), limit: '12' });
      if (selectedCategory !== 'todos') params.set('category', selectedCategory);
      if (searchTerm.trim()) params.set('search', searchTerm.trim());
      try {
        const response = await fetch(apiUrl(`/api/products?${params}`), { signal: controller.signal });
        if (!response.ok) throw new Error('No se pudieron cargar los productos.');
        const data = await response.json();
        setProducts(data);
        setProductTotal(Number(response.headers.get('X-Total-Count')) || data.length);
      } catch (error) {
        if (error.name !== 'AbortError') console.warn('No se pudieron cargar los productos.', error);
      } finally {
        if (!controller.signal.aborted) setIsProductsLoading(false);
      }
    }, searchTerm.trim() ? 250 : 0);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [productPage, searchTerm, selectedCategory]);

  const addToCart = (product) => {
    const cartKey = `${product.id}:${product.variant_id || ''}`;
    setCart((prev) => {
      const exists = prev.find((item) => `${item.id}:${item.variant_id || ''}` === cartKey);
      if (exists) {
        return prev.map((item) =>
          `${item.id}:${item.variant_id || ''}` === cartKey ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
    setIsCartOpen(true);
  };

  const updateQuantity = (id, delta) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (`${item.id}:${item.variant_id || ''}` === id) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean)
    );
  };

  const removeFromCart = (id) => {
    setCart((prev) => prev.filter((item) => `${item.id}:${item.variant_id || ''}` !== id));
  };

  const totalCart = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const totalCount = cart.reduce((acc, item) => acc + item.quantity, 0);

  const totalPages = Math.max(1, Math.ceil(productTotal / 12));

  const handleCheckoutWhatsApp = async () => {
    if (!buyerName.trim()) {
      alert('Por favor ingresa tu nombre antes de confirmar.');
      return;
    }

    if (!cart.length || isSubmittingOrder) return;
    setIsSubmittingOrder(true);
    const whatsappWindow = window.open('about:blank', '_blank');

    try {
      const response = await fetch(apiUrl('/api/orders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: buyerName.trim(),
          delivery_method: deliveryMethod,
          notes: notes.trim(),
          items: cart.map((item) => ({ product_id: item.id, variant_id: item.variant_id || null, quantity: item.quantity }))
        })
      });
      const order = await response.json();
      if (!response.ok) throw new Error(order.error || 'No se pudo registrar el pedido.');

      let message = `¡Hola, Alquimia Beauty's! ✨💜\n\n`;
      message += `Quisiera realizar este pedido:\n`;
      message += `━━━━━━━━━━━━━━━━━━\n`;
      message += `🧾 *Pedido #${order.id}*\n`;
      message += `👤 *Nombre:* ${buyerName.trim()}\n`;
      message += `📦 *Entrega:* ${deliveryMethod}\n\n`;
      message += `🛍️ *MI PEDIDO*\n`;

      order.items.forEach((item) => {
        const subtotal = Number(item.subtotal).toLocaleString('es-AR');
        message += `▫️ ${item.name}${item.variant_name ? ` (${item.variant_name})` : ''} × ${item.quantity} — $${subtotal}\n`;
      });

      message += `━━━━━━━━━━━━━━━━━━\n`;
      message += `💰 *TOTAL: $${Number(order.total).toLocaleString('es-AR')} ARS*\n`;
      if (notes.trim()) message += `📝 *Detalles:* ${notes.trim()}\n`;
      message += `\n`;
      message += `¿Me cuentan cuáles son los medios de pago y coordinamos la entrega? 😊\n`;
      message += `¡Muchas gracias! ✨`;

      const whatsappUrl = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
      if (whatsappWindow) whatsappWindow.location.href = whatsappUrl;
      else window.location.href = whatsappUrl;
    } catch (error) {
      whatsappWindow?.close();
      alert(error.message || 'No se pudo registrar el pedido. Inténtalo nuevamente.');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#faf5ff] text-[#2e1065] flex flex-col font-sans">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-purple-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            {/* LOGO DE ALQUIMIA */}
            <div className="flex items-center gap-3">
              <img
                src="/logo.jpeg"
                alt="Logo Alquimia Beauty's"
                className="h-12 w-12 object-contain rounded-full shadow-sm"
              />
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  <h1 className="text-2xl font-bold tracking-tight text-purple-950 font-serif">
                    Alquimia Beauty's
                  </h1>
                </div>
                <p className="text-xs text-purple-600 font-medium">
                  Fragancias, Cosmética & Belleza
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={() => setIsCartOpen(true)}
            className="relative flex items-center gap-2 bg-purple-100 hover:bg-purple-200 text-purple-900 px-4 py-2 rounded-full transition-all"
          >
            <ShoppingBag className="w-5 h-5 text-purple-700" />
            <span className="font-semibold hidden sm:inline">Carrito</span>
            {totalCount > 0 && (
              <span className="bg-purple-700 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                {totalCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 flex-1 w-full">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 scrollbar-none">
            <button
              onClick={() => { setSelectedCategory('todos'); setProductPage(1); }}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                selectedCategory === 'todos'
                  ? 'bg-purple-700 text-white shadow-sm'
                  : 'bg-purple-100 text-purple-800 hover:bg-purple-200'
              }`}
            >
              Todos
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => { setSelectedCategory(c.slug); setProductPage(1); }}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  selectedCategory === c.slug
                    ? 'bg-purple-700 text-white shadow-sm'
                    : 'bg-purple-100 text-purple-800 hover:bg-purple-200'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-64">
            <Search className="w-4 h-4 text-purple-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar producto..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setProductPage(1); }}
              className="w-full pl-9 pr-4 py-2 bg-white rounded-full text-sm border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-400 text-purple-950 placeholder-purple-300"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {isProductsLoading ? (
            <p className="col-span-full py-12 text-center text-purple-600">Cargando productos…</p>
          ) : products.length === 0 ? (
            <p className="col-span-full py-12 text-center text-purple-600">No encontramos productos con esa búsqueda.</p>
          ) : products.map((p, index) => {
            const hasVariants = (p.variants || []).length > 0;
            const availableVariants = (p.variants || []).filter((variant) => Number(variant.stock) > 0);
            const minVariantPrice = hasVariants ? Math.min(...p.variants.map((variant) => Number(variant.price))) : Number(p.price);
            const maxVariantPrice = hasVariants ? Math.max(...p.variants.map((variant) => Number(variant.price))) : Number(p.price);
            const stock = Number(p.stock);
            const hasStockValue =
              p.stock !== null &&
              p.stock !== undefined &&
              p.stock !== '' &&
              Number.isFinite(stock);
            const isOutOfStock = hasVariants ? availableVariants.length === 0 : hasStockValue && stock <= 0;

            return (
              <div
                key={p.id}
                className="bg-white rounded-2xl overflow-hidden border border-purple-100 shadow-sm hover:shadow-md transition-shadow flex flex-col group"
              >
                <ProductImageGallery product={p} eager={index < 4} />

                <div className="p-4 flex flex-col flex-1">
                  <h3 className="font-semibold text-purple-950 line-clamp-1">{p.name}</h3>
                  <p className="text-xs text-purple-600 line-clamp-2 mt-1 mb-2 flex-1">
                    {p.description}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelectedProduct(p)}
                    className="mb-3 flex items-center gap-1.5 self-start text-xs font-semibold text-purple-700 hover:text-purple-950 hover:underline"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Ver producto
                  </button>
                  <p
                    className={`text-xs font-medium mb-3 ${
                      isOutOfStock
                        ? 'text-red-600'
                        : hasStockValue
                          ? 'text-green-700'
                          : 'text-gray-500'
                    }`}
                  >
                    {isOutOfStock
                      ? 'Sin stock'
                      : hasStockValue
                        ? hasVariants ? `${availableVariants.length} opciones disponibles` : `Stock: ${stock} unidades`
                        : 'Stock no informado'}
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-purple-50">
                    <span className="text-lg font-bold text-purple-900">
                      {hasVariants && minVariantPrice !== maxVariantPrice ? `$${minVariantPrice.toLocaleString('es-AR')} – $${maxVariantPrice.toLocaleString('es-AR')}` : `$${minVariantPrice.toLocaleString('es-AR')}`}
                    </span>
                    <button
                      onClick={() => hasVariants ? setSelectedProduct(p) : addToCart(p)}
                      disabled={isOutOfStock}
                      className={`text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition-colors ${
                        isOutOfStock
                          ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                          : 'bg-purple-600 hover:bg-purple-700 text-white'
                      }`}
                    >
                      {!isOutOfStock && <Plus className="w-3.5 h-3.5" />}
                      {isOutOfStock ? 'Sin stock' : hasVariants ? 'Elegir opción' : 'Agregar'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {totalPages > 1 && (
          <nav aria-label="Páginas del catálogo" className="mt-8 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => { setProductPage((page) => Math.max(1, page - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              disabled={productPage === 1 || isProductsLoading}
              className="rounded-xl border border-purple-200 bg-white px-4 py-2 text-sm font-semibold text-purple-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-sm text-purple-700">Página {productPage} de {totalPages}</span>
            <button
              type="button"
              onClick={() => { setProductPage((page) => Math.min(totalPages, page + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              disabled={productPage >= totalPages || isProductsLoading}
              className="rounded-xl border border-purple-200 bg-white px-4 py-2 text-sm font-semibold text-purple-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Siguiente
            </button>
          </nav>
        )}
      </main>

      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onAddToCart={addToCart}
        />
      )}

      <a
        href={`https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent('Hola, tengo una consulta sobre sus productos.')}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Contactar por WhatsApp"
        title="Contactar por WhatsApp"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-colors hover:bg-[#20ba59] sm:w-auto sm:px-5"
      >
        <MessageCircle className="h-7 w-7" />
        <span className="ml-2 hidden text-sm font-semibold sm:inline">
          ¿Tenés dudas? Escribinos
        </span>
      </a>

      {/* Drawer Carrito */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-purple-950/40 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-white h-full flex flex-col shadow-2xl">
            <div className="p-4 border-b border-purple-100 flex items-center justify-between bg-purple-50/50">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-purple-700" />
                <h2 className="font-bold text-purple-950">Mi Carrito ({totalCount})</h2>
              </div>
              <button
                onClick={() => setIsCartOpen(false)}
                className="p-1.5 text-purple-500 hover:bg-purple-100 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {cart.length === 0 ? (
                <div className="text-center py-16 text-purple-400 flex flex-col items-center">
                  <ShoppingBag className="w-12 h-12 stroke-[1.5] mb-2" />
                  <p>Tu carrito está vacío</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={`${item.id}:${item.variant_id || ''}`}
                    className="flex items-center gap-3 bg-purple-50/40 p-2.5 rounded-xl border border-purple-100"
                  >
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="w-16 h-16 rounded-lg object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-purple-950 truncate">
                        {item.name}
                      </h4>
                      {item.variant_name && <p className="text-xs text-purple-600">Opción: {item.variant_name}</p>}
                      <p className="text-xs text-purple-700 font-bold mt-0.5">
                        ${Number(item.price).toLocaleString('es-AR')}
                      </p>
                      
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => updateQuantity(`${item.id}:${item.variant_id || ''}`, -1)}
                          className="w-6 h-6 rounded-md bg-white border border-purple-200 flex items-center justify-center text-purple-700 hover:bg-purple-100"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-bold text-purple-900 w-4 text-center">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(`${item.id}:${item.variant_id || ''}`, 1)}
                          disabled={item.stock !== null && item.stock !== undefined && item.stock !== '' && item.quantity >= Number(item.stock)}
                          className="w-6 h-6 rounded-md bg-white border border-purple-200 flex items-center justify-center text-purple-700 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={() => removeFromCart(`${item.id}:${item.variant_id || ''}`)}
                      className="text-purple-400 hover:text-red-500 p-1.5 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="p-4 border-t border-purple-100 bg-purple-50/30 space-y-3">
                <input
                  type="text"
                  placeholder="Tu nombre completo *"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-lg bg-white border border-purple-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <select
                  value={deliveryMethod}
                  onChange={(e) => setDeliveryMethod(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-lg bg-white border border-purple-200 focus:outline-none focus:ring-1 focus:ring-purple-500 text-purple-900"
                >
                  <option value="Envío a Domicilio">Envío a Domicilio</option>
                  <option value="Retiro en Punto de Entrega">Retiro en Punto de Entrega</option>
                </select>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={deliveryMethod === 'Envío a Domicilio' ? 'Dirección, barrio y referencia (opcional)' : 'Algún detalle para el pedido (opcional)'}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                />

                <div className="flex justify-between items-center pt-2">
                  <span className="text-sm font-semibold text-purple-900">Total:</span>
                  <span className="text-xl font-bold text-purple-950">
                    ${totalCart.toLocaleString('es-AR')} ARS
                  </span>
                </div>

                <button
                  onClick={handleCheckoutWhatsApp}
                  disabled={isSubmittingOrder}
                  className="w-full bg-[#25D366] hover:bg-[#20ba59] text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 shadow-sm transition-all"
                >
                  <MessageCircle className="w-5 h-5 fill-current" />
                  {isSubmittingOrder ? 'Registrando pedido…' : 'Comprar por WhatsApp'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
