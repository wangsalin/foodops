"use client";

import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Tree,
  Typography
} from "antd";
import type { DataNode } from "antd/es/tree";
import {
  ApartmentOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserSwitchOutlined
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { hasPermission, readStoredPermissions } from "@/lib/permissions";
import {
  createDefaultRolePermissions,
  permissionValueColor,
  permissionValueLabel,
  rolePermissionModules,
  type RolePermissionValue
} from "@/lib/permission-modules";

type Department = {
  id: string;
  name: string;
  parent_id?: string | null;
  type?: string;
  sort?: number;
};

type Role = {
  id: string;
  name: string;
  description?: string;
  data_scope?: string;
  permissions?: Record<string, RolePermissionValue>;
  is_default?: boolean;
};

type UserRecord = {
  id: string;
  name: string;
  username: string;
  phone?: string;
  role_id?: string;
  role_name?: string;
  department_id?: string;
  department_name?: string;
  status: string;
  store_scope_names?: string[];
  default_channel?: string;
};

type DepartmentFormValues = {
  name: string;
  parent_id?: string | null;
  type?: string;
  sort?: number;
};

type RoleFormValues = {
  name: string;
  description?: string;
  data_scope: string;
  permissions: Record<string, RolePermissionValue>;
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

const dataScopeHint: Record<string, string> = {
  all: "可查看当前租户下全部经营数据,适合总部管理层。",
  region: "预留区域维度,适合后续按行政区、城市或加盟区域自动授权。",
  multi_store: "按人员绑定的门店集合生效,适合督导、区域负责人和多店店长。",
  own_stores: "结合用户可见门店范围生效,适合加盟商或门店负责人。",
  single_store: "预留单门店视角,适合单店负责人。",
  channel: "预留渠道维度,适合渠道运营。",
  dept: "按部门边界限制组织数据。"
};

const permissionModules = rolePermissionModules;
const permissionLabel = permissionValueLabel;
const permissionColor = permissionValueColor;
const defaultPermissions = createDefaultRolePermissions();

function formatOrgText(value?: string | null) {
  if (!value) return "";
  return value
    .replace(/TMP-SUPERVISOR-DEPT-[A-Z0-9-]+/gi, "验收督导部门")
    .replace(/TMP-SUPERVISOR-[^-\\s]+-[A-Z0-9-]+/gi, "验收督导角色")
    .replace(/Supervisor Scope Smoke/gi, "验收督导账号")
    .replace(/\bSupervisor\b/gi, "督导")
    .replace(/Scope Smoke/gi, "验收范围")
    .replace(/Scope Store/gi, "测试门店")
    .replace(/\bScope\b/g, "范围")
    .replace(/\bSmoke\b/g, "验收")
    .replace(/\bSprint\b/g, "阶段")
    .replace(/\badmin\b/gi, "系统管理员")
    .replace(/\brole\b/gi, "角色")
    .replace(/\bscoped\b/gi, "受限范围")
    .replace(/\bsmoke\b/gi, "验收");
}

function formatOrgNames(values?: string[]) {
  return values?.length ? values.map(formatOrgText).join("、") : "未绑定";
}

function formatOrgAccount(value?: string | null) {
  if (!value) return "-";
  if (value === "admin") return "系统管理员账号";
  if (/^tmp_supervisor_/i.test(value)) return "验收督导账号";
  return value;
}

export function OrgPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departmentRoleIds, setDepartmentRoleIds] = useState<Record<string, string[]>>({});
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [deptRoleOpen, setDeptRoleOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState(() => readStoredPermissions());
  const [deptForm] = Form.useForm<DepartmentFormValues>();
  const [deptRoleForm] = Form.useForm<{ role_ids: string[] }>();
  const [roleForm] = Form.useForm<RoleFormValues>();
  const { message } = App.useApp();
  const canManageUsers = hasPermission(permissions, "users", "manage");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [deptRes, roleRes, userRes] = await Promise.all([
        api.get("/api/v1/org/departments"),
        api.get("/api/v1/org/roles"),
        api.get("/api/v1/org/users")
      ]);
      const roleLinkEntries = await Promise.all(
        deptRes.data.map(async (department: Department) => {
          try {
            const res = await api.get(`/api/v1/org/departments/${department.id}/roles`);
            return [department.id, res.data.map((role: Role) => role.id)] as const;
          } catch {
            return [department.id, []] as const;
          }
        })
      );
      setDepartments(deptRes.data);
      setRoles(roleRes.data);
      setUsers(userRes.data);
      setDepartmentRoleIds(Object.fromEntries(roleLinkEntries));
      setSelectedDepartmentId((current) => current || deptRes.data[0]?.id || null);
      setSelectedRoleId((current) => current || roleRes.data[0]?.id || null);
    } catch {
      message.error("组织架构加载失败,请确认后端服务和登录状态");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    setPermissions(readStoredPermissions());
    load();
  }, [load]);

  const departmentById = useMemo(() => new Map(departments.map((item) => [item.id, item])), [departments]);
  const usersByDepartment = useMemo(() => groupUsers(users, "department_id"), [users]);
  const usersByRole = useMemo(() => groupUsers(users, "role_id"), [users]);
  const selectedDepartment = selectedDepartmentId ? departmentById.get(selectedDepartmentId) || null : null;
  const selectedRole = selectedRoleId ? roles.find((item) => item.id === selectedRoleId) || null : null;
  const selectedDepartmentUsers = selectedDepartmentId ? usersByDepartment.get(selectedDepartmentId) || [] : [];
  const selectedRoleUsers = selectedRoleId ? usersByRole.get(selectedRoleId) || [] : [];
  const selectedDepartmentRoleIds = useMemo(
    () => selectedDepartmentId ? departmentRoleIds[selectedDepartmentId] || [] : [],
    [departmentRoleIds, selectedDepartmentId]
  );
  const selectedDepartmentRoles = useMemo(
    () => roles.filter((role) => selectedDepartmentRoleIds.includes(role.id)),
    [roles, selectedDepartmentRoleIds]
  );
  const departmentTree = useMemo(() => buildDepartmentTree(departments, usersByDepartment), [departments, usersByDepartment]);

  const orgStats = useMemo(() => {
    const activeUsers = users.filter((item) => item.status === "active").length;
    const unassignedUsers = users.filter((item) => !item.department_id || !item.role_id).length;
    const systemRoles = roles.filter((role) => role.permissions?.system === "manage").length;
    return {
      departments: departments.length,
      roles: roles.length,
      users: users.length,
      activeUsers,
      unassignedUsers,
      systemRoles
    };
  }, [departments, roles, users]);

  function openCreateDepartment(parentId?: string | null) {
    setEditingDepartment(null);
    deptForm.setFieldsValue({ name: "", parent_id: parentId || selectedDepartmentId || null, type: "dept", sort: 0 });
    setDeptOpen(true);
  }

  function openEditDepartment(record: Department) {
    setEditingDepartment(record);
    deptForm.setFieldsValue({
      name: record.name,
      parent_id: record.parent_id || null,
      type: record.type || "dept",
      sort: record.sort || 0
    });
    setDeptOpen(true);
  }

  async function submitDepartment(values: DepartmentFormValues) {
    const payload = {
      ...values,
      parent_id: values.parent_id || null,
      type: values.type || "dept",
      sort: values.sort ?? 0
    };
    try {
      if (editingDepartment) {
        await api.put(`/api/v1/org/departments/${editingDepartment.id}`, payload);
        message.success("部门已更新");
      } else {
        const res = await api.post("/api/v1/org/departments", payload);
        setSelectedDepartmentId(res.data.id);
        message.success("部门已创建");
      }
      setDeptOpen(false);
      deptForm.resetFields();
      await load();
    } catch {
      message.error("部门保存失败,请检查名称和上级部门");
    }
  }

  async function deleteDepartment(record: Department) {
    try {
      await api.delete(`/api/v1/org/departments/${record.id}`);
      message.success("部门已删除");
      setSelectedDepartmentId(null);
      await load();
    } catch {
      message.error("部门删除失败:请先移走下级部门或部门人员");
    }
  }

  function openDepartmentRoleConfig() {
    if (!selectedDepartment) return;
    deptRoleForm.setFieldsValue({ role_ids: selectedDepartmentRoleIds });
    setDeptRoleOpen(true);
  }

  async function submitDepartmentRoles(values: { role_ids: string[] }) {
    if (!selectedDepartment) return;
    try {
      const roleIds = values.role_ids || [];
      const res = await api.put(`/api/v1/org/departments/${selectedDepartment.id}/roles`, {
        role_ids: roleIds,
        default_role_id: roleIds[0] || null
      });
      setDepartmentRoleIds((current) => ({
        ...current,
        [selectedDepartment.id]: res.data.map((role: Role) => role.id)
      }));
      message.success("部门可用角色已更新");
      setDeptRoleOpen(false);
      deptRoleForm.resetFields();
    } catch {
      message.error("部门角色保存失败:请保留该部门已有人员正在使用的角色");
    }
  }

  function startCreateRole() {
    setEditingRole(null);
    roleForm.setFieldsValue({
      name: "",
      description: "",
      data_scope: "all",
      permissions: { ...defaultPermissions }
    });
    setRoleOpen(true);
  }

  function startEditRole(record: Role) {
    setEditingRole(record);
    roleForm.setFieldsValue({
      name: record.name,
      description: record.description,
      data_scope: record.data_scope || "all",
      permissions: { ...defaultPermissions, ...(record.permissions || {}) }
    });
    setSelectedRoleId(record.id);
    setRoleOpen(true);
  }

  async function copyRole(record: Role) {
    try {
      const res = await api.post("/api/v1/org/roles", {
        name: `${record.name} 副本`,
        description: record.description || "",
        data_scope: record.data_scope || "all",
        permissions: { ...defaultPermissions, ...(record.permissions || {}) }
      });
      setSelectedRoleId(res.data.id);
      message.success("角色副本已创建");
      await load();
    } catch {
      message.error("角色复制失败,请确认名称未重复");
    }
  }

  async function deleteRole(record: Role) {
    try {
      await api.delete(`/api/v1/org/roles/${record.id}`);
      message.success("角色已删除");
      setSelectedRoleId(null);
      await load();
    } catch {
      message.error("角色删除失败:请先移除该角色下的人员");
    }
  }

  async function submitRole(values: RoleFormValues) {
    const payload = {
      ...values,
      permissions: { ...defaultPermissions, ...(values.permissions || {}) }
    };
    try {
      if (editingRole) {
        await api.put(`/api/v1/org/roles/${editingRole.id}`, payload);
        message.success("角色权限已更新,用户重新登录后生效");
      } else {
        const res = await api.post("/api/v1/org/roles", payload);
        setSelectedRoleId(res.data.id);
        message.success("角色已创建");
      }
      setRoleOpen(false);
      roleForm.resetFields();
      await load();
    } catch {
      message.error("角色保存失败,请检查名称、权限和数据范围");
    }
  }

  function openRoleUsers(role: Role) {
    router.push(`/system/users?role_id=${role.id}`);
  }

  return (
    <main className="org-page">
      <section className="flow-band">
        <div>
          <span className="flow-kicker">组织权限</span>
          <div className="flow-title">组织树、角色权限和人员影响面统一维护</div>
          <div className="flow-text">部门决定人员归属,角色决定模块权限和数据范围。编辑角色前可直接查看会影响哪些账号。</div>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
          {canManageUsers ? <Button icon={<PlusOutlined />} onClick={() => openCreateDepartment(null)}>新增部门</Button> : null}
          {canManageUsers ? <Button type="primary" icon={<UserSwitchOutlined />} onClick={startCreateRole}>新增角色</Button> : null}
        </Space>
      </section>

      <div className="org-metric-grid">
        <OrgMetric label="部门" value={orgStats.departments} hint="含总部、部门和小组" />
        <OrgMetric label="角色" value={orgStats.roles} hint={`${orgStats.systemRoles} 个系统管理角色`} />
        <OrgMetric label="人员" value={orgStats.users} hint={`${orgStats.activeUsers} 个启用账号`} />
        <OrgMetric label="待完善" value={orgStats.unassignedUsers} hint="未绑定部门或角色" danger={orgStats.unassignedUsers > 0} />
      </div>

      <section className="org-workbench">
        <Card
          className="panel-card org-tree-card"
          title="组织树"
          loading={loading}
          extra={canManageUsers ? <Button size="small" icon={<PlusOutlined />} onClick={() => openCreateDepartment(selectedDepartmentId)}>下级部门</Button> : null}
        >
          {departments.length ? (
            <Tree
              blockNode
              defaultExpandAll
              selectedKeys={selectedDepartmentId ? [selectedDepartmentId] : []}
              treeData={departmentTree}
              onSelect={(keys) => setSelectedDepartmentId(String(keys[0] || ""))}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有部门">
              {canManageUsers ? <Button type="primary" onClick={() => openCreateDepartment(null)}>新增部门</Button> : null}
            </Empty>
          )}
        </Card>

        <Card
          className="panel-card org-detail-card"
          title="部门详情"
          loading={loading}
          extra={
            selectedDepartment && canManageUsers ? (
              <Space>
                <Button icon={<EditOutlined />} onClick={() => openEditDepartment(selectedDepartment)}>编辑</Button>
                <Popconfirm
                  title="删除部门"
                  description="仅空部门可删除。已有下级或人员时请先调整归属。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => deleteDepartment(selectedDepartment)}
                >
                  <Button danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              </Space>
            ) : null
          }
        >
          {selectedDepartment ? (
            <div className="org-detail-stack">
              <div className="org-detail-hero">
                <div className="org-detail-icon"><ApartmentOutlined /></div>
                <div>
                  <Typography.Text type="secondary">{selectedDepartment.type === "team" ? "小组" : "部门"}</Typography.Text>
                  <h3>{formatOrgText(selectedDepartment.name)}</h3>
                  <p>上级:{selectedDepartment.parent_id ? formatOrgText(departmentById.get(selectedDepartment.parent_id)?.name) || "未找到上级" : "顶级组织"}</p>
                </div>
              </div>
              <div className="org-info-grid">
                <div><span>直属人员</span><b>{selectedDepartmentUsers.length}</b></div>
                <div><span>下级部门</span><b>{departments.filter((item) => item.parent_id === selectedDepartment.id).length}</b></div>
                <div><span>可用角色</span><b>{selectedDepartmentRoleIds.length}</b></div>
                <div><span>排序</span><b>{selectedDepartment.sort ?? 0}</b></div>
                <div><span>人员入口</span><Button type="link" onClick={() => router.push(`/system/users?department_id=${selectedDepartment.id}`)}>查看人员</Button></div>
              </div>
              <div className="department-role-panel">
                <div>
                  <b>部门可用角色</b>
                  <span>人员新增或编辑时,只能选择当前部门已开放的角色。</span>
                </div>
                <Space wrap className="department-role-tags">
                  {selectedDepartmentRoles.length ? (
                    selectedDepartmentRoles.map((role) => (
                      <Tag key={role.id} color={role.data_scope === "all" ? "gold" : "blue"}>
                        {formatOrgText(role.name)} · {dataScopeLabel[role.data_scope || "all"] || role.data_scope}
                      </Tag>
                    ))
                  ) : (
                    <Tag color="red">未配置角色</Tag>
                  )}
                </Space>
                {canManageUsers ? (
                  <Button icon={<UserSwitchOutlined />} onClick={openDepartmentRoleConfig}>配置角色</Button>
                ) : null}
              </div>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={selectedDepartmentUsers}
                locale={{ emptyText: "该部门暂无人员" }}
                columns={[
                  { title: "姓名", dataIndex: "name", render: formatOrgText },
                  { title: "账号", dataIndex: "username", render: formatOrgAccount },
                  { title: "角色", dataIndex: "role_name", render: (value: string) => formatOrgText(value) || "未绑定" },
                  { title: "状态", dataIndex: "status", render: renderStatus }
                ]}
              />
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择一个部门" />
          )}
        </Card>
      </section>

      <section className="org-role-layout">
        <Card className="panel-card org-role-card" title="角色权限" loading={loading}>
          <div className="org-role-list">
            {roles.map((role) => {
              const roleUsers = usersByRole.get(role.id) || [];
              const active = role.id === selectedRoleId;
              return (
                <button
                  type="button"
                  className={`org-role-item${active ? " active" : ""}`}
                  key={role.id}
                  onClick={() => setSelectedRoleId(role.id)}
                >
                  <div>
                    <b>{formatOrgText(role.name)}</b>
                    <span>{formatOrgText(role.description) || "暂无说明"}</span>
                  </div>
                  <div className="org-role-side">
                    <Tag color={role.data_scope === "all" ? "gold" : "blue"}>{dataScopeLabel[role.data_scope || "all"] || role.data_scope}</Tag>
                    <em>{roleUsers.length} 人</em>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card
          className="panel-card org-impact-card"
          title="角色影响面"
          loading={loading}
          extra={
            selectedRole && canManageUsers ? (
              <Space wrap>
                <Button icon={<EditOutlined />} onClick={() => startEditRole(selectedRole)}>编辑</Button>
                <Button icon={<UserAddOutlined />} onClick={() => openRoleUsers(selectedRole)}>分配人员</Button>
                <Button icon={<CopyOutlined />} onClick={() => copyRole(selectedRole)}>复制</Button>
                <Popconfirm
                  title="删除角色"
                  description="仅未绑定人员的角色可删除。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => deleteRole(selectedRole)}
                >
                  <Button danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              </Space>
            ) : null
          }
        >
          {selectedRole ? (
            <div className="org-detail-stack">
              <div className="org-role-summary">
                <div>
                  <Typography.Text type="secondary">当前角色</Typography.Text>
                  <h3>{formatOrgText(selectedRole.name)}</h3>
                  <p>{formatOrgText(selectedRole.description) || dataScopeHint[selectedRole.data_scope || "all"]}</p>
                </div>
                <Tag color={selectedRole.data_scope === "all" ? "gold" : "blue"}>{dataScopeLabel[selectedRole.data_scope || "all"] || selectedRole.data_scope}</Tag>
              </div>
              <div className="org-assignment-guide">
                <div>
                  <b>人员绑定在人员权限页完成</b>
                  <span>这里定义角色能做什么;具体谁使用该角色、能看哪些门店,需要到人员权限页维护。</span>
                </div>
                <Space wrap>
                  {canManageUsers ? <Button type="primary" icon={<UserAddOutlined />} onClick={() => openRoleUsers(selectedRole)}>分配人员</Button> : null}
                  <Button onClick={() => openRoleUsers(selectedRole)}>查看绑定人员({selectedRoleUsers.length})</Button>
                </Space>
              </div>
              <div className="org-permission-tags">
                {permissionModules.map((item) => {
                  const value = selectedRole.permissions?.[item.key] || "none";
                  return (
                    <Tag key={item.key} color={permissionColor[value]}>
                      {item.label} · {permissionLabel[value]}
                    </Tag>
                  );
                })}
              </div>
              <Table
                size="small"
                rowKey="id"
                dataSource={selectedRoleUsers}
                pagination={{ pageSize: 5 }}
                locale={{ emptyText: "该角色暂无绑定人员" }}
                columns={[
                  { title: "姓名", dataIndex: "name", render: formatOrgText },
                  { title: "部门", dataIndex: "department_name", render: (value: string) => formatOrgText(value) || "未绑定" },
                  { title: "可见门店", dataIndex: "store_scope_names", render: formatOrgNames },
                  { title: "状态", dataIndex: "status", render: renderStatus }
                ]}
              />
              <div className="org-inline-actions">
                <Button onClick={() => openRoleUsers(selectedRole)}>查看该角色人员</Button>
              </div>
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择一个角色" />
          )}
        </Card>
      </section>

      <Modal
        title={editingDepartment ? `编辑部门:${formatOrgText(editingDepartment.name)}` : "新增部门"}
        open={deptOpen}
        onCancel={() => setDeptOpen(false)}
        footer={null}
        forceRender
        destroyOnHidden
      >
        <Form form={deptForm} layout="vertical" onFinish={submitDepartment} initialValues={{ type: "dept", sort: 0 }}>
          <Form.Item name="name" label="部门名称" rules={[{ required: true, message: "请输入部门名称" }]}>
            <Input placeholder="例如:华东运营部" />
          </Form.Item>
          <Form.Item name="parent_id" label="上级部门">
            <Select
              allowClear
              placeholder="不选择则为顶级组织"
              options={departments
                .filter((item) => item.id !== editingDepartment?.id)
                .map((item) => ({ value: item.id, label: formatOrgText(item.name) }))}
            />
          </Form.Item>
          <div className="role-form-grid">
            <Form.Item name="type" label="类型">
              <Select options={[{ value: "dept", label: "部门" }, { value: "team", label: "小组" }]} />
            </Form.Item>
            <Form.Item name="sort" label="排序">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Space>
            <Button type="primary" htmlType="submit" disabled={!canManageUsers}>保存</Button>
            <Button onClick={() => setDeptOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={`配置部门角色${selectedDepartment ? `:${formatOrgText(selectedDepartment.name)}` : ""}`}
        open={deptRoleOpen}
        onCancel={() => setDeptRoleOpen(false)}
        footer={null}
        forceRender
        destroyOnHidden
      >
        <Form form={deptRoleForm} layout="vertical" onFinish={submitDepartmentRoles}>
          <div className="department-role-modal-guide">
            <b>部门决定人员归属,角色决定权限边界</b>
            <span>只有在这里开放的角色,才会出现在人员新增/编辑表单的角色下拉中。</span>
          </div>
          <Form.Item
            name="role_ids"
            label="可分配角色"
            rules={[{ required: true, message: "请选择至少一个角色" }]}
          >
            <Select
              mode="multiple"
              placeholder="选择该部门可分配的角色"
              options={roles.map((role) => ({
                value: role.id,
                label: `${formatOrgText(role.name)} · ${dataScopeLabel[role.data_scope || "all"] || role.data_scope}`
              }))}
            />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" disabled={!canManageUsers}>保存部门角色</Button>
            <Button onClick={() => setDeptRoleOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={editingRole ? `编辑角色:${formatOrgText(editingRole.name)}` : "新增角色"}
        open={roleOpen}
        onCancel={() => setRoleOpen(false)}
        footer={null}
        width={760}
        forceRender
        destroyOnHidden
      >
        <Form form={roleForm} layout="vertical" onFinish={submitRole} initialValues={{ data_scope: "all", permissions: defaultPermissions }}>
          <div className="role-form-grid">
            <Form.Item name="name" label="角色名称" rules={[{ required: true, message: "请输入角色名称" }]}>
              <Input placeholder="例如:运营总监" />
            </Form.Item>
            <Form.Item name="data_scope" label="数据范围">
              <Select
                options={[
                  { value: "all", label: "全部数据" },
                  { value: "region", label: "区域门店" },
                  { value: "multi_store", label: "多门店管辖" },
                  { value: "own_stores", label: "负责门店" },
                  { value: "single_store", label: "单门店" },
                  { value: "channel", label: "渠道" },
                  { value: "dept", label: "本部门" }
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} placeholder="说明该角色的岗位边界和数据范围。" />
          </Form.Item>

          <div className="permission-editor">
            {permissionModules.map((item) => (
              <div className="permission-row" key={item.key}>
                <div>
                  <div className="risk-title">{item.label}</div>
                  <div className="risk-meta">{item.key}</div>
                </div>
                <Form.Item name={["permissions", item.key]} noStyle>
                  <Select
                    style={{ width: 128 }}
                    options={item.values.map((value) => ({
                      value,
                      label: permissionLabel[value]
                    }))}
                  />
                </Form.Item>
              </div>
            ))}
          </div>

          <Space style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit" disabled={!canManageUsers}>保存</Button>
            <Button onClick={() => setRoleOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>
    </main>
  );
}

function OrgMetric({ label, value, hint, danger }: { label: string; value: number; hint: string; danger?: boolean }) {
  return (
    <Card className={`metric-card panel-card${danger ? " org-metric-danger" : ""}`}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <div className="ai-big-number">{value}</div>
      <div className="metric-foot">{hint}</div>
    </Card>
  );
}

function groupUsers(users: UserRecord[], field: "department_id" | "role_id") {
  const result = new Map<string, UserRecord[]>();
  users.forEach((user) => {
    const key = user[field];
    if (!key) return;
    const list = result.get(key) || [];
    list.push(user);
    result.set(key, list);
  });
  return result;
}

function buildDepartmentTree(departments: Department[], usersByDepartment: Map<string, UserRecord[]>): DataNode[] {
  const childrenByParent = new Map<string, Department[]>();
  departments.forEach((department) => {
    const parentKey = department.parent_id || "__root__";
    const list = childrenByParent.get(parentKey) || [];
    list.push(department);
    childrenByParent.set(parentKey, list);
  });

  function build(parentKey: string): DataNode[] {
    return (childrenByParent.get(parentKey) || [])
      .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name))
      .map((department) => ({
        key: department.id,
        title: (
          <span className="org-tree-node">
            <span>{formatOrgText(department.name)}</span>
            <Tag>{usersByDepartment.get(department.id)?.length || 0}</Tag>
          </span>
        ),
        children: build(department.id)
      }));
  }

  return build("__root__");
}

function renderStatus(status: string) {
  return <Tag color={status === "active" ? "green" : "default"}>{status === "active" ? "启用" : "停用"}</Tag>;
}
