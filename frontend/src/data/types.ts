/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 门禁安防归属治理领域用到的账号与角色。 */
export type SecurityRole = '安防责任岗位' | '班组成员' | '外包巡检' | '运行管理员'

export type Operator = {
  id: string
  name: string
  role: SecurityRole
  /** 归属班组：记录归属到班组，外班组账号只读。 */
  team: string
  /** 安防责任岗位负责的出入口；其余角色为 null。 */
  entrance: string | null
  shift: string
  note: string
}

/** 越权/合规判定结果：allow=false 时 reason 必须写明点位归属。 */
export type Verdict = {
  allow: boolean
  reason: string
  /** 更宽一档的规则只作提示，不放行。 */
  hints: string[]
}

/** 操作留痕：任何改动（包括越权被拒、重复被拦）都记是谁在什么时候动的。 */
export type AuditRow = {
  id: number
  time: string
  账号: string
  岗位: string
  班组: string
  动作: string
  对象: string
  结果: '已执行' | '越权拒绝' | '重复拦截' | '缺项拦截'
  说明: string
}

/** 材料导入指纹账：同一指纹只留最早一版。 */
export type ImportLogRow = {
  id: number
  指纹: string
  点位编号: string
  检查日期: string
  导入时间: string
  导入账号: string
}

/** 出入口互评复核清单：评估结论写回对口出入口。 */
export type ReviewRow = {
  id: number
  对组: string
  对组键: string
  点位编号: string
  来源出入口: string
  复核出入口: string
  本口结论: string
  对口结论: string
  有效结论: string
  一致性: string
  说明: string
  更新时间: string
}

/** 待办由台账实时派生，不独立落库，保证两边读数一致。 */
export type TodoRow = {
  key: string
  点位编号: string
  事项: string
  归属: string
  可处理: boolean
  原因: string
}

export type MigrationReport = {
  ranAt: string
  点位总数: number
  现场登记: number
  按门数推定: number
  授权人数留空: number
  按交接班次归属: number
  归属留空: number
}
