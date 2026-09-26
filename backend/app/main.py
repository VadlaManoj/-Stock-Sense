import sqlite3, hashlib, secrets, os, re
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def utc_now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")

DB = os.path.join(os.path.dirname(__file__), "stocksense.db")
app = FastAPI(title="StockSense API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c

def hash_pw(p: str, s: Optional[str] = None):
    s = s or secrets.token_hex(16)
    return s, hashlib.pbkdf2_hmac("sha256", p.encode(), s.encode(), 120000).hex()

def verify_pw(p: str, s: str, h: str) -> bool:
    return hashlib.pbkdf2_hmac("sha256", p.encode(), s.encode(), 120000).hex() == h

def init():
    c = db()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password_hash TEXT, salt TEXT, role TEXT DEFAULT 'Inventory Manager');
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, expires TEXT);
    CREATE TABLE IF NOT EXISTS warehouses(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, sku TEXT UNIQUE, category TEXT, unit TEXT, initial_stock REAL DEFAULT 0, reorder_level REAL DEFAULT 10);
    CREATE TABLE IF NOT EXISTS stock(id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, warehouse_id INTEGER, qty REAL DEFAULT 0, UNIQUE(product_id, warehouse_id));
    CREATE TABLE IF NOT EXISTS moves(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, type TEXT, product_id INTEGER, quantity REAL, from_warehouse_id INTEGER, to_warehouse_id INTEGER, status TEXT, reason TEXT, partner TEXT, reference TEXT);
    CREATE TABLE IF NOT EXISTS reset_otps(email TEXT PRIMARY KEY, otp TEXT, expires TEXT);
    """)

    # Check and migrate columns if moves table was created without partner or reference
    cols = [r["name"] for r in c.execute("PRAGMA table_info(moves)").fetchall()]
    if "partner" not in cols:
        c.execute("ALTER TABLE moves ADD COLUMN partner TEXT")
    if "reference" not in cols:
        c.execute("ALTER TABLE moves ADD COLUMN reference TEXT")

    # Seed default user
    if not c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        s, h = hash_pw("admin123")
        c.execute("INSERT INTO users(name, email, password_hash, salt) VALUES(?, ?, ?, ?)",
                  ("Demo Manager", "admin@stocksense.local", h, s))

    # Seed default warehouses
    if not c.execute("SELECT 1 FROM warehouses LIMIT 1").fetchone():
        c.executemany("INSERT INTO warehouses(name) VALUES(?)", [("Main Warehouse",), ("Production Floor",), ("Store Room",)])

    # Seed default products
    if not c.execute("SELECT 1 FROM products LIMIT 1").fetchone():
        seed_products = [
            ("Steel Rod", "STL001", "Raw Material", "KG", 50, 20),
            ("Wooden Chair", "CHR001", "Finished Goods", "PCS", 120, 20),
            ("Screws", "SCR001", "Components", "PCS", 8, 20),
            ("Wood Planks", "WDP001", "Raw Material", "KG", 0, 15),
            ("Paint Bucket", "PNT001", "Consumables", "PCS", 25, 10),
        ]
        wh_row = c.execute("SELECT id FROM warehouses WHERE name='Main Warehouse'").fetchone()
        wh = wh_row["id"] if wh_row else 1
        now = utc_now_str()

        for p in seed_products:
            c.execute("INSERT INTO products(name, sku, category, unit, initial_stock, reorder_level) VALUES(?, ?, ?, ?, ?, ?)", p)
            pid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            if p[4] > 0:
                c.execute("INSERT INTO stock(product_id, warehouse_id, qty) VALUES(?, ?, ?)", (pid, wh, p[4]))
                ref = f"INIT-{pid:04d}"
                c.execute("INSERT INTO moves(date, type, product_id, quantity, to_warehouse_id, status, reason, reference) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                          (now, "receipt", pid, p[4], wh, "Done", "Initial Inventory", ref))

    # Ensure existing moves have reference
    c.execute("""
        UPDATE moves SET reference = UPPER(SUBSTR(type, 1, 3)) || '-' || printf('%04d', id)
        WHERE reference IS NULL OR reference = ''
    """)

    c.commit()
    c.close()

init()

def auth(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Login required")
    t = authorization.split(" ", 1)[1]
    c = db()
    r = c.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
                  (t, utc_now_iso())).fetchone()
    if not r:
        raise HTTPException(401, "Session expired")
    return dict(r)

# --- Pydantic Request Models ---
class Signup(BaseModel):
    name: str = Field(..., min_length=1)
    email: str = Field(..., min_length=3)
    password: str = Field(..., min_length=6)

class Login(BaseModel):
    email: str
    password: str

class OTPReq(BaseModel):
    email: str

class Reset(BaseModel):
    email: str
    otp: str
    password: str = Field(..., min_length=6)

class ProductIn(BaseModel):
    name: str = Field(..., min_length=1)
    sku: str = Field(..., min_length=1)
    category: str = Field(..., min_length=1)
    unit: str = Field(..., min_length=1)
    initial_stock: float = Field(0, ge=0)
    reorder_level: float = Field(10, ge=0)
    warehouse_id: Optional[int] = None

class ProductUpdate(BaseModel):
    name: str = Field(..., min_length=1)
    sku: str = Field(..., min_length=1)
    category: str = Field(..., min_length=1)
    unit: str = Field(..., min_length=1)
    reorder_level: float = Field(..., ge=0)

class WarehouseIn(BaseModel):
    name: str = Field(..., min_length=1)

class Operation(BaseModel):
    type: str  # receipt, delivery, transfer, adjustment
    product_id: int
    quantity: float = 0
    warehouse_id: Optional[int] = 0
    from_warehouse_id: Optional[int] = 0
    to_warehouse_id: Optional[int] = 0
    physical_count: Optional[float] = 0
    reason: Optional[str] = ""
    partner: Optional[str] = ""
    status: Optional[str] = "Done"

class StatusUpdate(BaseModel):
    status: str

# --- Helper Functions ---
def change_stock(c, pid: int, wid: int, delta: float):
    r = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (pid, wid)).fetchone()
    if not r:
        if delta < 0:
            raise HTTPException(400, "Insufficient stock at selected location")
        c.execute("INSERT INTO stock(product_id, warehouse_id, qty) VALUES(?, ?, ?)", (pid, wid, delta))
    else:
        new_qty = r["qty"] + delta
        if new_qty < 0:
            raise HTTPException(400, "Insufficient stock at selected location")
        c.execute("UPDATE stock SET qty=? WHERE product_id=? AND warehouse_id=?", (new_qty, pid, wid))

def get_product_warehouse_stocks(c, product_id: int):
    rows = c.execute("""
        SELECT w.id warehouse_id, w.name warehouse_name, COALESCE(s.qty, 0) qty
        FROM warehouses w
        LEFT JOIN stock s ON s.warehouse_id=w.id AND s.product_id=?
        ORDER BY w.id
    """, (product_id,)).fetchall()
    return [dict(r) for r in rows]

# --- Auth Routes ---
@app.post("/api/auth/signup")
def signup(x: Signup):
    name = x.name.strip()
    email = x.email.strip().lower()
    if not name:
        raise HTTPException(400, "Name is required")
    if "@" not in email:
        raise HTTPException(400, "Invalid email address")
    if len(x.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    c = db()
    try:
        s, h = hash_pw(x.password)
        c.execute("INSERT INTO users(name, email, password_hash, salt) VALUES(?, ?, ?, ?)", (name, email, h, s))
        c.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(400, "Email already registered")
    finally:
        c.close()
    return {"message": "Account created successfully"}

@app.post("/api/auth/login")
def login(x: Login):
    email = x.email.strip().lower()
    c = db()
    r = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not r or not verify_pw(x.password, r["salt"], r["password_hash"]):
        c.close()
        raise HTTPException(401, "Invalid email or password")
    token = secrets.token_urlsafe(32)
    exp = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    c.execute("INSERT INTO sessions(token, user_id, expires) VALUES(?, ?, ?)", (token, r["id"], exp))
    c.commit()
    c.close()
    return {"token": token, "user": {"id": r["id"], "name": r["name"], "email": r["email"], "role": r["role"]}}

@app.get("/api/auth/me")
def me(authorization: Optional[str] = Header(None)):
    user = auth(authorization)
    return {k: user[k] for k in ("id", "name", "email", "role")}

@app.post("/api/auth/request-otp")
def request_otp(x: OTPReq):
    email = x.email.strip().lower()
    c = db()
    r = c.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
    if not r:
        c.close()
        raise HTTPException(404, "No account found for this email")
    otp = f"{secrets.randbelow(1000000):06d}"
    exp = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    c.execute("INSERT OR REPLACE INTO reset_otps(email, otp, expires) VALUES(?, ?, ?)", (email, otp, exp))
    c.commit()
    c.close()
    print(f"[StockSense DEMO OTP] {email}: {otp}")
    return {"message": "OTP generated", "dev_otp": otp}

@app.post("/api/auth/reset-password")
def reset_password(x: Reset):
    email = x.email.strip().lower()
    c = db()
    r = c.execute("SELECT * FROM reset_otps WHERE email=? AND otp=? AND expires>?",
                  (email, x.otp, utc_now_iso())).fetchone()
    if not r:
        c.close()
        raise HTTPException(400, "Invalid or expired OTP")
    s, h = hash_pw(x.password)
    c.execute("UPDATE users SET password_hash=?, salt=? WHERE email=?", (h, s, email))
    c.execute("DELETE FROM reset_otps WHERE email=?", (email,))
    c.commit()
    c.close()
    return {"message": "Password reset successfully"}

# --- Products Routes ---
@app.get("/api/products")
def get_products(authorization: Optional[str] = Header(None),
                 category: Optional[str] = None,
                 search: Optional[str] = None):
    auth(authorization)
    c = db()
    query = """
        SELECT p.*, COALESCE(SUM(s.qty), 0) stock
        FROM products p
        LEFT JOIN stock s ON s.product_id=p.id
        WHERE 1=1
    """
    params = []
    if category:
        query += " AND p.category = ?"
        params.append(category)
    if search:
        s = f"%{search.strip().lower()}%"
        query += " AND (LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ?)"
        params.extend([s, s])
    query += " GROUP BY p.id ORDER BY p.id DESC"

    rows = c.execute(query, params).fetchall()

    # Pre-fetch all warehouse stocks
    ws_rows = c.execute("""
        SELECT s.product_id, s.warehouse_id, w.name warehouse_name, s.qty
        FROM stock s
        JOIN warehouses w ON w.id=s.warehouse_id
    """).fetchall()
    ws_map = {}
    for wr in ws_rows:
        pid = wr["product_id"]
        if pid not in ws_map:
            ws_map[pid] = []
        ws_map[pid].append({"warehouse_id": wr["warehouse_id"], "warehouse_name": wr["warehouse_name"], "qty": wr["qty"]})

    result = []
    for r in rows:
        item = dict(r)
        stock_val = item["stock"]
        reorder_val = item["reorder_level"]
        status = "Out of Stock" if stock_val <= 0 else "Low Stock" if stock_val <= reorder_val else "In Stock"
        item["status"] = status
        item["warehouse_stocks"] = ws_map.get(item["id"], [])
        result.append(item)

    c.close()
    return result

@app.post("/api/products")
def create_product(x: ProductIn, authorization: Optional[str] = Header(None)):
    auth(authorization)
    name = x.name.strip()
    sku = x.sku.strip().upper()
    category = x.category.strip()
    unit = x.unit.strip()

    if not name or not sku or not category or not unit:
        raise HTTPException(400, "All product fields are required")
    if x.initial_stock < 0 or x.reorder_level < 0:
        raise HTTPException(400, "Stock and reorder level cannot be negative")

    c = db()
    try:
        c.execute("INSERT INTO products(name, sku, category, unit, initial_stock, reorder_level) VALUES(?, ?, ?, ?, ?, ?)",
                  (name, sku, category, unit, x.initial_stock, x.reorder_level))
        pid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
    except sqlite3.IntegrityError:
        c.close()
        raise HTTPException(400, "SKU already exists")

    wh_id = x.warehouse_id
    if not wh_id:
        wh_row = c.execute("SELECT id FROM warehouses ORDER BY id LIMIT 1").fetchone()
        wh_id = wh_row["id"] if wh_row else 1

    if x.initial_stock > 0:
        c.execute("INSERT OR REPLACE INTO stock(product_id, warehouse_id, qty) VALUES(?, ?, ?)",
                  (pid, wh_id, x.initial_stock))
        now = utc_now_str()
        ref = f"INIT-{pid:04d}"
        c.execute("INSERT INTO moves(date, type, product_id, quantity, to_warehouse_id, status, reason, reference) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                  (now, "receipt", pid, x.initial_stock, wh_id, "Done", "Initial inventory", ref))

    c.commit()
    c.close()
    return {"message": "Product created", "id": pid}

@app.put("/api/products/{id}")
def update_product(id: int, x: ProductUpdate, authorization: Optional[str] = Header(None)):
    auth(authorization)
    name = x.name.strip()
    sku = x.sku.strip().upper()
    category = x.category.strip()
    unit = x.unit.strip()

    if not name or not sku or not category or not unit:
        raise HTTPException(400, "All product fields are required")
    if x.reorder_level < 0:
        raise HTTPException(400, "Reorder level cannot be negative")

    c = db()
    p = c.execute("SELECT * FROM products WHERE id=?", (id,)).fetchone()
    if not p:
        c.close()
        raise HTTPException(404, "Product not found")

    dup = c.execute("SELECT id FROM products WHERE sku=? AND id!=?", (sku, id)).fetchone()
    if dup:
        c.close()
        raise HTTPException(400, "SKU already exists")

    c.execute("UPDATE products SET name=?, sku=?, category=?, unit=?, reorder_level=? WHERE id=?",
              (name, sku, category, unit, x.reorder_level, id))
    c.commit()
    c.close()
    return {"message": "Product updated successfully"}

# --- Warehouse Routes ---
@app.get("/api/warehouses")
def get_warehouses(authorization: Optional[str] = Header(None)):
    auth(authorization)
    c = db()
    rows = c.execute("""
        SELECT w.*, COALESCE(SUM(s.qty), 0) stock_qty
        FROM warehouses w
        LEFT JOIN stock s ON s.warehouse_id=w.id
        GROUP BY w.id
        ORDER BY w.id
    """).fetchall()
    c.close()
    return [dict(r) for r in rows]

@app.post("/api/warehouses")
def add_warehouse(x: WarehouseIn, authorization: Optional[str] = Header(None)):
    auth(authorization)
    name = x.name.strip()
    if not name:
        raise HTTPException(400, "Warehouse name cannot be empty")
    c = db()
    try:
        c.execute("INSERT INTO warehouses(name) VALUES(?)", (name,))
        c.commit()
    except sqlite3.IntegrityError:
        c.close()
        raise HTTPException(400, "Warehouse already exists")
    c.close()
    return {"message": "Warehouse created"}

# --- Operations & Workflow Routes ---
@app.post("/api/operations")
def create_operation(x: Operation, authorization: Optional[str] = Header(None)):
    auth(authorization)
    op_type = x.type.strip().lower()
    if op_type not in ("receipt", "delivery", "transfer", "adjustment"):
        raise HTTPException(400, "Unknown operation type")

    status = (x.status or "Done").strip()
    valid_statuses = ("Draft", "Waiting", "Ready", "Done")
    if status not in valid_statuses:
        raise HTTPException(400, f"Invalid initial status. Must be one of: {', '.join(valid_statuses)}")

    c = db()
    p = c.execute("SELECT * FROM products WHERE id=?", (x.product_id,)).fetchone()
    if not p:
        c.close()
        raise HTTPException(404, "Product not found")

    now = utc_now_str()
    frm = to = None
    qty = x.quantity
    partner = (x.partner or "").strip()
    reason = (x.reason or "").strip()

    # Generate reference number
    prefix_map = {"receipt": "REC", "delivery": "DEL", "transfer": "TRF", "adjustment": "ADJ"}
    prefix = prefix_map[op_type]
    count_row = c.execute("SELECT COUNT(*) c FROM moves WHERE type=?", (op_type,)).fetchone()
    seq = (count_row["c"] if count_row else 0) + 1
    ref = f"{prefix}-{seq:04d}"

    if op_type == "receipt":
        if qty <= 0:
            c.close()
            raise HTTPException(400, "Quantity must be greater than zero")
        to = x.warehouse_id
        if not to:
            c.close()
            raise HTTPException(400, "Destination warehouse is required")
        if status == "Done":
            change_stock(c, x.product_id, to, qty)

    elif op_type == "delivery":
        if qty <= 0:
            c.close()
            raise HTTPException(400, "Quantity must be greater than zero")
        frm = x.warehouse_id
        if not frm:
            c.close()
            raise HTTPException(400, "Source warehouse is required")
        if status == "Done":
            # Check availability
            r = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (x.product_id, frm)).fetchone()
            avail = r["qty"] if r else 0
            if avail < qty:
                c.close()
                raise HTTPException(400, "Insufficient stock at selected location")
            change_stock(c, x.product_id, frm, -qty)

    elif op_type == "transfer":
        if qty <= 0:
            c.close()
            raise HTTPException(400, "Quantity must be greater than zero")
        frm = x.from_warehouse_id
        to = x.to_warehouse_id
        if not frm or not to:
            c.close()
            raise HTTPException(400, "Source and destination warehouses are required")
        if frm == to:
            c.close()
            raise HTTPException(400, "Source and destination must differ")
        if status == "Done":
            r = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (x.product_id, frm)).fetchone()
            avail = r["qty"] if r else 0
            if avail < qty:
                c.close()
                raise HTTPException(400, "Insufficient stock at source location")
            change_stock(c, x.product_id, frm, -qty)
            change_stock(c, x.product_id, to, qty)

    elif op_type == "adjustment":
        to = x.warehouse_id
        if not to:
            c.close()
            raise HTTPException(400, "Warehouse is required for adjustment")
        if x.physical_count < 0:
            c.close()
            raise HTTPException(400, "Physical count cannot be negative")

        r = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (x.product_id, to)).fetchone()
        current = r["qty"] if r else 0
        qty = x.physical_count - current
        if status == "Done":
            change_stock(c, x.product_id, to, qty)

    c.execute("""
        INSERT INTO moves(date, type, product_id, quantity, from_warehouse_id, to_warehouse_id, status, reason, partner, reference)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (now, op_type, x.product_id, qty, frm, to, status, reason, partner, ref))
    move_id = c.execute("SELECT last_insert_rowid()").fetchone()[0]

    c.commit()
    c.close()
    return {"message": "Operation recorded successfully", "id": move_id, "reference": ref, "status": status, "quantity_change": qty}

