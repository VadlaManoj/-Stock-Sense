import sqlite3, hashlib, secrets, os
from datetime import datetime, timedelta
from typing import Optional
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DB = os.path.join(os.path.dirname(__file__), "stocksense.db")
app = FastAPI(title="StockSense API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173","http://127.0.0.1:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def db():
    c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; return c

def hash_pw(p,s=None):
    s=s or secrets.token_hex(16)
    return s, hashlib.pbkdf2_hmac("sha256",p.encode(),s.encode(),120000).hex()

def verify_pw(p,s,h):
    return hashlib.pbkdf2_hmac("sha256",p.encode(),s.encode(),120000).hex()==h

def init():
    c=db()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,email TEXT UNIQUE,password_hash TEXT,salt TEXT,role TEXT DEFAULT 'Inventory Manager');
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER,expires TEXT);
    CREATE TABLE IF NOT EXISTS warehouses(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,sku TEXT UNIQUE,category TEXT,unit TEXT,initial_stock REAL DEFAULT 0,reorder_level REAL DEFAULT 10);
    CREATE TABLE IF NOT EXISTS stock(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER,warehouse_id INTEGER,qty REAL DEFAULT 0,UNIQUE(product_id,warehouse_id));
    CREATE TABLE IF NOT EXISTS moves(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT,type TEXT,product_id INTEGER,quantity REAL,from_warehouse_id INTEGER,to_warehouse_id INTEGER,status TEXT,reason TEXT);
    CREATE TABLE IF NOT EXISTS reset_otps(email TEXT PRIMARY KEY,otp TEXT,expires TEXT);
    """)
    if not c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        s,h=hash_pw("admin123")
        c.execute("INSERT INTO users(name,email,password_hash,salt) VALUES(?,?,?,?)",("Demo Manager","admin@stocksense.local",h,s))
    if not c.execute("SELECT 1 FROM warehouses LIMIT 1").fetchone():
        c.executemany("INSERT INTO warehouses(name) VALUES(?)",[("Main Warehouse",),("Production Floor",),("Store Room",)])
    if not c.execute("SELECT 1 FROM products LIMIT 1").fetchone():
        for p in [("Steel Rod","STL001","Raw Material","KG",50,20),("Wooden Chair","CHR001","Finished Goods","PCS",120,20),("Screws","SCR001","Components","PCS",8,20),("Wood Planks","WDP001","Raw Material","KG",0,15),("Paint Bucket","PNT001","Consumables","PCS",25,10)]:
            c.execute("INSERT INTO products(name,sku,category,unit,initial_stock,reorder_level) VALUES(?,?,?,?,?,?)",p)
        wh=c.execute("SELECT id FROM warehouses WHERE name='Main Warehouse'").fetchone()["id"]
        for p in c.execute("SELECT id,initial_stock FROM products"):
            c.execute("INSERT INTO stock(product_id,warehouse_id,qty) VALUES(?,?,?)",(p["id"],wh,p["initial_stock"]))
    c.commit();c.close()
init()

def auth(authorization):
    if not authorization or not authorization.startswith("Bearer "): raise HTTPException(401,"Login required")
    t=authorization.split(" ",1)[1]; c=db()
    r=c.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",(t,datetime.utcnow().isoformat())).fetchone()
    if not r: raise HTTPException(401,"Session expired")
    return dict(r)

class Signup(BaseModel): name:str; email:str; password:str
class Login(BaseModel): email:str; password:str
class OTPReq(BaseModel): email:str
class Reset(BaseModel): email:str; otp:str; password:str
class ProductIn(BaseModel):
    name:str; sku:str; category:str; unit:str; initial_stock:float=0; reorder_level:float=10
class WarehouseIn(BaseModel): name:str
class Operation(BaseModel):
    type:str; product_id:int; quantity:float=0; warehouse_id:int=0; from_warehouse_id:int=0; to_warehouse_id:int=0
    physical_count:float=0; reason:str=""; supplier:Optional[str]=None; customer:Optional[str]=None

@app.post("/api/auth/signup")
def signup(x:Signup):
    c=db()
    try:
        s,h=hash_pw(x.password);c.execute("INSERT INTO users(name,email,password_hash,salt) VALUES(?,?,?,?)",(x.name,x.email.lower(),h,s));c.commit()
    except sqlite3.IntegrityError: raise HTTPException(400,"Email already registered")
    return {"message":"Account created"}

@app.post("/api/auth/login")
def login(x:Login):
    c=db();r=c.execute("SELECT * FROM users WHERE email=?",(x.email.lower(),)).fetchone()
    if not r or not verify_pw(x.password,r["salt"],r["password_hash"]): raise HTTPException(401,"Invalid email or password")
    token=secrets.token_urlsafe(32);exp=(datetime.utcnow()+timedelta(days=2)).isoformat()
    c.execute("INSERT INTO sessions VALUES(?,?,?)",(token,r["id"],exp));c.commit()
    return {"token":token,"user":{"id":r["id"],"name":r["name"],"email":r["email"],"role":r["role"]}}

@app.get("/api/auth/me")
def me(authorization:str=Header(None)): return {k:auth(authorization)[k] for k in ("id","name","email","role")}

@app.post("/api/auth/request-otp")
def request_otp(x:OTPReq):
    c=db();r=c.execute("SELECT id FROM users WHERE email=?",(x.email.lower(),)).fetchone()
    if not r: raise HTTPException(404,"No account found for this email")
    otp=f"{secrets.randbelow(1000000):06d}";exp=(datetime.utcnow()+timedelta(minutes=10)).isoformat()
    c.execute("INSERT OR REPLACE INTO reset_otps VALUES(?,?,?)",(x.email.lower(),otp,exp));c.commit()
    print(f"[StockSense DEMO OTP] {x.email}: {otp}")
    return {"message":"OTP generated","dev_otp":otp}

@app.post("/api/auth/reset-password")
def reset(x:Reset):
    c=db();r=c.execute("SELECT * FROM reset_otps WHERE email=? AND otp=? AND expires>?",(x.email.lower(),x.otp,datetime.utcnow().isoformat())).fetchone()
    if not r: raise HTTPException(400,"Invalid or expired OTP")
    s,h=hash_pw(x.password);c.execute("UPDATE users SET password_hash=?,salt=? WHERE email=?",(h,s,x.email.lower()));c.execute("DELETE FROM reset_otps WHERE email=?",(x.email.lower(),));c.commit()
    return {"message":"Password reset successfully"}

@app.get("/api/products")
def products(authorization:str=Header(None)):
    auth(authorization);c=db()
    rows=c.execute("""SELECT p.*,COALESCE(SUM(s.qty),0) stock FROM products p LEFT JOIN stock s ON s.product_id=p.id GROUP BY p.id ORDER BY p.id DESC""").fetchall()
    return [{**dict(r),"status":"Out of Stock" if r["stock"]<=0 else "Low Stock" if r["stock"]<=r["reorder_level"] else "In Stock"} for r in rows]

@app.post("/api/products")
def add_product(x:ProductIn,authorization:str=Header(None)):
    auth(authorization);c=db()
    try:c.execute("INSERT INTO products(name,sku,category,unit,initial_stock,reorder_level) VALUES(?,?,?,?,?,?)",(x.name,x.sku,x.category,x.unit,x.initial_stock,x.reorder_level));pid=c.execute("SELECT last_insert_rowid()").fetchone()[0]
    except sqlite3.IntegrityError: raise HTTPException(400,"SKU already exists")
    wh=c.execute("SELECT id FROM warehouses ORDER BY id LIMIT 1").fetchone()["id"]
    c.execute("INSERT OR REPLACE INTO stock(product_id,warehouse_id,qty) VALUES(?,?,?)",(pid,wh,x.initial_stock));c.commit()
    return {"message":"Product created","id":pid}

@app.get("/api/warehouses")
def warehouses(authorization:str=Header(None)):
    auth(authorization);c=db();return [dict(r) for r in c.execute("""SELECT w.*,COALESCE(SUM(s.qty),0) stock_qty FROM warehouses w LEFT JOIN stock s ON s.warehouse_id=w.id GROUP BY w.id ORDER BY w.id""")]

@app.post("/api/warehouses")
def add_warehouse(x:WarehouseIn,authorization:str=Header(None)):
    auth(authorization);c=db()
    try:c.execute("INSERT INTO warehouses(name) VALUES(?)",(x.name,));c.commit()
    except sqlite3.IntegrityError: raise HTTPException(400,"Warehouse already exists")
    return {"message":"Warehouse created"}

def change_stock(c,pid,wid,delta):
    r=c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?",(pid,wid)).fetchone()
    if not r: c.execute("INSERT INTO stock(product_id,warehouse_id,qty) VALUES(?,?,?)",(pid,wid,delta))
    else:
        new=r["qty"]+delta
        if new < 0: raise HTTPException(400,"Insufficient stock at selected location")
        c.execute("UPDATE stock SET qty=? WHERE product_id=? AND warehouse_id=?",(new,pid,wid))

@app.post("/api/operations")
def operation(x:Operation,authorization:str=Header(None)):
    auth(authorization);c=db()
    p=c.execute("SELECT * FROM products WHERE id=?",(x.product_id,)).fetchone()
    if not p: raise HTTPException(404,"Product not found")
    now=datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    frm=to=None;qty=x.quantity
    if x.type=="receipt":
        to=x.warehouse_id;change_stock(c,x.product_id,to,qty)
    elif x.type=="delivery":
        frm=x.warehouse_id;change_stock(c,x.product_id,frm,-qty)
    elif x.type=="transfer":
        frm=x.from_warehouse_id;to=x.to_warehouse_id
        if frm==to: raise HTTPException(400,"Source and destination must differ")
        change_stock(c,x.product_id,frm,-qty);change_stock(c,x.product_id,to,qty)
    elif x.type=="adjustment":
        to=x.warehouse_id
        r=c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?",(x.product_id,to)).fetchone()
        current=r["qty"] if r else 0;qty=x.physical_count-current
        change_stock(c,x.product_id,to,qty)
    else: raise HTTPException(400,"Unknown operation type")
    c.execute("INSERT INTO moves(date,type,product_id,quantity,from_warehouse_id,to_warehouse_id,status,reason) VALUES(?,?,?,?,?,?,?,?)",(now,x.type,x.product_id,qty,frm,to,"Done",x.reason));c.commit()
    return {"message":"Operation validated successfully","quantity_change":qty}

@app.get("/api/moves")
def moves(authorization:str=Header(None)):
    auth(authorization);c=db()
    rows=c.execute("""SELECT m.*,p.name product,fw.name from_location,tw.name to_location FROM moves m JOIN products p ON p.id=m.product_id LEFT JOIN warehouses fw ON fw.id=m.from_warehouse_id LEFT JOIN warehouses tw ON tw.id=m.to_warehouse_id ORDER BY m.id DESC""").fetchall()
    return [dict(r) for r in rows]

@app.get("/api/dashboard")
def dashboard(authorization:str=Header(None)):
    auth(authorization);c=db()
    ps=c.execute("""SELECT p.id,p.name,p.sku,p.reorder_level,COALESCE(SUM(s.qty),0) stock FROM products p LEFT JOIN stock s ON s.product_id=p.id GROUP BY p.id""").fetchall()
    low=[dict(r) for r in ps if r["stock"]<=r["reorder_level"] and r["stock"]>0];out=[dict(r) for r in ps if r["stock"]<=0]
    wh=c.execute("""SELECT w.name,COALESCE(SUM(s.qty),0) qty FROM warehouses w LEFT JOIN stock s ON s.warehouse_id=w.id GROUP BY w.id""").fetchall()
    pending_receipts=c.execute("SELECT COUNT(*) n FROM moves WHERE type='receipt' AND status!='Done'").fetchone()["n"]
    pending_deliveries=c.execute("SELECT COUNT(*) n FROM moves WHERE type='delivery' AND status!='Done'").fetchone()["n"]
    transfers=c.execute("SELECT COUNT(*) n FROM moves WHERE type='transfer' AND status='Done'").fetchone()["n"]
    return {"total_products":len(ps),"low_stock":len(low),"out_of_stock":len(out),"pending_receipts":pending_receipts,"pending_deliveries":pending_deliveries,"internal_transfers":transfers,"alerts":low+out,"stock_by_warehouse":[dict(r) for r in wh],"max_warehouse_qty":max([r["qty"] for r in wh] or [1])}
