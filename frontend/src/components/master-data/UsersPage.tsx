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
  all: "全部数据",
  region: "区域门店",
  multi_store: "多门店管辖",
  own_stores: "负责门店",
  single_store: "单门店",
  channel: "渠道",
  dept: "本部门"
};

const permissionModules = rolePermissionModules;
const permissionLabel = permissionValueLabel;
const permissionColor = permissionValueColor;

function formatPersonName(value?: string | null) {
  if (!value) return "-";
  if (/Supervisor Scope Smoke/i.test(value)) return "验收督导账号";
  if (/Scope Smoke/i.test(value)) return "验收账号";
  return value;
}

function formatAccountName(value?: string | null) {
  if (!value) return "-";
  if (value === "admin") return "系统管理员账号";
  if (/^tmp_supervisor_/i.test(value)) return "验收督导账号";
  if (/^accept_store_manager$/i.test(value)) return "验收店长账号";
  if (/^accept_supervisor$/i.test(value)) return "验收督导账号";
  if (/^accept_warehouse$/i.test(value)) return "验收仓管账号";
  if (/^accept_ops_director$/i.test(value)) return "验收运营账号";
  return value;
}

function formatOrgName(value?: string | null) {
  if (!value) return "-";
  if (/^TMP-SUPERVISOR-DEPT/i.test(value)) return "验收督导部门";
  if (/^TMP-SUPERVISOR-/i.test(value)) return "验收督导角色";
  if (/Supervisor Scope Smoke/i.test(value)) return "验收督导角色";
  return value;
}