@app.patch("/api/operations/{id}/status")
def update_operation_status(id: int, x: StatusUpdate, authorization: Optional[str] = Header(None)):
    auth(authorization)
    new_status = x.status.strip()
    valid_statuses = ("Draft", "Waiting", "Ready", "Done", "Canceled")
    if new_status not in valid_statuses:
        raise HTTPException(400, f"Invalid status: {new_status}")

    c = db()
    m = c.execute("SELECT * FROM moves WHERE id=?", (id,)).fetchone()
    if not m:
        c.close()
        raise HTTPException(404, "Operation not found")

    curr_status = m["status"]
    if curr_status == "Done":
        c.close()
        raise HTTPException(400, "Completed operation cannot change status")
    if curr_status == "Canceled":
        c.close()
        raise HTTPException(400, "Canceled operation cannot change status")
    if curr_status == new_status:
        c.close()
        return {"message": f"Operation is already in status {new_status}"}

    # Allowed transitions:
    # Draft -> Waiting, Ready, Done, Canceled
    # Waiting -> Ready, Done, Canceled
    # Ready -> Done, Canceled
    allowed = {
        "Draft": ["Waiting", "Ready", "Done", "Canceled"],
        "Waiting": ["Ready", "Done", "Canceled"],
        "Ready": ["Done", "Canceled"],
    }
    if new_status not in allowed.get(curr_status, []):
        c.close()
        raise HTTPException(400, f"Cannot transition from {curr_status} to {new_status}")

    # If transitioning to Done, apply the inventory change now!
    if new_status == "Done":
        op_type = m["type"]
        pid = m["product_id"]
        qty = m["quantity"]

        if op_type == "receipt":
            change_stock(c, pid, m["to_warehouse_id"], qty)
        elif op_type == "delivery":
            r = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (pid, m["from_warehouse_id"])).fetchone()
            avail = r["qty"] if r else 0
            if avail < qty:
                c.close()
                raise HTTPException(400, "Insufficient stock at selected location")
            change_stock(c, pid, m["from_warehouse_id"], -qty)
        elif op_type == "transfer":
            r = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (pid, m["from_warehouse_id"])).fetchone()
            avail = r["qty"] if r else 0
            if avail < qty:
                c.close()
                raise HTTPException(400, "Insufficient stock at source location")
            change_stock(c, pid, m["from_warehouse_id"], -qty)
            change_stock(c, pid, m["to_warehouse_id"], qty)
        elif op_type == "adjustment":
            change_stock(c, pid, m["to_warehouse_id"], qty)

    c.execute("UPDATE moves SET status=? WHERE id=?", (new_status, id))
    c.commit()
    c.close()
    return {"message": f"Operation updated to {new_status}", "id": id, "status": new_status}

