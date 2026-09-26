import sys
import os
import secrets
import unittest

# Ensure backend root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from app.main import app, db, init

client = TestClient(app)

class TestStockSensePhase1(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init()

    def test_01_auth_flow(self):
        # Signup new user
        test_email = "testuser_phase1@example.com"
        # Cleanup in case previous test ran
        c = db()
        c.execute("DELETE FROM users WHERE email=?", (test_email,))
        c.commit()
        c.close()

        res = client.post("/api/auth/signup", json={
            "name": "Phase1 Tester",
            "email": test_email,
            "password": "password123"
        })
        self.assertEqual(res.status_code, 200, res.text)

        # Duplicate signup should fail
        res_dup = client.post("/api/auth/signup", json={
            "name": "Phase1 Tester",
            "email": test_email,
            "password": "password123"
        })
        self.assertEqual(res_dup.status_code, 400)
        self.assertIn("already registered", res_dup.json()["detail"])

        # Invalid login
        res_bad = client.post("/api/auth/login", json={
            "email": test_email,
            "password": "wrongpassword"
        })
        self.assertEqual(res_bad.status_code, 401)

        # Valid login
        res_login = client.post("/api/auth/login", json={
            "email": test_email,
            "password": "password123"
        })
        self.assertEqual(res_login.status_code, 200)
        data = res_login.json()
        self.assertIn("token", data)
        token = data["token"]

        # Auth Me
        res_me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(res_me.status_code, 200)
        self.assertEqual(res_me.json()["email"], test_email)

    def test_02_products_crud_and_validation(self):
        # Login demo manager
        res_login = client.post("/api/auth/login", json={
            "email": "admin@stocksense.local",
            "password": "admin123"
        })
        token = res_login.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Create product with unique SKU
        sku = f"TST-P1-{secrets.token_hex(4).upper()}"
        res_create = client.post("/api/products", headers=headers, json={
            "name": "Test Phase 1 Widget",
            "sku": sku,
            "category": "Electronics",
            "unit": "PCS",
            "initial_stock": 50,
            "reorder_level": 15
        })
        self.assertEqual(res_create.status_code, 200, res_create.text)
        pid = res_create.json()["id"]

        # Duplicate SKU should fail
        res_dup = client.post("/api/products", headers=headers, json={
            "name": "Duplicate Widget",
            "sku": sku,
            "category": "Electronics",
            "unit": "PCS",
            "initial_stock": 10,
            "reorder_level": 5
        })
        self.assertEqual(res_dup.status_code, 400)

        # Update product
        res_update = client.put(f"/api/products/{pid}", headers=headers, json={
            "name": "Test Phase 1 Widget Updated",
            "sku": sku,
            "category": "Electronics",
            "unit": "PCS",
            "reorder_level": 25
        })
        self.assertEqual(res_update.status_code, 200)

        # Verify in list
        res_list = client.get("/api/products", headers=headers)
        self.assertEqual(res_list.status_code, 200)
        prods = [p for p in res_list.json() if p["id"] == pid]
        self.assertTrue(len(prods) == 1)
        p = prods[0]
        self.assertEqual(p["name"], "Test Phase 1 Widget Updated")
        self.assertEqual(p["reorder_level"], 25)
        self.assertEqual(p["stock"], 50)
        self.assertTrue(len(p["warehouse_stocks"]) > 0)

    def test_03_operation_statuses_and_inventory_consistency(self):
        res_login = client.post("/api/auth/login", json={
            "email": "admin@stocksense.local",
            "password": "admin123"
        })
        token = res_login.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Warehouses
        res_wh = client.get("/api/warehouses", headers=headers)
        whs = res_wh.json()
        self.assertTrue(len(whs) >= 2)
        wh1 = whs[0]["id"]
        wh2 = whs[1]["id"]

        # Create a fresh product for testing operations
        sku = f"TST-FLOW-{secrets.token_hex(4).upper()}"
        res_p = client.post("/api/products", headers=headers, json={
            "name": "Flow Test Item",
            "sku": sku,
            "category": "Raw Material",
            "unit": "KG",
            "initial_stock": 100,
            "reorder_level": 20,
            "warehouse_id": wh1
        })
        self.assertEqual(res_p.status_code, 200, res_p.text)
        pid = res_p.json()["id"]

        # 1. Draft Receipt must NOT increase stock
        res_draft_rcpt = client.post("/api/operations", headers=headers, json={
            "type": "receipt",
            "product_id": pid,
            "quantity": 40,
            "warehouse_id": wh1,
            "status": "Draft",
            "partner": "Supplier ABC"
        })
        self.assertEqual(res_draft_rcpt.status_code, 200)
        rcpt_id = res_draft_rcpt.json()["id"]

        # Verify stock is still 100
        prods = client.get("/api/products", headers=headers).json()
        p = next(x for x in prods if x["id"] == pid)
        self.assertEqual(p["stock"], 100)

        # 2. Advance Draft -> Waiting -> Ready -> Done
        res_w = client.patch(f"/api/operations/{rcpt_id}/status", headers=headers, json={"status": "Waiting"})
        self.assertEqual(res_w.status_code, 200)
        # Still not done, stock still 100
        p = next(x for x in client.get("/api/products", headers=headers).json() if x["id"] == pid)
        self.assertEqual(p["stock"], 100)

        res_r = client.patch(f"/api/operations/{rcpt_id}/status", headers=headers, json={"status": "Ready"})
        self.assertEqual(res_r.status_code, 200)

        # Complete to Done
        res_d = client.patch(f"/api/operations/{rcpt_id}/status", headers=headers, json={"status": "Done"})
        self.assertEqual(res_d.status_code, 200)

        # Stock should now be 140!
        p = next(x for x in client.get("/api/products", headers=headers).json() if x["id"] == pid)
        self.assertEqual(p["stock"], 140)

        # Cannot transition after Done
        res_invalid = client.patch(f"/api/operations/{rcpt_id}/status", headers=headers, json={"status": "Draft"})
        self.assertEqual(res_invalid.status_code, 400)

        # 3. Delivery with insufficient stock protection
        res_oversell = client.post("/api/operations", headers=headers, json={
            "type": "delivery",
            "product_id": pid,
            "quantity": 200,  # available is 140
            "warehouse_id": wh1,
            "status": "Done",
            "partner": "Customer XYZ"
        })
        self.assertEqual(res_oversell.status_code, 400)
        self.assertIn("Insufficient stock", res_oversell.json()["detail"])

        # 4. Valid Delivery
        res_delivery = client.post("/api/operations", headers=headers, json={
            "type": "delivery",
            "product_id": pid,
            "quantity": 30,
            "warehouse_id": wh1,
            "status": "Done",
            "partner": "Customer XYZ"
        })
        self.assertEqual(res_delivery.status_code, 200)

        # Stock now 110
        p = next(x for x in client.get("/api/products", headers=headers).json() if x["id"] == pid)
        self.assertEqual(p["stock"], 110)

        # 5. Internal Transfer: wh1 (110) -> wh2 (0)
        res_trf = client.post("/api/operations", headers=headers, json={
            "type": "transfer",
            "product_id": pid,
            "quantity": 50,
            "from_warehouse_id": wh1,
            "to_warehouse_id": wh2,
            "status": "Done"
        })
        self.assertEqual(res_trf.status_code, 200)

        # Check total stock is still 110, but wh1 has 60 and wh2 has 50
        p = next(x for x in client.get("/api/products", headers=headers).json() if x["id"] == pid)
        self.assertEqual(p["stock"], 110)
        ws_dict = {ws["warehouse_id"]: ws["qty"] for ws in p["warehouse_stocks"]}
        self.assertEqual(ws_dict.get(wh1), 60)
        self.assertEqual(ws_dict.get(wh2), 50)

        # 6. Inventory Adjustment: physical count at wh1 set to 65 (+5)
        res_adj = client.post("/api/operations", headers=headers, json={
            "type": "adjustment",
            "product_id": pid,
            "warehouse_id": wh1,
            "physical_count": 65,
            "reason": "Annual recount",
            "status": "Done"
        })
        self.assertEqual(res_adj.status_code, 200)

        p = next(x for x in client.get("/api/products", headers=headers).json() if x["id"] == pid)
        self.assertEqual(p["stock"], 115)
        ws_dict = {ws["warehouse_id"]: ws["qty"] for ws in p["warehouse_stocks"]}
        self.assertEqual(ws_dict.get(wh1), 65)

    def test_04_dashboard_and_filtering(self):
        res_login = client.post("/api/auth/login", json={
            "email": "admin@stocksense.local",
            "password": "admin123"
        })
        token = res_login.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        res_dash = client.get("/api/dashboard", headers=headers)
        self.assertEqual(res_dash.status_code, 200)
        d = res_dash.json()
        self.assertIn("total_products", d)
        self.assertIn("low_stock", d)
        self.assertIn("out_of_stock", d)
        self.assertIn("pending_receipts", d)
        self.assertIn("pending_deliveries", d)
        self.assertIn("scheduled_transfers", d)
        self.assertIn("stock_by_warehouse", d)

        # Test Moves query filtering
        res_moves_all = client.get("/api/moves", headers=headers)
        self.assertEqual(res_moves_all.status_code, 200)
        moves = res_moves_all.json()
        self.assertTrue(len(moves) > 0)
        # Check all moves have reference
        for m in moves:
            self.assertTrue(m.get("reference") is not None)

        # Filter by type
        res_rcpt = client.get("/api/moves?type=receipt", headers=headers)
        self.assertEqual(res_rcpt.status_code, 200)
        for m in res_rcpt.json():
            self.assertEqual(m["type"], "receipt")

if __name__ == "__main__":
    unittest.main()
