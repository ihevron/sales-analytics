const VAT_RATE = 0.18;
const TOKEN_KEY = "customerOrderToken";
const CUSTOMER_KEY = "customerOrderProfile";
const CART_KEY = "customerOrderCart";
const TERMS_VERSION_KEY = "customerOrderTermsVersion";
const FALLBACK_IMAGE = "./management/wa-logo.png";

const SECTION_TEXT = {
  recommended: {
    title: "המומלצים שלי",
    subtitle: "",
  },
  deals: {
    title: "מבצעים",
    subtitle: "",
  },
  all: {
    title: "כל המוצרים",
    subtitle: "",
  },
};

const DEFAULT_CUSTOMER_SETTINGS = {
  loginTitle: "כניסה למערכת ההזמנות",
  loginSubtitle: "מזמינים בקלות, רואים מוצרים מומלצים ומבצעים, ושולחים הזמנה ישירות לחברון שיווק סלטים בע\"מ.",
  termsText: [
    "השימוש באתר מיועד לביצוע הזמנות מול חברון שיווק סלטים בע\"מ בלבד.",
    "המחירים, הזמינות והאישור הסופי של ההזמנה כפופים לבדיקת החברה ולאישור ההזמנה בפועל.",
    "שליחת הזמנה מהווה בקשה להזמנה. ייתכנו שינויים בכמות, בזמינות, במחיר ובמועד האספקה לפי מלאי ותיאום מול הלקוח.",
    "פרטי הלקוח נשמרים לצורך טיפול בהזמנות, שירות ותיאום אספקה. אין להזין פרטי כרטיס אשראי במסך זה.",
  ].join("\n\n"),
  warrantyText: [
    "האחריות לאיכות המוצרים ניתנת בהתאם לדין, לתנאי הספקים ולנהלי החברה.",
    "יש לבדוק את הסחורה בעת קבלתה ולעדכן את החברה בסמוך לקבלה במקרה של חוסר, פגם או אי התאמה.",
  ].join("\n\n"),
};

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  customer: safeJson(localStorage.getItem(CUSTOMER_KEY), null),
  products: [],
  suppliers: [],
  categories: [],
  cart: safeJson(localStorage.getItem(CART_KEY), {}),
  search: "",
  supplier: "",
  category: "",
  sort: "customer",
  section: "recommended",
  hasCustomerHistory: false,
  quantitySku: "",
  loginMode: "existing",
  termsMode: "customer",
  termsPromptOpen: false,
  settings: { ...DEFAULT_CUSTOMER_SETTINGS },
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadCustomerSettings();
  document.getElementById("login-form").addEventListener("submit", login);
  document.getElementById("register-form").addEventListener("submit", registerCustomer);
  document.getElementById("logout-button").addEventListener("click", logout);
  document.querySelectorAll("[data-login-mode]").forEach((button) => {
    button.addEventListener("click", () => setLoginMode(button.dataset.loginMode));
  });
  document.getElementById("product-search").addEventListener("input", debounce((event) => {
    state.search = event.target.value.trim();
    loadProducts();
  }, 250));
  document.getElementById("supplier-filter").addEventListener("change", (event) => {
    state.supplier = event.target.value;
    loadProducts();
  });
  document.getElementById("category-filter").addEventListener("change", (event) => {
    state.category = event.target.value;
    state.section = state.category ? "all" : state.section;
    loadProducts();
  });
  document.getElementById("sort-filter").addEventListener("change", (event) => {
    state.sort = event.target.value || "customer";
    loadProducts();
  });
  document.getElementById("submit-order").addEventListener("click", submitOrder);
  document.getElementById("cart-fab").addEventListener("click", openCart);
  document.getElementById("close-cart").addEventListener("click", closeCart);
  document.getElementById("cart-backdrop").addEventListener("click", closeCart);
  document.getElementById("show-register-terms").addEventListener("click", () => showTermsModal("register"));
  document.getElementById("terms-close").addEventListener("click", closeTermsModal);
  document.getElementById("close-quantity-sheet").addEventListener("click", closeQuantitySheet);
  document.getElementById("quantity-apply").addEventListener("click", applyQuantitySheet);
  document.getElementById("quantity-minus").addEventListener("click", () => adjustQuantitySheet(-1));
  document.getElementById("quantity-plus").addEventListener("click", () => adjustQuantitySheet(1));
  document.getElementById("quantity-select").addEventListener("change", (event) => {
    if (!state.quantitySku) return;
    setQuantity(state.quantitySku, Number(event.target.value) || 0);
    closeQuantitySheet();
  });
  document.getElementById("quantity-input").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyQuantitySheet();
  });
  document.getElementById("quantity-sheet").addEventListener("click", (event) => {
    if (event.target.id === "quantity-sheet") closeQuantitySheet();
  });
  document.getElementById("terms-accept").addEventListener("change", (event) => {
    document.getElementById("terms-confirm").disabled = !event.target.checked;
  });
  document.getElementById("terms-confirm").addEventListener("click", acceptTerms);
  document.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      state.section = button.dataset.section;
      loadProducts();
    });
  });
  fillQuantityOptions();

  if (state.token && state.customer) {
    showApp();
    if (hasValidTermsAcceptance()) {
      loadProducts();
    } else {
      showTermsModal();
    }
  } else {
    showLogin();
  }
  renderCart();
}

