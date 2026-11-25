import { useCallback, useEffect, useState } from 'react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  fetchCurrentUser,
  fetchPublicConfig,
  logout,
  setUnauthorizedHandler,
  type AuthUser,
  type PublicConfig,
} from './api';
import { EnvBanner } from './components/EnvBanner';
import { ImportPage } from './pages/ImportPage';
import { ListPage } from './pages/ListPage';
import { LoginPage } from './pages/LoginPage';

interface AuthenticatedShellProps {
  config: PublicConfig | null;
  user: AuthUser;
  onLogout: () => Promise<void>;
}

function AuthenticatedShell({
  config,
  user,
  onLogout,
}: AuthenticatedShellProps) {
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogoutClick() {
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="app-layout">
      <a href="#main-content" className="skip-link visually-hidden">
        Chuyển đến nội dung chính
      </a>

      <EnvBanner config={config} />

      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-block">
            <Link to="/" className="brand-link">
              <span className="brand-mark" aria-hidden="true">
                GK
              </span>
              <span className="brand-text">
                <span className="brand-title">GKSKLaiXe</span>
                <span className="brand-facility" data-testid="header-facility-info">
                  {config
                    ? `CSYT ${config.facilityId} · ${config.facilityName}`
                    : 'Cơ sở Y tế'}
                </span>
              </span>
            </Link>
            <span
              className={`env-badge ${
                config?.appEnv === 'production'
                  ? 'env-badge-prod'
                  : 'env-badge-test'
              }`}
              data-testid="header-env-badge"
            >
              {config?.appEnv === 'production' ? 'PRODUCTION' : 'Kiểm thử'}
            </span>
          </div>

          <nav className="primary-nav" aria-label="Điều hướng chính">
            <ul className="nav-list">
              <li>
                <NavLink to="/" end className="nav-link">
                  Danh sách &amp; Đối soát
                </NavLink>
              </li>
              <li>
                <NavLink to="/import" className="nav-link">
                  Import Excel
                </NavLink>
              </li>
            </ul>
          </nav>

          <div className="account-actions">
            <span className="user-pill" data-testid="current-username">
              {user.username}
            </span>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                void handleLogoutClick();
              }}
              disabled={loggingOut}
            >
              {loggingOut ? 'Đang thoát...' : 'Đăng xuất'}
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="workspace-main">
        <Routes>
          <Route path="/" element={<ListPage config={config} />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const location = useLocation();
  const navigate = useNavigate();

  const handleUnauthorized = useCallback(() => {
    setUser(null);
    setSessionNotice('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    navigate('/login', { replace: true });
  }, [navigate]);

  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
    return () => {
      setUnauthorizedHandler(null);
    };
  }, [handleUnauthorized]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const [configResult, userResult] = await Promise.allSettled([
        fetchPublicConfig(),
        fetchCurrentUser(),
      ]);

      if (cancelled) {
        return;
      }

      if (configResult.status === 'fulfilled') {
        setConfig(configResult.value);
      }

      if (userResult.status === 'fulfilled') {
        setUser(userResult.value.user);
      } else {
        setUser(null);
      }

      setInitializing(false);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cập nhật tiêu đề trang SPA theo từng route (WCAG 2.4.2 Page Titled)
  useEffect(() => {
    if (!user || location.pathname === '/login') {
      document.title = 'Đăng nhập | GKSKLaiXe';
    } else if (location.pathname === '/import') {
      document.title = 'Import Excel | GKSKLaiXe';
    } else {
      document.title = 'Danh sách & Đối soát | GKSKLaiXe';
    }
  }, [user, location.pathname]);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Vẫn xóa trạng thái cục bộ ngay cả khi máy chủ đã thu hồi phiên trước đó
    } finally {
      setUser(null);
      setSessionNotice(null);
      navigate('/login', { replace: true });
    }
  }

  function handleLoginSuccess(loggedInUser: AuthUser) {
    setUser(loggedInUser);
    setSessionNotice(null);
    navigate('/', { replace: true });
  }

  if (initializing) {
    return (
      <div className="bootstrap-screen">
        <EnvBanner config={config} />
        <main id="main-content" className="bootstrap-main">
          <div className="bootstrap-card" role="status">
            <div className="spinner-dot" aria-hidden="true" />
            <span>Đang khởi tạo phiên làm việc GKSKLaiXe...</span>
          </div>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route
          path="/login"
          element={
            <LoginPage
              config={config}
              sessionNotice={sessionNotice}
              onLoginSuccess={handleLoginSuccess}
            />
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route
        path="/*"
        element={
          <AuthenticatedShell
            config={config}
            user={user}
            onLogout={handleLogout}
          />
        }
      />
    </Routes>
  );
}
