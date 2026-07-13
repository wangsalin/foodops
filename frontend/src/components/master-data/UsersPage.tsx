"use client";

import { App, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { hasPermission, readStoredPermissions } from "@/lib/permissions";
import {
  permissionValueColor,
  permissionValueLabel,
  rolePermissionModules,
  type RolePermissionValue
} from "@/lib/permission-modules";

type PermissionMap = Record<string, RolePermissionValue>;
type OptionRecord = { id: string; name: string; data_scope?: string; permissions?: PermissionMap };
type UserRecord = {
  id: string;
  name: string;
  username: string;
  phone?: string;
  default_channel?: string;
  role_id?: string;
  role_name?: string;
  role_data_scope?: string;
  role_permissions?: PermissionMap;
  department_id?: string;
  department_name?: string;
  status: string;
  store_scope_ids?: string[];
  store_scope_names?: string[];
};

const dataScopeLabel: Record<string, string> = {
  all: "å…¨éƒ¨æ•°æ®",
  region: "åŒºåŸŸé—¨åº—",
  multi_store: "å¤šé—¨åº—ç®¡è¾–",
  own_stores: "è´Ÿè´£é—¨åº—",
  single_store: "å•é—¨åº—",
  channel: "æ¸ é“",
  dept: "æœ¬éƒ¨é—¨"
};

const permissionModules = rolePermissionModules;
const permissionLabel = permissionValueLabel;
const permissionColor = permissionValueColor;

function formatPersonName(value?: string | null) {
  if (!value) return "-";
  if (/Supervisor Scope Smoke/i.test(value)) return "éªŒæ”¶ç£å¯¼è´¦å·";
  if (/Scope Smoke/i.test(value)) return "éªŒæ”¶è´¦å·";
  return value;
}

function formatAccountName(value?: string | null) {
  if (!value) return "-";
  if (value === "admin") return "ç³»ç»Ÿç®¡ç†å‘˜è´¦å·";
  if (/^tmp_supervisor_/i.test(value)) return "éªŒæ”¶ç£å¯¼è´¦å·";
  if (/^accept_store_manager$/i.test(value)) return "éªŒæ”¶åº—é•¿è´¦å·";
  if (/^accept_supervisor$/i.test(value)) return "éªŒæ”¶ç£å¯¼è´¦å·";
  if (/^accept_warehouse$/i.test(value)) return "éªŒæ”¶ä»“ç®¡è´¦å·";
  if (/^accept_ops_director$/i.test(value)) return "éªŒæ”¶è¿è¥è´¦å·";
  return value;
}

function formatOrgName(value?: string | null) {
  if (!value) return "-";
  if (/^TMP-SUPERVISOR-DEPT/i.test(value)) return "éªŒæ”¶ç£å¯¼éƒ¨é—¨";
  if (/^TMP-SUPERVISOR-/i.test(value)) return "éªŒæ”¶ç£å¯¼è§’è‰²";
  if (/Supervisor Scope Smoke/i.test(value)) return "éªŒæ”¶ç£å¯¼è§’è‰²";
  return value;
}

function formatStoreName(value?: string | null) {
  if (!value) return "æœªå‘½åé—¨åº—";
  if (/^Scope Store/i.test(value)) return "æµ‹è¯•é—¨åº—";
  return value;
}

type UserFormValues = {
  name: string;
  username?: string;
  password?: string;
  phone?: string;
  default_channel?: string;
  department_id?: string;
  role_id?: string;
  status?: string;
  store_scope_ids?: string[];
};

function normalizeNotificationChannel(channel?: string) {
  return "system";
}

export function UsersPage() {
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<OptionRecord[]>([]);
  const [assignableRoles, setAssignableRoles] = useState<OptionRecord[]>([]);
  const [departments, setDepartments] = useState<OptionRecord[]>([]);
  const [stores, setStores] = useState<OptionRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [resetUser, setResetUser] = useState<UserRecord | null>(null);
  const [permissionUser, setPermissionUser] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<UserFormValues>();
  const [resetForm] = Form.useForm();
  const watchedDepartmentId = Form.useWatch("department_id", form);
  const watchedRoleId = Form.useWatch("role_id", form);
  const [permissions, setPermissions] = useState(() => readStoredPermissions());
  const { message } = App.useApp();
  const canManageUsers = hasPermission(permissions, "users", "manage");
  const selectedFormRole = useMemo(
    () => assignableRoles.find((role) => role.id === watchedRoleId) || roles.find((role) => role.id === watchedRoleId) || null,
    [assignableRoles, roles, watchedRoleId]
  );
  const selectedFormScope = selectedFormRole?.data_scope || "none";
  const roleSelectDisabled = !watchedDepartmentId || assignableRoles.length === 0;
  const storeScopeDisabled = !watchedDepartmentId || !selectedFormRole || selectedFormScope === "all";
  const storeScopeRequired = Boolean(selectedFormRole && selectedFormScope !== "all");
  const storeScopeHint = getStoreScopeHint(selectedFormRole);
  const rolePlaceholder = !watchedDepartmentId
    ? "è¯·å…ˆé€‰æ‹©éƒ¨é—¨"
    : assignableRoles.length
      ? "é€‰æ‹©è¯¥éƒ¨é—¨ä¸‹å¯åˆ†é…çš„è§’è‰²"
      : "è¯¥éƒ¨é—¨æš‚æ— å¯ç”¨è§’è‰²ï¼Œè¯·å…ˆåˆ°ç»„ç»‡æž¶æž„é…ç½®";
  const departmentRoleGuide = getDepartmentRoleGuide(Boolean(watchedDepartmentId), assignableRoles.length);
  const departmentFilter = searchParams.get("department_id");
  const roleFilter = searchParams.get("role_id");
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      if (departmentFilter && user.department_id !== departmentFilter) return false;
      if (roleFilter && user.role_id !== roleFilter) return false;
      return true;
    });
  }, [departmentFilter, roleFilter, users]);
  const filterLabel = useMemo(() => {
    const departmentName = departments.find((item) => item.id === departmentFilter)?.name;
    const roleName = roles.find((item) => item.id === roleFilter)?.name;
    return [departmentName ? `éƒ¨é—¨ï¼š${departmentName}` : "", roleName ? `è§’è‰²ï¼š${roleName}` : ""].filter(Boolean).join(" / ");
  }, [departmentFilter, departments, roleFilter, roles]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userRes, roleRes, deptRes] = await Promise.all([
        api.get("/api/v1/org/users"),
        api.get("/api/v1/org/roles"),
        api.get("/api/v1/org/departments")
      ]);
      let storeData: OptionRecord[] = [];
      if (canManageUsers) {
        try {
          const storeRes = await api.get("/api/v1/stores");
          storeData = storeRes.data;
        } catch {
          message.warning("é—¨åº—èŒƒå›´æ•°æ®åŠ è½½å¤±è´¥ï¼Œäººå‘˜åˆ—è¡¨ä»å¯æŸ¥çœ‹ï¼Œè¯·æ£€æŸ¥å½“å‰è´¦å·çš„é—¨åº—è¯»å–æƒé™");
        }
      }
      setUsers(userRes.data);
      setRoles(roleRes.data);
      setDepartments(deptRes.data);
      setStores(storeData);
    } catch {
      message.error("äººå‘˜æ•°æ®åŠ è½½å¤±è´¥ï¼Œè¯·ç¡®è®¤åŽç«¯æœåŠ¡å’Œç™»å½•çŠ¶æ€");
    } finally {
      setLoading(false);
    }
  }, [canManageUsers, message]);

  const loadDepartmentRoles = useCallback(async (departmentId?: string) => {
    if (!departmentId) {
      setAssignableRoles([]);
      return;
    }
    try {
      const res = await api.get(`/api/v1/org/roles?department_id=${departmentId}`);
      setAssignableRoles(res.data);
    } catch {
      setAssignableRoles([]);
      message.error("è¯¥éƒ¨é—¨å¯åˆ†é…è§’è‰²åŠ è½½å¤±è´¥ï¼Œè¯·åˆ°ç»„ç»‡æž¶æž„æ£€æŸ¥éƒ¨é—¨è§’è‰²é…ç½®");
    }
  }, [message]);

  useEffect(() => {
    setPermissions(readStoredPermissions());
    load();
  }, [load]);

  function startCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ default_channel: "system", department_id: departmentFilter || undefined, store_scope_ids: [] });
    void loadDepartmentRoles(departmentFilter || undefined);
    setOpen(true);
  }

  function startEdit(record: UserRecord) {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      phone: record.phone,
      default_channel: normalizeNotificationChannel(record.default_channel),
      department_id: record.department_id,
      role_id: record.role_id,
      status: record.status,
      store_scope_ids: record.store_scope_ids || []
    });
    void loadDepartmentRoles(record.department_id);
    setOpen(true);
  }

  function handleDepartmentChange(departmentId?: string) {
    form.setFieldsValue({ role_id: undefined, store_scope_ids: [] });
    void loadDepartmentRoles(departmentId);
  }

  function handleRoleChange(roleId?: string) {
    const role = assignableRoles.find((item) => item.id === roleId) || roles.find((item) => item.id === roleId);
    const currentStores = form.getFieldValue("store_scope_ids") || [];
    if (!role || role.data_scope === "all") {
      form.setFieldValue("store_scope_ids", []);
      return;
    }
    if (role.data_scope === "single_store" && currentStores.length > 1) {
      form.setFieldValue("store_scope_ids", [currentStores[0]]);
    }
  }

  async function submit(values: UserFormValues) {
    const { store_scope_ids: rawStoreScopeIds = [], ...userPayload } = values;
    const selectedRole = assignableRoles.find((role) => role.id === values.role_id) || roles.find((role) => role.id === values.role_id);
    const storeScopeIds = selectedRole?.data_scope === "all" || !selectedRole ? [] : rawStoreScopeIds;
    let userId = editing?.id;
    if (editing) {
      await api.patch(`/api/v1/org/users/${editing.id}`, userPayload);
      message.success("äººå‘˜ä¿¡æ¯å·²æ›´æ–°");
    } else {
      const res = await api.post("/api/v1/org/users", userPayload);
      userId = res.data.id;
      message.success("äººå‘˜å·²åˆ›å»º");
    }
    if (userId) {
      await api.put(`/api/v1/org/users/${userId}/store-scopes`, { store_ids: storeScopeIds });
    }
    setOpen(false);
    form.resetFields();
    await load();
  }

  async function resetPassword(values: { password: string }) {
    if (!resetUser) return;
    await api.post(`/api/v1/org/users/${resetUser.id}/reset-password`, values);
    message.success("å¯†ç å·²é‡ç½®");
    setResetOpen(false);
    resetForm.resetFields();
  }

  return (
    <>
      <Card
        className="panel-card"
        title={
          <Space wrap>
            <span>äººå‘˜åˆ—è¡¨</span>
            {filterLabel ? <Tag color="blue">{filterLabel}</Tag> : null}
            <Tag>{filteredUsers.length} / {users.length}</Tag>
          </Space>
        }
        extra={canManageUsers ? <Button type="primary" onClick={startCreate}>æ–°å¢žäººå‘˜</Button> : null}
      >
        <Table
          loading={loading}
          rowKey="id"
          dataSource={filteredUsers}
          scroll={{ x: 1280 }}
          locale={{ emptyText: filterLabel ? "è¯¥ç­›é€‰æ¡ä»¶ä¸‹æš‚æ— äººå‘˜ï¼Œè¯·æ–°å¢žäººå‘˜æˆ–ç¼–è¾‘å·²æœ‰äººå‘˜åˆ†é…è§’è‰²ã€‚" : "æš‚æ— äººå‘˜" }}
          columns={[
            { title: "å§“å", dataIndex: "name", width: 120, render: (value: string) => formatPersonName(value) },
            { title: "è´¦å·", dataIndex: "username", width: 150, render: formatAccountName },
            { title: "éƒ¨é—¨", dataIndex: "department_name", width: 140, render: (value: string) => formatOrgName(value) },
            { title: "è§’è‰²", dataIndex: "role_name", width: 170, render: (value: string) => formatOrgName(value) },
            {
              title: "æ•°æ®èŒƒå›´",
              dataIndex: "role_data_scope",
              width: 110,
              render: (value: string) => <Tag color={value === "all" ? "gold" : "blue"}>{dataScopeLabel[value] || "æœªè®¾ç½®"}</Tag>
            },
            {
              title: "æƒé™æ‘˜è¦",
              dataIndex: "role_permissions",
              width: 160,
              render: (value: PermissionMap | undefined) => renderPermissionSummary(value)
            },
            {
              title: "å¯è§é—¨åº—",
              dataIndex: "store_scope_names",
              width: 160,
              render: (_: string[], record: UserRecord) => renderStoreScope(record)
            },
            { title: "æ‰‹æœºå·", dataIndex: "phone", width: 140 },
            {
              title: "é€šçŸ¥æ¸ é“",
              dataIndex: "default_channel",
              width: 110,
              render: (value: string) => {
                const channel = normalizeNotificationChannel(value);
                const label: Record<string, string> = { system: "系统内" };
                const color: Record<string, string> = { system: "default" };
                return <Tag color={color[channel] || "default"}>{label[channel]}</Tag>;
              }
            },
            { title: "çŠ¶æ€", dataIndex: "status", width: 90, render: (status: string) => <Tag color={status === "active" ? "green" : "default"}>{status === "active" ? "å¯ç”¨" : "åœç”¨"}</Tag> },
            {
              title: "æ“ä½œ",
              width: 210,
              fixed: "right",
              render: (_: unknown, record: UserRecord) => (
                <Space>
                  {canManageUsers ? (
                    <>
                      <Button type="link" onClick={() => setPermissionUser(record)}>æƒé™è¯¦æƒ…</Button>
                      <Button type="link" onClick={() => startEdit(record)}>ç¼–è¾‘</Button>
                      <Button
                        type="link"
                        onClick={() => {
                          setResetUser(record);
                          resetForm.resetFields();
                          setResetOpen(true);
                        }}
                      >
                        é‡ç½®å¯†ç 
                      </Button>
                    </>
                  ) : (
                    <Button type="link" onClick={() => setPermissionUser(record)}>æŸ¥çœ‹æƒé™</Button>
                  )}
                </Space>
              )
            }
          ]}
        />
      </Card>

      <Modal className="responsive-modal user-form-modal" title={editing ? "ç¼–è¾‘äººå‘˜" : "æ–°å¢žäººå‘˜"} open={open} onCancel={() => setOpen(false)} footer={null} forceRender>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="name" label="å§“å" rules={[{ required: true, message: "è¯·è¾“å…¥å§“å" }]}><Input /></Form.Item>
          {!editing && (
            <>
              <Form.Item name="username" label="ç™»å½•è´¦å·" rules={[{ required: true, message: "è¯·è¾“å…¥è´¦å·" }]}><Input /></Form.Item>
              <Form.Item name="password" label="åˆå§‹å¯†ç " rules={[{ required: true, min: 8, message: "è‡³å°‘ 8 ä½" }]}><Input.Password /></Form.Item>
            </>
          )}
          <Form.Item name="phone" label="æ‰‹æœºå·"><Input placeholder="ç”¨äºŽäººå‘˜æ¡£æ¡ˆå’ŒåŽç»­çŸ­ä¿¡èƒ½åŠ›é¢„ç•™" /></Form.Item>
          <Form.Item name="default_channel" label="é»˜è®¤é€šçŸ¥æ¸ é“" initialValue="system">
            <Select
              options={[
                { value: "system", label: "系统内通知" }
              ]}
            />
          </Form.Item>
          <Form.Item name="department_id" label="éƒ¨é—¨" rules={[{ required: true, message: "è¯·å…ˆé€‰æ‹©éƒ¨é—¨" }]}>
            <Select
              allowClear
              onChange={handleDepartmentChange}
              placeholder="å…ˆé€‰æ‹©äººå‘˜æ‰€å±žéƒ¨é—¨"
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          </Form.Item>
          <Form.Item name="role_id" label="è§’è‰²" rules={[{ required: true, message: "è¯·é€‰æ‹©è¯¥éƒ¨é—¨ä¸‹å¯åˆ†é…çš„è§’è‰²" }]}>
            <Select
              allowClear
              disabled={roleSelectDisabled}
              onChange={handleRoleChange}
              placeholder={rolePlaceholder}
              options={assignableRoles.map((r) => ({
                value: r.id,
                label: `${formatOrgName(r.name)}${r.data_scope ? ` Â· ${dataScopeLabel[r.data_scope] || r.data_scope}` : ""}`
              }))}
            />
          </Form.Item>
          <div className={`user-scope-guide${watchedDepartmentId ? " required" : ""}`}>
            <b>{departmentRoleGuide.title}</b>
            <span>{departmentRoleGuide.description}</span>
          </div>
          <div className={`user-scope-guide${storeScopeRequired ? " required" : ""}`}>
            <b>{storeScopeHint.title}</b>
            <span>{storeScopeHint.description}</span>
          </div>
          <Form.Item
            name="store_scope_ids"
            label="å¯è§é—¨åº—"
            rules={[
              {
                validator: (_, value: string[] = []) => {
                  if (!selectedFormRole || selectedFormScope === "all") return Promise.resolve();
                  if (selectedFormScope === "single_store" && value.length !== 1) {
                    return Promise.reject(new Error("å•é—¨åº—è§’è‰²å¿…é¡»é€‰æ‹© 1 å®¶é—¨åº—"));
                  }
                  if (!value.length) {
                    return Promise.reject(new Error("è¯¥è§’è‰²éœ€è¦é…ç½®è‡³å°‘ 1 å®¶å¯è§é—¨åº—"));
                  }
                  return Promise.resolve();
                }
              }
            ]}
          >
            <Select
              allowClear
              disabled={storeScopeDisabled}
              maxCount={selectedFormScope === "single_store" ? 1 : undefined}
              mode="multiple"
              placeholder={storeScopeHint.placeholder}
              options={stores.map((s) => ({ value: s.id, label: s.name }))}
            />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="çŠ¶æ€">
              <Select options={[{ value: "active", label: "å¯ç”¨" }, { value: "disabled", label: "åœç”¨" }]} />
            </Form.Item>
          )}
          <Space className="modal-action-row"><Button type="primary" htmlType="submit" disabled={!canManageUsers}>ä¿å­˜</Button><Button onClick={() => setOpen(false)}>å–æ¶ˆ</Button></Space>
        </Form>
      </Modal>

      <Modal className="responsive-modal user-form-modal" title={`é‡ç½®å¯†ç ${resetUser ? `ï¼š${formatPersonName(resetUser.name)}` : ""}`} open={resetOpen} onCancel={() => setResetOpen(false)} footer={null} forceRender>
        <Form form={resetForm} layout="vertical" onFinish={resetPassword}>
          <Form.Item name="password" label="æ–°å¯†ç " rules={[{ required: true, min: 8, message: "è‡³å°‘ 8 ä½" }]}><Input.Password /></Form.Item>
          <Space className="modal-action-row"><Button type="primary" htmlType="submit" disabled={!canManageUsers}>ç¡®è®¤é‡ç½®</Button><Button onClick={() => setResetOpen(false)}>å–æ¶ˆ</Button></Space>
        </Form>
      </Modal>

      <Modal
        className="responsive-modal user-permission-modal"
        title={`æƒé™è¯¦æƒ…${permissionUser ? `ï¼š${formatPersonName(permissionUser.name)}` : ""}`}
        open={Boolean(permissionUser)}
        onCancel={() => setPermissionUser(null)}
        footer={<Button onClick={() => setPermissionUser(null)}>å…³é—­</Button>}
        width={720}
      >
        {permissionUser ? (
          <div className="permission-audit">
            <div className="permission-audit-head">
              <div>
                <Typography.Text type="secondary">è´¦å·</Typography.Text>
                <h3>{formatAccountName(permissionUser.username)}</h3>
              </div>
              <div>
                <Typography.Text type="secondary">è§’è‰²</Typography.Text>
                <h3>{formatOrgName(permissionUser.role_name) || "æœªç»‘å®šè§’è‰²"}</h3>
              </div>
              <div>
                <Typography.Text type="secondary">æ•°æ®èŒƒå›´</Typography.Text>
                <h3>{dataScopeLabel[permissionUser.role_data_scope || ""] || "æœªè®¾ç½®"}</h3>
              </div>
            </div>
            <div className="permission-audit-meta">
              <Tag>éƒ¨é—¨ï¼š{formatOrgName(permissionUser.department_name) || "æœªç»‘å®š"}</Tag>
              <Tag>å¯è§é—¨åº—ï¼š{storeScopeText(permissionUser)}</Tag>
              <Tag color={permissionUser.status === "active" ? "green" : "default"}>{permissionUser.status === "active" ? "å¯ç”¨" : "åœç”¨"}</Tag>
            </div>
            <Table
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={permissionModules.map((item) => ({
                key: item.key,
                module: item.label,
                permission: effectivePermission(permissionUser.role_permissions, item.key)
              }))}
              columns={[
                { title: "æ¨¡å—", dataIndex: "module" },
                {
                  title: "æƒé™",
                  dataIndex: "permission",
                  render: (value: RolePermissionValue) => <Tag color={permissionColor[value]}>{permissionLabel[value]}</Tag>
                }
              ]}
            />
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function renderPermissionSummary(permissions?: PermissionMap) {
  if (!permissions) return <Tag>æœªç»‘å®š</Tag>;
  const manageCount = permissionModules.filter((item) => permissions[item.key] === "manage").length;
  const readCount = permissionModules.filter((item) => permissions[item.key] === "read").length;
  const activeCount = permissionModules.filter((item) => permissions[item.key] && permissions[item.key] !== "none").length;
  if (permissions.system === "manage") return <Tag color="gold">ç³»ç»Ÿç®¡ç†</Tag>;
  return (
    <Space size={[4, 4]} wrap>
      <Tag color="green">ç®¡ç† {manageCount}</Tag>
      <Tag color="blue">åªè¯» {readCount}</Tag>
      <Tag>å¯ç”¨ {activeCount}</Tag>
    </Space>
  );
}

function effectivePermission(permissions: PermissionMap | undefined, module: string): RolePermissionValue {
  if (!permissions) return "none";
  if (permissions.system === "manage") return "manage";
  return permissions[module] || "none";
}

function getDepartmentRoleGuide(hasDepartment: boolean, roleCount: number) {
  if (!hasDepartment) {
    return {
      title: "å…ˆé€‰éƒ¨é—¨ï¼Œå†é€‰è§’è‰²",
      description: "æœªé€‰æ‹©éƒ¨é—¨æ—¶ä¸å¼€æ”¾è§’è‰²å’Œå¯è§é—¨åº—é…ç½®ï¼Œé¿å…äººå‘˜æƒé™å½’å±žä¸æ¸…ã€‚"
    };
  }
  if (!roleCount) {
    return {
      title: "è¯¥éƒ¨é—¨è¿˜æ²¡æœ‰é…ç½®å¯åˆ†é…è§’è‰²",
      description: "è¯·å…ˆåˆ°ç»„ç»‡æž¶æž„é¡µä¸ºè¯¥éƒ¨é—¨é…ç½®å¯ç”¨è§’è‰²ï¼Œå†å›žæ¥æ–°å¢žæˆ–ç¼–è¾‘äººå‘˜ã€‚"
    };
  }
  return {
    title: `å·²é€‰æ‹©éƒ¨é—¨ï¼Œå¯åˆ†é… ${roleCount} ä¸ªè§’è‰²`,
    description: "è§’è‰²å†³å®šæ¨¡å—æƒé™å’Œæ•°æ®èŒƒå›´ï¼›éƒ¨é—¨å†³å®šäººå‘˜å½’å±žå’ŒåŽç»­éƒ¨é—¨ç®¡ç†ã€‚"
  };
}

function getStoreScopeHint(role: OptionRecord | null) {
  if (!role) {
    return {
      title: "å…ˆé€‰æ‹©è§’è‰²ï¼Œå†é…ç½®é—¨åº—èŒƒå›´",
      description: "è§’è‰²å†³å®šæ•°æ®èŒƒå›´ï¼›æœªé€‰æ‹©è§’è‰²æ—¶ä¸éœ€è¦é…ç½®å¯è§é—¨åº—ã€‚",
      placeholder: "è¯·å…ˆé€‰æ‹©è§’è‰²"
    };
  }
  const scope = role.data_scope || "all";
  if (scope === "all") {
    return {
      title: "è¯¥è§’è‰²å¯æŸ¥çœ‹å…¨éƒ¨é—¨åº—",
      description: "å…¨éƒ¨æ•°æ®è§’è‰²ä¸éœ€è¦å•ç‹¬é…ç½®å¯è§é—¨åº—ï¼Œä¿å­˜æ—¶ç³»ç»Ÿä¼šè‡ªåŠ¨æ¸…ç©ºé—¨åº—èŒƒå›´ã€‚",
      placeholder: "å…¨éƒ¨é—¨åº—è‡ªåŠ¨å¯è§"
    };
  }
  if (scope === "single_store") {
    return {
      title: "è¯¥è§’è‰²å¿…é¡»ç»‘å®š 1 å®¶é—¨åº—",
      description: "åº—é•¿æˆ–å•åº—è´Ÿè´£äººåªèƒ½çœ‹åˆ°æ‰€ç»‘å®šé—¨åº—çš„æ•°æ®å’Œä»»åŠ¡ã€‚",
      placeholder: "è¯·é€‰æ‹© 1 å®¶é—¨åº—"
    };
  }
  if (scope === "multi_store") {
    return {
      title: "ç£å¯¼/åŒºåŸŸè´Ÿè´£äººéœ€ç»‘å®šå¤šå®¶ç®¡è¾–é—¨åº—",
      description: "ç£å¯¼å·¥ä½œå°ã€ä»»åŠ¡ã€é¢„è­¦ã€èˆ†æƒ…ã€ç¤¾åª’å†…å®¹å’Œæ—¥æŠ¥ä¼šæŒ‰è¿™é‡Œé€‰æ‹©çš„é—¨åº—è¿‡æ»¤ã€‚",
      placeholder: "é€‰æ‹©ç£å¯¼è´Ÿè´£çš„å¤šå®¶é—¨åº—"
    };
  }
  if (scope === "dept") {
    return {
      title: "æœ¬éƒ¨é—¨è§’è‰²ä»éœ€è¦é…ç½®å¯è§é—¨åº—",
      description: "å½“å‰åŽç«¯æŒ‰å¯è§é—¨åº—é›†åˆè¿‡æ»¤ç»è¥æ•°æ®ï¼›éƒ¨é—¨ç”¨äºŽç»„ç»‡å½’å±žå’Œäººå‘˜ç®¡ç†ã€‚",
      placeholder: "é€‰æ‹©è¯¥éƒ¨é—¨äººå‘˜å¯æŸ¥çœ‹çš„é—¨åº—"
    };
  }
  return {
    title: `${dataScopeLabel[scope] || "å—é™èŒƒå›´"}è§’è‰²éœ€è¦é…ç½®å¯è§é—¨åº—`,
    description: "ç£å¯¼ã€åŒºåŸŸã€æ¸ é“ã€åŠ ç›Ÿå•†ç­‰éžå…¨é‡è§’è‰²ï¼Œç»è¥æ•°æ®ä¼šæŒ‰è¿™é‡Œé€‰æ‹©çš„é—¨åº—è¿‡æ»¤ã€‚",
    placeholder: "é€‰æ‹©è¯¥äººå‘˜å¯æŸ¥çœ‹çš„é—¨åº—"
  };
}

function storeScopeText(record: UserRecord) {
  if (record.role_data_scope === "all") return "å…¨éƒ¨é—¨åº—";
  if (record.store_scope_names?.length) return record.store_scope_names.map(formatStoreName).join("ã€");
  if (!record.role_id) return "æœªç»‘å®šè§’è‰²";
  return "æœªé…ç½®";
}

function renderStoreScope(record: UserRecord) {
  if (record.role_data_scope === "all") return <Tag color="gold">å…¨éƒ¨é—¨åº—</Tag>;
  if (record.store_scope_names?.length) return record.store_scope_names.map(formatStoreName).join("ã€");
  return <Tag color="red">æœªé…ç½®</Tag>;
}

