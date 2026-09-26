import React, {useEffect, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";
const icons = {dashboard:"📊", products:"📦", receipts:"📥", deliveries:"📤", transfers:"🔄", adjustments:"🧮", history:"📜", warehouse:"🏭", profile:"👤", logout:"🚪", settings:"⚙️"};

async function api(path, options={}) {
  const token = localStorage.getItem("stocksense_token");
  const headers = {"Content-Type":"application/json", ...(options.headers||{})};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, {...options, headers});
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.detail || "Request failed");
  return data;
}

function Logo({light=false}) {
  return <div className={"brand "+(light?"brand-light":"")}><span className="brand-mark">◇</span><div><b>StockSense</b><small>Inventory Management System</small></div></div>;
}

function Auth({onLogin}) {
  const [mode,setMode]=useState("login");
  const [form,setForm]=useState({name:"",email:"",password:""});
  const [otp,setOtp]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  async function submit(e){
    e.preventDefault(); setBusy(true); setMessage("");
    try {
      if(mode==="login"){
        const d=await api("/auth/login",{method:"POST",body:JSON.stringify({email:form.email,password:form.password})});
        localStorage.setItem("stocksense_token",d.token); onLogin(d.user);
      } else if(mode==="signup"){
        await api("/auth/signup",{method:"POST",body:JSON.stringify(form)});
        setMessage("Account created. You can now log in."); setMode("login");
      } else if(mode==="forgot"){
        const d=await api("/auth/request-otp",{method:"POST",body:JSON.stringify({email:form.email})});
        setMessage(`Demo OTP: ${d.dev_otp} — check the backend console in production.`);
        setMode("otp");
      } else if(mode==="otp"){
        const d=await api("/auth/reset-password",{method:"POST",body:JSON.stringify({email:form.email,otp,password:form.password})});
        setMessage(d.message); setMode("login");
      }
    } catch(err){setMessage(err.message)} finally{setBusy(false)}
  }

  if(mode==="otp") return <AuthShell title="OTP Verification" subtitle="Enter the 6-digit code sent to your email.">
    <form onSubmit={submit} className="auth-form">
      <label>Email<input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required /></label>
      <label>OTP<input value={otp} onChange={e=>setOtp(e.target.value)} maxLength="6" placeholder="123456" required /></label>
      <label>New Password<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required /></label>
      <button disabled={busy} className="primary full">{busy?"Please wait…":"Verify OTP & Reset Password →"}</button>
      {message && <div className="notice">{message}</div>}
    </form>
    <button className="link-btn" onClick={()=>setMode("login")}>← Back to login</button>
  </AuthShell>;

  return <AuthShell title={mode==="login"?"Welcome Back":mode==="signup"?"Create Account":"Forgot Password"} subtitle={
    mode==="login"?"Sign in to continue to StockSense":mode==="signup"?"Join StockSense to manage your inventory":"Enter your email to receive an OTP"}>
    <form onSubmit={submit} className="auth-form">
      {mode==="signup" && <label>Full Name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required /></label>}
      <label>Email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="yourname@example.com" required /></label>
      {mode!=="forgot" && <label>Password<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required /></label>}
      {mode==="login" && <div className="between"><label className="check"><input type="checkbox" defaultChecked/> Remember me</label><button type="button" className="link-btn" onClick={()=>setMode("forgot")}>Forgot Password?</button></div>}
      <button disabled={busy} className="primary full">{busy?"Please wait…":mode==="login"?"Login →":mode==="signup"?"Sign Up":"Send OTP"}</button>
      {message && <div className="notice">{message}</div>}
    </form>
    {mode==="login" && <div className="auth-switch">Don’t have an account? <button className="link-btn" onClick={()=>setMode("signup")}>Sign up</button></div>}
    {mode==="signup" && <div className="auth-switch">Already have an account? <button className="link-btn" onClick={()=>setMode("login")}>Login</button></div>}
    {mode==="forgot" && <div className="auth-switch"><button className="link-btn" onClick={()=>setMode("login")}>← Back to login</button></div>}
  </AuthShell>;
}