async function loadCustomerSettings() {
  try {
    const response = await fetch("/api/customer/settings", { cache: "no-store" });
    const data = await response.json();
    if (data && data.ok && data.settings) {
      state.settings = { ...DEFAULT_CUSTOMER_SETTINGS, ...data.settings };
    }
  } catch {
    state.settings = { ...DEFAULT_CUSTOMER_SETTINGS };
  }
  applyCustomerSettings();
}

function applyCustomerSettings() {
  document.getElementById("login-title").textContent = state.settings.loginTitle || DEFAULT_CUSTOMER_SETTINGS.loginTitle;
  document.getElementById("login-subtitle").textContent = state.settings.loginSubtitle || DEFAULT_CUSTOMER_SETTINGS.loginSubtitle;
  document.getElementById("terms-text").textContent = state.settings.termsText || DEFAULT_CUSTOMER_SETTINGS.termsText;
  document.getElementById("warranty-text").textContent = state.settings.warrantyText || DEFAULT_CUSTOMER_SETTINGS.warrantyText;
}

function hasValidTermsAcceptance() {
  const acceptedAt = Date.parse(state.customer?.terms_accepted_at || "");
  if (!acceptedAt) return false;
  if (Date.now() - acceptedAt > 1000 * 60 * 60 * 24 * 30) return false;
  const currentVersion = String(state.settings.termsVersion || "").trim();
  const acceptedVersion = String(state.customer?.terms_version_accepted || localStorage.getItem(TERMS_VERSION_KEY) || "").trim();
  return !(currentVersion && acceptedVersion && acceptedVersion !== currentVersion);
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

function setLoginMode(mode) {
  state.loginMode = mode === "new" ? "new" : "existing";
  document.querySelectorAll("[data-login-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.loginMode === state.loginMode);
  });
  document.getElementById("login-form").hidden = state.loginMode !== "existing";
  document.getElementById("register-form").hidden = state.loginMode !== "new";
  document.getElementById("login-message").textContent = "";
}

async function handleAuthSuccess(data) {
  state.token = data.token;
  state.customer = data.customer;
  localStorage.setItem(TOKEN_KEY, state.token);
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(state.customer));
  showApp();
  if (data.requires_terms || !hasValidTermsAcceptance()) {
    showTermsModal();
    return;
  }
  await loadProducts();
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
    message.textContent = "";
    await handleAuthSuccess(data);
  } catch {
    message.textContent = "מספר לקוח או ח.פ אינם תקינים";
  }
}

