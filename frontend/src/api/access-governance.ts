import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// ————————————————————————————————————————————————
// 门禁安防归属治理：谁能改、谁只能看，全部在这一层裁决。
// 页面只负责展示结果，不自行判断权限。
// ————————————————————————————————————————————————

export type Operator = {
  name: string
  role: string
  team: string
}

export type GovernanceResult = ActionResult & {
  /** 规则冲突时被降级的宽松档说明，只作提示，不作放行依据 */
  hint?: string
}

// 归属登记：每个出入口的安防责任岗位与责任班组，点位改动只认这一份。
export const ENTRANCE_OWNERSHIP: Record<string, { post: string; team: string }> = {
  东出入口: { post: '安防责任岗', team: '安防一班' },
  西出入口: { post: '安防责任岗', team: '安防一班' },
  南出入口: { post: '安防责任岗', team: '安防二班' },
}

// 可切换的值班身份（演示用）：前两个是本出入口责任岗，后两个只读。
export const ACCESS_IDENTITIES: (Operator & { label: string })[] = [
  { label: '张谨 · 安防责任岗 · 安防一班（东/西出入口）', name: '张谨', role: '安防责任岗', team: '安防一班' },
  { label: '李卫 · 安防责任岗 · 安防二班（南出入口）', name: '李卫', role: '安防责任岗', team: '安防二班' },
  { label: '王巡 · 外包巡检员 · 外包巡检队（只读）', name: '王巡', role: '外包巡检员', team: '外包巡检队' },
  { label: '值班管理员 · 平台班组（宽松档对照）', name: '值班管理员', role: '值班管理员', team: '平台班组' },
]

// 授权人数推定办法（裁决口径）：早年缺授权人数的存量点位，
// 按现场实际门数 × 6 人/门 推定；4 人/门 的口径只留作对照，不进台账读数。
export const INFER_PER_DOOR = 6
export const INFER_PER_DOOR_ALT = 4
// 早年界限：检查日期早于此日的存量记录才走门数推定。
export const LEGACY_DATE_CUTOFF = '2024-01-01'
// 显式留空标记：迁移时补不齐的缺项一律写它，不静默默认。
export const BLANK = '（空缺）'

const ACCESS_KEY = 'access'
const HAZARD_KEY = 'hazard'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function ownershipOf(point: EntryRow): { post: string; team: string; text: string } {
  const entrance = String(point['所属出入口'] ?? '')
  const registered = ENTRANCE_OWNERSHIP[entrance]
  const team = String(point['责任班组'] ?? registered?.team ?? BLANK)
  const post = registered?.post ?? '安防责任岗'
  return { post, team, text: `该点位归属${entrance}·${team}（责任岗位：${post}）` }
}

type RuleVerdict = { level: 'deny' | 'allow'; reason: string }

// 规则冲突时以更严的那一档为准：任何一条 deny 命中即拒绝，
// 同时命中的 allow 一律降级成提示，写在 hint 里只作对照。
function evaluateRules(point: EntryRow, operator: Operator): { allowed: boolean; reason: string; hint: string } {
  const owner = ownershipOf(point)
  const verdicts: RuleVerdict[] = []

  // 宽松档：值班管理员全域通行。与归属规则冲突时让位，仅留作对照提示。
  if (operator.role === '值班管理员') {
    verdicts.push({ level: 'allow', reason: '值班管理员全域通行（宽松档）' })
  }
  // 严格档一：岗位必须登记在册。
  if (operator.role !== owner.post) {
    verdicts.push({ level: 'deny', reason: `仅本出入口的安防责任岗位能提交检查与整改，其他人只读；${owner.text}` })
  }
  // 严格档二：班组必须归属该点位。
  if (operator.team !== owner.team) {
    verdicts.push({ level: 'deny', reason: `记录归属到班组，外班组只能查看、不能改动；${owner.text}` })
  }
  if (operator.role === owner.post && operator.team === owner.team) {
    verdicts.push({ level: 'allow', reason: '本出入口安防责任岗位，允许改动' })
  }

  const deny = verdicts.find((item) => item.level === 'deny')
  const allow = verdicts.find((item) => item.level === 'allow')
  if (deny) {
    const hint = allow
      ? `提示：「${allow.reason}」与归属规则冲突，已按更严的一档处理，仅留作对照`
      : ''
    return { allowed: false, reason: deny.reason, hint }
  }
  return { allowed: true, reason: allow?.reason ?? '', hint: '' }
}

function findPoint(id: number): { rows: EntryRow[]; index: number } {
  const rows = listRows(ACCESS_KEY)
  return { rows, index: rows.findIndex((row) => Number(row.id) === id) }
}