function AuthShell({title,subtitle,children}) {
  return <div className="auth-page">
    <section className="auth-visual">
      <Logo light/>
      <div className="visual-copy">
        <h1>Manage Your<br/>Inventory <span>Smarter</span></h1>
        <p>Track stock, streamline operations, and get real-time visibility across all your warehouses.</p>
        <div className="benefits"><div>📦 <b>Real-time Stock Tracking</b><small>Know your inventory anytime, anywhere.</small></div><div>🏭 <b>Multi-Warehouse Support</b><small>Manage stock across multiple locations.</small></div><div>📈 <b>Easy Operations</b><small>Receipts, deliveries, transfers & adjustments.</small></div><div>🔔 <b>Low Stock Alerts</b><small>Never run out of critical items.</small></div></div>
        <div className="stats"><span><b>10K+</b><small>Products Managed</small></span><span><b>Multi</b><small>Warehouse Support</small></span><span><b>99.9%</b><small>Accurate Tracking</small></span></div>
      </div>
    </section>
    <section className="auth-card-wrap"><div className="auth-card"><Logo/><h2>{title}</h2><p>{subtitle}</p>{children}<div className="auth-art">📦 🧑‍💼 🏗️</div></div></section>
  </div>;
}

function App(){
  const [user,setUser]=useState(null);
  const [page,setPage]=useState("dashboard");
  const [dash,setDash]=useState(null);
  const [products,setProducts]=useState([]);
  const [warehouses,setWarehouses]=useState([]);
  const [history,setHistory]=useState([]);
  const [toast,setToast]=useState("");

  async function loadAll(){
    try{
      const [d,p,w,h]=await Promise.all([api("/dashboard"),api("/products"),api("/warehouses"),api("/moves")]);
      setDash(d); setProducts(p); setWarehouses(w); setHistory(h);
    }catch(e){setToast(e.message)}
  }
  useEffect(()=>{ if(localStorage.getItem("stocksense_token")) api("/auth/me").then(d=>{setUser(d);loadAll()}).catch(()=>localStorage.removeItem("stocksense_token")); },[]);
  useEffect(()=>{ if(toast){const t=setTimeout(()=>setToast(""),3000);return()=>clearTimeout(t)}},[toast]);

  function logout(){localStorage.removeItem("stocksense_token");setUser(null)}
  if(!user) return <Auth onLogin={u=>{setUser(u);loadAll()}}/>;

  const refresh=async()=>{await loadAll();setToast("Updated successfully ✓")};

  return <div className="app">
    <aside className="sidebar"><Logo light/><nav>
      <Nav icon={icons.dashboard} label="Dashboard" active={page==="dashboard"} onClick={()=>setPage("dashboard")}/>
      <Nav icon={icons.products} label="Products" active={page==="products"||page==="add-product"} onClick={()=>setPage("products")}/>
      <div className="nav-section">OPERATIONS</div>
      <Nav icon={icons.receipts} label="Receipts" active={page==="receipts"} onClick={()=>setPage("receipts")}/>
      <Nav icon={icons.deliveries} label="Delivery Orders" active={page==="deliveries"} onClick={()=>setPage("deliveries")}/>
      <Nav icon={icons.transfers} label="Internal Transfers" active={page==="transfers"} onClick={()=>setPage("transfers")}/>
      <Nav icon={icons.adjustments} label="Inventory Adjustments" active={page==="adjustments"} onClick={()=>setPage("adjustments")}/>
      <Nav icon={icons.history} label="Move History" active={page==="history"} onClick={()=>setPage("history")}/>
      <div className="nav-section">SYSTEM</div>
      <Nav icon={icons.warehouse} label="Warehouses" active={page==="warehouses"} onClick={()=>setPage("warehouses")}/>
    </nav><div className="sidebar-bottom"><div>👤 {user.name}<small>{user.role}</small></div><button onClick={logout}>🚪 Logout</button></div></aside>
    <main className="main"><header><div className="search">🔎 <input placeholder="Search products, documents…" /></div><div className="header-user">🔔 <span>👨‍💼 {user.name}<small>{user.role}</small></span></div></header>
      {toast&&<div className="toast">{toast}</div>}
      <div className="content">{page==="dashboard"&&<Dashboard dash={dash} history={history} onRefresh={refresh}/>}
      {page==="products"&&<Products products={products} onAdd={()=>setPage("add-product")} onRefresh={refresh}/>}
      {page==="add-product"&&<ProductForm warehouses={warehouses} onDone={async()=>{await refresh();setPage("products")}}/>}
      {page==="receipts"&&<OperationForm type="receipt" products={products} warehouses={warehouses} onDone={refresh}/>}
      {page==="deliveries"&&<OperationForm type="delivery" products={products} warehouses={warehouses} onDone={refresh}/>}
      {page==="transfers"&&<OperationForm type="transfer" products={products} warehouses={warehouses} onDone={refresh}/>}
      {page==="adjustments"&&<OperationForm type="adjustment" products={products} warehouses={warehouses} onDone={refresh}/>}
      {page==="history"&&<History history={history}/>}
      {page==="warehouses"&&<Warehouses warehouses={warehouses} onDone={refresh}/>}</div>
    </main>
  </div>
}

