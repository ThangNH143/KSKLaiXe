import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  changePassword,
  checkSystemConnection,
  listUsers,
  resetUserPassword,
  updateUserStatus,
  upsertUser,
  type AuthUser,
  type PublicConfig,
  type SafeUserItem,
  type SystemConnectionCheckResult,
} from '../api';

export type SystemAdminTab = 'connection' | 'users' | 'password';

export interface SystemAdminModalProps {
  open: boolean;
  onClose: () => void;
  config: PublicConfig | null;
  currentUser: AuthUser;
  initialTab?: SystemAdminTab;
}

export function SystemAdminModal({
  open,
  onClose,
  config,
  currentUser,
  initialTab = 'connection',
}: SystemAdminModalProps) {
  const [activeTab, setActiveTab] = useState<SystemAdminTab>(initialTab);

  // Tab 1: Kiểm tra kết nối Cổng Sở Y tế & Database
  const [checkingConn, setCheckingConn] = useState(false);
  const [connResult, setConnResult] =
    useState<SystemConnectionCheckResult | null>(null);
  const [connError, setConnError] = useState<string | null>(null);

  // Tab 2: Quản trị người dùng
  const [users, setUsers] = useState<SafeUserItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userNotice, setUserNotice] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);

  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [savingUser, setSavingUser] = useState(false);

  const [resetTargetId, setResetTargetId] = useState<number | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');
  const [resettingId, setResettingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  // Tab 3: Đổi mật khẩu cá nhân
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmNextPassword, setConfirmNextPassword] = useState('');
  const [changingPass, setChangingPass] = useState(false);
  const [passNotice, setPassNotice] = useState<string | null>(null);
  const [passError, setPassError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  const loadUserList = useCallback(async () => {
    setLoadingUsers(true);
    setUserError(null);
    try {
      const res = await listUsers();
      setUsers(res.items);
    } catch (err) {
      setUserError(
        err instanceof ApiError
          ? err.message
          : 'Không thể tải danh sách người dùng.',
      );
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (open && activeTab === 'users') {
      void loadUserList();
    }
  }, [open, activeTab, loadUserList]);

  if (!open) {
    return null;
  }

  async function handleCheckConnection() {
    setCheckingConn(true);
    setConnError(null);
    try {
      const result = await checkSystemConnection();
      setConnResult(result);
    } catch (err) {
      setConnError(
        err instanceof ApiError
          ? err.message
          : 'Lỗi khi kiểm tra kết nối hệ thống.',
      );
    } finally {
      setCheckingConn(false);
    }
  }

  async function handleCreateOrUpdateUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUserNotice(null);
    setUserError(null);

    const trimmedUsername = newUsername.trim();
    if (trimmedUsername.length < 2) {
      setUserError('Tên đăng nhập phải có ít nhất 2 ký tự.');
      return;
    }
    if (newUserPassword.length < 6) {
      setUserError('Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }

    setSavingUser(true);
    try {
      const res = await upsertUser({
        username: trimmedUsername,
        password: newUserPassword,
        fullName: newFullName.trim(),
        isActive: true,
      });
      setUserNotice(
        res.created
          ? `Đã tạo mới tài khoản "${res.user.username}" thành công.`
          : `Đã cập nhật mật khẩu/thông tin tài khoản "${res.user.username}".`,
      );
      setNewUsername('');
      setNewFullName('');
      setNewUserPassword('');
      await loadUserList();
    } catch (err) {
      setUserError(
        err instanceof ApiError
          ? err.message
          : 'Lỗi khi tạo/cập nhật tài khoản.',
      );
    } finally {
      setSavingUser(false);
    }
  }

  async function handleConfirmResetPassword(userItem: SafeUserItem) {
    setUserNotice(null);
    setUserError(null);
    if (resetPasswordVal.length < 6) {
      setUserError('Mật khẩu đặt lại phải có ít nhất 6 ký tự.');
      return;
    }

    setResettingId(userItem.id);
    try {
      await resetUserPassword(userItem.id, resetPasswordVal);
      setUserNotice(
        `Đã đặt lại mật khẩu cho tài khoản "${userItem.username}".`,
      );
      setResetTargetId(null);
      setResetPasswordVal('');
      await loadUserList();
    } catch (err) {
      setUserError(
        err instanceof ApiError
          ? err.message
          : 'Không thể đặt lại mật khẩu người dùng.',
      );
    } finally {
      setResettingId(null);
    }
  }

  async function handleToggleUserStatus(userItem: SafeUserItem) {
    setUserNotice(null);
    setUserError(null);
    setTogglingId(userItem.id);
    try {
      const nextActive = !userItem.isActive;
      await updateUserStatus(userItem.id, nextActive);
      setUserNotice(
        nextActive
          ? `Đã mở khóa tài khoản "${userItem.username}".`
          : `Đã khóa tài khoản "${userItem.username}".`,
      );
      await loadUserList();
    } catch (err) {
      setUserError(
        err instanceof ApiError
          ? err.message
          : 'Không thể thay đổi trạng thái tài khoản.',
      );
    } finally {
      setTogglingId(null);
    }
  }

  async function handleChangeOwnPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPassNotice(null);
    setPassError(null);

    if (!currentPassword) {
      setPassError('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }
    if (nextPassword.length < 6) {
      setPassError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (nextPassword !== confirmNextPassword) {
      setPassError('Xác nhận mật khẩu mới không khớp.');
      return;
    }

    setChangingPass(true);
    try {
      const res = await changePassword(currentPassword, nextPassword);
      setPassNotice(res.message);
      setCurrentPassword('');
      setNextPassword('');
      setConfirmNextPassword('');
    } catch (err) {
      setPassError(
        err instanceof ApiError ? err.message : 'Đổi mật khẩu thất bại.',
      );
    } finally {
      setChangingPass(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog system-admin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-admin-modal-title"
        data-testid="system-admin-modal"
      >
        <div className="system-admin-header">
          <div>
            <h2 id="system-admin-modal-title" className="modal-title">
              ⚙️ Hệ thống, Kết nối SYT &amp; Quản trị Tài khoản
            </h2>
            <p className="system-admin-subtitle">
              Tài khoản đang đăng nhập:{' '}
              <strong>{currentUser.username}</strong>
              {config
                ? ` · CSYT ${config.facilityId} (${config.facilityName})`
                : ''}
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            data-testid="system-admin-close-btn"
          >
            ✕ Đóng
          </button>
        </div>

        <div className="drawer-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'connection'}
            className={`drawer-tab-btn ${
              activeTab === 'connection' ? 'active' : ''
            }`}
            onClick={() => setActiveTab('connection')}
            data-testid="sys-tab-connection"
          >
            🔌 Kiểm tra kết nối SYT &amp; DB
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'users'}
            className={`drawer-tab-btn ${
              activeTab === 'users' ? 'active' : ''
            }`}
            onClick={() => setActiveTab('users')}
            data-testid="sys-tab-users"
          >
            👥 Quản trị người dùng
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'password'}
            className={`drawer-tab-btn ${
              activeTab === 'password' ? 'active' : ''
            }`}
            onClick={() => setActiveTab('password')}
            data-testid="sys-tab-password"
          >
            🔑 Đổi mật khẩu của tôi
          </button>
        </div>

        <div className="system-admin-body">
          {activeTab === 'connection' && (
            <section
              aria-label="Kiểm tra kết nối Cổng Sở Y tế và Database"
              data-testid="sys-panel-connection"
            >
              <p className="sys-panel-desc">
                Kiểm tra trực tiếp kết nối tới cơ sở dữ liệu MSSQL (5 bảng{' '}
                <code>dbo.gksk_*</code>) và thử đăng nhập tài khoản CSYT lên
                Cổng Sở Y tế Đồng Nai (
                <code>{config?.baseUrlHost ?? 'ksktd.dongnai.gov.vn'}</code>)
                trước khi đẩy dữ liệu thật.
              </p>

              <div className="sys-action-row">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    void handleCheckConnection();
                  }}
                  disabled={checkingConn}
                  data-testid="run-connection-check-btn"
                >
                  {checkingConn
                    ? '⏳ Đang kiểm tra kết nối...'
                    : '🔍 Kiểm tra kết nối Cổng Sở Y tế & Database ngay'}
                </button>
              </div>

              {connError && (
                <div
                  className="alert-banner alert-error"
                  role="alert"
                  data-testid="conn-check-error"
                >
                  {connError}
                </div>
              )}

              {connResult && (
                <div
                  className="conn-result-grid"
                  data-testid="conn-check-result"
                >
                  <div
                    className={`conn-card ${
                      connResult.database.ok ? 'conn-card-ok' : 'conn-card-fail'
                    }`}
                    data-testid="conn-db-card"
                  >
                    <div className="conn-card-title">
                      <span>🗄️ Cơ sở dữ liệu ({connResult.database.kind.toUpperCase()})</span>
                      <span
                        className={`conn-status-pill ${
                          connResult.database.ok ? 'pill-ok' : 'pill-fail'
                        }`}
                        data-testid="conn-db-status"
                      >
                        {connResult.database.ok ? '✅ Sẵn sàng' : '⛔ Lỗi kết nối'}
                      </span>
                    </div>
                    <p className="conn-card-msg">
                      {connResult.database.message}
                    </p>
                    <ul className="conn-meta-list">
                      <li>
                        Bảng tiền tố <code>gksk_*</code>:{' '}
                        <strong>{connResult.database.tables.join(', ')}</strong>
                      </li>
                      <li>
                        Tài khoản nội bộ:{' '}
                        <strong>{connResult.database.userCount}</strong> · Đợt
                        import:{' '}
                        <strong>{connResult.database.batchCount}</strong> · Tổng
                        số giấy:{' '}
                        <strong>{connResult.database.certificateCount}</strong>
                      </li>
                    </ul>
                  </div>

                  <div
                    className={`conn-card ${
                      connResult.sytGateway.ok
                        ? 'conn-card-ok'
                        : 'conn-card-fail'
                    }`}
                    data-testid="conn-syt-card"
                  >
                    <div className="conn-card-title">
                      <span>🏥 Cổng Sở Y tế Đồng Nai ({connResult.sytGateway.baseUrlHost})</span>
                      <span
                        className={`conn-status-pill ${
                          connResult.sytGateway.ok ? 'pill-ok' : 'pill-fail'
                        }`}
                        data-testid="conn-syt-status"
                      >
                        {connResult.sytGateway.ok
                          ? '✅ Xác thực CSYT thành công'
                          : '⛔ Lỗi xác thực / Mạng'}
                      </span>
                    </div>
                    <p className="conn-card-msg">
                      {connResult.sytGateway.message}
                    </p>
                    <ul className="conn-meta-list">
                      <li>
                        CSYT:{' '}
                        <strong>
                          {connResult.sytGateway.facilityId} —{' '}
                          {connResult.sytGateway.facilityName}
                        </strong>
                      </li>
                      <li>
                        Mã phản hồi:{' '}
                        <strong>
                          HTTP {connResult.sytGateway.httpStatus ?? 'N/A'} (
                          {connResult.sytGateway.resCode ?? 'N/A'})
                        </strong>
                        {connResult.sytGateway.durationMinutes !== null
                          ? ` · Hiệu lực Token: ${connResult.sytGateway.durationMinutes} phút`
                          : ''}
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </section>
          )}

          {activeTab === 'users' && (
            <section
              aria-label="Quản trị tài khoản người dùng"
              data-testid="sys-panel-users"
            >
              {userNotice && (
                <div
                  className="alert-banner alert-success"
                  role="status"
                  data-testid="user-admin-notice"
                >
                  {userNotice}
                </div>
              )}
              {userError && (
                <div
                  className="alert-banner alert-error"
                  role="alert"
                  data-testid="user-admin-error"
                >
                  {userError}
                </div>
              )}

              <form
                className="user-create-form"
                onSubmit={(e) => {
                  void handleCreateOrUpdateUser(e);
                }}
              >
                <h3 className="sys-section-heading">
                  ➕ Thêm mới hoặc Cập nhật tài khoản (bảng{' '}
                  <code>dbo.gksk_users</code>)
                </h3>
                <div className="user-form-grid">
                  <div className="form-field">
                    <label htmlFor="new-user-username">
                      Tên đăng nhập (vd: <code>thangnh</code>)
                    </label>
                    <input
                      id="new-user-username"
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="thangnh"
                      disabled={savingUser}
                      data-testid="new-user-username-input"
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="new-user-fullname">
                      Họ và tên / Bộ phận
                    </label>
                    <input
                      id="new-user-fullname"
                      type="text"
                      value={newFullName}
                      onChange={(e) => setNewFullName(e.target.value)}
                      placeholder="Nguyễn Hoàng Thắng"
                      disabled={savingUser}
                      data-testid="new-user-fullname-input"
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="new-user-password">
                      Mật khẩu (tối thiểu 6 ký tự)
                    </label>
                    <input
                      id="new-user-password"
                      type="password"
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      placeholder="••••••"
                      disabled={savingUser}
                      data-testid="new-user-password-input"
                    />
                  </div>
                  <div className="user-form-submit-col">
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={savingUser}
                      data-testid="save-user-btn"
                    >
                      {savingUser ? 'Đang lưu...' : '💾 Lưu tài khoản'}
                    </button>
                  </div>
                </div>
              </form>

              <div className="user-list-wrapper">
                <div className="user-list-header">
                  <h3 className="sys-section-heading">
                    📋 Danh sách tài khoản trong Database ({users.length})
                  </h3>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      void loadUserList();
                    }}
                    disabled={loadingUsers}
                  >
                    🔄 Làm mới
                  </button>
                </div>

                {loadingUsers ? (
                  <p className="sys-panel-desc">Đang tải danh sách tài khoản...</p>
                ) : users.length === 0 ? (
                  <p className="sys-panel-desc" data-testid="users-empty-msg">
                    Chưa có tài khoản nào trong bảng <code>dbo.gksk_users</code>
                    . Bạn có thể thêm tài khoản mới ở biểu mẫu bên trên.
                  </p>
                ) : (
                  <table className="data-table" data-testid="users-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Tên đăng nhập</th>
                        <th>Họ và tên</th>
                        <th>Trạng thái</th>
                        <th>Cập nhật</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => {
                        const isSelf =
                          u.username.toLowerCase() ===
                          currentUser.username.toLowerCase();
                        return (
                          <tr
                            key={u.id}
                            data-testid={`user-row-${u.username}`}
                          >
                            <td>{u.id}</td>
                            <td>
                              <strong>{u.username}</strong>
                              {isSelf ? (
                                <span className="self-badge"> (Bạn)</span>
                              ) : null}
                            </td>
                            <td>{u.fullName || '—'}</td>
                            <td>
                              <span
                                className={`conn-status-pill ${
                                  u.isActive ? 'pill-ok' : 'pill-fail'
                                }`}
                              >
                                {u.isActive ? 'Hoạt động' : 'Đã khóa'}
                              </span>
                            </td>
                            <td>
                              {new Date(u.updatedAt).toLocaleString('vi-VN')}
                            </td>
                            <td>
                              {resetTargetId === u.id ? (
                                <div className="inline-reset-box">
                                  <input
                                    type="password"
                                    value={resetPasswordVal}
                                    onChange={(e) =>
                                      setResetPasswordVal(e.target.value)
                                    }
                                    placeholder="Mật khẩu mới (>=6 ký tự)"
                                    className="inline-reset-input"
                                    data-testid={`reset-pass-input-${u.username}`}
                                  />
                                  <button
                                    type="button"
                                    className="btn-primary btn-sm"
                                    disabled={resettingId === u.id}
                                    onClick={() => {
                                      void handleConfirmResetPassword(u);
                                    }}
                                    data-testid={`confirm-reset-btn-${u.username}`}
                                  >
                                    Lưu
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-ghost btn-sm"
                                    onClick={() => {
                                      setResetTargetId(null);
                                      setResetPasswordVal('');
                                    }}
                                  >
                                    Hủy
                                  </button>
                                </div>
                              ) : (
                                <div className="row-actions">
                                  <button
                                    type="button"
                                    className="btn-secondary btn-sm"
                                    onClick={() => {
                                      setResetTargetId(u.id);
                                      setResetPasswordVal('');
                                    }}
                                    data-testid={`open-reset-btn-${u.username}`}
                                  >
                                    🔑 Đặt lại MK
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-ghost btn-sm"
                                    disabled={isSelf || togglingId === u.id}
                                    onClick={() => {
                                      void handleToggleUserStatus(u);
                                    }}
                                    data-testid={`toggle-status-btn-${u.username}`}
                                  >
                                    {u.isActive ? '🔒 Khóa' : '🔓 Mở khóa'}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          {activeTab === 'password' && (
            <section
              aria-label="Đổi mật khẩu cá nhân"
              data-testid="sys-panel-password"
            >
              {passNotice && (
                <div
                  className="alert-banner alert-success"
                  role="status"
                  data-testid="change-pass-notice"
                >
                  {passNotice}
                </div>
              )}
              {passError && (
                <div
                  className="alert-banner alert-error"
                  role="alert"
                  data-testid="change-pass-error"
                >
                  {passError}
                </div>
              )}

              <form
                className="change-password-form"
                onSubmit={(e) => {
                  void handleChangeOwnPassword(e);
                }}
              >
                <div className="form-field">
                  <label htmlFor="own-current-password">
                    Mật khẩu hiện tại
                  </label>
                  <input
                    id="own-current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={changingPass}
                    data-testid="own-current-password-input"
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="own-next-password">
                    Mật khẩu mới (tối thiểu 6 ký tự)
                  </label>
                  <input
                    id="own-next-password"
                    type="password"
                    value={nextPassword}
                    onChange={(e) => setNextPassword(e.target.value)}
                    disabled={changingPass}
                    data-testid="own-next-password-input"
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="own-confirm-password">
                    Nhập lại mật khẩu mới
                  </label>
                  <input
                    id="own-confirm-password"
                    type="password"
                    value={confirmNextPassword}
                    onChange={(e) => setConfirmNextPassword(e.target.value)}
                    disabled={changingPass}
                    data-testid="own-confirm-password-input"
                  />
                </div>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={changingPass}
                  data-testid="submit-change-password-btn"
                >
                  {changingPass ? 'Đang cập nhật...' : '🔑 Cập nhật mật khẩu mới'}
                </button>
              </form>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
