-- Migration 0001: các bảng cho đường ingest (Plan 2 mục 4, Plan 3 P1-11).
-- Chưa có bảng users: owner_id chưa có khóa ngoại, Part 2 sẽ thêm bằng migration mới
-- (không sửa tệp này sau khi đã áp dụng lên D1 thật).

CREATE TABLE ea_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    INTEGER,
  login       INTEGER,            -- null cho đến lần ingest đầu tiên
  server      TEXT,
  broker      TEXT,
  name        TEXT,
  currency    TEXT,
  mode        TEXT,
  key_hash    TEXT NOT NULL UNIQUE, -- SHA-256 hex của API key; không lưu khóa thô
  key_prefix  TEXT NOT NULL,        -- 8 ký tự đầu để nhận diện
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  bound_at    INTEGER,
  created_at  INTEGER NOT NULL
);

-- Một (server, login) chỉ thuộc về một liên kết. Bảng lạnh: chỉ ghi khi tạo/gắn.
CREATE UNIQUE INDEX ux_ea_links_server_login
  ON ea_links (server, login) WHERE login IS NOT NULL;

-- Bảng NÓNG: một dòng mỗi liên kết, KHÔNG đặt chỉ mục phụ (Rules BE mục 6).
CREATE TABLE link_state (
  link_id        INTEGER PRIMARY KEY REFERENCES ea_links (id),
  balance        REAL,
  equity         REAL,
  margin         REAL,
  margin_free    REAL,
  margin_level   REAL,
  floating_pl    REAL,
  positions_json TEXT,
  pending_json   TEXT,
  last_reason    TEXT,
  last_seen_at   INTEGER NOT NULL,
  last_seq       INTEGER,
  last_sid       TEXT,
  ea_ver         TEXT,
  last_ip        TEXT,
  vps_label      TEXT,
  presence       INTEGER NOT NULL DEFAULT 0 CHECK (presence IN (0, 1)) -- 0 online, 1 offline
);

CREATE TABLE equity_m5 (
  link_id      INTEGER NOT NULL,
  ts           INTEGER NOT NULL,
  balance      REAL,
  equity       REAL,
  floating_pl  REAL,
  margin_level REAL,
  PRIMARY KEY (link_id, ts)
) WITHOUT ROWID;

CREATE TABLE trades (
  link_id     INTEGER NOT NULL,
  ticket      INTEGER NOT NULL, -- position id
  symbol      TEXT,
  type        TEXT,
  volume      REAL,
  open_time   INTEGER,
  open_price  REAL,
  close_time  INTEGER,
  close_price REAL,
  sl          REAL,
  tp          REAL,
  profit      REAL,
  swap        REAL,
  commission  REAL,
  comment     TEXT,
  magic       INTEGER,
  PRIMARY KEY (link_id, ticket)
) WITHOUT ROWID;

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id     INTEGER NOT NULL,
  ts          INTEGER NOT NULL,
  type        TEXT NOT NULL,
  detail_json TEXT
);

-- Lý do: truy vấn sự kiện theo liên kết + thời gian, và chống ghi dồn auth_fail.
-- Chi phí: +1 dòng ghi mỗi lần chèn sự kiện (sự kiện hiếm: chuyển trạng thái, lỗi xác thực).
CREATE INDEX idx_events_link_ts ON events (link_id, ts);
