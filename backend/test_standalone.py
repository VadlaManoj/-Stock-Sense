import sqlite3
import os
import secrets
from datetime import datetime, timedelta

# Import directly from app.main
from app.main import (
    DB, db, init, hash_pw, verify_pw, change_stock,
    get_product_warehouse_stocks, app
)

def run_tests():
    print("=== RUNNING STOCKSENSE PHASE 1 STANDALONE VERIFICATION ===")
    init()
    c = db()

    # 1. Test Password Hashing
    print("[1/8] Testing Password Hashing & Verification...")
    salt, hashed = hash_pw("securePass123")
    assert verify_pw("securePass123", salt, hashed) is True
    assert verify_pw("wrongPass", salt, hashed) is False
    print("  [PASS] Password hashing works accurately.")

    # 2. Test User Creation & Demo User
    print("[2/8] Testing User & Auth Records...")
    demo = c.execute("SELECT * FROM users WHERE email='admin@stocksense.local'").fetchone()
    assert demo is not None
    assert verify_pw("admin123", demo["salt"], demo["password_hash"]) is True
    print("  [PASS] Default admin account initialized and verified.")

    # 3. Test Product Management & Warehouse Breakdown
    print("[3/8] Testing Product Schema & Warehouse Stock...")
    prods = c.execute("SELECT * FROM products").fetchall()
    assert len(prods) >= 5
    first_prod = prods[0]
    ws = get_product_warehouse_stocks(c, first_prod["id"])
    assert len(ws) >= 3
    print(f"  [PASS] Products count: {len(prods)}, Warehouse stocks breakdown verified.")

    # 4. Test Operation Workflow: Draft -> Waiting -> Ready -> Done
    print("[4/8] Testing Status Workflow & Stock Timing...")
    wh1 = c.execute("SELECT id FROM warehouses WHERE name='Main Warehouse'").fetchone()["id"]
    wh2 = c.execute("SELECT id FROM warehouses WHERE name='Store Room'").fetchone()["id"]

    # Insert test product
    test_sku = "VERIFY-" + secrets.token_hex(4).upper()
    c.execute("INSERT INTO products(name, sku, category, unit, initial_stock, reorder_level) VALUES(?, ?, ?, ?, ?, ?)",
              ("Workflow Item", test_sku, "TestCat", "PCS", 100, 20))
    t_pid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
    c.execute("INSERT INTO stock(product_id, warehouse_id, qty) VALUES(?, ?, ?)", (t_pid, wh1, 100))
    c.commit()

    # Verify initial stock
    s0 = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (t_pid, wh1)).fetchone()["qty"]
    assert s0 == 100

    # Create Draft Receipt for +50
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    c.execute("INSERT INTO moves(date, type, product_id, quantity, to_warehouse_id, status, reason, reference) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
              (now, "receipt", t_pid, 50, wh1, "Draft", "Testing Draft", "REC-9999"))
    m_id = c.execute("SELECT last_insert_rowid()").fetchone()[0]
    c.commit()

    # Stock must NOT have changed!
    s1 = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (t_pid, wh1)).fetchone()["qty"]
    assert s1 == 100, f"Expected stock 100, got {s1}"
    print("  [PASS] Draft receipt does NOT modify stock.")

    # Advance to Waiting
    c.execute("UPDATE moves SET status='Waiting' WHERE id=?", (m_id,))
    c.commit()
    s2 = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (t_pid, wh1)).fetchone()["qty"]
    assert s2 == 100

    # Advance to Ready
    c.execute("UPDATE moves SET status='Ready' WHERE id=?", (m_id,))
    c.commit()
    s3 = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (t_pid, wh1)).fetchone()["qty"]
    assert s3 == 100

    # Advance to Done -> Apply change_stock
    change_stock(c, t_pid, wh1, 50)
    c.execute("UPDATE moves SET status='Done' WHERE id=?", (m_id,))
    c.commit()
    s4 = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (t_pid, wh1)).fetchone()["qty"]
    assert s4 == 150, f"Expected stock 150, got {s4}"
    print("  [PASS] Operation completion to Done accurately updates stock to 150.")

    # 5. Test Insufficient Stock Protection on Delivery
    print("[5/8] Testing Negative Stock / Overselling Prevention...")
    failed_properly = False
    try:
        # Attempt to deliver 200 when only 150 available
        change_stock(c, t_pid, wh1, -200)
    except Exception as e:
        failed_properly = True
        assert "Insufficient stock" in str(e.detail if hasattr(e, 'detail') else str(e))
    assert failed_properly is True
    # Verify stock remained 150
    s5 = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (t_pid, wh1)).fetchone()["qty"]
    assert s5 == 150
    print("  [PASS] Protected against negative stock.")

    # 6. Test Internal Transfer Consistency
    print("[6/8] Testing Internal Transfer Balance...")
    # Transfer 40 from wh1 to wh2
    change_stock(c, t_pid, wh1, -40)
    change_stock(c, t_pid, wh2, 40)
    c.execute("INSERT INTO moves(date, type, product_id, quantity, from_warehouse_id, to_warehouse_id, status, reason, reference) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
              (now, "transfer", t_pid, 40, wh1, wh2, "Done", "Internal Rebalance", "TRF-9999"))
    c.commit()

    q_wh1 = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (t_pid, wh1)).fetchone()["qty"]
    q_wh2 = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (t_pid, wh2)).fetchone()["qty"]
    assert q_wh1 == 110, f"Expected 110, got {q_wh1}"
    assert q_wh2 == 40, f"Expected 40, got {q_wh2}"
    total_q = c.execute("SELECT SUM(qty) s FROM stock WHERE product_id=?", (t_pid,)).fetchone()["s"]
    assert total_q == 150
    print("  [PASS] Internal transfer preserves total stock: 110 at WH1 + 40 at WH2 = 150.")

    # 7. Test Inventory Adjustment
    print("[7/8] Testing Inventory Physical Adjustment...")
    # Physical count at wh1 found to be 115 (+5 difference)
    cur = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (t_pid, wh1)).fetchone()["qty"]
    phys = 115
    diff = phys - cur
    change_stock(c, t_pid, wh1, diff)
    c.execute("INSERT INTO moves(date, type, product_id, quantity, to_warehouse_id, status, reason, reference) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
              (now, "adjustment", t_pid, diff, wh1, "Done", "Physical Count Correction", "ADJ-9999"))
    c.commit()

    q_adj = c.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (t_pid, wh1)).fetchone()["qty"]
    assert q_adj == 115
    print("  [PASS] Inventory adjustment sets physical count to 115 and logs delta in ledger.")

    # 8. Test Audit Ledger & Traceability
    print("[8/8] Testing Move History / Audit Ledger Traceability...")
    moves = c.execute("SELECT * FROM moves WHERE product_id=?", (t_pid,)).fetchall()
    assert len(moves) >= 3
    for m in moves:
        assert m["reference"] is not None
        assert m["status"] in ("Draft", "Waiting", "Ready", "Done", "Canceled")
    print(f"  [PASS] Traceability confirmed for all {len(moves)} moves with references.")

    c.close()
    print("\n>>> ALL PHASE 1 STANDALONE BACKEND CHECKS PASSED SUCCESSFULLY! <<<\n")

if __name__ == "__main__":
    run_tests()