function formatStoreName(value?: string | null) {
  if (!value) return "未命名门店";
  if (/^Scope Store/i.test(value)) return "测试门店";
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
    ? "请先选择部门"
    : assignableRoles.length
      ? "选择该部门下可分配的角色"
      : "该部门暂无可用角色,请先到组织架构配置";
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
    return [departmentName ? `部门:${departmentName}` : "", roleName ? `角色:${roleName}` : ""].filter(Boolean).join(" / ");
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
          message.warning("门店范围数据加载失败,人员列表仍可查看,请检查当前账号的门店读取权限");
        }
      }
      setUsers(userRes.data);
      setRoles(roleRes.data);
      setDepartments(deptRes.data);
      setStores(storeData);
    } catch {
      message.error("人员数据加载失败,请确认后端服务和登录状态");
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
      message.error("该部门可分配角色加载失败,请到组织架构检查部门角色配置");
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
      message.success("人员信息已更新");
    } else {
      const res = await api.post("/api/v1/org/users", userPayload);
      userId = res.data.id;
      message.success("人员已创建");
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
    message.success("密码已重置");
    setResetOpen(false);
    resetForm.resetFields();
  }

  return (
    <>
      <Card
        className="panel-card"
        title={
          <Space wrap>
            <span>人员列表</span>
            {filterLabel ? <Tag color="blue">{filterLabel}</Tag> : null}
            <Tag>{filteredUsers.length} / {users.length}</Tag>
          </Space>
        }
        extra={canManageUsers ? <Button type="primary" onClick={startCreate}>新增人员</Button> : null}
      >
        <Table
          loading={loading}
          rowKey="id"
          dataSource={filteredUsers}
          scroll={{ x: 1280 }}
          locale={{ emptyText: filterLabel ? "该筛选条件下暂无人员,请新增人员或编辑已有人员分配角色。" : "暂无人员" }}
          columns={[
            { title: "姓名", dataIndex: "name", width: 120, render: (value: string) => formatPersonName(value) },
            { title: "账号", dataIndex: "username", width: 150, render: formatAccountName },
            { title: "部门", dataIndex: "department_name", width: 140, render: (value: string) => formatOrgName(value) },
            { title: "角色", dataIndex: "role_name", width: 170, render: (value: string) => formatOrgName(value) },
            {
              title: "数据范围",
              dataIndex: "role_data_scope",
              width: 110,
              render: (value: string) => <Tag color={value === "all" ? "gold" : "blue"}>{dataScopeLabel[value] || "未设置"}</Tag>
            },
            {
              title: "权限摘要",
              dataIndex: "role_permissions",
              width: 160,
              render: (value: PermissionMap | undefined) => renderPermissionSummary(value)
            },
            {
              title: "可见门店",
              dataIndex: "store_scope_names",
              width: 160,
              render: (_: string[], record: UserRecord) => renderStoreScope(record)
            },
            { title: "手机号", dataIndex: "phone", width: 140 },
            {
              title: "通知渠道",
              dataIndex: "default_channel",
              width: 110,
              render: (value: string) => {
                const channel = normalizeNotificationChannel(value);
                const label: Record<string, string> = { system: "系统内" };
                const color: Record<string, string> = { system: "default" };
                return <Tag color={color[channel] || "default"}>{label[channel]}</Tag>;
              }
            },
            { title: "状态", dataIndex: "status", width: 90, render: (status: string) => <Tag color={status === "active" ? "green" : "default"}>{status === "active" ? "启用" : "停用"}</Tag> },
            {
              title: "操作",
              width: 210,
              fixed: "right",
              render: (_: unknown, record: UserRecord) => (
                <Space>
                  {canManageUsers ? (
                    <>
                      <Button type="link" onClick={() => setPermissionUser(record)}>权限详情</Button>
                      <Button type="link" onClick={() => startEdit(record)}>编辑</Button>
                      <Button
                        type="link"
                        onClick={() => {
                          setResetUser(record);
                          resetForm.resetFields();
                          setResetOpen(true);
                        }}
                      >
                        重置密码
                      </Button>
                    </>
                  ) : (
                    <Button type="link" onClick={() => setPermissionUser(record)}>查看权限</Button>
                  )}
                </Space>
              )
            }
          ]}
        />
      </Card>

      <Modal className="responsive-modal user-form-modal" title={editing ? "编辑人员" : "新增人员"} open={open} onCancel={() => setOpen(false)} footer={null} forceRender>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: "请输入姓名" }]}><Input /></Form.Item>
          {!editing && (
            <>
              <Form.Item name="username" label="登录账号" rules={[{ required: true, message: "请输入账号" }]}><Input /></Form.Item>
              <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 8, message: "至少 8 位" }]}><Input.Password /></Form.Item>
            </>
          )}
          <Form.Item name="phone" label="手机号"><Input placeholder="用于人员档案和后续短信能力预留" /></Form.Item>
          <Form.Item name="default_channel" label="默认通知渠道" initialValue="system">
            <Select
              options={[
                { value: "system", label: "系统内通知" }
              ]}
            />
          </Form.Item>
          <Form.Item name="department_id" label="部门" rules={[{ required: true, message: "请先选择部门" }]}>
            <Select
              allowClear
              onChange={handleDepartmentChange}
              placeholder="先选择人员所属部门"
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          </Form.Item>
          <Form.Item name="role_id" label="角色" rules={[{ required: true, message: "请选择该部门下可分配的角色" }]}>
            <Select
              allowClear
              disabled={roleSelectDisabled}
              onChange={handleRoleChange}
              placeholder={rolePlaceholder}
              options={assignableRoles.map((r) => ({
                value: r.id,
                label: `${formatOrgName(r.name)}${r.data_scope ? ` · ${dataScopeLabel[r.data_scope] || r.data_scope}` : ""}`
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
            label="可见门店"
            rules={[
              {
                validator: (_, value: string[] = []) => {
                  if (!selectedFormRole || selectedFormScope === "all") return Promise.resolve();
                  if (selectedFormScope === "single_store" && value.length !== 1) {
                    return Promise.reject(new Error("单门店角色必须选择 1 家门店"));
                  }
                  if (!value.length) {
                    return Promise.reject(new Error("该角色需要配置至少 1 家可见门店"));
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
            <Form.Item name="status" label="状态">
              <Select options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} />
            </Form.Item>
          )}
          <Space className="modal-action-row"><Button type="primary" htmlType="submit" disabled={!canManageUsers}>保存</Button><Button onClick={() => setOpen(false)}>取消</Button></Space>
        </Form>
      </Modal>

      <Modal className="responsive-modal user-form-modal" title={`重置密码${resetUser ? `:${formatPersonName(resetUser.name)}` : ""}`} open={resetOpen} onCancel={() => setResetOpen(false)} footer={null} forceRender>
        <Form form={resetForm} layout="vertical" onFinish={resetPassword}>
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 8, message: "至少 8 位" }]}><Input.Password /></Form.Item>
          <Space className="modal-action-row"><Button type="primary" htmlType="submit" disabled={!canManageUsers}>确认重置</Button><Button onClick={() => setResetOpen(false)}>取消</Button></Space>
        </Form>
      </Modal>

      <Modal
        className="responsive-modal user-permission-modal"
        title={`权限详情${permissionUser ? `:${formatPersonName(permissionUser.name)}` : ""}`}
        open={Boolean(permissionUser)}
        onCancel={() => setPermissionUser(null)}
        footer={<Button onClick={() => setPermissionUser(null)}>关闭</Button>}
        width={720}
      >
        {permissionUser ? (
          <div className="permission-audit">
            <div className="permission-audit-head">
              <div>
                <Typography.Text type="secondary">账号</Typography.Text>
                <h3>{formatAccountName(permissionUser.username)}</h3>
              </div>
              <div>
                <Typography.Text type="secondary">角色</Typography.Text>
                <h3>{formatOrgName(permissionUser.role_name) || "未绑定角色"}</h3>
              </div>
              <div>
                <Typography.Text type="secondary">数据范围</Typography.Text>
                <h3>{dataScopeLabel[permissionUser.role_data_scope || ""] || "未设置"}</h3>
              </div>
            </div>
            <div className="permission-audit-meta">
              <Tag>部门:{formatOrgName(permissionUser.department_name) || "未绑定"}</Tag>
              <Tag>可见门店:{storeScopeText(permissionUser)}</Tag>
              <Tag color={permissionUser.status === "active" ? "green" : "default"}>{permissionUser.status === "active" ? "启用" : "停用"}</Tag>
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
                { title: "模块", dataIndex: "module" },
                {
                  title: "权限",
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
  if (!permissions) return <Tag>未绑定</Tag>;
  const manageCount = permissionModules.filter((item) => permissions[item.key] === "manage").length;
  const readCount = permissionModules.filter((item) => permissions[item.key] === "read").length;
  const activeCount = permissionModules.filter((item) => permissions[item.key] && permissions[item.key] !== "none").length;
  if (permissions.system === "manage") return <Tag color="gold">系统管理</Tag>;
  return (
    <Space size={[4, 4]} wrap>
      <Tag color="green">管理 {manageCount}</Tag>
      <Tag color="blue">只读 {readCount}</Tag>
      <Tag>启用 {activeCount}</Tag>
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
      title: "先选部门,再选角色",
      description: "未选择部门时不开放角色和可见门店配置,避免人员权限归属不清。"
    };
  }
  if (!roleCount) {
    return {
      title: "该部门还没有配置可分配角色",
      description: "请先到组织架构页为该部门配置可用角色,再回来新增或编辑人员。"
    };
  }
  return {
    title: `已选择部门,可分配 ${roleCount} 个角色`,
    description: "角色决定模块权限和数据范围;部门决定人员归属和后续部门管理。"
  };
}

function getStoreScopeHint(role: OptionRecord | null) {
  if (!role) {
    return {
      title: "先选择角色,再配置门店范围",
      description: "角色决定数据范围;未选择角色时不需要配置可见门店。",
      placeholder: "请先选择角色"
    };
  }
  const scope = role.data_scope || "all";
  if (scope === "all") {
    return {
      title: "该角色可查看全部门店",
      description: "全部数据角色不需要单独配置可见门店,保存时系统会自动清空门店范围。",
      placeholder: "全部门店自动可见"
    };
  }
  if (scope === "single_store") {
    return {
      title: "该角色必须绑定 1 家门店",
      description: "店长或单店负责人只能看到所绑定门店的数据和任务。",
      placeholder: "请选择 1 家门店"
    };
  }
  if (scope === "multi_store") {
    return {
      title: "督导/区域负责人需绑定多家管辖门店",
      description: "督导工作台、任务、预警、舆情、社媒内容和日报会按这里选择的门店过滤。",
      placeholder: "选择督导负责的多家门店"
    };
  }
  if (scope === "dept") {
    return {
      title: "本部门角色仍需要配置可见门店",
      description: "当前后端按可见门店集合过滤经营数据;部门用于组织归属和人员管理。",
      placeholder: "选择该部门人员可查看的门店"
    };
  }
  return {
    title: `${dataScopeLabel[scope] || "受限范围"}角色需要配置可见门店`,
    description: "督导、区域、渠道、加盟商等非全量角色,经营数据会按这里选择的门店过滤。",
    placeholder: "选择该人员可查看的门店"
  };
}

function storeScopeText(record: UserRecord) {
  if (record.role_data_scope === "all") return "全部门店";
  if (record.store_scope_names?.length) return record.store_scope_names.map(formatStoreName).join("、");
  if (!record.role_id) return "未绑定角色";
  return "未配置";
}

function renderStoreScope(record: UserRecord) {
  if (record.role_data_scope === "all") return <Tag color="gold">全部门店</Tag>;
  if (record.store_scope_names?.length) return record.store_scope_names.map(formatStoreName).join("、");
  return <Tag color="red">未配置</Tag>;
}