# --- Moves / Stock Ledger Route ---
@app.get("/api/moves")
def get_moves(authorization: Optional[str] = Header(None),
              type: Optional[str] = None,
              status: Optional[str] = None,
              warehouse_id: Optional[int] = None,
              category: Optional[str] = None,
              search: Optional[str] = None):
    auth(authorization)
    c = db()
    query = """
        SELECT m.*, p.name product, p.sku sku, p.category category, p.unit unit,
               fw.name from_location, tw.name to_location
        FROM moves m
        JOIN products p ON p.id=m.product_id
        LEFT JOIN warehouses fw ON fw.id=m.from_warehouse_id
        LEFT JOIN warehouses tw ON tw.id=m.to_warehouse_id
        WHERE 1=1
    """
    params = []
    if type and type.lower() != "all":
        query += " AND LOWER(m.type) = ?"
        params.append(type.strip().lower())
    if status and status.lower() != "all":
        query += " AND m.status = ?"
        params.append(status.strip())
    if warehouse_id and warehouse_id > 0:
        query += " AND (m.from_warehouse_id = ? OR m.to_warehouse_id = ?)"
        params.extend([warehouse_id, warehouse_id])
    if category and category.lower() != "all":
        query += " AND p.category = ?"
        params.append(category.strip())
    if search:
        s = f"%{search.strip().lower()}%"
        query += " AND (LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ? OR LOWER(COALESCE(m.reference, '')) LIKE ? OR LOWER(COALESCE(m.partner, '')) LIKE ?)"
        params.extend([s, s, s, s])

    query += " ORDER BY m.id DESC"
    rows = c.execute(query, params).fetchall()
    c.close()
    return [dict(r) for r in rows]

