import httpx
import secrets

print("=== TESTING LIVE HTTP ENDPOINTS & VITE PROXY ===")
client = httpx.Client(base_url="http://localhost:5173")

# 1. Invalid Login
r_bad = client.post("/api/auth/login", json={"email": "admin@stocksense.local", "password": "wrong"})
assert r_bad.status_code == 401, f"Expected 401, got {r_bad.status_code}"
assert "Invalid email or password" in r_bad.json()["detail"]
print("[PASS] Invalid login correctly returned 401: Invalid email or password.")

# 2. Signup
email = f"live_{secrets.token_hex(4)}@example.com"
r_signup = client.post("/api/auth/signup", json={"name": "Live Tester", "email": email, "password": "password123"})
assert r_signup.status_code == 200, f"Signup failed: {r_signup.text}"
print("[PASS] Signup via Vite proxy succeeded.")

# 3. Login
r_login = client.post("/api/auth/login", json={"email": email, "password": "password123"})
assert r_login.status_code == 200
token = r_login.json()["token"]
headers = {"Authorization": f"Bearer {token}"}
print("[PASS] Login via Vite proxy succeeded and returned token.")

# 4. Auth Me
r_me = client.get("/api/auth/me", headers=headers)
assert r_me.status_code == 200
assert r_me.json()["email"] == email
print("[PASS] Auth Me endpoint confirmed session is valid.")

# 5. Dashboard KPIs
r_dash = client.get("/api/dashboard", headers=headers)
assert r_dash.status_code == 200
d = r_dash.json()
for k in ["total_products", "low_stock", "out_of_stock", "pending_receipts", "pending_deliveries", "scheduled_transfers"]:
    assert k in d, f"Missing KPI {k}"
print(f"[PASS] Dashboard returned all KPIs: {d['total_products']} products, {d['pending_receipts']} pending receipts.")

# 6. Direct CORS Preflight check on FastAPI
c_direct = httpx.Client(base_url="http://127.0.0.1:8000")
for origin in ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174"]:
    r_opts = c_direct.options("/api/auth/login", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})
    assert r_opts.headers.get("access-control-allow-origin") == origin, f"CORS origin {origin} failed"
print("[PASS] Direct CORS preflights verified for localhost:5173, 127.0.0.1:5173, and dynamic port 5174.")

print("=== ALL LIVE INTEGRATION CHECKS PASSED SUCCESSFULLY! ===")