function Nav({icon,label,active,onClick}){return <button className={"nav-item "+(active?"active":"")} onClick={onClick}><span>{icon}</span>{label}</button>}

function Dashboard({dash,history,onRefresh}){
  if(!dash)return <Loading/>;
  return <><PageTitle title="Dashboard" sub="Overview of your inventory operations" action={<button className="secondary" onClick={onRefresh}>↻ Refresh</button>}/>
  <div className="kpi-grid">{[
    ["📦","Total Products",dash.total_products,"#eef6ff"],["⚠️","Low Stock Items",dash.low_stock,"#fff7e8"],["🛑","Out of Stock",dash.out_of_stock,"#fff0f0"],
    ["📥","Pending Receipts",dash.pending_receipts,"#f3efff"],["📤","Pending Deliveries",dash.pending_deliveries,"#effaf4"],["🔄","Internal Transfers",dash.internal_transfers,"#eef6ff"]
  ].map(x=><div className="kpi" style={{background:x[3]}} key={x[1]}><span>{x[0]}</span><div><small>{x[1]}</small><strong>{x[2]}</strong></div></div>)}</div>
  <div className="two-col"><div className="panel"><div className="panel-head"><h3>Stock by Warehouse</h3></div>{dash.stock_by_warehouse.map(w=><div className="bar-row" key={w.name}><span>{w.name}</span><div><i style={{width:Math.min(100,w.qty/(dash.max_warehouse_qty||1)*100)+"%"}}/></div><b>{w.qty}</b></div>)}</div>
  <div className="panel"><div className="panel-head"><h3>Low Stock Alerts</h3></div>{dash.alerts.length?dash.alerts.map(a=><div className="alert-row" key={a.sku}><span>🔔</span><div><b>{a.name}</b><small>{a.stock} / reorder {a.reorder_level}</small></div><em>{a.stock===0?"Out of stock":"Low stock"}</em></div>):<div className="empty">No low-stock items 🎉</div>}</div></div>
  <div className="panel"><div className="panel-head"><h3>Recent Operations</h3></div><Table rows={history.slice(0,6)} cols={["date","type","product","quantity","from_location","to_location","status"]}/></div></>
}

function PageTitle({title,sub,action}){return <div className="page-title"><div><h1>{title}</h1><p>{sub}</p></div>{action}</div>}

function Products({products,onAdd}){const [q,setQ]=useState("");const rows=products.filter(p=>(p.name+" "+p.sku+" "+p.category).toLowerCase().includes(q.toLowerCase()));return <><PageTitle title="Products" sub="Manage your products and stock information" action={<button className="primary" onClick={onAdd}>＋ Add Product</button>}/><div className="toolbar"><input placeholder="🔎 Search by name, SKU…" value={q} onChange={e=>setQ(e.target.value)}/></div><div className="panel"><Table rows={rows} cols={["name","sku","category","unit","stock","status"]}/></div></>}

function ProductForm({onDone}){const [f,setF]=useState({name:"Steel Rod",sku:"STL001",category:"Raw Material",unit:"KG",initial_stock:0,reorder_level:10});async function save(e){e.preventDefault();try{await api("/products",{method:"POST",body:JSON.stringify({...f,initial_stock:+f.initial_stock,reorder_level:+f.reorder_level})});await onDone()}catch(err){alert(err.message)}}return <><PageTitle title="Add Product" sub="Create a new product"/><FormCard onSubmit={save} button="Save Product"><Field label="Product Name" value={f.name} onChange={v=>setF({...f,name:v})}/><Field label="SKU / Code" value={f.sku} onChange={v=>setF({...f,sku:v})}/><Field label="Category" value={f.category} onChange={v=>setF({...f,category:v})}/><Field label="Unit of Measure" value={f.unit} onChange={v=>setF({...f,unit:v})}/><Field label="Initial Stock" type="number" value={f.initial_stock} onChange={v=>setF({...f,initial_stock:v})}/><Field label="Reorder Level" type="number" value={f.reorder_level} onChange={v=>setF({...f,reorder_level:v})}/></FormCard></>}

