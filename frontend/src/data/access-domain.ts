import type { EntryRow, Operator, Verdict } from './types'

/**
 * 门禁安防归属治理的固定口径（裁决结论）。
 *
 * 1) 授权人数：早年缺登记的，按现场实际门数 ×2（一主一备）推定入账；
 *    门数也缺的显式留空，不推定。门数 ×1（每门一人）只留作对照列。
 * 2) 规则冲突从严：外包全域禁写 > 出入口责任岗位 > 班组归属 > 班次窗口，
 *    任一档拒绝即拒绝；更宽一档（同班组可写）降级为提示。
 * 3) 存量迁移：同日交接班次 > 同班组任意交接 > 最近一次交接 > 都没有则显式留空。
 */

export const AUTH_FACTOR = 2
export const AUTH_FACTOR_ALT = 1

export const SECURITY_VERDICTS = ['合格', '不合格', '存疑'] as const
/** 从严取档：不合格 > 存疑 > 合格。 */
const VERDICT_SEVERITY: Record<string, number> = { 不合格: 3, 存疑: 2, 合格: 1 }

export function stricterVerdict(a: string, b: string): string {
  if (a && b) return VERDICT_SEVERITY[a] >= VERDICT_SEVERITY[b] ? a : b
  return a || b || ''
}

export const OPERATORS: Operator[] = [
  { id: 'U1001', name: '张磊', role: '安防责任岗位', team: '一班', entrance: '1号出入口', shift: '白班 08:00-20:00', note: '1号口责任岗，可提交本口检查/整改' },
  { id: 'U1002', name: '李芳', role: '安防责任岗位', team: '二班', entrance: '2号出入口', shift: '夜班 20:00-08:00', note: '2号口责任岗，可提交本口检查/整改' },
  { id: 'U1003', name: '王强', role: '班组成员', team: '一班', entrance: null, shift: '白班 08:00-20:00', note: '一班成员，非责任岗：本口也只读，可写仅作提示' },
  { id: 'U1004', name: '赵敏', role: '外包巡检', team: '外委班组', entrance: null, shift: '白班 08:00-20:00', note: '外包巡检：全域只读，禁止任何改动' },
  { id: 'U1005', name: '陈涛', role: '运行管理员', team: '调度室', entrance: null, shift: '行政班', note: '只读全台账，不参与点位操作' },
]

export const ENTRANCES = ['1号出入口', '2号出入口', '3号出入口'] as const

/** 出入口安防责任名册：归属判定的基准。3号口尚未指派，只可查看。 */
export const ENTRANCE_ROSTER: Record<string, { owner: Operator | null; team: string; pair: string | null }> = {
  '1号出入口': { owner: OPERATORS[0], team: '一班', pair: '2号出入口' },
  '2号出入口': { owner: OPERATORS[1], team: '二班', pair: '1号出入口' },
  '3号出入口': { owner: null, team: '', pair: null },
}

export function findOperator(id: string): Operator {
  return OPERATORS.find((item) => item.id === id) ?? OPERATORS[4]
}

function ownershipText(row: EntryRow): string {
  const entrance = String(row.所属出入口 ?? '')
  const team = String(row.归属班组 ?? '')
  const ownerName = String(row.责任岗位 ?? '')
  const roster = ENTRANCE_ROSTER[entrance]
  if (roster?.owner) {
    return `点位 ${String(row.点位编号)} 归属${entrance} · ${roster.team}，责任岗位 ${roster.owner.name}（${roster.owner.id}）`
  }
  if (!roster) {
    return `点位 ${String(row.点位编号)} 归属未知出入口「${entrance}」，责任岗位待指派`
  }
  return `点位 ${String(row.点位编号)} 归属${entrance}，责任岗位尚未指派（台账归属班组：${team || '留空'}，登记岗位：${ownerName || '留空'}）`
}

/**
 * 归属判定。从严顺序逐级裁决：
 *  - 外包巡检：全域只读，任何写操作拒绝（最严）
 *  - 运行管理员：只读
 *  - 责任岗位：仅自己负责的出入口可写
 *  - 同班组成员：本班组点位仍只读，更宽一档降级为提示
 *  - 无责任岗位的出入口：谁都不能写
 */
export function judgeOperation(row: EntryRow, operator: Operator, action: string): Verdict {
  const entrance = String(row.所属出入口 ?? '')
  const roster = ENTRANCE_ROSTER[entrance]
  const owner = roster?.owner ?? null
  const hints: string[] = []

  if (operator.role === '外包巡检') {
    return {
      allow: false,
      hints,
      reason: `越权拒绝：${ownershipText(row)}。外包巡检账号 ${operator.name}（${operator.id}）全域只读，禁止${action}。`,
    }
  }

  if (operator.role === '运行管理员') {
    return {
      allow: false,
      hints,
      reason: `越权拒绝：${ownershipText(row)}。运行管理员只复核、不改动，禁止${action}。`,
    }
  }

  if (!owner) {
    return {
      allow: false,
      hints: ['该出入口尚未指派安防责任岗位，缺项补齐后才可操作'],
      reason: `拒绝：${ownershipText(row)}。当前无责任岗位可提交${action}。`,
    }
  }

  const isOwner = operator.role === '安防责任岗位' && operator.entrance === entrance
  if (isOwner) {
    return { allow: true, reason: '', hints }
  }

  if (operator.role === '安防责任岗位') {
    return {
      allow: false,
      hints: [`宽松档提示：${entrance}责任岗位是 ${owner.name}，你负责的是 ${operator.entrance ?? '未指派出入口'}`],
      reason: `越权拒绝：${ownershipText(row)}。${operator.name}（${operator.id}）非本口责任岗，禁止${action}。`,
    }
  }

  // 班组成员：更宽一档（同班组可操作）降级为提示，仍按更严档拒绝
  const sameTeam = operator.team === roster.team
  if (sameTeam) {
    hints.push(`宽松档提示：你与该点位同属${operator.team}，按班组口径本可${action}；但从严执行，仅责任岗位 ${owner.name} 可操作`)
  }
  return {
    allow: false,
    hints,
    reason: `越权拒绝：${ownershipText(row)}。仅本出入口安防责任岗位可${action}，${operator.name}（${operator.role}）只读。`,
  }
}

/** 授权人数推定：门数 ×2；门数缺失则留空（''）。同时返回 ×1 的对照值。 */
export function inferAuthorizedCount(doorCount: number | null): { value: number | ''; alt: number | ''; source: string } {
  if (doorCount === null || Number.isNaN(doorCount) || doorCount <= 0) {
    return { value: '', alt: '', source: '留空待补' }
  }
  return { value: doorCount * AUTH_FACTOR, alt: doorCount * AUTH_FACTOR_ALT, source: '按门数推定' }
}
