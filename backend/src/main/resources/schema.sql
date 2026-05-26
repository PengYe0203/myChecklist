-- build tables

CREATE TABLE user (
    user_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
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
  type INT DEFAULT 0 COMMENT '0-quicknote 1-scheduled 2-DDL 3-scene',
  settlement_type INT DEFAULT 0 COMMENT '0-manual 1-auto',
  target_duration INT, -- second
  start_time DATETIME,
  end_time DATETIME,
  cron_config VARCHAR(100),
  actual_duration INT DEFAULT 0,
  run_status INT DEFAULT 0 COMMENT '0-stopped 1-running 2-suspended',
  last_start_time DATETIME,
  is_active TINYINT(1) DEFAULT 0 COMMENT '0-inactive 1-active',
  own_duration INT DEFAULT 0,
  sub_duration_sum INT DEFAULT 0,
  inherit_parent_time TINYINT(1) DEFAULT 1,
  current_day_segments TEXT COMMENT '当天执行片段JSON: [[start_sec, end_sec], ...]',
  INDEX idx_user_id (user_id)
);

create table task_log (
  log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  date DATE NOT NULL,
  title VARCHAR(100),
  type INT COMMENT '0-随手记 1-周期任务 2-DDL 3-场景',
  planned_duration INT,
  parent_id BIGINT,
  actual_duration INT DEFAULT 0,
  actual_start_time DATETIME,
  result_status INT DEFAULT 0 COMMENT '0-未开始 1-未完成 2-完成 3-超时完成',
  work_segments TEXT COMMENT '历史执行片段JSON: [[start_sec, end_sec], ...]',
  INDEX idx_user_id (user_id),
  INDEX idx_task_id (task_id)
);

CREATE TABLE review (
    review_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    date DATE NOT NULL,
    content TEXT,
    done_count INT DEFAULT 0,
    total_count INT DEFAULT 0,
    actual_duration_sum INT DEFAULT 0,
    planned_duration_sum INT DEFAULT 0,
    streak_days INT DEFAULT 0,
    time_distribution JSON COMMENT '24小时利用分布:[sec0, sec1, ..., sec23]',
    UNIQUE KEY uk_user_date (user_id, date)
);
