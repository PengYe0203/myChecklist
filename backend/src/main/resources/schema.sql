-- build tables

CREATE TABLE user (
    user_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

create table task (
  task_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title VARCHAR(100) NOT NULL,
  description TEXT,
  parent_id BIGINT DEFAULT 0,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_completed TINYINT(1) DEFAULT 0,
  type INT DEFAULT 0 COMMENT '0-quicknote 1-scheduled 2-DDL',
  settlement_type INT DEFAULT 0 COMMENT '0-manual 1-auto',
  target_duration INT, -- second
  start_time DATETIME,
  end_time DATETIME,
  cron_config VARCHAR(100),
  due DATETIME,
  INDEX idx_user_id (user_id)
);

create table task_log (
  log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  date DATE NOT NULL,
  result_status INT DEFAULT 0 COMMENT '0-not_started 1-incomplete 2-completed 3-Exceeded',
  planned_duration INT,
  actual_duration INT DEFAULT 0,
  actual_start_time DATETIME,
  run_status INT DEFAULT 0 COMMENT '0-stopped 1-running 2-suspended',
  last_start_time DATETIME,
  INDEX idx_user_id (user_id),
  INDEX idx_task_id (task_id)
);

CREATE TABLE review (
    review_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    date DATE NOT NULL,
    content TEXT,
    UNIQUE KEY uk_user_date (user_id, date)
);

ALTER TABLE task ADD COLUMN actual_duration INT DEFAULT 0;
ALTER TABLE task ADD COLUMN run_status INT DEFAULT 0 COMMENT '0-stopped 1-running 2-suspended';
ALTER TABLE task ADD COLUMN last_start_time DATETIME;