function guard(id: number, operator: Operator): { rows: EntryRow[]; index: number; verdict: GovernanceResult | null } {
  const { rows, index } = findPoint(id)
  if (index < 0) {
    return { rows, index, verdict: { ok: false, message: `没有找到编号为 ${id} 的安防点位` } }
  }
  const verdict = evaluateRules(rows[index], operator)
  if (!verdict.allowed) {
    return { rows, index, verdict: { ok: false, message: `越权改动已拒绝：${verdict.reason}`, hint: verdict.hint } }
  }
  return { rows, index, verdict: null }
}

function inspectionKey(pointNo: string, checkDate: string): string {
  return `${pointNo}|${checkDate}`
}

/** 提交检查：同一份检查记录（点位编号+检查日期）反复提交也只算一次。 */
export function submitInspection(id: number, checkDate: string, operator: Operator): GovernanceResult {
  const { rows, index, verdict } = guard(id, operator)
  if (verdict) return verdict
  const point = rows[index]
  const key = inspectionKey(String(point['点位编号']), checkDate)
  if (String(point['检查记录键'] ?? '') === key) {
    return { ok: true, message: `同一份检查记录（${key}）已提交过，只按一次计，未重复登记` }
  }
  if (String(point.status) !== '待检查') {
    return { ok: false, message: `点位当前状态「${point.status}」，不在待检查环节，不能重复提交检查` }
  }
  const next = [...rows]
  next[index] = {
    ...point,
    status: '检查中',
    安防状态: '检查中',
    检查日期: checkDate,
    检查人员: operator.name,
    检查记录键: key,
    pending: true,
  }
  saveRows(ACCESS_KEY, next)
  return { ok: true, message: `检查已提交（记录键 ${key}），当前状态「检查中」` }
}

/** 提出整改：检查中的点位才能转入需整改。 */
export function raiseRectification(id: number, operator: Operator): GovernanceResult {
  const { rows, index, verdict } = guard(id, operator)
  if (verdict) return verdict
  const point = rows[index]
  if (String(point.status) === '需整改') {
    return { ok: false, message: '该点位已在需整改状态，不用重复提出' }
  }
  if (String(point.status) !== '检查中') {
    return { ok: false, message: `点位当前状态「${point.status}」，需先提交检查再提出整改` }
  }
  const next = [...rows]
  next[index] = { ...point, status: '需整改', 安防状态: '需整改', pending: true }
  saveRows(ACCESS_KEY, next)
  return { ok: true, message: '已提出整改，点位转入「需整改」' }
}

/**
 * 整改闭环：点位回到状态正常，同时往隐患整改清单并一条已闭环记录。
 * 评估结论在同一次写入里落到点位台账与隐患清单两处，两处读数一致；
 * 隐患清单按来源点位去重，同一点位闭环只多一条记录。
 */
export function closeRectification(id: number, conclusion: string, operator: Operator): GovernanceResult {
  const { rows, index, verdict } = guard(id, operator)
  if (verdict) return verdict
  const point = rows[index]
  if (String(point.status) !== '需整改') {
    return { ok: false, message: `点位当前状态「${point.status}」，只有需整改的点位才能闭环` }
  }
  const text = conclusion.trim() || `复核通过：${point['所属出入口']}${point['点位编号']}整改完成`

  const nextAccess = [...rows]
  nextAccess[index] = {
    ...point,
    status: '状态正常',
    安防状态: '状态正常',
    评估结论: text,
    pending: false,
  }

  const hazards = listRows(HAZARD_KEY)
  const pointNo = String(point['点位编号'])
  const alreadyClosed = hazards.some((row) => String(row['来源点位'] ?? '') === pointNo)
  const nextHazards = [...hazards]
  if (!alreadyClosed) {
    const nextId = hazards.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
    nextHazards.push({
      id: nextId,
      status: '已闭环',
      pending: false,
      abnormal: false,
      隐患编号: `HAZA-${String(nextId).padStart(4, '0')}`,
      隐患部位: `${point['所属出入口']}/${pointNo}`,
      隐患等级: '一般',
      整改措施: '门禁安防整改闭环',
      责任人员: operator.name,
      发现日期: String(point['检查日期'] ?? BLANK),
      整改期限: String(point['检查日期'] ?? BLANK),
      整改状态: '已闭环',
      评估结论: text,
      来源点位: pointNo,
    })
  }

  // 台账与隐患清单在同一次操作里落库，待办读数两边一致。
  saveRows(ACCESS_KEY, nextAccess)
  saveRows(HAZARD_KEY, nextHazards)

  return {
    ok: true,
    message: alreadyClosed
      ? '整改已闭环；隐患清单中该点位已有闭环记录，未重复新增'
      : '整改已闭环，隐患整改清单已同步新增一条已闭环记录，评估结论两处一致',
  }
}