function OperationForm({type,products,warehouses,onDone}){
 const cfg={receipt:["Receipts (Incoming Stock)","Add incoming stock from supplier","📥","Validate & Receive"],delivery:["Delivery Orders (Outgoing Stock)","Ship products to customer","📤","Validate & Deliver"],transfer:["Internal Transfer","Move stock between locations","🔄","Validate & Transfer"],adjustment:["Inventory Adjustment","Adjust stock based on physical count","🧮","Validate & Adjust"]}[type];
 const [f,setF]=useState({product_id:products[0]?.id||"",quantity:10,warehouse_id:warehouses[0]?.id||"",from_warehouse_id:warehouses[0]?.id||"",to_warehouse_id:warehouses[1]?.id||warehouses[0]?.id||"",physical_count:0,reason:"Physical count / operational correction"});
 useEffect(()=>{if(products[0])setF(x=>({...x,product_id:products[0].id}))},[products]);
 async function submit(e){e.preventDefault();try{await api("/operations",{method:"POST",body:JSON.stringify({type,...f,product_id:+f.product_id,quantity:+f.quantity,warehouse_id:+f.warehouse_id,from_warehouse_id:+f.from_warehouse_id,to_warehouse_id:+f.to_warehouse_id,physical_count:+f.physical_count})});await onDone()}catch(err){alert(err.message)}}
 return <><PageTitle title={cfg[0]} sub={cfg[1]}/><FormCard onSubmit={submit} button={cfg[3]} accent={type==="adjustment"?"orange":""}>
 {type==="receipt"&&<Field label="Supplier" value={f.supplier||"ABC Steel Suppliers"} onChange={v=>setF({...f,supplier:v})}/>}
 {type==="delivery"&&<Field label="Customer" value={f.customer||"XYZ Manufacturing"} onChange={v=>setF({...f,customer:v})}/>}
 {type==="transfer"&&<><Select label="From Location" value={f.from_warehouse_id} options={warehouses} onChange={v=>setF({...f,from_warehouse_id:v})}/><Select label="To Location" value={f.to_warehouse_id} options={warehouses} onChange={v=>setF({...f,to_warehouse_id:v})}/></>}
 {type!=="transfer"&&<Select label="Warehouse / Location" value={f.warehouse_id} options={warehouses} onChange={v=>setF({...f,warehouse_id:v})}/>}
 <Select label="Product" value={f.product_id} options={products.map(p=>({id:p.id,name:`${p.name} (${p.sku})`}))} onChange={v=>setF({...f,product_id:v})}/>
 {type==="adjustment"?<Field label="Physical Count" type="number" value={f.physical_count} onChange={v=>setF({...f,physical_count:v})}/>:<Field label="Quantity" type="number" value={f.quantity} onChange={v=>setF({...f,quantity:v})}/>}
 {type==="adjustment"&&<Field label="Reason" value={f.reason} onChange={v=>setF({...f,reason:v})}/>}
 </FormCard></>
}

function History({history}){return <><PageTitle title="Move History / Stock Ledger" sub="Complete log of all inventory movements"/><div className="panel"><div className="toolbar"><select><option>All Document Types</option><option>Receipt</option><option>Delivery</option><option>Transfer</option><option>Adjustment</option></select><select><option>All Statuses</option><option>Done</option></select></div><Table rows={history} cols={["date","type","product","quantity","from_location","to_location","status"]}/></div></>}

function Warehouses({warehouses,onDone}){const [name,setName]=useState("");async function add(e){e.preventDefault();try{await api("/warehouses",{method:"POST",body:JSON.stringify({name})});setName("");await onDone()}catch(err){alert(err.message)}}return <><PageTitle title="Warehouses" sub="Manage stock locations"/><div className="panel"><form onSubmit={add} className="inline-form"><input placeholder="New warehouse / location" value={name} onChange={e=>setName(e.target.value)} required/><button className="primary">＋ Add</button></form><div className="warehouse-list">{warehouses.map(w=><div key={w.id}>🏭 <b>{w.name}</b><span>{w.stock_qty} units</span></div>)}</div></div></>}

function FormCard({children,onSubmit,button,accent=""}){return <div className="panel form-card"><form onSubmit={onSubmit}><div className="form-grid">{children}</div><div className="form-actions"><button type="submit" className={"primary "+accent}>{button}</button></div></form></div>}
function Field({label,value,onChange,type="text"}){return <label>{label}<input type={type} value={value} onChange={e=>onChange(e.target.value)} required /></label>}
function Select({label,value,options,onChange}){return <label>{label}<select value={value} onChange={e=>onChange(e.target.value)} required>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
function Table({rows,cols}){if(!rows.length)return <div className="empty">No records yet.</div>;return <div className="table-wrap"><table><thead><tr>{cols.map(c=><th key={c}>{c.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.id||i}>{cols.map(c=><td key={c}>{c==="status"?<span className="badge">{r[c]}</span>:c==="type"?<span className="type">{r[c]}</span>:r[c]??"—"}</td>)}</tr>)}</tbody></table></div>}
function Loading(){return <div className="loading">Loading StockSense…</div>}

createRoot(document.getElementById("root")).render(<App/>);
