-- Active: 1753665102208@@127.0.0.1@3306@qook_chatbot
-- Active: 1753665102208@@127.0.0.1@3306@qook_chatbot
-- Qook 신선식품 챗봇 데이터베이스 설정
-- 데이터베이스 생성 및 사용자 설정

-- 데이터베이스 생성
DROP DATABASE qook_chatbot;

CREATE DATABASE IF NOT EXISTS qook_chatbot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 사용자 생성 및 권한 부여
CREATE USER IF NOT EXISTS 'qook_user'@'localhost' IDENTIFIED BY 'qook_pass';
CREATE USER IF NOT EXISTS 'qook_user'@'%' IDENTIFIED BY 'qook_pass';

GRANT ALL PRIVILEGES ON qook_chatbot.* TO 'qook_user'@'localhost';
GRANT ALL PRIVILEGES ON qook_chatbot.* TO 'qook_user'@'%';

FLUSH PRIVILEGES;

-- 데이터베이스 사용
USE qook_chatbot;

-- 사용자 정보 테이블
CREATE TABLE userinfo_tbl (
    user_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    birth_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    email VARCHAR(100),
    phone_num VARCHAR(20),
    address VARCHAR(200),
    post_num VARCHAR(10)
);

-- 사용자 상세 정보 테이블
CREATE TABLE user_detail_tbl (
    user_id VARCHAR(45) PRIMARY KEY,
    gender ENUM('M', 'F'),
    age INT,
    allergy VARCHAR(100),
    vegan TINYINT(1) DEFAULT 0,
    house_hold INT,
    unfavorite VARCHAR(100),
    membership VARCHAR(45),
    FOREIGN KEY (user_id) REFERENCES userinfo_tbl(user_id) ON DELETE CASCADE
);

-- 사용자 로그 테이블
CREATE TABLE userlog_tbl (
    log_id VARCHAR(45) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    log_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    logout_time DATETIME,
    FOREIGN KEY (user_id) REFERENCES userinfo_tbl(user_id) ON DELETE CASCADE
);

-- 대화 히스토리 테이블
CREATE TABLE history_tbl (
    log_id VARCHAR(45) NOT NULL,
    message_text VARCHAR(1000) NOT NULL,
    role ENUM('user', 'bot') NOT NULL,
    created_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    history_id VARCHAR(45) PRIMARY KEY,
    FOREIGN KEY (log_id) REFERENCES userlog_tbl(log_id) ON DELETE CASCADE
);

-- 카테고리 정의 테이블 (1=과일, 2=채소 등)
CREATE TABLE category_definition_tbl (
    category_id INT PRIMARY KEY,
    category_name VARCHAR(45) NOT NULL
);

-- 상품 카테고리 테이블
CREATE TABLE category_tbl (
    item VARCHAR(45) PRIMARY KEY,
    category_id INT,
    FOREIGN KEY (category_id) REFERENCES category_definition_tbl(category_id)
);

-- 상품 정보 테이블
CREATE TABLE product_tbl (
    product VARCHAR(45) PRIMARY KEY,
    item VARCHAR(45) NOT NULL,
    organic VARCHAR(45),
    unit_price VARCHAR(45) NOT NULL,
    origin VARCHAR(45),
    cart_add_count INT DEFAULT 0,
    FOREIGN KEY (item) REFERENCES category_tbl(item)
);

-- 재고 테이블
CREATE TABLE stock_tbl (
    product VARCHAR(45) PRIMARY KEY,
    stock VARCHAR(45) NOT NULL,
    FOREIGN KEY (product) REFERENCES product_tbl(product) ON DELETE CASCADE
);

-- 주문 테이블
CREATE TABLE order_tbl (
    order_code INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(45) NOT NULL,
    order_date VARCHAR(45) NOT NULL,
    total_price INT NOT NULL,
    order_status VARCHAR(20) DEFAULT 'pending',
    subtotal INT NOT NULL, 
    discount_amount INT NOT NULL, 
    shipping_fee INT NOT NULL, 
    membership_tier_at_checkout VARCHAR(45) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES userinfo_tbl(user_id) ON DELETE CASCADE
);

-- 주문 상세 테이블
CREATE TABLE order_detail_tbl (
    order_code INT NOT NULL,
    product VARCHAR(45) NOT NULL,
    quantity VARCHAR(45) NOT NULL,
    price VARCHAR(45) NOT NULL,
    PRIMARY KEY (order_code, product),
    FOREIGN KEY (order_code) REFERENCES order_tbl(order_code) ON DELETE CASCADE,
    FOREIGN KEY (product) REFERENCES product_tbl(product) ON DELETE CASCADE
);