# --- Dashboard Route ---
@app.get("/api/dashboard")
def get_dashboard(authorization: Optional[str] = Header(None),
                  warehouse_id: Optional[int] = None,
                  category: Optional[str] = None):
    auth(authorization)
    c = db()

    # Total products and stock levels
    p_query = """
        SELECT p.id, p.name, p.sku, p.category, p.reorder_level, COALESCE(SUM(s.qty), 0) stock
        FROM products p
        LEFT JOIN stock s ON s.product_id=p.id
    """
    p_params = []
    where_clauses = []
    if warehouse_id and warehouse_id > 0:
        where_clauses.append("s.warehouse_id = ?")
        p_params.append(warehouse_id)
    if category and category.lower() != "all":
        where_clauses.append("p.category = ?")
        p_params.append(category)

    if where_clauses:
        p_query += " WHERE " + " AND ".join(where_clauses)
    p_query += " GROUP BY p.id"

    ps = [dict(r) for r in c.execute(p_query, p_params).fetchall()]
    low = [r for r in ps if 0 < r["stock"] <= r["reorder_level"]]
    out = [r for r in ps if r["stock"] <= 0]

    # Warehouse breakdown
    wh = c.execute("""
        SELECT w.id, w.name, COALESCE(SUM(s.qty), 0) qty
        FROM warehouses w
        LEFT JOIN stock s ON s.warehouse_id=w.id
        GROUP BY w.id
        ORDER BY w.id
    """).fetchall()

    # KPIs for pending operations (operations not yet Done or Canceled)
    pending_receipts = c.execute("SELECT COUNT(*) n FROM moves WHERE type='receipt' AND status NOT IN ('Done', 'Canceled')").fetchone()["n"]
    pending_deliveries = c.execute("SELECT COUNT(*) n FROM moves WHERE type='delivery' AND status NOT IN ('Done', 'Canceled')").fetchone()["n"]
    scheduled_transfers = c.execute("SELECT COUNT(*) n FROM moves WHERE type='transfer' AND status NOT IN ('Done', 'Canceled')").fetchone()["n"]

    # Recent operations
    recent = c.execute("""
        SELECT m.*, p.name product, p.sku sku, p.category category, p.unit unit,
               fw.name from_location, tw.name to_location
        FROM moves m
        JOIN products p ON p.id=m.product_id
        LEFT JOIN warehouses fw ON fw.id=m.from_warehouse_id
        LEFT JOIN warehouses tw ON tw.id=m.to_warehouse_id
        ORDER BY m.id DESC LIMIT 15
    """).fetchall()

    c.close()
    return {
        "total_products": len(ps),
        "low_stock": len(low),
        "out_of_stock": len(out),
        "pending_receipts": pending_receipts,
        "pending_deliveries": pending_deliveries,
        "scheduled_transfers": scheduled_transfers,
        "alerts": low + out,
        "stock_by_warehouse": [dict(r) for r in wh],
        "max_warehouse_qty": max([r["qty"] for r in wh] or [1]),
        "recent_moves": [dict(r) for r in recent],
    }
