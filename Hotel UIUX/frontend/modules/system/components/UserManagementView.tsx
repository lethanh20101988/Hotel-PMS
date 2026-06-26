import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, Plus, RefreshCw, Building2, Shield, UserCog, AlertCircle, X, Check,
} from 'lucide-react';

type MeUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  companyId?: string | null;
  permissions?: string[];
};

type Company = { id: string; name: string; slug: string; status: string };

type RbacUser = {
  id: string;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  role: string;
  roleId?: string | null;
  status: string;
  permissions?: string[];
};

type RbacRole = {
  id: string;
  name: string;
  description?: string | null;
  isSystem?: number | boolean;
  permissions: string[];
};

type Permission = { id: string; name: string; description?: string | null };

const API_PREFIX = String((import.meta as any).env?.VITE_API_URL || '/api').replace(/\/$/, '');

const PERMISSION_LABELS: Record<string, string> = {
  create_user: 'Tạo tài khoản',
  reset_password: 'Đặt lại mật khẩu',
  assign_role: 'Gán vai trò / phân quyền',
  create_data: 'Tạo dữ liệu',
  update_data: 'Sửa dữ liệu',
  delete_data: 'Xóa dữ liệu',
  approve_data: 'Duyệt dữ liệu',
  access_documents: 'Truy cập Chứng từ',
  access_dashboard: 'Truy cập Tổng quan',
  access_system: 'Truy cập Hệ thống',
  access_hotel_pms: 'Truy cập Hotel PMS',
  access_delivery: 'Truy cập Giao hàng',
  access_devices: 'Truy cập Thiết bị & Gia hạn',
  access_inventory: 'Truy cập Sản phẩm & Bản quyền',
  access_invoices: 'Truy cập Hóa đơn & VAT',
  access_fund: 'Truy cập Quỹ & Ngân hàng',
  access_cit: 'Truy cập Thuế TNDN',
  access_assets: 'Truy cập TSCĐ & CCDC',
  access_accounting: 'Truy cập Kế toán tổng hợp',
  access_reports: 'Truy cập Báo cáo',
  access_settings: 'Truy cập Cấu hình',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Quản trị (Admin)',
  manager: 'Quản lý',
  staff: 'Nhân viên',
};

const getToken = () => {
  try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
};

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_PREFIX}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

const companyQuery = (companyId: string) => `?companyId=${encodeURIComponent(companyId)}`;

const roleBadgeClass = (role: string) => {
  if (role === 'admin') return 'bg-purple-100 text-purple-700';
  if (role === 'manager') return 'bg-blue-100 text-blue-700';
  if (role === 'staff') return 'bg-slate-100 text-slate-700';
  return 'bg-amber-100 text-amber-800';
};

