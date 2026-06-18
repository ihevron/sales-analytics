const VAT_RATE = 0.18;
const TOKEN_KEY = "customerOrderToken";
const CUSTOMER_KEY = "customerOrderProfile";
const CART_KEY = "customerOrderCart";
const FALLBACK_IMAGE = "./management/wa-logo.png";

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  customer: safeJson(localStorage.getItem(CUSTOMER_KEY), null),
  products: [],
  cart: safeJson(localStorage.getItem(CART_KEY), {}),
  search: "",
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  document.getElementById("login-form").addEventListener("submit", login);
  document.getElementById("logout-button").addEventListener("click", logout);
  document.getElementById("product-search").addEventListener("input", debounce((event) => {
    state.search = event.target.value.trim();
    loadProducts();
  }, 250));
  document.getElementById("submit-order").addEventListener("click", submitOrder);

  if (state.token && state.customer) {
    showApp();
    loadProducts();
  } else {
    showLogin();
  }
  renderCart();
}

function safeJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function money(value) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function integer(value) {
  return new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function debounce(callback, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "הפעולה נכשלה");
  }
  return data;
}

async function login(event) {
  event.preventDefault();
  const message = document.getElementById("login-message");
  message.textContent = "בודק פרטים...";
  try {
    const data = await api("/api/customer/login", {
      method: "POST",
      body: JSON.stringify({
        customerNo: document.getElementById("customer-no").value.trim(),
        companyId: document.getElementById("company-id").value.trim(),
      }),
    });
    state.token = data.token;
    state.customer = data.customer;
    localStorage.setItem(TOKEN_KEY, state.token);
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(state.customer));
    message.textContent = "";
    showApp();
    await loadProducts();
  } catch (error) {
    message.textContent = "מספר לקוח או ח.פ אינם תקינים";
  }
}

function logout() {
  state.token = "";
  state.customer = null;
  state.cart = {};
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_KEY);
  localStorage.removeItem(CART_KEY);
  showLogin();
  renderCart();
}

function showLogin() {
  document.getElementById("login-view").hidden = false;
  document.getElementById("app-view").hidden = true;
}

function showApp() {
  document.getElementById("login-view").hidden = true;
  document.getElementById("app-view").hidden = false;
  document.getElementById("customer-name").textContent = state.customer?.customer_name || "לקוח";
}

async function loadProducts() {
  const grid = document.getElementById("product-grid");
  grid.innerHTML = `<div class="empty-state">טוען מוצרים...</div>`;
  try {
    const params = new URLSearchParams({ limit: "300" });
    if (state.search) params.set("q", state.search);
    const data = await api(`/api/customer/products?${params.toString()}`);
    state.products = Array.isArray(data.rows) ? data.rows : [];
    renderProducts();
  } catch (error) {
    if (/unauthorized/i.test(error.message)) logout();
    grid.innerHTML = `<div class="empty-state">לא ניתן לטעון מוצרים כרגע</div>`;
  }
}

function renderProducts() {
  const grid = document.getElementById("product-grid");
  if (!state.products.length) {
    grid.innerHTML = `<div class="empty-state">לא נמצאו מוצרים</div>`;
    return;
  }
  grid.innerHTML = state.products.map((product) => {
    const quantity = state.cart[product.sku]?.quantity || 0;
    const image = product.image_url || FALLBACK_IMAGE;
    return `
      <article class="product-card">
        <img src="${escapeHtml(image)}" alt="" loading="lazy" onerror="this.src='${FALLBACK_IMAGE}'" />
        <div class="product-info">
          <h3>${escapeHtml(product.description || product.sku)}</h3>
          <div class="product-meta">מק״ט ${escapeHtml(product.sku)}${product.category ? ` · ${escapeHtml(product.category)}` : ""}</div>
          <div class="product-price">${money(product.price)}</div>
          <div class="quantity-row" data-sku="${escapeHtml(product.sku)}">
            <button type="button" data-action="minus" aria-label="הפחתה">−</button>
            <input type="number" min="0" step="1" value="${quantity}" aria-label="כמות" />
            <button type="button" data-action="plus" aria-label="הוספה">+</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
  grid.querySelectorAll(".quantity-row").forEach((row) => {
    const sku = row.dataset.sku;
    row.querySelector('[data-action="minus"]').addEventListener("click", () => setQuantity(sku, (state.cart[sku]?.quantity || 0) - 1));
    row.querySelector('[data-action="plus"]').addEventListener("click", () => setQuantity(sku, (state.cart[sku]?.quantity || 0) + 1));
    row.querySelector("input").addEventListener("change", (event) => setQuantity(sku, Number(event.target.value) || 0));
  });
}

function productBySku(sku) {
  return state.products.find((product) => product.sku === sku) || state.cart[sku]?.product || null;
}

function setQuantity(sku, quantity) {
  const product = productBySku(sku);
  if (!product) return;
  const nextQuantity = Math.max(0, Math.round(Number(quantity) || 0));
  if (nextQuantity <= 0) {
    delete state.cart[sku];
  } else {
    state.cart[sku] = { quantity: nextQuantity, product };
  }
  saveCart();
  renderCart();
  renderProducts();
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
}

function cartItems() {
  return Object.entries(state.cart)
    .map(([sku, item]) => ({ sku, quantity: Number(item.quantity) || 0, product: item.product }))
    .filter((item) => item.quantity > 0);
}

function renderCart() {
  const items = cartItems();
  const list = document.getElementById("cart-list");
  document.getElementById("cart-count").textContent = `${integer(items.length)} פריטים`;
  document.getElementById("submit-order").disabled = !items.length;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">הסל ריק</div>`;
  } else {
    list.innerHTML = items.map((item) => `
      <div class="cart-item">
        <div>
          <strong>${escapeHtml(item.product?.description || item.sku)}</strong>
          <small>${integer(item.quantity)} יח׳ · ${money((item.product?.price || 0) * item.quantity)}</small>
        </div>
        <button class="cart-remove" type="button" data-sku="${escapeHtml(item.sku)}" aria-label="הסרה">×</button>
      </div>
    `).join("");
    list.querySelectorAll(".cart-remove").forEach((button) => {
      button.addEventListener("click", () => setQuantity(button.dataset.sku, 0));
    });
  }

  const subtotal = items.reduce((sum, item) => sum + ((Number(item.product?.price) || 0) * item.quantity), 0);
  const vat = subtotal * VAT_RATE;
  document.getElementById("subtotal").textContent = money(subtotal);
  document.getElementById("vat").textContent = money(vat);
  document.getElementById("total").textContent = money(subtotal + vat);
}

async function submitOrder() {
  const items = cartItems();
  if (!items.length) return;
  const message = document.getElementById("order-message");
  const button = document.getElementById("submit-order");
  message.textContent = "שולח הזמנה...";
  button.disabled = true;
  try {
    await api("/api/customer/order", {
      method: "POST",
      body: JSON.stringify({
        note: document.getElementById("order-note").value.trim(),
        items: items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
      }),
    });
    state.cart = {};
    saveCart();
    document.getElementById("order-note").value = "";
    renderCart();
    renderProducts();
    message.style.color = "#0f766e";
    message.textContent = "ההזמנה נשלחה בהצלחה";
  } catch (error) {
    message.style.color = "#dc2626";
    message.textContent = "לא ניתן לשלוח את ההזמנה כרגע";
  } finally {
    button.disabled = !cartItems().length;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
