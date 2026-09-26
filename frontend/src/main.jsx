import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "/api";
const icons = {
  dashboard: "📊",
  products: "📦",
  receipts: "📥",
  deliveries: "📤",
  transfers: "🔄",
  adjustments: "🧮",
  history: "📜",
  warehouse: "🏭",
  logout: "🚪",
};

async function api(path, options = {}) {
  const token = localStorage.getItem("stocksense_token");
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = API.endsWith("/") ? `${API.slice(0, -1)}${cleanPath}` : `${API}${cleanPath}`;

  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (err) {
    throw new Error("Unable to connect to server. Please ensure the backend is running at http://127.0.0.1:8000");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = "Request failed";
    if (typeof data.detail === "string") {
      msg = data.detail;
    } else if (Array.isArray(data.detail)) {
      msg = data.detail.map(d => d.msg || d.message || JSON.stringify(d)).join("; ");
    } else if (res.status === 401) {
      msg = "Invalid email or password.";
    } else if (res.status === 404) {
      msg = "Resource not found.";
    } else if (res.statusText) {
      msg = res.statusText;
    }
    throw new Error(msg);
  }
  return data;
}

function Logo({ light = false }) {
  return (
    <div className={"brand " + (light ? "brand-light" : "")}>
      <span className="brand-mark">◇</span>
      <div>
        <b>StockSense</b>
        <small>Inventory Management System</small>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const s = status || "Draft";
  const cls =
    s === "Done"
      ? "badge-done"
      : s === "Ready"
      ? "badge-ready"
      : s === "Waiting"
      ? "badge-waiting"
      : s === "Canceled"
      ? "badge-canceled"
      : s === "In Stock"
      ? "badge-in-stock"
      : s === "Low Stock"
      ? "badge-low-stock"
      : s === "Out of Stock"
      ? "badge-out-of-stock"
      : "badge-draft";
  return <span className={`badge ${cls}`}>{s}</span>;
}

function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("notice");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      if (mode === "login") {
        if (!form.email || !form.password) {
          throw new Error("Please enter both email and password.");
        }
        const d = await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        localStorage.setItem("stocksense_token", d.token);
        onLogin(d.user);
      } else if (mode === "signup") {
        if (!form.name.trim()) throw new Error("Full name is required.");
        if (!form.email.includes("@")) throw new Error("Please enter a valid email address.");
        if (form.password.length < 6) throw new Error("Password must be at least 6 characters.");

        await api("/auth/signup", {
          method: "POST",
          body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), password: form.password }),
        });
        setMessage("Account created successfully! You can now log in.");
        setMessageType("success");
        setMode("login");
      } else if (mode === "forgot") {
        if (!form.email) throw new Error("Please enter your email.");
        const d = await api("/auth/request-otp", {
          method: "POST",
          body: JSON.stringify({ email: form.email }),
        });
        setMessage(`OTP generated: ${d.dev_otp} (Valid for 10 minutes)`);
        setMessageType("notice");
        setMode("otp");
      } else if (mode === "otp") {
        if (form.password.length < 6) throw new Error("New password must be at least 6 characters.");
        const d = await api("/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ email: form.email, otp, password: form.password }),
        });
        setMessage(d.message);
        setMessageType("success");
        setMode("login");
      }
    } catch (err) {
      setMessage(err.message);
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "otp") {
    return (
      <AuthShell title="OTP Verification" subtitle="Enter the 6-digit code sent to your email.">
        <form onSubmit={submit} className="auth-form">
          <label>
            Email
            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label>
            6-Digit OTP
            <input value={otp} onChange={e => setOtp(e.target.value)} maxLength="6" placeholder="123456" required />
          </label>
          <label>
            New Password
            <input
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder="Minimum 6 characters"
              required
            />
          </label>
          <button disabled={busy} className="primary full">
            {busy ? "Please wait…" : "Verify OTP & Reset Password →"}
          </button>
          {message && <div className={`notice notice-${messageType}`}>{message}</div>}
        </form>
        <button className="link-btn" style={{ marginTop: "14px" }} onClick={() => setMode("login")}>
          ← Back to login
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={mode === "login" ? "Welcome Back" : mode === "signup" ? "Create Account" : "Forgot Password"}
      subtitle={
        mode === "login"
          ? "Sign in to continue to StockSense"
          : mode === "signup"
          ? "Join StockSense to manage your inventory"
          : "Enter your email to receive a password reset OTP"
      }
    >
      <form onSubmit={submit} className="auth-form">
        {mode === "signup" && (
          <label>
            Full Name
            <input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Alex Johnson"
              required
            />
          </label>
        )}
        <label>
          Email Address
          <input
            type="email"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            placeholder="admin@stocksense.local"
            required
          />
        </label>
        {mode !== "forgot" && (
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder={mode === "signup" ? "Minimum 6 characters" : "••••••••"}
              required
            />
          </label>
        )}
        {mode === "login" && (
          <div className="between">
            <label className="check">
              <input type="checkbox" defaultChecked /> Remember me
            </label>
            <button type="button" className="link-btn" onClick={() => setMode("forgot")}>
              Forgot Password?
            </button>
          </div>
        )}
        <button disabled={busy} className="primary full">
          {busy ? "Please wait…" : mode === "login" ? "Login →" : mode === "signup" ? "Sign Up" : "Send OTP"}
        </button>
        {message && <div className={`notice notice-${messageType}`}>{message}</div>}
      </form>
      {mode === "login" && (
        <div className="auth-switch">
          Don’t have an account?{" "}
          <button className="link-btn" onClick={() => { setMode("signup"); setMessage(""); }}>
            Sign up
          </button>
        </div>
      )}
      {mode === "signup" && (
        <div className="auth-switch">
          Already have an account?{" "}
          <button className="link-btn" onClick={() => { setMode("login"); setMessage(""); }}>
            Login
          </button>
        </div>
      )}
      {mode === "forgot" && (
        <div className="auth-switch">
          <button className="link-btn" onClick={() => { setMode("login"); setMessage(""); }}>
            ← Back to login
          </button>
        </div>
      )}
    </AuthShell>
  );
}

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="auth-page">
      <section className="auth-visual">
        <Logo light />
        <div className="visual-copy">
          <h1>
            Manage Your
            <br />
            Inventory <span>Smarter</span>
          </h1>
          <p>Track stock, streamline operations, and get real-time visibility across all your warehouses.</p>
          <div className="benefits">
            <div>
              📦 <b>Real-time Stock Tracking</b>
              <small>Know your inventory anytime, anywhere.</small>
            </div>
            <div>
              🏭 <b>Multi-Warehouse Support</b>
              <small>Manage stock across multiple locations.</small>
            </div>
            <div>
              📈 <b>Easy Operations</b>
              <small>Receipts, deliveries, transfers & adjustments.</small>
            </div>
            <div>
              🔔 <b>Low Stock Alerts</b>
              <small>Never run out of critical items.</small>
            </div>
          </div>
          <div className="stats">
            <span>
              <b>10K+</b>
              <small>Products Managed</small>
            </span>
            <span>
              <b>Multi</b>
              <small>Warehouse Support</small>
            </span>
            <span>
              <b>99.9%</b>
              <small>Accurate Tracking</small>
            </span>
          </div>
        </div>
      </section>
      <section className="auth-card-wrap">
        <div className="auth-card">
          <Logo />
          <h2>{title}</h2>
          <p>{subtitle}</p>
          {children}
          <div className="auth-art">📦 🧑‍💼 🏗️</div>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [dash, setDash] = useState(null);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState("");
  const [editingProduct, setEditingProduct] = useState(null);
  const [activeModal, setActiveModal] = useState(null); // 'receipt' | 'delivery' | 'transfer' | 'adjustment'
  const [globalSearch, setGlobalSearch] = useState("");

  async function loadAll() {
    try {
      const [d, p, w, h] = await Promise.all([
        api("/dashboard"),
        api("/products"),
        api("/warehouses"),
        api("/moves"),
      ]);
      setDash(d);
      setProducts(p);
      setWarehouses(w);
      setHistory(h);
    } catch (e) {
      setToast(e.message);
    }
  }

  useEffect(() => {
    if (localStorage.getItem("stocksense_token")) {
      api("/auth/me")
        .then(d => {
          setUser(d);
          loadAll();
        })
        .catch(() => {
          localStorage.removeItem("stocksense_token");
          setUser(null);
        });
    }
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  function logout() {
    localStorage.removeItem("stocksense_token");
    setUser(null);
  }

  if (!user) return <Auth onLogin={u => { setUser(u); loadAll(); }} />;

  const refresh = async (msg = "Updated successfully ✓") => {
    await loadAll();
    setToast(msg);
  };

  async function updateStatus(id, newStatus) {
    try {
      await api(`/operations/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      await refresh(`Operation moved to ${newStatus} ✓`);
    } catch (err) {
      setToast(err.message);
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <Logo light />
        <nav>
          <Nav icon={icons.dashboard} label="Dashboard" active={page === "dashboard"} onClick={() => setPage("dashboard")} />
          <Nav icon={icons.products} label="Products" active={page === "products" || page === "add-product"} onClick={() => setPage("products")} />
          <div className="nav-section">OPERATIONS</div>
          <Nav icon={icons.receipts} label="Receipts" active={page === "receipts"} onClick={() => setPage("receipts")} />
          <Nav icon={icons.deliveries} label="Delivery Orders" active={page === "deliveries"} onClick={() => setPage("deliveries")} />
          <Nav icon={icons.transfers} label="Internal Transfers" active={page === "transfers"} onClick={() => setPage("transfers")} />
          <Nav icon={icons.adjustments} label="Inventory Adjustments" active={page === "adjustments"} onClick={() => setPage("adjustments")} />
          <Nav icon={icons.history} label="Move History" active={page === "history"} onClick={() => setPage("history")} />
          <div className="nav-section">SYSTEM</div>
          <Nav icon={icons.warehouse} label="Warehouses" active={page === "warehouses"} onClick={() => setPage("warehouses")} />
        </nav>
        <div className="sidebar-bottom">
          <div>
            👤 {user.name}
            <small>{user.role}</small>
          </div>
          <button onClick={logout}>🚪 Logout</button>
        </div>
      </aside>

      <main className="main">
        <header>
          <div className="search">
            🔎 <input
              placeholder="Global search by product, SKU, reference…"
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
            />
          </div>
          <div className="header-user">
            <span>
              👨‍💼 {user.name}
              <small>{user.role}</small>
            </span>
          </div>
        </header>

        {toast && <div className="toast">{toast}</div>}

        <div className="content">
          {page === "dashboard" && (
            <Dashboard
              dash={dash}
              history={history}
              products={products}
              warehouses={warehouses}
              onRefresh={refresh}
              onUpdateStatus={updateStatus}
              globalSearch={globalSearch}
            />
          )}

          {page === "products" && (
            <Products
              products={products}
              onAdd={() => setPage("add-product")}
              onEdit={p => setEditingProduct(p)}
              globalSearch={globalSearch}
            />
          )}

          {page === "add-product" && (
            <ProductForm
              warehouses={warehouses}
              onDone={async () => {
                await refresh("Product added successfully ✓");
                setPage("products");
              }}
              onCancel={() => setPage("products")}
            />
          )}

          {page === "receipts" && (
            <OperationsView
              type="receipt"
              title="Receipts (Incoming Stock)"
              sub="Manage incoming supplier receipts and validate stock increases"
              moves={history.filter(m => m.type === "receipt")}
              products={products}
              warehouses={warehouses}
              onNew={() => setActiveModal("receipt")}
              onUpdateStatus={updateStatus}
              globalSearch={globalSearch}
            />
          )}

          {page === "deliveries" && (
            <OperationsView
              type="delivery"
              title="Delivery Orders (Outgoing Stock)"
              sub="Process outgoing shipments to customers with stock validation"
              moves={history.filter(m => m.type === "delivery")}
              products={products}
              warehouses={warehouses}
              onNew={() => setActiveModal("delivery")}
              onUpdateStatus={updateStatus}
              globalSearch={globalSearch}
            />
          )}

          {page === "transfers" && (
            <OperationsView
              type="transfer"
              title="Internal Transfers"
              sub="Transfer inventory between warehouses while maintaining balanced total stock"
              moves={history.filter(m => m.type === "transfer")}
              products={products}
              warehouses={warehouses}
              onNew={() => setActiveModal("transfer")}
              onUpdateStatus={updateStatus}
              globalSearch={globalSearch}
            />
          )}

          {page === "adjustments" && (
            <OperationsView
              type="adjustment"
              title="Inventory Adjustments"
              sub="Reconcile recorded inventory with actual physical counts"
              moves={history.filter(m => m.type === "adjustment")}
              products={products}
              warehouses={warehouses}
              onNew={() => setActiveModal("adjustment")}
              onUpdateStatus={updateStatus}
              globalSearch={globalSearch}
            />
          )}

          {page === "history" && (
            <History
              history={history}
              warehouses={warehouses}
              globalSearch={globalSearch}
            />
          )}

          {page === "warehouses" && (
            <Warehouses
              warehouses={warehouses}
              onDone={() => refresh("Warehouse added successfully ✓")}
            />
          )}
        </div>
      </main>

      {/* Edit Product Modal */}
      {editingProduct && (
        <EditProductModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={async () => {
            setEditingProduct(null);
            await refresh("Product updated successfully ✓");
          }}
        />
      )}

      {/* Operation Creation Modal */}
      {activeModal && (
        <OperationModal
          type={activeModal}
          products={products}
          warehouses={warehouses}
          onClose={() => setActiveModal(null)}
          onDone={async (msg) => {
            setActiveModal(null);
            await refresh(msg || "Operation created successfully ✓");
          }}
        />
      )}
    </div>
  );
}

function Nav({ icon, label, active, onClick }) {
  return (
    <button className={"nav-item " + (active ? "active" : "")} onClick={onClick}>
      <span>{icon}</span>
      {label}
    </button>
  );
}

function PageTitle({ title, sub, action }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {action}
    </div>
  );
}

function Dashboard({ dash, history, products, warehouses, onRefresh, onUpdateStatus, globalSearch }) {
  const [docFilter, setDocFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [localSearch, setLocalSearch] = useState("");

  const categories = useMemo(() => {
    const set = new Set(products.map(p => p.category).filter(Boolean));
    return Array.from(set);
  }, [products]);

  const filteredHistory = useMemo(() => {
    return history.filter(m => {
      if (docFilter !== "all" && m.type !== docFilter) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (warehouseFilter !== "all") {
        const wid = +warehouseFilter;
        if (m.from_warehouse_id !== wid && m.to_warehouse_id !== wid) return false;
      }
      if (categoryFilter !== "all") {
        const p = products.find(prod => prod.id === m.product_id);
        if (!p || p.category !== categoryFilter) return false;
      }
      const s = (localSearch || globalSearch).toLowerCase().trim();
      if (s) {
        const match =
          (m.product || "").toLowerCase().includes(s) ||
          (m.reference || "").toLowerCase().includes(s) ||
          (m.type || "").toLowerCase().includes(s) ||
          (m.partner || "").toLowerCase().includes(s) ||
          (m.reason || "").toLowerCase().includes(s);
        if (!match) return false;
      }
      return true;
    });
  }, [history, docFilter, statusFilter, warehouseFilter, categoryFilter, localSearch, globalSearch, products]);

  if (!dash) return <Loading />;

  return (
    <>
      <PageTitle
        title="Dashboard"
        sub="Overview of inventory operations and stock health"
        action={
          <button className="secondary" onClick={() => onRefresh("Dashboard refreshed ✓")}>
            ↻ Refresh
          </button>
        }
      />

      <div className="kpi-grid">
        {[
          ["📦", "Total Products", dash.total_products, "#eef6ff"],
          ["⚠️", "Low Stock Items", dash.low_stock, "#fff7e8"],
          ["🛑", "Out of Stock", dash.out_of_stock, "#fff0f0"],
          ["📥", "Pending Receipts", dash.pending_receipts, "#f3efff"],
          ["📤", "Pending Deliveries", dash.pending_deliveries, "#effaf4"],
          ["🔄", "Scheduled Transfers", dash.scheduled_transfers, "#eef6ff"],
        ].map(x => (
          <div className="kpi" style={{ background: x[3] }} key={x[1]}>
            <span>{x[0]}</span>
            <div>
              <small>{x[1]}</small>
              <strong>{x[2]}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <h3>Stock by Warehouse</h3>
          </div>
          {dash.stock_by_warehouse.map(w => (
            <div className="bar-row" key={w.name}>
              <span>{w.name}</span>
              <div>
                <i style={{ width: `${Math.min(100, (w.qty / (dash.max_warehouse_qty || 1)) * 100)}%` }} />
              </div>
              <b>{w.qty}</b>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Low Stock Alerts</h3>
          </div>
          {dash.alerts && dash.alerts.length ? (
            dash.alerts.map(a => (
              <div className="alert-row" key={a.sku}>
                <span>🔔</span>
                <div>
                  <b>{a.name} ({a.sku})</b>
                  <small>
                    Stock: {a.stock} / Reorder Level: {a.reorder_level}
                  </small>
                </div>
                <em className={a.stock <= 0 ? "out" : "low"}>
                  {a.stock <= 0 ? "Out of stock" : "Low stock"}
                </em>
              </div>
            ))
          ) : (
            <div className="empty">No low-stock items 🎉</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Operations & Movements</h3>
          <small style={{ color: "#64748b" }}>Showing {filteredHistory.length} matching operations</small>
        </div>

        {/* Complete Dashboard Filter Bar */}
        <div className="filter-bar">
          <select value={docFilter} onChange={e => setDocFilter(e.target.value)}>
            <option value="all">All Document Types</option>
            <option value="receipt">Receipts (Incoming)</option>
            <option value="delivery">Deliveries (Outgoing)</option>
            <option value="transfer">Internal Transfers</option>
            <option value="adjustment">Adjustments</option>
          </select>

          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Waiting">Waiting</option>
            <option value="Ready">Ready</option>
            <option value="Done">Done</option>
            <option value="Canceled">Canceled</option>
          </select>

          <select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)}>
            <option value="all">All Warehouses</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>

          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="all">All Categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <input
            placeholder="Filter operations…"
            value={localSearch}
            onChange={e => setLocalSearch(e.target.value)}
          />

          {(docFilter !== "all" || statusFilter !== "all" || warehouseFilter !== "all" || categoryFilter !== "all" || localSearch) && (
            <button
              className="btn-sm"
              onClick={() => {
                setDocFilter("all");
                setStatusFilter("all");
                setWarehouseFilter("all");
                setCategoryFilter("all");
                setLocalSearch("");
              }}
            >
              ✕ Reset Filters
            </button>
          )}
        </div>

        <OperationsTable
          rows={filteredHistory.slice(0, 15)}
          onUpdateStatus={onUpdateStatus}
        />
      </div>
    </>
  );
}

function Products({ products, onAdd, onEdit, globalSearch }) {
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const categories = useMemo(() => {
    const s = new Set(products.map(p => p.category).filter(Boolean));
    return Array.from(s);
  }, [products]);

  const rows = useMemo(() => {
    return products.filter(p => {
      if (catFilter !== "all" && p.category !== catFilter) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      const s = (q || globalSearch).toLowerCase().trim();
      if (s) {
        const match =
          (p.name || "").toLowerCase().includes(s) ||
          (p.sku || "").toLowerCase().includes(s) ||
          (p.category || "").toLowerCase().includes(s);
        if (!match) return false;
      }
      return true;
    });
  }, [products, q, globalSearch, catFilter, statusFilter]);

  return (
    <>
      <PageTitle
        title="Products"
        sub="Manage product catalog, reorder levels, and warehouse stock"
        action={
          <button className="primary" onClick={onAdd}>
            ＋ Add Product
          </button>
        }
      />

      <div className="panel">
        <div className="toolbar">
          <input
            placeholder="🔎 Search by name, SKU, category…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="all">All Categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Stock Statuses</option>
            <option value="In Stock">In Stock</option>
            <option value="Low Stock">Low Stock</option>
            <option value="Out of Stock">Out of Stock</option>
          </select>
          <small style={{ color: "#64748b", marginLeft: "auto" }}>
            {rows.length} product{rows.length === 1 ? "" : "s"} found
          </small>
        </div>

        {rows.length === 0 ? (
          <div className="empty">No products matching the criteria.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product Name</th>
                  <th>SKU / Code</th>
                  <th>Category</th>
                  <th>Unit</th>
                  <th>Reorder Level</th>
                  <th>Total Stock</th>
                  <th>Warehouse Stock</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b></td>
                    <td><code>{p.sku}</code></td>
                    <td>{p.category}</td>
                    <td>{p.unit}</td>
                    <td>{p.reorder_level}</td>
                    <td><b>{p.stock}</b></td>
                    <td>
                      {p.warehouse_stocks && p.warehouse_stocks.length > 0 ? (
                        p.warehouse_stocks.map(ws => (
                          <span key={ws.warehouse_id} className="stock-tag">
                            {ws.warehouse_name}: <b>{ws.qty}</b>
                          </span>
                        ))
                      ) : (
                        <span style={{ color: "#94a3b8" }}>No stock</span>
                      )}
                    </td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>
                      <button className="btn-sm btn-sm-primary" onClick={() => onEdit(p)}>
                        ✏️ Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function EditProductModal({ product, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: product.name,
    sku: product.sku,
    category: product.category,
    unit: product.unit,
    reorder_level: product.reorder_level,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/products/${product.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name.trim(),
          sku: form.sku.trim(),
          category: form.category.trim(),
          unit: form.unit.trim(),
          reorder_level: +form.reorder_level,
        }),
      });
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Product — {product.sku}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {error && <div className="notice notice-error" style={{ marginBottom: "16px" }}>{error}</div>}

        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Product Name" value={form.name} onChange={v => setForm({ ...form, name: v })} />
            <Field label="SKU / Code" value={form.sku} onChange={v => setForm({ ...form, sku: v })} />
            <Field label="Category" value={form.category} onChange={v => setForm({ ...form, category: v })} />
            <Field label="Unit of Measure" value={form.unit} onChange={v => setForm({ ...form, unit: v })} />
            <Field
              label="Reorder Level"
              type="number"
              value={form.reorder_level}
              onChange={v => setForm({ ...form, reorder_level: v })}
            />
          </div>

          <div style={{ marginTop: "20px", padding: "14px", background: "#f8fafc", borderRadius: "10px" }}>
            <small style={{ fontWeight: "700", color: "#475569", display: "block", marginBottom: "6px" }}>
              Current Warehouse Stock:
            </small>
            {product.warehouse_stocks && product.warehouse_stocks.length > 0 ? (
              product.warehouse_stocks.map(ws => (
                <span key={ws.warehouse_id} className="stock-tag" style={{ fontSize: "11px" }}>
                  {ws.warehouse_name}: <b>{ws.qty}</b>
                </span>
              ))
            ) : (
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>0 units recorded</span>
            )}
          </div>

          <div className="form-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className="primary">
              {busy ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProductForm({ warehouses, onDone, onCancel }) {
  const [f, setF] = useState({
    name: "",
    sku: "",
    category: "Raw Material",
    unit: "PCS",
    initial_stock: 0,
    warehouse_id: warehouses[0]?.id || 1,
    reorder_level: 10,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!f.name.trim() || !f.sku.trim() || !f.category.trim() || !f.unit.trim()) {
        throw new Error("All product fields are required.");
      }
      await api("/products", {
        method: "POST",
        body: JSON.stringify({
          name: f.name.trim(),
          sku: f.sku.trim(),
          category: f.category.trim(),
          unit: f.unit.trim(),
          initial_stock: +f.initial_stock,
          warehouse_id: +f.warehouse_id,
          reorder_level: +f.reorder_level,
        }),
      });
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle title="Add Product" sub="Create a new inventory item and establish initial stock" />
      <div className="panel form-card">
        {error && <div className="notice notice-error" style={{ marginBottom: "18px" }}>{error}</div>}
        <form onSubmit={save}>
          <div className="form-grid">
            <Field label="Product Name" value={f.name} onChange={v => setF({ ...f, name: v })} placeholder="e.g. Copper Wire" />
            <Field label="SKU / Code" value={f.sku} onChange={v => setF({ ...f, sku: v })} placeholder="e.g. CPR001" />
            <Field label="Category" value={f.category} onChange={v => setF({ ...f, category: v })} placeholder="e.g. Raw Material" />
            <Field label="Unit of Measure" value={f.unit} onChange={v => setF({ ...f, unit: v })} placeholder="e.g. KG, PCS, MTR" />
            <Field
              label="Initial Stock"
              type="number"
              value={f.initial_stock}
              onChange={v => setF({ ...f, initial_stock: v })}
            />
            <Select
              label="Initial Warehouse"
              value={f.warehouse_id}
              options={warehouses}
              onChange={v => setF({ ...f, warehouse_id: v })}
            />
            <Field
              label="Reorder Level"
              type="number"
              value={f.reorder_level}
              onChange={v => setF({ ...f, reorder_level: v })}
            />
          </div>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className="primary">
              {busy ? "Saving…" : "Save Product"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function OperationsView({ type, title, sub, moves, products, warehouses, onNew, onUpdateStatus, globalSearch }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [whFilter, setWhFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return moves.filter(m => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (whFilter !== "all") {
        const wid = +whFilter;
        if (m.from_warehouse_id !== wid && m.to_warehouse_id !== wid) return false;
      }
      const s = (search || globalSearch).toLowerCase().trim();
      if (s) {
        const match =
          (m.product || "").toLowerCase().includes(s) ||
          (m.reference || "").toLowerCase().includes(s) ||
          (m.partner || "").toLowerCase().includes(s) ||
          (m.reason || "").toLowerCase().includes(s);
        if (!match) return false;
      }
      return true;
    });
  }, [moves, statusFilter, whFilter, search, globalSearch]);

  const newBtnLabel =
    type === "receipt"
      ? "＋ New Receipt"
      : type === "delivery"
      ? "＋ New Delivery Order"
      : type === "transfer"
      ? "＋ New Transfer"
      : "＋ New Adjustment";

  return (
    <>
      <PageTitle
        title={title}
        sub={sub}
        action={
          <button className="primary" onClick={onNew}>
            {newBtnLabel}
          </button>
        }
      />

      <div className="panel">
        <div className="toolbar">
          <input
            placeholder="🔎 Search by product, reference, partner…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Waiting">Waiting</option>
            <option value="Ready">Ready</option>
            <option value="Done">Done</option>
            <option value="Canceled">Canceled</option>
          </select>
          <select value={whFilter} onChange={e => setWhFilter(e.target.value)}>
            <option value="all">All Warehouses</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <small style={{ color: "#64748b", marginLeft: "auto" }}>
            {filtered.length} document{filtered.length === 1 ? "" : "s"}
          </small>
        </div>

        <OperationsTable rows={filtered} onUpdateStatus={onUpdateStatus} showDetails />
      </div>
    </>
  );
}

function OperationsTable({ rows, onUpdateStatus, showDetails = false }) {
  if (!rows || rows.length === 0) {
    return <div className="empty">No operation records found.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Date & Time</th>
            <th>Type</th>
            <th>Product</th>
            <th>Quantity</th>
            <th>From</th>
            <th>To</th>
            <th>Status</th>
            <th>Partner / Reason</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td><b><code>{r.reference || `OP-${r.id}`}</code></b></td>
              <td>{r.date}</td>
              <td><span className={`type type-${r.type}`}>{r.type?.toUpperCase()}</span></td>
              <td>
                <b>{r.product}</b> {r.sku && <small style={{ color: "#64748b" }}>({r.sku})</small>}
              </td>
              <td>
                <b>{r.quantity > 0 && r.type === "receipt" ? `+${r.quantity}` : r.quantity}</b>
              </td>
              <td>{r.from_location || "—"}</td>
              <td>{r.to_location || "—"}</td>
              <td><StatusBadge status={r.status} /></td>
              <td>{r.partner || r.reason || "—"}</td>
              <td>
                <div className="btn-group">
                  {r.status === "Draft" && (
                    <>
                      <button className="btn-sm" onClick={() => onUpdateStatus(r.id, "Waiting")} title="Advance to Waiting">
                        Waiting
                      </button>
                      <button className="btn-sm" onClick={() => onUpdateStatus(r.id, "Ready")} title="Advance to Ready">
                        Ready
                      </button>
                      <button className="btn-sm btn-sm-primary" onClick={() => onUpdateStatus(r.id, "Done")} title="Validate and Complete">
                        Validate ✓
                      </button>
                      <button className="btn-danger" onClick={() => onUpdateStatus(r.id, "Canceled")} title="Cancel Operation">
                        Cancel
                      </button>
                    </>
                  )}
                  {r.status === "Waiting" && (
                    <>
                      <button className="btn-sm" onClick={() => onUpdateStatus(r.id, "Ready")} title="Advance to Ready">
                        Ready
                      </button>
                      <button className="btn-sm btn-sm-primary" onClick={() => onUpdateStatus(r.id, "Done")} title="Validate and Complete">
                        Validate ✓
                      </button>
                      <button className="btn-danger" onClick={() => onUpdateStatus(r.id, "Canceled")} title="Cancel Operation">
                        Cancel
                      </button>
                    </>
                  )}
                  {r.status === "Ready" && (
                    <>
                      <button className="btn-sm btn-sm-primary" onClick={() => onUpdateStatus(r.id, "Done")} title="Validate and Complete">
                        Validate ✓
                      </button>
                      <button className="btn-danger" onClick={() => onUpdateStatus(r.id, "Canceled")} title="Cancel Operation">
                        Cancel
                      </button>
                    </>
                  )}
                  {(r.status === "Done" || r.status === "Canceled") && (
                    <small style={{ color: "#94a3b8" }}>Finalized</small>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OperationModal({ type, products, warehouses, onClose, onDone }) {
  const titles = {
    receipt: ["New Receipt (Incoming Stock)", "Add incoming goods from supplier"],
    delivery: ["New Delivery Order (Outgoing Stock)", "Ship products to customer with stock check"],
    transfer: ["New Internal Transfer", "Move stock between two warehouse locations"],
    adjustment: ["New Inventory Adjustment", "Reconcile physical inventory count"],
  };

  const [productId, setProductId] = useState(products[0]?.id || "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || "");
  const [fromWarehouseId, setFromWarehouseId] = useState(warehouses[0]?.id || "");
  const [toWarehouseId, setToWarehouseId] = useState(warehouses[1]?.id || warehouses[0]?.id || "");
  const [quantity, setQuantity] = useState(10);
  const [physicalCount, setPhysicalCount] = useState(0);
  const [partner, setPartner] = useState(type === "receipt" ? "ABC Steel Suppliers" : "XYZ Manufacturing");
  const [reason, setReason] = useState(type === "adjustment" ? "Annual physical recount" : "Standard operations");
  const [desiredStatus, setDesiredStatus] = useState("Done"); // 'Draft' | 'Done'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedProduct = useMemo(() => {
    return products.find(p => p.id === +productId) || products[0];
  }, [products, productId]);

  // Current stock at selected warehouse
  const currentStockAtLocation = useMemo(() => {
    if (!selectedProduct || !selectedProduct.warehouse_stocks) return 0;
    const targetWhId = type === "transfer" ? +fromWarehouseId : +warehouseId;
    const ws = selectedProduct.warehouse_stocks.find(w => w.warehouse_id === targetWhId);
    return ws ? ws.qty : 0;
  }, [selectedProduct, warehouseId, fromWarehouseId, type]);

  useEffect(() => {
    if (type === "adjustment") {
      setPhysicalCount(currentStockAtLocation);
    }
  }, [currentStockAtLocation, type]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      if (!productId) throw new Error("Please select a product.");

      if (type === "delivery" && desiredStatus === "Done") {
        if (+quantity > currentStockAtLocation) {
          throw new Error(`Insufficient stock. Available at selected location: ${currentStockAtLocation} units.`);
        }
      }

      if (type === "transfer") {
        if (+fromWarehouseId === +toWarehouseId) {
          throw new Error("Source and destination warehouses must be different.");
        }
        if (desiredStatus === "Done" && +quantity > currentStockAtLocation) {
          throw new Error(`Insufficient stock at source warehouse. Available: ${currentStockAtLocation} units.`);
        }
      }

      if (type === "adjustment" && +physicalCount < 0) {
        throw new Error("Physical count cannot be negative.");
      }

      if (type !== "adjustment" && +quantity <= 0) {
        throw new Error("Quantity must be greater than zero.");
      }

      const res = await api("/operations", {
        method: "POST",
        body: JSON.stringify({
          type,
          product_id: +productId,
          quantity: +quantity,
          warehouse_id: +warehouseId,
          from_warehouse_id: +fromWarehouseId,
          to_warehouse_id: +toWarehouseId,
          physical_count: +physicalCount,
          partner,
          reason,
          status: desiredStatus,
        }),
      });

      await onDone(`Operation ${res.reference} recorded (${desiredStatus}) ✓`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{titles[type][0]}</h2>
            <small style={{ color: "#64748b" }}>{titles[type][1]}</small>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {error && <div className="notice notice-error" style={{ marginBottom: "16px" }}>{error}</div>}

        <form onSubmit={submit}>
          <div className="form-grid">
            <Select
              label="Product"
              value={productId}
              options={products.map(p => ({ id: p.id, name: `${p.name} (${p.sku})` }))}
              onChange={v => setProductId(v)}
            />

            {type === "receipt" && (
              <>
                <Select
                  label="Destination Warehouse"
                  value={warehouseId}
                  options={warehouses}
                  onChange={v => setWarehouseId(v)}
                />
                <Field label="Supplier" value={partner} onChange={v => setPartner(v)} />
                <Field
                  label="Quantity to Receive"
                  type="number"
                  value={quantity}
                  onChange={v => setQuantity(v)}
                />
              </>
            )}

            {type === "delivery" && (
              <>
                <div>
                  <Select
                    label="Source Warehouse"
                    value={warehouseId}
                    options={warehouses}
                    onChange={v => setWarehouseId(v)}
                  />
                  <div className="hint-text">
                    Available stock at location: <b>{currentStockAtLocation}</b> units
                  </div>
                </div>
                <Field label="Customer" value={partner} onChange={v => setPartner(v)} />
                <Field
                  label="Quantity to Ship"
                  type="number"
                  value={quantity}
                  onChange={v => setQuantity(v)}
                />
              </>
            )}

            {type === "transfer" && (
              <>
                <div>
                  <Select
                    label="From Location (Source)"
                    value={fromWarehouseId}
                    options={warehouses}
                    onChange={v => setFromWarehouseId(v)}
                  />
                  <div className="hint-text">
                    Available stock: <b>{currentStockAtLocation}</b> units
                  </div>
                </div>
                <Select
                  label="To Location (Destination)"
                  value={toWarehouseId}
                  options={warehouses}
                  onChange={v => setToWarehouseId(v)}
                />
                <Field
                  label="Quantity to Transfer"
                  type="number"
                  value={quantity}
                  onChange={v => setQuantity(v)}
                />
              </>
            )}

            {type === "adjustment" && (
              <>
                <div>
                  <Select
                    label="Warehouse / Location"
                    value={warehouseId}
                    options={warehouses}
                    onChange={v => setWarehouseId(v)}
                  />
                  <div className="hint-text">
                    System recorded stock: <b>{currentStockAtLocation}</b> units
                  </div>
                </div>
                <div>
                  <Field
                    label="Actual Physical Count"
                    type="number"
                    value={physicalCount}
                    onChange={v => setPhysicalCount(v)}
                  />
                  <div className="hint-text">
                    Difference: <b>{+physicalCount - currentStockAtLocation >= 0 ? `+${+physicalCount - currentStockAtLocation}` : +physicalCount - currentStockAtLocation}</b> units
                  </div>
                </div>
              </>
            )}

            <Field label="Reference / Reason" value={reason} onChange={v => setReason(v)} />
          </div>

          <div style={{ marginTop: "20px", display: "flex", gap: "10px", alignItems: "center" }}>
            <span style={{ fontSize: "13px", fontWeight: "700", color: "#334155" }}>Workflow Mode:</span>
            <label style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer", fontSize: "13px" }}>
              <input
                type="radio"
                name="status_choice"
                checked={desiredStatus === "Done"}
                onChange={() => setDesiredStatus("Done")}
              />
              Validate & Complete Now (Modifies stock)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer", fontSize: "13px", marginLeft: "14px" }}>
              <input
                type="radio"
                name="status_choice"
                checked={desiredStatus === "Draft"}
                onChange={() => setDesiredStatus("Draft")}
              />
              Save as Draft (No stock change until validated)
            </label>
          </div>

          <div className="form-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className={`primary ${type === "adjustment" ? "orange" : ""}`}
            >
              {busy ? "Saving…" : desiredStatus === "Done" ? "Validate & Complete ✓" : "Save as Draft 💾"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function History({ history, warehouses, globalSearch }) {
  const [docFilter, setDocFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [whFilter, setWhFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return history.filter(m => {
      if (docFilter !== "all" && m.type !== docFilter) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (whFilter !== "all") {
        const wid = +whFilter;
        if (m.from_warehouse_id !== wid && m.to_warehouse_id !== wid) return false;
      }
      const s = (search || globalSearch).toLowerCase().trim();
      if (s) {
        const match =
          (m.product || "").toLowerCase().includes(s) ||
          (m.reference || "").toLowerCase().includes(s) ||
          (m.partner || "").toLowerCase().includes(s) ||
          (m.reason || "").toLowerCase().includes(s);
        if (!match) return false;
      }
      return true;
    });
  }, [history, docFilter, statusFilter, whFilter, search, globalSearch]);

  return (
    <>
      <PageTitle
        title="Move History / Stock Ledger"
        sub="Complete immutable audit ledger of all inventory movements and status progressions"
      />
      <div className="panel">
        <div className="toolbar">
          <input
            placeholder="🔎 Search ledger by product, reference, reason…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select value={docFilter} onChange={e => setDocFilter(e.target.value)}>
            <option value="all">All Document Types</option>
            <option value="receipt">Receipt</option>
            <option value="delivery">Delivery</option>
            <option value="transfer">Transfer</option>
            <option value="adjustment">Adjustment</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Waiting">Waiting</option>
            <option value="Ready">Ready</option>
            <option value="Done">Done</option>
            <option value="Canceled">Canceled</option>
          </select>
          <select value={whFilter} onChange={e => setWhFilter(e.target.value)}>
            <option value="all">All Locations</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <small style={{ color: "#64748b", marginLeft: "auto" }}>
            {filtered.length} audit record{filtered.length === 1 ? "" : "s"}
          </small>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">No matching ledger records.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Reference</th>
                  <th>Type</th>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Source Location</th>
                  <th>Destination Location</th>
                  <th>Status</th>
                  <th>Partner / Reason</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td><b><code>{r.reference || `OP-${r.id}`}</code></b></td>
                    <td><span className={`type type-${r.type}`}>{r.type?.toUpperCase()}</span></td>
                    <td>
                      <b>{r.product}</b> {r.sku && <small style={{ color: "#64748b" }}>({r.sku})</small>}
                    </td>
                    <td>
                      <b>{r.quantity > 0 && r.type === "receipt" ? `+${r.quantity}` : r.quantity}</b>
                    </td>
                    <td>{r.from_location || "—"}</td>
                    <td>{r.to_location || "—"}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{r.partner || r.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Warehouses({ warehouses, onDone }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api("/warehouses", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setName("");
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle title="Warehouses" sub="Manage stock locations and view unit counts" />
      <div className="panel">
        {error && <div className="notice notice-error" style={{ marginBottom: "16px" }}>{error}</div>}
        <form onSubmit={add} className="inline-form">
          <input
            placeholder="New warehouse / location name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
          <button disabled={busy} className="primary">
            {busy ? "Adding…" : "＋ Add Warehouse"}
          </button>
        </form>
        <div className="warehouse-list">
          {warehouses.map(w => (
            <div key={w.id}>
              <span>🏭 <b>{w.name}</b></span>
              <span><b>{w.stock_qty}</b> units stored</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required
      />
    </label>
  );
}

function Select({ label, value, options, onChange }) {
  return (
    <label>
      {label}
      <select value={value} onChange={e => onChange(e.target.value)} required>
        {options.map(o => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Loading() {
  return <div className="loading">Loading StockSense…</div>;
}

createRoot(document.getElementById("root")).render(<App />);