async function registerCustomer(event) {
  event.preventDefault();
  const message = document.getElementById("login-message");
  message.textContent = "פותח לקוח חדש...";
  try {
    const data = await api("/api/customer/register", {
      method: "POST",
      body: JSON.stringify({
        customerName: document.getElementById("new-customer-name").value.trim(),
        companyId: document.getElementById("new-company-id").value.trim(),
        phone: document.getElementById("new-phone").value.trim(),
        address: document.getElementById("new-address").value.trim(),
        termsAccepted: document.getElementById("new-terms").checked,
      }),
    });
    message.textContent = "";
    await handleAuthSuccess(data);
  } catch (error) {
    message.textContent = error.message || "לא ניתן לפתוח לקוח חדש כרגע. יש לוודא שמילאת שם עסק, ח.פ, טלפון ואישור תנאים.";
  }
}

function logout() {
  state.token = "";
  state.customer = null;
  state.cart = {};
  state.products = [];
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_KEY);
  localStorage.removeItem(TERMS_VERSION_KEY);
  localStorage.removeItem(CART_KEY);
  closeCart();
  closeQuantitySheet();
  showLogin();
  renderCart();
}

function showTermsModal(mode = "customer") {
  if (state.termsPromptOpen && state.termsMode === mode) return;
  state.termsMode = mode;
  state.termsPromptOpen = true;
  document.getElementById("terms-modal").hidden = false;
  document.body.classList.add("terms-open");
  document.getElementById("terms-accept").checked = false;
  document.getElementById("terms-confirm").disabled = true;
  document.getElementById("terms-confirm").textContent = mode === "register" ? "אישור תנאים" : "אישור והמשך להזמנה";
  document.getElementById("terms-message").textContent = "";
}

function closeTermsModal() {
  state.termsPromptOpen = false;
  document.getElementById("terms-modal").hidden = true;
  document.body.classList.remove("terms-open");
}

async function acceptTerms() {
  const message = document.getElementById("terms-message");
  if (!document.getElementById("terms-accept").checked) {
    message.textContent = "יש לאשר את תנאי השימוש כדי להמשיך";
    return;
  }
  if (state.termsMode === "register") {
    document.getElementById("new-terms").checked = true;
    closeTermsModal();
    return;
  }
  message.textContent = "שומר אישור...";
  try {
    const data = await api("/api/customer/terms", {
      method: "POST",
      body: JSON.stringify({ accepted: true }),
    });
    state.customer = data.customer || {
      ...state.customer,
      terms_accepted_at: new Date().toISOString(),
      terms_version_accepted: state.settings.termsVersion || "",
    };
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(state.customer));
    if (state.customer.terms_version_accepted || state.settings.termsVersion) {
      localStorage.setItem(TERMS_VERSION_KEY, state.customer.terms_version_accepted || state.settings.termsVersion);
    }
    closeTermsModal();
    await loadProducts();
  } catch {
    message.textContent = "לא ניתן לשמור את האישור כרגע";
  }
}

function showLogin() {
  document.body.classList.remove("ordering-open");
  document.getElementById("login-view").hidden = false;
  document.getElementById("app-view").hidden = true;
  window.scrollTo(0, 0);
}

function showApp() {
  document.body.classList.add("ordering-open");
  document.getElementById("login-view").hidden = true;
  document.getElementById("app-view").hidden = false;
  document.getElementById("customer-name").textContent = state.customer?.customer_name || "לקוח";
  window.scrollTo(0, 0);
}

async function loadProducts() {
  updateNavigation();
  const grid = document.getElementById("product-grid");
  grid.innerHTML = `<div class="empty-state">טוען מוצרים...</div>`;
  try {
    const params = new URLSearchParams({ limit: "300", section: state.section, sort: state.sort });
    if (state.search) params.set("q", state.search);
    if (state.supplier) params.set("supplier", state.supplier);
    if (state.category) params.set("category", state.category);
    const data = await api(`/api/customer/products?${params.toString()}`);
    state.products = Array.isArray(data.rows) ? data.rows : [];
    state.suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
    state.categories = Array.isArray(data.categories) ? data.categories : [];
    state.hasCustomerHistory = Boolean(data.hasCustomerHistory);
    renderFilters();
    updateNavigation();
    renderProducts();
  } catch (error) {
    if (/unauthorized/i.test(error.message)) logout();
    if (/terms_required/i.test(error.message)) {
      if (!hasValidTermsAcceptance()) showTermsModal();
      return;
    }
    grid.innerHTML = `<div class="empty-state">לא ניתן לטעון מוצרים כרגע</div>`;
  }
}

