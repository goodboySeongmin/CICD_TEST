# create_refund_triggers.py
import mysql.connector

DB_CONFIG = dict(
    host="127.0.0.1",
    user="qook_user",
    password="qook_pass",
    database="qook_chatbot",
    port=3306,
)

BI = """
CREATE TRIGGER bi_refund_qty_guard
BEFORE INSERT ON refund_tbl
FOR EACH ROW
BEGIN
  DECLARE ordered_qty  INT DEFAULT 0;
  DECLARE refunded_qty INT DEFAULT 0;

  SELECT COALESCE(SUM(od.quantity),0) INTO ordered_qty
    FROM order_detail_tbl od
   WHERE od.order_code = NEW.order_code
     AND od.product    = NEW.product;

  SELECT COALESCE(SUM(r.request_qty),0) INTO refunded_qty
    FROM refund_tbl r
   WHERE r.order_code = NEW.order_code
     AND r.product    = NEW.product
     AND r.status IN ('open','processing','approved','refunded'); -- approved 포함

  IF (NEW.request_qty + refunded_qty) > ordered_qty THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Refund quantity exceeds ordered quantity';
  END IF;
END
"""

BU = """
CREATE TRIGGER bu_refund_qty_guard
BEFORE UPDATE ON refund_tbl
FOR EACH ROW
BEGIN
  DECLARE ordered_qty  INT DEFAULT 0;
  DECLARE refunded_qty INT DEFAULT 0;

  SELECT COALESCE(SUM(od.quantity),0) INTO ordered_qty
    FROM order_detail_tbl od
   WHERE od.order_code = NEW.order_code
     AND od.product    = NEW.product;

  SELECT COALESCE(SUM(r.request_qty),0) INTO refunded_qty
    FROM refund_tbl r
   WHERE r.id <> NEW.id
     AND r.order_code = NEW.order_code
     AND r.product    = NEW.product
     AND r.status IN ('open','processing','approved','refunded'); -- approved 포함

  IF (NEW.request_qty + refunded_qty) > ordered_qty THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Refund quantity exceeds ordered quantity';
  END IF;
END
"""

def main():
    conn = mysql.connector.connect(**DB_CONFIG)
    conn.autocommit = True
    cur = conn.cursor()
    try:
        # 한 줄씩! DELIMITER 쓰지 마세요.
        cur.execute("DROP TRIGGER IF EXISTS bi_refund_qty_guard")
        cur.execute("DROP TRIGGER IF EXISTS bu_refund_qty_guard")
        cur.execute(BI)
        cur.execute(BU)
        print("✅ refund triggers created/updated successfully")
    except mysql.connector.Error as e:
        print(f"❌ MySQL error {e.errno}: {e.msg}")
        if e.errno == 1419:
            print("   (TRIGGER 권한 또는 log_bin_trust_function_creators 설정 확인 필요)")
        raise
    finally:
        try:
            cur.close()
            conn.close()
        except:
            pass

if __name__ == "__main__":
    main()
