-- Migration 001_init.sql — Khởi tạo lược đồ CSDL MSSQL cho GKSKLaiXe (ARCHITECTURE.md §5)
-- Quy tắc an toàn:
-- 1. 100% tên bảng bắt buộc có tiền tố gksk_
-- 2. Kiểm tra IF OBJECT_ID(...) IS NULL trước khi CREATE TABLE để an toàn tuyệt đối trên DB đang vận hành

IF OBJECT_ID(N'dbo.gksk_schema_migrations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.gksk_schema_migrations (
    version       NVARCHAR(64) NOT NULL PRIMARY KEY,
    applied_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;

IF OBJECT_ID(N'dbo.gksk_import_batches', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.gksk_import_batches (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    filename      NVARCHAR(255) NOT NULL,
    row_count     INT NOT NULL,
    created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;

IF OBJECT_ID(N'dbo.gksk_certificates', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.gksk_certificates (
    id                    INT IDENTITY(1,1) PRIMARY KEY,
    so                    NVARCHAR(64) NOT NULL,
    fields_json           NVARCHAR(MAX) NOT NULL,
    data_sha256           CHAR(64) NOT NULL,
    status                VARCHAR(20) NOT NULL,
    batch_id              INT NULL REFERENCES dbo.gksk_import_batches(id),
    excel_row_number      INT NULL,
    server_certificate_id NVARCHAR(64) NULL,
    created_at            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ux_gksk_cert_so UNIQUE (so)
  );
END;

IF OBJECT_ID(N'dbo.gksk_submissions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.gksk_submissions (
    id                    INT IDENTITY(1,1) PRIMARY KEY,
    certificate_id        INT NOT NULL REFERENCES dbo.gksk_certificates(id) ON DELETE CASCADE,
    msg_id                VARCHAR(64) NOT NULL,
    send_datetime         BIGINT NOT NULL,
    data_sha256           CHAR(64) NOT NULL,
    attempts              INT NOT NULL DEFAULT 0,
    http_status           INT NULL,
    res_code              VARCHAR(64) NULL,
    result_status         VARCHAR(20) NULL,
    server_submission_id  NVARCHAR(64) NULL,
    errors_json           NVARCHAR(MAX) NULL,
    warnings_json         NVARCHAR(MAX) NULL,
    last_error            NVARCHAR(500) NULL,
    created_at            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    finished_at           DATETIME2 NULL,
    CONSTRAINT ux_gksk_sub_msg_id UNIQUE (msg_id)
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'ix_gksk_cert_status'
    AND object_id = OBJECT_ID(N'dbo.gksk_certificates')
)
BEGIN
  CREATE INDEX ix_gksk_cert_status ON dbo.gksk_certificates(status);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'ix_gksk_cert_batch'
    AND object_id = OBJECT_ID(N'dbo.gksk_certificates')
)
BEGIN
  CREATE INDEX ix_gksk_cert_batch ON dbo.gksk_certificates(batch_id);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'ix_gksk_sub_cert'
    AND object_id = OBJECT_ID(N'dbo.gksk_submissions')
)
BEGIN
  CREATE INDEX ix_gksk_sub_cert ON dbo.gksk_submissions(certificate_id, id DESC);
END;