function renderFilters() {
  fillSelect(document.getElementById("supplier-filter"), "כל הספקים", state.suppliers, state.supplier);
  fillSelect(document.getElementById("category-filter"), "כל הקטגוריות", state.categories, state.category);
}

function fillSelect(select, defaultLabel, values, selected) {
  const current = selected && values.includes(selected) ? selected : "";
  if (selected && !current) state[select.id === "supplier-filter" ? "supplier" : "category"] = "";
  select.innerHTML = [
    `<option value="">${defaultLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
  ].join("");
  select.value = current;
}

function updateNavigation() {
  document.querySelectorAll("[data-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === state.section);
  });
  const text = SECTION_TEXT[state.section] || SECTION_TEXT.all;
  const subtitle = state.category ? "" : text.subtitle;
  document.getElementById("section-title").textContent = state.category || text.title;
  const subtitleElement = document.getElementById("section-subtitle");
  subtitleElement.textContent = subtitle;
  subtitleElement.hidden = !subtitle;
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
    const badge = product.customer_recommended ? "מומלץ עבורך" : (product.popularity_label || "");
    const badgeClass = badge === "Top 10" ? "top10" : (badge === "Top 100" ? "top100" : "recommended");
    return `
      <article class="product-card">
        <img src="${escapeHtml(image)}" alt="" loading="lazy" onerror="this.src='${FALLBACK_IMAGE}'" />
        <div class="product-info">
          <h3>${escapeHtml(product.description || product.sku)}</h3>
          <div class="product-meta">מק״ט ${escapeHtml(product.sku)}${product.category ? ` · ${escapeHtml(product.category)}` : ""}</div>
          ${badge ? `<div class="product-badge ${badgeClass}">${escapeHtml(badge)}</div>` : ""}
          ${renderPrice(product)}
          <div class="quantity-row" data-sku="${escapeHtml(product.sku)}">
            <button type="button" data-action="minus" aria-label="הפחתה">−</button>
            <select class="quantity-inline-select" data-action="quantity-select" aria-label="בחירת כמות">
              ${quantitySelectOptions(quantity)}
            </select>
            <button type="button" data-action="plus" aria-label="הוספה">+</button>
          </div>
          ${quantity > 0 ? `<textarea class="item-note-input" data-item-note="${escapeHtml(product.sku)}" rows="2" placeholder="הערה לפריט">${escapeHtml(state.cart[product.sku]?.note || "")}</textarea>` : ""}
        </div>
      </article>
    `;
  }).join("");
  grid.querySelectorAll(".quantity-row").forEach((row) => {
    const sku = row.dataset.sku;
    row.querySelector('[data-action="minus"]').addEventListener("click", () => setQuantity(sku, (state.cart[sku]?.quantity || 0) - 1));
    row.querySelector('[data-action="plus"]').addEventListener("click", () => setQuantity(sku, (state.cart[sku]?.quantity || 0) + 1));
    row.querySelector('[data-action="quantity-select"]').addEventListener("change", (event) => setQuantity(sku, Number(event.target.value) || 0));
  });
  grid.querySelectorAll("[data-item-note]").forEach((textarea) => {
    textarea.addEventListener("input", () => updateItemNote(textarea.dataset.itemNote, textarea.value, false));
  });
}

function quantitySelectOptions(selectedQuantity) {
  const selected = Math.min(999, Math.max(0, Math.round(Number(selectedQuantity) || 0)));
  const values = Array.from({ length: 101 }, (_, value) => value);
  if (!values.includes(selected)) values.push(selected);
  return values
    .sort((a, b) => a - b)
    .map((value) => `<option value="${value}"${value === selected ? " selected" : ""}>${value}</option>`)
    .join("");
}

function renderPrice(product) {
  const price = Number(product.price) || 0;
  const listPrice = Number(product.list_price) || 0;
  const promoPrice = Number(product.promo_price) || 0;
  const discount = Number(product.promo_discount_percent) || 0;
  const hasPromo = promoPrice > 0;
  if (!hasPromo) return `<div class="product-price">${money(price)}</div>`;
  const label = discount > 0 ? `-${integer(discount)}%` : "מבצע";
  return `
    <div class="price-stack">
      <span class="old-price">${money(listPrice)}</span>
      <strong class="promo-price">${money(promoPrice)}</strong>
      <span class="discount-chip">${escapeHtml(label)}</span>
    </div>
  `;
}

function productBySku(sku) {
  return state.products.find((product) => product.sku === sku) || state.cart[sku]?.product || null;
}

function setQuantity(sku, quantity) {
  const product = productBySku(sku);
  if (!product) return;
  const nextQuantity = Math.max(0, Math.min(999, Math.round(Number(quantity) || 0)));
  if (nextQuantity <= 0) {
    delete state.cart[sku];
  } else {
    state.cart[sku] = { quantity: nextQuantity, product, note: state.cart[sku]?.note || "" };
  }
  saveCart();
  renderCart();
  renderProducts();
}

function fillQuantityOptions() {
  const options = document.getElementById("quantity-options");
  const select = document.getElementById("quantity-select");
  options.innerHTML = Array.from({ length: 31 }, (_, value) => `
    <button type="button" data-quantity="${value}" role="option">${value}</button>
  `).join("");
  select.innerHTML = Array.from({ length: 101 }, (_, value) => `
    <option value="${value}">${value}</option>
  `).join("");
  options.querySelectorAll("[data-quantity]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.quantitySku) return;
      setQuantity(state.quantitySku, Number(button.dataset.quantity));
      closeQuantitySheet();
    });
  });
}

function openQuantitySheet(sku) {
  state.quantitySku = sku;
  const product = productBySku(sku);
  if (!product) return;
  const quantity = Math.min(999, Math.max(0, state.cart[sku]?.quantity || 0));
  document.getElementById("quantity-product-name").textContent = product.description || sku;
  document.getElementById("quantity-input").value = String(quantity);
  const select = document.getElementById("quantity-select");
  if (!select.querySelector(`option[value="${quantity}"]`)) {
    select.append(new Option(String(quantity), String(quantity)));
  }
  select.value = String(quantity);
  document.getElementById("quantity-sheet").hidden = false;
  document.body.classList.add("quantity-open");
  markQuantityOption(quantity);
  setTimeout(() => {
    const selected = document.querySelector(".quantity-options .selected");
    selected?.scrollIntoView({ inline: "center", block: "nearest" });
  }, 0);
}

function closeQuantitySheet() {
  document.getElementById("quantity-sheet").hidden = true;
  document.body.classList.remove("quantity-open");
  state.quantitySku = "";
}

function markQuantityOption(quantity) {
  document.querySelectorAll(".quantity-options [data-quantity]").forEach((button) => {
    button.classList.toggle("selected", Number(button.dataset.quantity) === Number(quantity));
  });
  const select = document.getElementById("quantity-select");
  if (select?.querySelector(`option[value="${quantity}"]`)) select.value = String(quantity);
}

function adjustQuantitySheet(delta) {
  const input = document.getElementById("quantity-input");
  const next = Math.min(999, Math.max(0, Number(input.value || 0) + delta));
  input.value = String(next);
  const select = document.getElementById("quantity-select");
  if (!select.querySelector(`option[value="${next}"]`)) {
    select.append(new Option(String(next), String(next)));
  }
  markQuantityOption(next);
}

function applyQuantitySheet() {
  if (!state.quantitySku) return;
  setQuantity(state.quantitySku, Number(document.getElementById("quantity-input").value) || 0);
  closeQuantitySheet();
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
}

function cartItems() {
  return Object.entries(state.cart)
    .map(([sku, item]) => ({ sku, quantity: Number(item.quantity) || 0, product: item.product, note: item.note || "" }))
    .filter((item) => item.quantity > 0);
}

function openCart() {
  const mobileCart = window.matchMedia("(max-width: 1100px)").matches;
  if (mobileCart) {
    document.body.classList.add("cart-open");
    document.getElementById("cart-backdrop").hidden = false;
    return;
  }
  const panel = document.getElementById("cart-panel");
  document.getElementById("cart-backdrop").hidden = true;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  panel.classList.add("cart-panel-highlight");
  setTimeout(() => panel.classList.remove("cart-panel-highlight"), 1400);
}

function closeCart() {
  document.body.classList.remove("cart-open");
  document.getElementById("cart-backdrop").hidden = true;
}

function renderCart() {
  const items = cartItems();
  const list = document.getElementById("cart-list");
  document.getElementById("cart-count").textContent = `${integer(items.length)} פריטים`;
  document.getElementById("cart-fab-count").textContent = integer(items.reduce((sum, item) => sum + item.quantity, 0));
  document.getElementById("submit-order").disabled = !items.length;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">הסל ריק</div>`;
  } else {
    list.innerHTML = items.map((item) => `
      <div class="cart-item">
        <div>
          <strong>${escapeHtml(item.product?.description || item.sku)}</strong>
          <small>${integer(item.quantity)} יח׳ · ${money((item.product?.price || 0) * item.quantity)}</small>
          <textarea class="cart-item-note" data-cart-note="${escapeHtml(item.sku)}" rows="2" placeholder="הערה לפריט">${escapeHtml(item.note || "")}</textarea>
        </div>
        <div class="cart-item-actions">
          <button type="button" data-cart-minus="${escapeHtml(item.sku)}" aria-label="הפחתת כמות">−</button>
          <button type="button" data-cart-picker="${escapeHtml(item.sku)}" aria-label="בחירת כמות">${integer(item.quantity)}</button>
          <button type="button" data-cart-plus="${escapeHtml(item.sku)}" aria-label="הוספת כמות">+</button>
          <button class="cart-remove" type="button" data-sku="${escapeHtml(item.sku)}" aria-label="הסרה">×</button>
        </div>
      </div>
    `).join("");
    list.querySelectorAll("[data-cart-minus]").forEach((button) => button.addEventListener("click", () => setQuantity(button.dataset.cartMinus, (state.cart[button.dataset.cartMinus]?.quantity || 0) - 1)));
    list.querySelectorAll("[data-cart-plus]").forEach((button) => button.addEventListener("click", () => setQuantity(button.dataset.cartPlus, (state.cart[button.dataset.cartPlus]?.quantity || 0) + 1)));
    list.querySelectorAll("[data-cart-picker]").forEach((button) => button.addEventListener("click", () => openQuantitySheet(button.dataset.cartPicker)));
    list.querySelectorAll(".cart-remove").forEach((button) => button.addEventListener("click", () => setQuantity(button.dataset.sku, 0)));
    list.querySelectorAll("[data-cart-note]").forEach((textarea) => {
      textarea.addEventListener("input", () => updateItemNote(textarea.dataset.cartNote, textarea.value, false));
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
        items: items.map((item) => ({ sku: item.sku, quantity: item.quantity, note: item.note || "" })),
      }),
    });
    state.cart = {};
    saveCart();
    document.getElementById("order-note").value = "";
    renderCart();
    renderProducts();
    message.style.color = "#0f766e";
    message.textContent = "ההזמנה נשלחה בהצלחה";
  } catch {
    message.style.color = "#dc2626";
    message.textContent = "לא ניתן לשלוח את ההזמנה כרגע";
  } finally {
    button.disabled = !cartItems().length;
  }
}

function updateItemNote(sku, note, rerenderCart) {
  if (!state.cart[sku]) return;
  state.cart[sku].note = String(note || "").slice(0, 500);
  saveCart();
  if (rerenderCart) renderCart();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
