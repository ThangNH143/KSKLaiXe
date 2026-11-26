import { describe, expect, it } from 'vitest';
import { ConfigError, getPublicConfig, loadConfig } from './config.js';

function makeValidEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    APP_ENV: 'test',
    PORT: '3001',
    LOG_LEVEL: 'info',
    DB_HOST: 'localhost',
    DB_PORT: '1433',
    DB_USER: 'sa',
    DB_PASSWORD: 'SecretDbPassword!123',
    DB_NAME: 'GKSKLaiXe',
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERT: 'true',
    GKSK_BASE_URL: 'https://api.dongnai.gov.vn',
    GKSK_USERNAME: '75001',
    GKSK_PASSWORD: 'SecretCsytPassword!456',
    GKSK_FACILITY_ID: '75001',
    GKSK_FACILITY_NAME: 'TTYT Mau Dong Nai',
    GKSK_SENDER_ID: '',
    GKSK_PRIVATE_KEY_PATH: '',
    GKSK_HTTP_TIMEOUT_MS: '30000',
    APP_LOGIN_USER: 'admin',
    APP_LOGIN_PASSWORD_HASH: '$2b$10$abcdefghijklmnopqrstuv123456789012345678901234567890',
    SESSION_SECRET: 'super-long-random-session-secret-0123456789',
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('đọc cấu hình hợp lệ đầy đủ với giá trị mặc định đúng', () => {
    const cfg = loadConfig(makeValidEnv());

    expect(cfg.appEnv).toBe('test');
    expect(cfg.port).toBe(3001);
    expect(cfg.logLevel).toBe('info');
    expect(cfg.db).toEqual({
      host: 'localhost',
      port: 1433,
      user: 'sa',
      dbPassword: 'SecretDbPassword!123',
      name: 'GKSKLaiXe',
      encrypt: false,
      trustServerCert: true,
    });
    expect(cfg.gksk).toEqual({
      baseUrl: 'https://api.dongnai.gov.vn',
      username: '75001',
      password: 'SecretCsytPassword!456',
      facilityId: '75001',
      facilityName: 'TTYT Mau Dong Nai',
      senderId: '75001',
      httpTimeoutMs: 30000,
    });
    expect(cfg.gksk.privateKeyPath).toBeUndefined();
    expect(cfg.auth.loginUser).toBe('admin');
    expect(cfg.auth.allowInsecureCookie).toBe(false);
  });

  it('hỗ trợ ALLOW_INSECURE_COOKIE=true cho mạng LAN nội bộ chạy qua HTTP', () => {
    const cfg = loadConfig(
      makeValidEnv({
        APP_ENV: 'production',
        GKSK_BASE_URL: 'https://ksktd.dongnai.gov.vn',
        ALLOW_INSECURE_COOKIE: 'true',
      }),
    );
    expect(cfg.appEnv).toBe('production');
    expect(cfg.auth.allowInsecureCookie).toBe(true);
  });

  it('ném ConfigError nêu rõ tên các biến bị thiếu khi thiếu biến bắt buộc', () => {
    const env = makeValidEnv({
      DB_HOST: undefined,
      DB_PASSWORD: undefined,
      GKSK_BASE_URL: undefined,
      GKSK_PASSWORD: undefined,
      SESSION_SECRET: undefined,
    });

    let caught: unknown;
    try {
      loadConfig(env);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const configErr = caught as ConfigError;
    const vars = configErr.issues.map((i) => i.variable);
    expect(vars).toContain('DB_HOST');
    expect(vars).toContain('DB_PASSWORD');
    expect(vars).toContain('GKSK_BASE_URL');
    expect(vars).toContain('GKSK_PASSWORD');
    expect(vars).toContain('SESSION_SECRET');
    expect(configErr.message).toContain('DB_PASSWORD');
    expect(configErr.message).toContain('GKSK_BASE_URL');
  });

  it('không bao giờ in giá trị bí mật trong thông báo lỗi', () => {
    const env = makeValidEnv({
      DB_PASSWORD: 'TOP_SECRET_DB_VALUE_999',
      GKSK_PASSWORD: 'TOP_SECRET_GKSK_VALUE_888',
      SESSION_SECRET: 'TOO_SHORT_777',
      APP_ENV: 'invalid_secret_env',
    });

    let caught: unknown;
    try {
      loadConfig(env);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const msg = (caught as ConfigError).message;
    expect(msg).toContain('SESSION_SECRET');
    expect(msg).toContain('APP_ENV');
    expect(msg).not.toContain('TOP_SECRET_DB_VALUE_999');
    expect(msg).not.toContain('TOP_SECRET_GKSK_VALUE_888');
    expect(msg).not.toContain('TOO_SHORT_777');
    expect(msg).not.toContain('invalid_secret_env');
  });

  it('chuẩn hóa GKSK_BASE_URL bỏ dấu / ở cuối', () => {
    const cfg1 = loadConfig(makeValidEnv({ GKSK_BASE_URL: 'https://x/' }));
    expect(cfg1.gksk.baseUrl).toBe('https://x');

    const cfg2 = loadConfig(makeValidEnv({ GKSK_BASE_URL: 'https://api.dongnai.gov.vn///' }));
    expect(cfg2.gksk.baseUrl).toBe('https://api.dongnai.gov.vn');
  });

  it('cho phép http://localhost khi APP_ENV=test', () => {
    const cfg = loadConfig(
      makeValidEnv({
        APP_ENV: 'test',
        GKSK_BASE_URL: 'http://localhost:4000/',
      }),
    );
    expect(cfg.gksk.baseUrl).toBe('http://localhost:4000');
  });

  it('bắt buộc https:// khi APP_ENV=production và ném lỗi nếu dùng http://', () => {
    const env = makeValidEnv({
      APP_ENV: 'production',
      GKSK_BASE_URL: 'http://api.dongnai.gov.vn',
    });

    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      const configErr = err as ConfigError;
      expect(configErr.issues.some((i) => i.variable === 'GKSK_BASE_URL')).toBe(true);
      expect(configErr.message).toContain('https://');
    }
  });

  it('chấp nhận https:// khi APP_ENV=production', () => {
    const cfg = loadConfig(
      makeValidEnv({
        APP_ENV: 'production',
        GKSK_BASE_URL: 'https://api.dongnai.gov.vn/',
      }),
    );
    expect(cfg.appEnv).toBe('production');
    expect(cfg.gksk.baseUrl).toBe('https://api.dongnai.gov.vn');
  });

  it('GKSK_SENDER_ID trống thì mặc định bằng GKSK_FACILITY_ID; nếu có giá trị thì dùng giá trị đó', () => {
    const cfgDefault = loadConfig(
      makeValidEnv({ GKSK_FACILITY_ID: '75009', GKSK_SENDER_ID: '   ' }),
    );
    expect(cfgDefault.gksk.senderId).toBe('75009');

    const cfgCustom = loadConfig(
      makeValidEnv({ GKSK_FACILITY_ID: '75009', GKSK_SENDER_ID: '75009_CUSTOM' }),
    );
    expect(cfgCustom.gksk.senderId).toBe('75009_CUSTOM');
  });

  it('xử lý đúng GKSK_PRIVATE_KEY_PATH khi có giá trị', () => {
    const cfg = loadConfig(makeValidEnv({ GKSK_PRIVATE_KEY_PATH: './keys/private.pem' }));
    expect(cfg.gksk.privateKeyPath).toBe('./keys/private.pem');
  });

  it('kiểm tra lỗi định dạng PORT, DB_PORT, DB_ENCRYPT, GKSK_HTTP_TIMEOUT_MS', () => {
    const env = makeValidEnv({
      PORT: '99999',
      DB_PORT: 'abc',
      DB_ENCRYPT: 'maybe',
      GKSK_HTTP_TIMEOUT_MS: '100',
    });

    try {
      loadConfig(env);
      expect.unreachable('Phải ném ConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const vars = (err as ConfigError).issues.map((i) => i.variable);
      expect(vars).toContain('PORT');
      expect(vars).toContain('DB_PORT');
      expect(vars).toContain('DB_ENCRYPT');
      expect(vars).toContain('GKSK_HTTP_TIMEOUT_MS');
    }
  });

  it('getPublicConfig chỉ trả thông tin công khai và không lộ bí mật/DB', () => {
    const cfg = loadConfig(makeValidEnv());
    const pub = getPublicConfig(cfg);

    expect(pub).toEqual({
      appEnv: 'test',
      facilityId: '75001',
      facilityName: 'TTYT Mau Dong Nai',
      baseUrlHost: 'api.dongnai.gov.vn',
    });
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain('SecretDbPassword!123');
    expect(serialized).not.toContain('SecretCsytPassword!456');
    expect(serialized).not.toContain('super-long-random-session-secret');
    expect(serialized).not.toContain('localhost');
  });
});