-- 장바구니 테이블
CREATE TABLE cart_tbl (
    user_id VARCHAR(45) NOT NULL,
    product VARCHAR(45) NOT NULL,
    unit_price VARCHAR(45) NOT NULL,
    total_price VARCHAR(45) NOT NULL,
    quantity VARCHAR(45) NOT NULL,
    PRIMARY KEY (user_id, product),
    FOREIGN KEY (user_id) REFERENCES userinfo_tbl(user_id) ON DELETE CASCADE,
    FOREIGN KEY (product) REFERENCES product_tbl(product) ON DELETE CASCADE
);

-- FAQ 테이블
CREATE TABLE faq_tbl (
    faq_id INT AUTO_INCREMENT PRIMARY KEY,
    question VARCHAR(500) NOT NULL,
    answer VARCHAR(1000) NOT NULL,
    faq_category VARCHAR(100)
);

-- 채팅 세션 테이블 (추가)
CREATE TABLE chat_sessions (
    session_id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    status ENUM('active', 'completed', 'timeout') DEFAULT 'active',
    FOREIGN KEY (user_id) REFERENCES userinfo_tbl(user_id)
);

-- 채팅 상태 추적 테이블 (추가)
CREATE TABLE chat_state (
    session_id VARCHAR(50) PRIMARY KEY,
    current_step VARCHAR(50),
    route_type ENUM('search_order', 'cs') DEFAULT 'search_order',
    query_data JSON,
    cart_data JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id)
);

-- 인덱스 생성
CREATE INDEX idx_userlog_user_time ON userlog_tbl(user_id, log_time);
CREATE INDEX idx_history_log_time ON history_tbl(log_id, created_time);
CREATE INDEX idx_order_user_date ON order_tbl(user_id, order_date);
CREATE INDEX idx_faq_category ON faq_tbl(faq_category);
CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id, created_at);
CREATE INDEX idx_chat_state_step ON chat_state(current_step);

-- ===== 인증 및 확장 기능 테이블 (auth_tables.sql에서 이동) =====

-- Django 호환 auth_user 테이블 생성
CREATE TABLE IF NOT EXISTS auth_user (
    id VARCHAR(45) PRIMARY KEY,
    username VARCHAR(150) UNIQUE NOT NULL,
    email VARCHAR(254) UNIQUE NOT NULL,
    password VARCHAR(128) NOT NULL,
    first_name VARCHAR(150) NOT NULL DEFAULT '',
    last_name VARCHAR(150) NOT NULL DEFAULT '',
    is_active TINYINT(1) DEFAULT 1,
    is_staff TINYINT(1) DEFAULT 0,
    is_superuser TINYINT(1) DEFAULT 0,
    date_joined DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME NULL,
    FOREIGN KEY (id) REFERENCES userinfo_tbl(user_id) ON DELETE CASCADE
);

-- 세션 관리 테이블
CREATE TABLE IF NOT EXISTS user_sessions (
    session_id VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(45) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    user_agent VARCHAR(500),
    ip_address VARCHAR(45),
    FOREIGN KEY (user_id) REFERENCES userinfo_tbl(user_id) ON DELETE CASCADE
);

-- 멤버십 관리 테이블
CREATE TABLE IF NOT EXISTS membership_tbl (
    membership_id INT AUTO_INCREMENT PRIMARY KEY,
    membership_name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(200),
    benefits JSON,
    monthly_fee DECIMAL(10,2) DEFAULT 0,
    discount_rate DECIMAL(3,2) DEFAULT 0,
    free_shipping_threshold DECIMAL(10,2) DEFAULT 30000,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


-- 기본 멤버십 데이터 삽입
INSERT IGNORE INTO membership_tbl (membership_name, description, benefits, monthly_fee, discount_rate, free_shipping_threshold) VALUES
('basic', '기본 회원', '{"features": ["고객지원", "무료배송(무료배송 기준: 30,000원 이상)"]}', 0, 0.00, 30000),
('gold', '골드 회원', '{"features": ["5% 할인", "우선 고객지원", "무료배송(무료배송 기준: 15,000원 이상)"]}', 4900, 0.05, 15000),
('premium', '프리미엄 회원', '{"features": ["10% 할인", "VIP 전담 매니저", "무료배송(금액 무관)", "신상품 우선 구매"]}', 9900, 0.10, 0);




-- 확장 테이블 인덱스 생성 (성능 최적화)
CREATE INDEX idx_auth_user_email ON auth_user(email);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id, expires_at);

