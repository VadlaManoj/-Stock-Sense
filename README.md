# StockSense — Inventory Management System

A full-stack demo matching the supplied 11-screen StockSense reference:
1. Login
2. Dashboard
3. Sign up
4. OTP verification/password reset
5. Products
6. Add Product
7. Receipts (incoming stock)
8. Delivery Orders (outgoing stock)
9. Internal Transfer
10. Inventory Adjustment
11. Move History / Stock Ledger

## Stack
- Frontend: React + Vite
- Backend: FastAPI
- Database: SQLite
- Authentication: password hashing + bearer sessions
- Local login background asset: `frontend/public/login-bg.jpg`

## Demo account
Email: `admin@stocksense.local`
Password: `admin123`

## Run backend (Windows)
```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Run frontend
Open another terminal:
```powershell
cd frontend
npm install
npm run dev
```

Open:
http://localhost:5173

## Inventory logic
- Receipt: stock increases at selected warehouse.
- Delivery: stock decreases at selected warehouse.
- Internal transfer: source decreases and destination increases.
- Adjustment: physical count becomes the recorded stock and the difference is logged.
- Move History is the audit ledger for every validated operation.
- Dashboard automatically calculates low/out-of-stock alerts.

## Notes
This is a functional college/project demo. For production deployment, add HTTPS, a real email/SMS OTP provider, stronger token/session handling, role permissions, validation/auditing, backups, and deployment configuration.