export const UserManagementView: React.FC = () => {
  const [me, setMe] = useState<MeUser | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [users, setUsers] = useState<RbacUser[]>([]);
  const [roles, setRoles] = useState<RbacRole[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [companyForm, setCompanyForm] = useState({ name: '', slug: '' });

  const [showCreateUser, setShowCreateUser] = useState(false);
  const [userForm, setUserForm] = useState({
    mode: 'user' as 'user' | 'admin',
    username: '',
    email: '',
    password: '',
    roleId: '',
  });

  const [showCreateRole, setShowCreateRole] = useState(false);
  const [roleForm, setRoleForm] = useState({ name: '', description: '', permissions: [] as string[] });

  const [editRole, setEditRole] = useState<RbacRole | null>(null);
  const [editRolePerms, setEditRolePerms] = useState<string[]>([]);

  const [editUser, setEditUser] = useState<RbacUser | null>(null);
  const [editUserRoleId, setEditUserRoleId] = useState('');
  const [resetPasswordUser, setResetPasswordUser] = useState<RbacUser | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const isSuperAdmin = me?.role === 'super_admin';
  const canManageUsers = isSuperAdmin || me?.permissions?.includes('create_user');
  const canAssignRole = isSuperAdmin || me?.permissions?.includes('assign_role');
  const canResetPassword = isSuperAdmin || me?.permissions?.includes('reset_password');

  const activeCompanyId = isSuperAdmin ? selectedCompanyId : (me?.companyId || '');

  const loadMe = useCallback(async () => {
    const data = await apiFetch<MeUser>('/me');
    setMe(data);
    if (data.role !== 'super_admin' && data.companyId) {
      setSelectedCompanyId(data.companyId);
    }
  }, []);

  const loadCompanies = useCallback(async () => {
    const data = await apiFetch<{ companies: Company[] }>('/super-admin/companies');
    setCompanies(data.companies || []);
    if (!selectedCompanyId && data.companies?.length) {
      setSelectedCompanyId(data.companies[0].id);
    }
  }, [selectedCompanyId]);

  const loadRbacData = useCallback(async (companyId: string) => {
    if (!companyId) return;
    const q = companyQuery(companyId);
    const [usersRes, rolesRes, permsRes] = await Promise.all([
      apiFetch<{ users: RbacUser[] }>(`/rbac/users${q}`),
      apiFetch<{ roles: RbacRole[] }>(`/rbac/roles${q}`),
      apiFetch<{ permissions: Permission[] }>(`/rbac/permissions${q}`),
    ]);
    setUsers(usersRes.users || []);
    setRoles(rolesRes.roles || []);
    setPermissions(permsRes.permissions || []);
  }, []);

  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      await loadMe();
      if (isSuperAdmin || me?.role === 'super_admin') {
        await loadCompanies();
      }
      const cid = isSuperAdmin ? selectedCompanyId : me?.companyId;
      if (cid) await loadRbacData(cid);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu');
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, loadCompanies, loadMe, loadRbacData, me?.companyId, me?.role, selectedCompanyId]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await apiFetch<MeUser>('/me');
        setMe(data);
        if (data.role === 'super_admin') {
          const comp = await apiFetch<{ companies: Company[] }>('/super-admin/companies');
          setCompanies(comp.companies || []);
          const firstId = comp.companies?.[0]?.id || '';
          setSelectedCompanyId(firstId);
          if (firstId) await loadRbacData(firstId);
        } else if (data.companyId) {
          setSelectedCompanyId(data.companyId);
          await loadRbacData(data.companyId);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Không tải được dữ liệu');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadRbacData]);

  useEffect(() => {
    if (!activeCompanyId || loading) return;
    void (async () => {
      try {
        await loadRbacData(activeCompanyId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Không tải được dữ liệu công ty');
      }
    })();
  }, [activeCompanyId, loadRbacData, loading]);

  useEffect(() => {
    const onRemoteUpdate = (event: Event) => {
      const kinds = ((event as CustomEvent<{ kinds?: string[] }>).detail?.kinds || []) as string[];
      if (!kinds.includes('rbac')) return;
      void (async () => {
        try {
          if (isSuperAdmin) await loadCompanies();
          if (activeCompanyId) await loadRbacData(activeCompanyId);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Không tải được dữ liệu phân quyền mới');
        }
      })();
    };
    window.addEventListener('vtr:state-remote-update', onRemoteUpdate);
    return () => window.removeEventListener('vtr:state-remote-update', onRemoteUpdate);
  }, [activeCompanyId, isSuperAdmin, loadCompanies, loadRbacData]);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === activeCompanyId),
    [companies, activeCompanyId],
  );

  const handleCreateCompany = async () => {
    if (!companyForm.name.trim() || !companyForm.slug.trim()) {
      window.alert('Vui lòng nhập tên và mã (slug) công ty.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ company: Company }>('/super-admin/companies', {
        method: 'POST',
        body: JSON.stringify({ name: companyForm.name.trim(), slug: companyForm.slug.trim().toLowerCase() }),
      });
      setCompanies((prev) => [res.company, ...prev]);
      setSelectedCompanyId(res.company.id);
      setShowCreateCompany(false);
      setCompanyForm({ name: '', slug: '' });
      await loadRbacData(res.company.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Tạo công ty thất bại');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateUser = async () => {
    if (!activeCompanyId) return;
    if (!userForm.email.trim() && userForm.mode === 'admin') {
      window.alert('Admin công ty cần email đăng nhập.');
      return;
    }
    if (userForm.mode === 'user' && !userForm.username.trim()) {
      window.alert('Vui lòng nhập tên đăng nhập.');
      return;
    }
    if (userForm.password.length < 6) {
      window.alert('Mật khẩu tối thiểu 6 ký tự.');
      return;
    }
    setBusy(true);
    try {
      if (userForm.mode === 'admin' && isSuperAdmin) {
        await apiFetch(`/super-admin/companies/${activeCompanyId}/admins`, {
          method: 'POST',
          body: JSON.stringify({
            email: userForm.email.trim().toLowerCase(),
            password: userForm.password,
            username: userForm.username.trim() || undefined,
          }),
        });
      } else {
        const staffRole = roles.find((r) => r.name === 'staff');
        await apiFetch('/rbac/users', {
          method: 'POST',
          body: JSON.stringify({
            companyId: activeCompanyId,
            username: userForm.username.trim(),
            password: userForm.password,
            email: userForm.email.trim() || undefined,
            roleId: userForm.roleId || staffRole?.id,
          }),
        });
      }
      setShowCreateUser(false);
      setUserForm({ mode: 'user', username: '', email: '', password: '', roleId: '' });
      await loadRbacData(activeCompanyId);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Tạo tài khoản thất bại');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveUserRole = async () => {
    if (!editUser || !editUserRoleId || !activeCompanyId) return;
    setBusy(true);
    try {
      await apiFetch(`/rbac/users/${editUser.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ roleId: editUserRoleId, companyId: activeCompanyId }),
      });
      setEditUser(null);
      await loadRbacData(activeCompanyId);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Gán vai trò thất bại');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !activeCompanyId) return;
    if (newPassword.length < 6) {
      window.alert('Mật khẩu tối thiểu 6 ký tự.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/rbac/users/${resetPasswordUser.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword, companyId: activeCompanyId }),
      });
      setResetPasswordUser(null);
      setNewPassword('');
      window.alert('Đã đặt lại mật khẩu.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Đặt lại mật khẩu thất bại');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRole = async () => {
    if (!activeCompanyId || !roleForm.name.trim()) return;
    setBusy(true);
    try {
      await apiFetch('/rbac/roles', {
        method: 'POST',
        body: JSON.stringify({
          companyId: activeCompanyId,
          name: roleForm.name.trim(),
          description: roleForm.description.trim() || undefined,
          permissions: roleForm.permissions,
        }),
      });
      setShowCreateRole(false);
      setRoleForm({ name: '', description: '', permissions: [] });
      await loadRbacData(activeCompanyId);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Tạo vai trò thất bại');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRolePermissions = async () => {
    if (!editRole || !activeCompanyId) return;
    setBusy(true);
    try {
      await apiFetch(`/rbac/roles/${editRole.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: editRolePerms, companyId: activeCompanyId }),
      });
      setEditRole(null);
      await loadRbacData(activeCompanyId);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Cập nhật quyền thất bại');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !me) {
    return (
      <div className="p-6 flex items-center gap-2 text-slate-500">
        <RefreshCw className="w-5 h-5 animate-spin" /> Đang tải...
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" /> Người dùng & Phân quyền
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            {isSuperAdmin
              ? 'Super Admin: chọn công ty/khách sạn, tạo admin công ty và thiết lập phân quyền.'
              : 'Quản lý tài khoản và vai trò trong công ty của bạn.'}
          </p>
          {me?.email && (
            <p className="text-xs text-slate-400 mt-1">
              Đăng nhập: <span className="font-semibold text-slate-600">{me.email}</span>
              <span className="ml-2 px-2 py-0.5 rounded bg-violet-100 text-violet-700 font-bold uppercase text-[10px]">
                {me.role}
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="flex items-center gap-2 px-3 py-2 text-sm font-bold text-slate-600 border rounded-lg hover:bg-slate-50"
        >
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> Làm mới
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm flex gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

      {isSuperAdmin && (
        <div className="mb-6 p-4 rounded-xl border border-slate-200 bg-slate-50">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Công ty / Khách sạn</label>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="w-full p-2.5 border rounded-lg bg-white font-semibold text-slate-700"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.slug})</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateCompany(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700"
            >
              <Building2 className="w-4 h-4" /> Tạo công ty
            </button>
          </div>
          {selectedCompany && (
            <p className="text-xs text-slate-500 mt-2">ID: {selectedCompany.id}</p>
          )}
        </div>
      )}

      {!activeCompanyId && isSuperAdmin && (
        <div className="text-center py-12 text-slate-500">
          Chưa có công ty. Hãy tạo công ty trước khi thêm tài khoản.
        </div>
      )}

      {activeCompanyId && (
        <>
          <div className="flex gap-2 mb-4 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setTab('users')}
              className={`px-4 py-2 text-sm font-bold rounded-t-lg ${tab === 'users' ? 'bg-white border border-b-0 border-slate-200 text-blue-600' : 'text-slate-500'}`}
            >
              Tài khoản ({users.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('roles')}
              className={`px-4 py-2 text-sm font-bold rounded-t-lg ${tab === 'roles' ? 'bg-white border border-b-0 border-slate-200 text-blue-600' : 'text-slate-500'}`}
            >
              Vai trò & Quyền ({roles.length})
            </button>
          </div>

          {tab === 'users' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-slate-600">
                  Danh sách tài khoản — <b>{selectedCompany?.name || activeCompanyId}</b>
                </p>
                {(canManageUsers || isSuperAdmin) && (
                  <button
                    type="button"
                    onClick={() => {
                      setUserForm({
                        mode: isSuperAdmin ? 'admin' : 'user',
                        username: '',
                        email: '',
                        password: '',
                        roleId: roles.find((r) => r.name === 'staff')?.id || '',
                      });
                      setShowCreateUser(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold text-sm hover:bg-emerald-700"
                  >
                    <Plus className="w-4 h-4" /> Tạo tài khoản
                  </button>
                )}
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-xs">
                    <tr>
                      <th className="p-3">Tên đăng nhập</th>
                      <th className="p-3">Email / SĐT</th>
                      <th className="p-3">Vai trò</th>
                      <th className="p-3">Trạng thái</th>
                      <th className="p-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-slate-400">
                          Chưa có tài khoản. Bấm « Tạo tài khoản » để thêm.
                        </td>
                      </tr>
                    ) : (
                      users.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-50">
                          <td className="p-3 font-bold text-slate-800">{u.username || '—'}</td>
                          <td className="p-3 text-slate-600">{u.email || u.phone || '—'}</td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${roleBadgeClass(u.role)}`}>
                              {ROLE_LABELS[u.role] || u.role}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={u.status === 'active' ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                              {u.status === 'active' ? 'Hoạt động' : 'Ngừng'}
                            </span>
                          </td>
                          <td className="p-3 text-right space-x-2">
                            {canAssignRole && (
                              <button
                                type="button"
                                className="text-blue-600 hover:underline text-xs font-bold"
                                onClick={() => {
                                  setEditUser(u);
                                  setEditUserRoleId(u.roleId || roles.find((r) => r.name === u.role)?.id || '');
                                }}
                              >
                                Gán vai trò
                              </button>
                            )}
                            {canResetPassword && (
                              <button
                                type="button"
                                className="text-amber-600 hover:underline text-xs font-bold"
                                onClick={() => {
                                  setResetPasswordUser(u);
                                  setNewPassword('');
                                }}
                              >
                                Đặt MK
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'roles' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-slate-600">Vai trò mặc định: Admin (toàn quyền), Manager, Staff. Có thể tạo vai trò tùy chỉnh.</p>
                {canAssignRole && (
                  <button
                    type="button"
                    onClick={() => setShowCreateRole(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg font-bold text-sm hover:bg-violet-700"
                  >
                    <Shield className="w-4 h-4" /> Tạo vai trò
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {roles.map((role) => (
                  <div key={role.id} className="border rounded-xl p-4 bg-white">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${roleBadgeClass(role.name)}`}>
                            {ROLE_LABELS[role.name] || role.name}
                          </span>
                          {role.isSystem && (
                            <span className="text-[10px] uppercase font-bold text-slate-400">Hệ thống</span>
                          )}
                        </div>
                        {role.description && (
                          <p className="text-sm text-slate-500 mt-1">{role.description}</p>
                        )}
                      </div>
                      {canAssignRole && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditRole(role);
                            setEditRolePerms([...role.permissions]);
                          }}
                          className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <UserCog className="w-4 h-4" /> Sửa quyền
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {role.permissions.length === 0 ? (
                        <span className="text-xs text-slate-400">Không có quyền</span>
                      ) : (
                        role.permissions.map((p) => (
                          <span key={p} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                            {PERMISSION_LABELS[p] || p}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 rounded-xl border border-dashed border-slate-300">
                <h4 className="text-xs font-black uppercase text-slate-500 mb-2">Danh mục quyền</h4>
                <div className="grid sm:grid-cols-2 gap-2 text-sm text-slate-600">
                  {permissions.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="font-medium">{PERMISSION_LABELS[p.name] || p.name}</span>
                      <span className="text-xs text-slate-400">({p.name})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal: Tạo công ty */}
      {showCreateCompany && (
        <Modal title="Tạo công ty / khách sạn" onClose={() => setShowCreateCompany(false)}>
          <label className="block mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase">Tên</span>
            <input
              className="w-full mt-1 p-2.5 border rounded-lg"
              value={companyForm.name}
              onChange={(e) => setCompanyForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Khách sạn Victory Hanoi"
            />
          </label>
          <label className="block mb-4">
            <span className="text-xs font-bold text-slate-500 uppercase">Mã (slug)</span>
            <input
              className="w-full mt-1 p-2.5 border rounded-lg"
              value={companyForm.slug}
              onChange={(e) => setCompanyForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
              placeholder="victory-hanoi"
            />
            <span className="text-xs text-slate-400">Chỉ chữ thường, số và dấu gạch ngang</span>
          </label>
          <ModalActions
            onCancel={() => setShowCreateCompany(false)}
            onConfirm={() => void handleCreateCompany()}
            confirmLabel="Tạo công ty"
            busy={busy}
          />
        </Modal>
      )}

      {/* Modal: Tạo user */}
      {showCreateUser && (
        <Modal title="Tạo tài khoản" onClose={() => setShowCreateUser(false)}>
          {isSuperAdmin && (
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setUserForm((f) => ({ ...f, mode: 'admin' }))}
                className={`flex-1 py-2 rounded-lg text-sm font-bold border ${userForm.mode === 'admin' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-600'}`}
              >
                Admin công ty
              </button>
              <button
                type="button"
                onClick={() => setUserForm((f) => ({ ...f, mode: 'user' }))}
                className={`flex-1 py-2 rounded-lg text-sm font-bold border ${userForm.mode === 'user' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600'}`}
              >
                Nhân viên / Kế toán
              </button>
            </div>
          )}
          {userForm.mode === 'admin' ? (
            <>
              <label className="block mb-3">
                <span className="text-xs font-bold text-slate-500 uppercase">Email đăng nhập *</span>
                <input
                  type="email"
                  className="w-full mt-1 p-2.5 border rounded-lg"
                  value={userForm.email}
                  onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <label className="block mb-3">
                <span className="text-xs font-bold text-slate-500 uppercase">Tên đăng nhập (tùy chọn)</span>
                <input
                  className="w-full mt-1 p-2.5 border rounded-lg"
                  value={userForm.username}
                  onChange={(e) => setUserForm((f) => ({ ...f, username: e.target.value }))}
                />
              </label>
            </>
          ) : (
            <>
              <label className="block mb-3">
                <span className="text-xs font-bold text-slate-500 uppercase">Tên đăng nhập *</span>
                <input
                  className="w-full mt-1 p-2.5 border rounded-lg"
                  value={userForm.username}
                  onChange={(e) => setUserForm((f) => ({ ...f, username: e.target.value }))}
                />
              </label>
              <label className="block mb-3">
                <span className="text-xs font-bold text-slate-500 uppercase">Email (tùy chọn)</span>
                <input
                  type="email"
                  className="w-full mt-1 p-2.5 border rounded-lg"
                  value={userForm.email}
                  onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <label className="block mb-3">
                <span className="text-xs font-bold text-slate-500 uppercase">Vai trò</span>
                <select
                  className="w-full mt-1 p-2.5 border rounded-lg"
                  value={userForm.roleId}
                  onChange={(e) => setUserForm((f) => ({ ...f, roleId: e.target.value }))}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{ROLE_LABELS[r.name] || r.name}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="block mb-4">
            <span className="text-xs font-bold text-slate-500 uppercase">Mật khẩu *</span>
            <input
              type="password"
              className="w-full mt-1 p-2.5 border rounded-lg"
              value={userForm.password}
              onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
            />
          </label>
          <ModalActions
            onCancel={() => setShowCreateUser(false)}
            onConfirm={() => void handleCreateUser()}
            confirmLabel="Tạo tài khoản"
            busy={busy}
          />
        </Modal>
      )}

      {/* Modal: Gán vai trò */}
      {editUser && (
        <Modal title={`Gán vai trò — ${editUser.username || editUser.email}`} onClose={() => setEditUser(null)}>
          <select
            className="w-full p-2.5 border rounded-lg mb-4"
            value={editUserRoleId}
            onChange={(e) => setEditUserRoleId(e.target.value)}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{ROLE_LABELS[r.name] || r.name}</option>
            ))}
          </select>
          <ModalActions
            onCancel={() => setEditUser(null)}
            onConfirm={() => void handleSaveUserRole()}
            confirmLabel="Lưu"
            busy={busy}
          />
        </Modal>
      )}

      {/* Modal: Reset password */}
      {resetPasswordUser && (
        <Modal title={`Đặt lại mật khẩu — ${resetPasswordUser.username || resetPasswordUser.email}`} onClose={() => setResetPasswordUser(null)}>
          <label className="block mb-4">
            <span className="text-xs font-bold text-slate-500 uppercase">Mật khẩu mới</span>
            <input
              type="password"
              className="w-full mt-1 p-2.5 border rounded-lg"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <ModalActions
            onCancel={() => setResetPasswordUser(null)}
            onConfirm={() => void handleResetPassword()}
            confirmLabel="Đặt lại"
            busy={busy}
          />
        </Modal>
      )}

      {/* Modal: Tạo role */}
      {showCreateRole && (
        <Modal title="Tạo vai trò tùy chỉnh" onClose={() => setShowCreateRole(false)}>
          <label className="block mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase">Tên vai trò</span>
            <input
              className="w-full mt-1 p-2.5 border rounded-lg"
              value={roleForm.name}
              onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="frontdesk"
            />
          </label>
          <label className="block mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase">Mô tả</span>
            <input
              className="w-full mt-1 p-2.5 border rounded-lg"
              value={roleForm.description}
              onChange={(e) => setRoleForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
          <PermissionChecklist
            permissions={permissions}
            selected={roleForm.permissions}
            onChange={(perms) => setRoleForm((f) => ({ ...f, permissions: perms }))}
          />
          <ModalActions
            onCancel={() => setShowCreateRole(false)}
            onConfirm={() => void handleCreateRole()}
            confirmLabel="Tạo vai trò"
            busy={busy}
            className="mt-4"
          />
        </Modal>
      )}

      {/* Modal: Sửa quyền role */}
      {editRole && (
        <Modal title={`Sửa quyền — ${editRole.name}`} onClose={() => setEditRole(null)}>
          <PermissionChecklist
            permissions={permissions}
            selected={editRolePerms}
            onChange={setEditRolePerms}
          />
          <ModalActions
            onCancel={() => setEditRole(null)}
            onConfirm={() => void handleSaveRolePermissions()}
            confirmLabel="Lưu quyền"
            busy={busy}
            className="mt-4"
          />
        </Modal>
      )}
    </div>
  );
};

const PermissionChecklist: React.FC<{
  permissions: Permission[];
  selected: string[];
  onChange: (perms: string[]) => void;
}> = ({ permissions, selected, onChange }) => (
  <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-3">
    {permissions.map((p) => (
      <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={selected.includes(p.name)}
          onChange={() => onChange(
            selected.includes(p.name) ? selected.filter((x) => x !== p.name) : [...selected, p.name],
          )}
        />
        <span className="font-medium">{PERMISSION_LABELS[p.name] || p.name}</span>
      </label>
    ))}
  </div>
);

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[70]">
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between p-4 border-b">
        <h4 className="font-bold text-slate-800">{title}</h4>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100">
          <X className="w-5 h-5 text-slate-500" />
        </button>
      </div>
      <div className="p-4">{children}</div>
    </div>
  </div>
);

const ModalActions: React.FC<{
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy?: boolean;
  className?: string;
}> = ({ onCancel, onConfirm, confirmLabel, busy, className = '' }) => (
  <div className={`flex gap-3 ${className}`}>
    <button type="button" onClick={onCancel} className="flex-1 py-2 border rounded-lg font-bold text-slate-600">
      Hủy
    </button>
    <button
      type="button"
      onClick={onConfirm}
      disabled={busy}
      className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
    >
      {busy ? 'Đang xử lý...' : confirmLabel}
    </button>
  </div>
);