/** 调整授权人数：只有本出入口责任岗能改，越权一律拒绝并写明归属。 */
export function updateAuthorizedCount(id: number, count: number, operator: Operator): GovernanceResult {
  const { rows, index, verdict } = guard(id, operator)
  if (verdict) return verdict
  if (!Number.isInteger(count) || count < 0) {
    return { ok: false, message: '授权人数必须是不小于 0 的整数' }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 授权人数: count, 授权来源: '责任岗调整' }
  saveRows(ACCESS_KEY, next)
  return { ok: true, message: `授权人数已调整为 ${count} 人，台账已留痕（${operator.team}/${operator.name}）` }
}

/**
 * 存量台账迁移：按交接班次逐条回填，同一条只迁移一次。
 * 早年（检查日期早于 2024-01-01）缺授权人数的，按现场实际门数推定；
 * 补不齐的缺项显式留空，不静默默认。
 */
export function migrateLegacyRows(): GovernanceResult {
  const rows = listRows(ACCESS_KEY)
  let migrated = 0
  const next = rows.map((row) => {
    if (String(row['迁移标记'] ?? '') === '已迁移') {
      return row
    }
    migrated += 1
    const updated: EntryRow = { ...row }
    // 按交接班次迁移：班次本身缺了也显式留空。
    updated['迁移班次'] = String(row['交接班次'] ?? '') || BLANK
    const authorized = row['授权人数']
    const doors = Number(row['现场门数'])
    if (authorized === undefined || authorized === '') {
      const checkDate = String(row['检查日期'] ?? '')
      if (checkDate && checkDate < LEGACY_DATE_CUTOFF && Number.isFinite(doors) && doors > 0) {
        updated['授权人数'] = doors * INFER_PER_DOOR
        updated['授权对照值'] = doors * INFER_PER_DOOR_ALT
        updated['授权来源'] = `按现场门数推定（${doors}门×${INFER_PER_DOOR}人/门）`
      } else {
        updated['授权人数'] = BLANK
        updated['授权来源'] = BLANK
      }
    }
    for (const field of ['检查人员', '评估结论', '交接班次'] as const) {
      if (updated[field] === undefined || updated[field] === '') {
        updated[field] = BLANK
      }
    }
    updated['迁移标记'] = '已迁移'
    return updated
  })
  if (migrated === 0) {
    return { ok: true, message: '存量台账均已按交接班次迁移过，没有待处理记录' }
  }
  saveRows(ACCESS_KEY, next)
  return { ok: true, message: `已按交接班次迁移存量台账 ${migrated} 条，缺项已补齐或显式留空` }
}

/**
 * 检查材料导入：同一份材料（点位编号+检查日期）重复导入只留最早那一版，
 * 已在台账里的优先，同批次里靠前的优先，不会多出一行。
 */
export function importInspectionMaterials(materials: EntryRow[]): GovernanceResult & { added: number; skipped: number } {
  const rows = listRows(ACCESS_KEY)
  const seen = new Set(
    rows.map((row) => inspectionKey(String(row['点位编号']), String(row['检查日期'] ?? ''))),
  )
  const next = [...rows]
  let maxId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0)
  let added = 0
  let skipped = 0
  for (const material of materials) {
    const key = inspectionKey(String(material['点位编号'] ?? ''), String(material['检查日期'] ?? ''))
    if (seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    maxId += 1
    added += 1
    next.push({
      ...clone(material),
      id: maxId,
      status: '待检查',
      安防状态: '待检查',
      pending: true,
      abnormal: false,
      迁移标记: '已迁移',
      迁移班次: '导入批次',
      授权来源: material['授权来源'] ?? '材料导入',
    })
  }
  if (added > 0) {
    saveRows(ACCESS_KEY, next)
  }
  return {
    ok: true,
    added,
    skipped,
    message: `导入新增 ${added} 条；重复材料 ${skipped} 条只保留最早一版，未多出一行`,
  }
}

/** 待办读数：与运营概览同源，台账改动后两边一致。 */
export function accessTodoSummary(): { pendingPoints: number; closedHazards: number; pendingHazards: number } {
  const points = listRows(ACCESS_KEY)
  const hazards = listRows(HAZARD_KEY)
  return {
    pendingPoints: points.filter((row) => row.pending).length,
    closedHazards: hazards.filter((row) => String(row.status) === '已闭环').length,
    pendingHazards: hazards.filter((row) => row.pending).length,
  }
}