-- 뷰 생성 (사용자 전체 정보 조회용)
CREATE OR REPLACE VIEW user_full_info AS
SELECT 
    u.user_id,
    u.name,
    u.email,
    u.phone_num,
    u.address,
    u.post_num,
    u.created_at,
    ud.gender,
    ud.age,
    ud.allergy,
    ud.vegan,
    ud.house_hold,
    ud.unfavorite,
    ud.membership,
    m.membership_name,
    m.discount_rate,
    m.free_shipping_threshold,
    au.last_login,
    au.is_active
FROM userinfo_tbl u
LEFT JOIN user_detail_tbl ud ON u.user_id = ud.user_id
LEFT JOIN membership_tbl m ON ud.membership = m.membership_name
LEFT JOIN auth_user au ON u.user_id = au.id;

-- 환불 테이블
CREATE TABLE IF NOT EXISTS refund_tbl (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticket_id    VARCHAR(40)  NOT NULL,
  user_id      VARCHAR(64)  NOT NULL,
  order_code   VARCHAR(64)  NOT NULL,
  product      VARCHAR(255) NOT NULL,
  request_qty  INT          NOT NULL DEFAULT 1,
  reason       TEXT,
  status       VARCHAR(20)  NOT NULL DEFAULT 'open', -- open|processing|refunded|rejected 등
  created_at   DATETIME     NOT NULL,
  updated_at   DATETIME     NOT NULL,
  UNIQUE KEY uk_ticket (ticket_id),
  KEY idx_user_order (user_id, order_code),
  KEY idx_order_product (order_code, product)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 주문 수량을 초과하는 환불을 차단하는 트리거
DELIMITER $$;

CREATE TRIGGER bi_refund_qty_guard
BEFORE INSERT ON refund_tbl
FOR EACH ROW
BEGIN
  DECLARE ordered_qty  INT DEFAULT 0;
  DECLARE refunded_qty INT DEFAULT 0;

  SELECT COALESCE(SUM(od.quantity),0)
    INTO ordered_qty
    FROM order_detail_tbl od
   WHERE od.order_code = NEW.order_code
     AND od.product    = NEW.product;

  SELECT COALESCE(SUM(r.request_qty),0)
    INTO refunded_qty
    FROM refund_tbl r
   WHERE r.order_code = NEW.order_code
     AND r.product    = NEW.product
     AND r.status IN ('open','processing','refunded');

  IF (NEW.request_qty + refunded_qty) > ordered_qty THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Refund quantity exceeds ordered quantity';
  END IF;
END$$;

-- 추가 부분
-- root 로 로그인 후
SET GLOBAL log_bin_trust_function_creators = 1;
-- 영구화 하고 싶으면:
-- SET PERSIST log_bin_trust_function_creators = 1;


GRANT TRIGGER ON qook_chatbot.* TO 'qook_user'@'localhost';
GRANT TRIGGER ON qook_chatbot.* TO 'qook_user'@'%';
FLUSH PRIVILEGES;

SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA='qook_chatbot'
  AND TABLE_NAME IN ('order_tbl','order_detail_tbl','refund_tbl')
ORDER BY TABLE_NAME, COLUMN_NAME;

ALTER TABLE refund_tbl
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- =========================
-- Tavily URL 기반 레시피 즐겨찾기
-- =========================
CREATE TABLE IF NOT EXISTS recipe_favorite_tbl (
    user_id        VARCHAR(50)  NOT NULL,
    recipe_url     VARCHAR(1000) NOT NULL,
    url_hash       CHAR(64) AS (SHA2(recipe_url, 256)) STORED,
    source         ENUM('tavily','external','internal') DEFAULT 'tavily',
    recipe_title   VARCHAR(200),
    image_url      VARCHAR(500),
    site_name      VARCHAR(100),
    snippet        VARCHAR(1000),
    tags           JSON,
    fetched_at     DATETIME,
    favorited_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, url_hash),
    CONSTRAINT fk_recipefav_user
      FOREIGN KEY (user_id) REFERENCES userinfo_tbl(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_recipefav_user_time ON recipe_favorite_tbl(user_id, favorited_at DESC);
CREATE INDEX idx_recipefav_source    ON recipe_favorite_tbl(source);
