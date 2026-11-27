-- Migration 002_users.sql — Bảng tài khoản người dùng nội bộ ứng dụng (ARCHITECTURE.md §5)
-- Quy tắc an toàn:
-- 1. 100% tên bảng bắt buộc có tiền tố gksk_ (dbo.gksk_users)
-- 2. Kiểm tra IF OBJECT_ID(...) IS NULL trước khi CREATE TABLE để an toàn tuyệt đối trên DB đang vận hành

IF OBJECT_ID(N'dbo.gksk_users', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.gksk_users (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    username      NVARCHAR(64) NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
    full_name     NVARCHAR(128) NOT NULL DEFAULT N'',
    is_active     BIT NOT NULL DEFAULT 1,
    created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ux_gksk_users_username UNIQUE (username)
  );
END;
