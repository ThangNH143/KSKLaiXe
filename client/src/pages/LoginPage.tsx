import { useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  login,
  type AuthUser,
  type PublicConfig,
} from '../api';
import { EnvBanner } from '../components/EnvBanner';

export interface LoginPageProps {
  config: PublicConfig | null;
  sessionNotice?: string | null;
  onLoginSuccess: (user: AuthUser) => void;
}

export function LoginPage({
  config,
  sessionNotice,
  onLoginSuccess,
}: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touchedUsername, setTouchedUsername] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const usernameInvalid =
    (touchedUsername || submitAttempted) && username.trim().length === 0;
  const passwordInvalid =
    (touchedPassword || submitAttempted) && password.length === 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    setErrorMessage(null);

    const trimmedUser = username.trim();
    if (trimmedUser.length === 0) {
      usernameRef.current?.focus();
      return;
    }
    if (password.length === 0) {
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const session = await login(trimmedUser, password);
      onLoginSuccess(session.user);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Đăng nhập thất bại. Vui lòng thử lại.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page-shell">
      <EnvBanner config={config} />

      <main id="main-content" className="login-main">
        <div className="login-card">
          <header className="login-header">
            <div className="login-brand-row">
              <span className="brand-mark" aria-hidden="true">
                GK
              </span>
              <span
                className={`env-badge ${
                  config?.appEnv === 'production'
                    ? 'env-badge-prod'
                    : 'env-badge-test'
                }`}
                data-testid="login-env-badge"
              >
                {config?.appEnv === 'production'
                  ? 'Môi trường Sản xuất'
                  : 'Môi trường Kiểm thử'}
              </span>
            </div>

            <h1>Đăng nhập GKSKLaiXe</h1>
            <p className="login-subtitle">
              Hệ thống Import Excel, Xuất XML &amp; Đối soát Giấy khám sức khỏe
              lái xe
            </p>

            {config && (
              <div className="facility-summary-box" data-testid="login-facility-info">
                <div>
                  <span className="facility-label">Mã CSYT:</span>{' '}
                  <strong>{config.facilityId}</strong>
                </div>
                <div className="facility-name">{config.facilityName}</div>
                <div className="facility-host">Cổng kết nối: {config.baseUrlHost}</div>
              </div>
            )}
          </header>

          {sessionNotice && !errorMessage && (
            <div
              className="alert-banner alert-warning"
              role="alert"
              data-testid="session-notice"
            >
              {sessionNotice}
            </div>
          )}

          {errorMessage && (
            <div
              className="alert-banner alert-error"
              role="alert"
              data-testid="login-error"
            >
              {errorMessage}
            </div>
          )}

          <form
            className="login-form"
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            noValidate
          >
            <div className="form-field">
              <label htmlFor="login-username">Tên đăng nhập</label>
              <input
                ref={usernameRef}
                id="login-username"
                name="username"
                type="text"
                className={usernameInvalid ? 'user-invalid-fallback' : undefined}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                onBlur={() => setTouchedUsername(true)}
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="next"
                required
                aria-invalid={usernameInvalid ? 'true' : 'false'}
                aria-describedby={
                  usernameInvalid ? 'login-username-error' : undefined
                }
                disabled={submitting}
              />
              {usernameInvalid && (
                <div id="login-username-error" className="field-error-text">
                  <span role="img" aria-label="Lỗi">
                    ⛔
                  </span>{' '}
                  Vui lòng nhập tên đăng nhập nội bộ.
                </div>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="login-password">Mật khẩu</label>
              <div className="password-input-group">
                <input
                  ref={passwordRef}
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  className={passwordInvalid ? 'user-invalid-fallback' : undefined}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  onBlur={() => setTouchedPassword(true)}
                  autoComplete="current-password"
                  enterKeyHint="done"
                  required
                  aria-invalid={passwordInvalid ? 'true' : 'false'}
                  aria-describedby={
                    passwordInvalid ? 'login-password-error' : undefined
                  }
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={submitting}
                >
                  {showPassword ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
              {passwordInvalid && (
                <div id="login-password-error" className="field-error-text">
                  <span role="img" aria-label="Lỗi">
                    ⛔
                  </span>{' '}
                  Vui lòng nhập mật khẩu.
                </div>
              )}
            </div>

            <button
              type="submit"
              className="btn-primary login-submit-btn"
              disabled={submitting}
            >
              {submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>

          <footer className="login-footer">
            Tài khoản nội bộ do quản trị viên CSYT cấp. Thông tin đăng nhập Cổng
            Sở Y tế chỉ được lưu an toàn tại máy chủ.
          </footer>
        </div>
      </main>
    </div>
  );
}
