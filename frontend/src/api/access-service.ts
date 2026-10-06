import {
  ACCESS_COLLECTIONS,
  listCollection,
  listRows,
  resetCollections,
  resetRows,
  saveCollection,
  saveRows,
} from '@/data/local-store'
import {
  ENTRANCE_ROSTER,
  inferAuthorizedCount,
  judgeOperation,
  stricterVerdict,
} from '@/data/access-domain'
import type {
  ActionResult,
  AuditRow,
  EntryRow,
  ImportLogRow,
  MigrationReport,
  Operator,
  ReviewRow,
  TodoRow,
} from '@/data/types'

// 门禁安防运维的全部写操作都经此服务：归属判定 → 联动更新（台账/隐患/复核/待办/审计）。

const MIGRATION_KEY = 'urban-utility-tunnel:access-migration:v2'
const MIGRATION_BATCH = 'MIG-20261006-01'

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function today(): string {
  return now().slice(0, 10)
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// ── 审计轨迹：改动、拒绝、拦截全部留痕，写明账号、岗位、归属 ──

function audits(): AuditRow[] {
  return listCollection('audits') as AuditRow[]
}

function pushAudit(
  operator: Operator,
  动作: string,
  对象: string,
  结果: AuditRow['结果'],
  说明: string,
): void {
  const rows = audits()
  rows.push({
    id: nextId(rows),
    time: now(),
    账号: `${operator.name}（${operator.id}）`,
    岗位: operator.role,
    班组: operator.team,
    动作,
    对象,
    结果,
    说明,
  })
  saveCollection('audits', rows)
}

// ── 存量迁移：授权人数按门数 ×2 推定；归属按交接班次迁移；缺项显式留空 ──

type StoredMigration = { batch: string; report: MigrationReport }

function readMigration(): StoredMigration | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const raw = window.localStorage.getItem(MIGRATION_KEY)
  return raw ? (JSON.parse(raw) as StoredMigration) : null
}

function writeMigration(payload: StoredMigration): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(MIGRATION_KEY, JSON.stringify(payload))
  }
}

/** 裁决的迁移优先级：同日交接班次 → 同班组交接 → 最近一次交接 → 无则显式留空。 */
function matchDuty(row: EntryRow, dutyRows: EntryRow[]): EntryRow | null {
  const checkDate = String(row.检查日期 ?? '')
  const roster = ENTRANCE_ROSTER[String(row.所属出入口 ?? '')]
  const sameDate = dutyRows
    .filter((duty) => String(duty.值班日期) === checkDate)
  if (sameDate.length) {
    // 同日多条交接：先取与该出入口归属班组一致的班次；都不一致再按班组序取一条
    const teamMatch = sameDate.find((duty) => roster && String(duty.值班班组) === roster.team)
    return teamMatch ?? [...sameDate].sort((a, b) => String(a.值班班组).localeCompare(String(b.值班班组)))[0]
  }

  const beforeDate = (duty: EntryRow) => String(duty.值班日期) <= checkDate
  const sameTeam = dutyRows
    .filter((duty) => roster && duty.值班班组 === roster.team && beforeDate(duty))
    .sort((a, b) => String(b.值班日期).localeCompare(String(a.值班日期)))
  if (sameTeam.length) return sameTeam[0]

  const latest = dutyRows
    .filter(beforeDate)
    .sort((a, b) => String(b.值班日期).localeCompare(String(a.值班日期)))
  if (latest.length) return latest[0]

  // 检查日期早于全部交接记录：优先取归属班组的班次，其次最近一次；都没有才留空
  if (roster?.team) {
    const teamAny = dutyRows
      .filter((duty) => String(duty.值班班组) === roster.team)
      .sort((a, b) => String(a.值班日期).localeCompare(String(b.值班日期)))
    if (teamAny.length) return teamAny[0]
  }
  const any = [...dutyRows].sort((a, b) => String(b.值班日期).localeCompare(String(a.值班日期)))
  return any[0] ?? null
}

export function ensureMigration(operator?: Operator): MigrationReport {
  const existed = readMigration()
  if (existed) return existed.report

  const access = [...listRows('access')].sort(
    (a, b) => String(a.检查日期).localeCompare(String(b.检查日期)) || Number(a.id) - Number(b.id),
  )
  const dutyRows = listRows('duty')

  const report: MigrationReport = {
    ranAt: now(),
    点位总数: access.length,
    现场登记: 0,
    按门数推定: 0,
    授权人数留空: 0,
    按交接班次归属: 0,
    归属留空: 0,
  }

  const migrated = access.map((row) => {
    const next: EntryRow = { ...row, 迁移批次: MIGRATION_BATCH }

    // 授权人数：已有登记保留并标记来源；缺失则按门数 ×2 推定；门数也缺则显式留空。
    const registered = Number(next.授权人数)
    if (next.授权人数 !== '' && next.授权人数 !== undefined && !Number.isNaN(registered) && registered > 0) {
      next.授权来源 = '现场登记'
      report.现场登记 += 1
      const doors = Number(next.实际门数)
      next.对照授权人数 = !Number.isNaN(doors) && doors > 0 ? doors * 1 : ''
    } else {
      const doors = Number(next.实际门数)
      const inferred = inferAuthorizedCount(!Number.isNaN(doors) && doors > 0 ? doors : null)
      next.授权人数 = inferred.value
      next.对照授权人数 = inferred.alt
      next.授权来源 = inferred.source
      if (inferred.source === '按门数推定') report.按门数推定 += 1
      else report.授权人数留空 += 1
    }

    // 归属按交接班次迁移；找不到交接记录就显式留空、责任岗位标待指派。
    const roster = ENTRANCE_ROSTER[String(next.所属出入口 ?? '')]
    const matched = matchDuty(next, dutyRows)
    if (matched) {
      next.归属班组 = String(matched.值班班组)
      next.归属依据 = `交接班次 ${String(matched.交接编号)}（${String(matched.值班日期)} ${String(matched.班次)}）`
      report.按交接班次归属 += 1
    } else {
      next.归属班组 = roster?.team ?? ''
      next.归属依据 = roster?.team ? '无交接记录，按出入口名册留班组' : '无交接记录，显式留空'
      report.归属留空 += 1
    }
    next.责任岗位 = roster?.owner ? `${roster.owner.name}（${roster.owner.id}）` : ''
    if (next.检查人员 === '' && matched) next.检查人员 = String(matched.交接人员)

    return next
  })

  saveRows('access', migrated)
  const stored: StoredMigration = { batch: MIGRATION_BATCH, report }
  writeMigration(stored)
  pushAudit(
    operator ?? { id: 'SYS', name: '系统迁移', role: '运行管理员', team: '调度室', entrance: null, shift: '', note: '' },
    '存量台账迁移',
    `批次 ${MIGRATION_BATCH}`,
    '已执行',
    `共 ${report.点位总数} 个点位：按门数推定 ${report.按门数推定}，现场登记 ${report.现场登记}，授权人数留空 ${report.授权人数留空}；按交接班次归属 ${report.按交接班次归属}，归属留空 ${report.归属留空}`,
  )
  return report
}

export function migrationReport(): MigrationReport | null {
  return readMigration()?.report ?? null
}

// ── 复核清单：结论写回对口出入口，两处结论一致；冲突取更严一档 ──

function reviews(): ReviewRow[] {
  return listCollection('reviews') as ReviewRow[]
}

// 一个点位的互评在清单里只有一行：本口结论是点位归属出入口的评估，对口结论是其对组出入口的复核。
function reviewKey(pointCode: string, source: string): string {
  return `${pointCode}@${source}`
}

function consistencyOf(own: string, counter: string): string {
  if (!counter) return '待对口复核'
  return own === counter ? '两处一致' : `冲突从严：取「${stricterVerdict(own, counter)}」`
}

/** 写入本口评估结论并同步对口出入口的复核清单（同一行、两处读数一致）。 */
function syncReview(row: EntryRow, verdict: string): ReviewRow {
  const source = String(row.所属出入口)
  const pointCode = String(row.点位编号)
  const pair = ENTRANCE_ROSTER[source]?.pair ?? ''
  const all = reviews()
  const key = reviewKey(pointCode, source)
  const existing = all.find((item) => item.对组键 === key)
  const counter = existing && String(existing.对口结论) !== '待对口复核' ? String(existing.对口结论) : ''
  const effective = stricterVerdict(verdict, counter)

  const record: ReviewRow = {
    id: existing?.id ?? nextId(all),
    对组: pair ? `${source} ↔ ${pair}` : source,
    对组键: key,
    点位编号: pointCode,
    来源出入口: source,
    复核出入口: pair,
    本口结论: verdict,
    对口结论: counter || '待对口复核',
    有效结论: effective,
    一致性: consistencyOf(verdict, counter),
    说明: counter
      ? `两处结论按更严档统一为「${effective}」`
      : '宽松档仅提示：待对口出入口复核，未复核前不放宽处置',
    更新时间: now(),
  }
  const nextAll = existing ? all.map((item) => (item.id === existing.id ? record : item)) : [...all, record]
  saveCollection('reviews', nextAll)
  return record
}

/** 对口出入口责任岗录入复核结论（写入同一行的「对口结论」列）。 */
export function submitCounterpartReview(
  operator: Operator,
  pointCode: string,
  sourceEntrance: string,
  verdict: string,
): ActionResult {
  const pair = ENTRANCE_ROSTER[sourceEntrance]?.pair ?? ''
  const isPairOwner =
    operator.role === '安防责任岗位' && operator.entrance === pair
  if (!isPairOwner) {
    const reason = `越权拒绝：点位 ${pointCode} 的对口复核归属${pair}，仅${pair}安防责任岗位可录入复核结论，${operator.name}（${operator.role}）只读。`
    pushAudit(operator, '对口复核', pointCode, '越权拒绝', reason)
    return { ok: false, message: reason }
  }

  const all = reviews()
  const key = reviewKey(pointCode, sourceEntrance)
  const existing = all.find((item) => item.对组键 === key)
  if (!existing) {
    return { ok: false, message: `点位 ${pointCode} 尚未由${sourceEntrance}录入本口结论，暂无可复核记录` }
  }
  const own = String(existing.本口结论)
  const effective = stricterVerdict(own, verdict)
  const record: ReviewRow = {
    ...existing,
    对口结论: verdict,
    有效结论: effective,
    一致性: consistencyOf(own, verdict),
    说明:
      own === verdict
        ? `两处结论一致：「${effective}」`
        : `两处结论冲突，按更严档统一为「${effective}」，宽松档仅作提示`,
    更新时间: now(),
  }
  saveCollection('reviews', all.map((item) => (item.id === existing.id ? record : item)))
  pushAudit(
    operator,
    '对口复核',
    pointCode,
    '已执行',
    `对${sourceEntrance}点位 ${pointCode} 录入复核结论「${verdict}」，有效结论「${effective}」`,
  )
  return { ok: true, message: `复核结论已写回同一清单行，两处有效结论统一为「${effective}」` }
}

// ── 隐患清单联动：提出整改即建隐患；整改闭环写回一条已闭环记录 ──

function findOpenHazard(pointCode: string): EntryRow | null {
  return (
    listRows('hazard').find(
      (hazard) => String(hazard.来源点位) === pointCode && String(hazard.status) !== '已闭环',
    ) ?? null
  )
}

function createHazard(row: EntryRow, operator: Operator, measure: string): EntryRow[] {
  const hazards = listRows('hazard')
  const pointCode = String(row.点位编号)
  hazards.push({
    id: nextId(hazards),
    status: '整改中',
    pending: true,
    abnormal: true,
    隐患编号: `HAZA-${String(nextId(hazards)).padStart(4, '0')}`,
    隐患部位: `${String(row.所属出入口)} ${String(row.点位编号)}（${String(row.门禁类型)}）`,
    隐患等级: '一般',
    整改措施: measure,
    责任人员: operator.name,
    发现日期: today(),
    整改期限: '2026-10-13',
    闭环日期: '',
    来源点位: pointCode,
    整改状态: '整改中',
  })
  saveRows('hazard', hazards)
  return hazards
}

function closeHazard(pointCode: string, measure: string, operator: Operator): void {
  const hazards = listRows('hazard')
  const open = hazards.find(
    (hazard) => String(hazard.来源点位) === pointCode && String(hazard.status) !== '已闭环',
  )
  if (open) {
    open.status = '已闭环'
    open.pending = false
    open.abnormal = false
    open.闭环日期 = today()
    open.整改措施 = measure
    open.整改状态 = '已闭环'
  } else {
    // 整改完成并进清单：清单随之多一条已闭环记录
    hazards.push({
      id: nextId(hazards),
      status: '已闭环',
      pending: false,
      abnormal: false,
      隐患编号: `HAZA-${String(nextId(hazards)).padStart(4, '0')}`,
      隐患部位: pointCode,
      隐患等级: '一般',
      整改措施: measure,
      责任人员: operator.name,
      发现日期: today(),
      整改期限: today(),
      闭环日期: today(),
      来源点位: pointCode,
      整改状态: '已闭环',
    })
  }
  saveRows('hazard', hazards)
}

// ── 点位写操作：全部先过归属裁决 ──

function findPoint(id: number): EntryRow | null {
  return listRows('access').find((row) => Number(row.id) === id) ?? null
}

function persistPoint(updated: EntryRow): void {
  const rows = listRows('access')
  saveRows(
    'access',
    rows.map((row) => (Number(row.id) === Number(updated.id) ? updated : row)),
  )
}

function guard(row: EntryRow, operator: Operator, action: string): ActionResult | null {
  const verdict = judgeOperation(row, operator, action)
  if (!verdict.allow) {
    pushAudit(operator, action, String(row.点位编号), '越权拒绝', verdict.reason)
    return { ok: false, message: [verdict.reason, ...verdict.hints].join(' ') }
  }
  return null
}

/** 提交检查：同一点位 + 同一检查日期重复提交只算一次。 */
export function submitInspection(
  operator: Operator,
  id: number,
  checkDate = today(),
): ActionResult {
  const row = findPoint(id)
  if (!row) return { ok: false, message: `没有找到编号为 ${id} 的安防点位` }
  const denied = guard(row, operator, '提交检查')
  if (denied) return denied

  if (String(row.status) !== '待检查') {
    const msg = `重复拦截：点位 ${String(row.点位编号)} 已处于「${String(row.status)}」，同一份检查记录只算一次`
    pushAudit(operator, '提交检查', String(row.点位编号), '重复拦截', msg)
    return { ok: false, message: msg }
  }

  persistPoint({
    ...row,
    status: '检查中',
    pending: true,
    检查日期: checkDate,
    检查人员: operator.name,
    归属班组: row.归属班组 || ENTRANCE_ROSTER[String(row.所属出入口)]?.team || '',
  })
  pushAudit(operator, '提交检查', String(row.点位编号), '已执行', `检查日期 ${checkDate}`)
  return { ok: true, message: `检查已提交（${checkDate}），点位进入检查中` }
}

/** 判定正常：写台账 + 评估结论同步到对口复核清单。 */
export function judgeNormal(operator: Operator, id: number): ActionResult {
  const row = findPoint(id)
  if (!row) return { ok: false, message: `没有找到编号为 ${id} 的安防点位` }
  const denied = guard(row, operator, '判定正常')
  if (denied) return denied
  if (String(row.status) !== '检查中') {
    const msg = `重复拦截：点位 ${String(row.点位编号)} 当前「${String(row.status)}」，无需重复判定，同一份评估只算一次`
    pushAudit(operator, '判定正常', String(row.点位编号), '重复拦截', msg)
    return { ok: false, message: msg }
  }

  persistPoint({ ...row, status: '状态正常', pending: false, abnormal: false, 评估结论: '合格' })
  const review = syncReview(row, '合格')
  pushAudit(operator, '判定正常', String(row.点位编号), '已执行', '评估结论「合格」已写回复核清单')
  return { ok: true, message: `已判定正常，复核清单同步：${review.一致性}` }
}

/** 提出整改：写台账、建隐患、复核结论同步为「不合格」（比存疑更严）。 */
export function raiseRectification(operator: Operator, id: number, measure: string): ActionResult {
  const row = findPoint(id)
  if (!row) return { ok: false, message: `没有找到编号为 ${id} 的安防点位` }
  const denied = guard(row, operator, '提出整改')
  if (denied) return denied
  if (['需整改', '已闭环'].includes(String(row.status))) {
    const msg = `重复拦截：点位 ${String(row.点位编号)} 已「${String(row.status)}」，同一份整改不重复立项`
    pushAudit(operator, '提出整改', String(row.点位编号), '重复拦截', msg)
    return { ok: false, message: msg }
  }
  if (String(row.status) !== '检查中') {
    return { ok: false, message: `拒绝：点位 ${String(row.点位编号)} 需先提交检查，才能提出整改` }
  }
  if (!measure.trim()) {
    pushAudit(operator, '提出整改', String(row.点位编号), '缺项拦截', '整改措施缺项，需补齐')
    return { ok: false, message: '整改措施为缺项：要么补齐措施，要么显式留空说明' }
  }

  persistPoint({ ...row, status: '需整改', pending: true, abnormal: true, 评估结论: '不合格' })
  createHazard(row, operator, measure.trim())
  const review = syncReview(row, '不合格')
  pushAudit(operator, '提出整改', String(row.点位编号), '已执行', `措施「${measure}」已并入隐患整改清单；复核：${review.一致性}`)
  return { ok: true, message: '已提出整改并并入隐患整改清单，复核结论同步为「不合格」' }
}

/** 整改闭环：点位闭环 + 隐患清单多一条已闭环 + 复核清单更新。 */
export function closeRectification(operator: Operator, id: number, measure: string): ActionResult {
  const row = findPoint(id)
  if (!row) return { ok: false, message: `没有找到编号为 ${id} 的安防点位` }
  const denied = guard(row, operator, '整改闭环')
  if (denied) return denied
  if (String(row.status) === '已闭环') {
    const msg = `重复拦截：点位 ${String(row.点位编号)} 已闭环，闭环记录只可查看、不能再改动`
    pushAudit(operator, '整改闭环', String(row.点位编号), '重复拦截', msg)
    return { ok: false, message: msg }
  }
  if (String(row.status) !== '需整改') {
    return { ok: false, message: `拒绝：点位 ${String(row.点位编号)} 当前「${String(row.status)}」，没有待闭环的整改` }
  }
  if (!measure.trim()) {
    pushAudit(operator, '整改闭环', String(row.点位编号), '缺项拦截', '闭环说明缺项')
    return { ok: false, message: '闭环说明为缺项，请补齐整改结果' }
  }

  persistPoint({ ...row, status: '已闭环', pending: false, abnormal: false, 评估结论: '合格' })
  closeHazard(String(row.点位编号), measure.trim(), operator)
  const review = syncReview(row, '合格')
  pushAudit(operator, '整改闭环', String(row.点位编号), '已执行', `隐患整改清单已闭环；复核：${review.一致性}`)
  return { ok: true, message: '整改闭环完成：点位、隐患清单（已闭环）、复核清单三处已同步' }
}

/** 调整授权人数：只有本口责任岗可改，台账记录新旧值与操作账号。 */
export function adjustAuthorized(
  operator: Operator,
  id: number,
  nextCount: number,
): ActionResult {
  const row = findPoint(id)
  if (!row) return { ok: false, message: `没有找到编号为 ${id} 的安防点位` }
  const denied = guard(row, operator, '调整授权人数')
  if (denied) return denied
  if (!Number.isFinite(nextCount) || nextCount < 0) {
    return { ok: false, message: '授权人数必须是不小于 0 的整数' }
  }
  const old = row.授权人数
  persistPoint({ ...row, 授权人数: nextCount, 授权来源: '现场调整' })
  pushAudit(
    operator,
    '调整授权人数',
    String(row.点位编号),
    '已执行',
    `授权人数 ${old === '' ? '留空' : old} → ${nextCount}，台账已留痕`,
  )
  return { ok: true, message: `授权人数已由「${old === '' ? '留空' : old}」改为「${nextCount}」` }
}

/** 登记新点位：归属以所选出入口的责任名册为准。 */
export function registerPoint(
  operator: Operator,
  input: { 点位编号: string; 所属出入口: string; 门禁类型: string; 监控覆盖: string; 授权人数: number | ''; 实际门数: number | '' },
): ActionResult {
  const pseudo: EntryRow = {
    id: -1,
    status: '待检查',
    pending: true,
    abnormal: false,
    点位编号: input.点位编号,
    所属出入口: input.所属出入口,
    归属班组: '',
    责任岗位: '',
  }
  const denied = guard(pseudo, operator, '登记安防点位')
  if (denied) return denied
  if (!input.点位编号.trim() || !input.门禁类型.trim()) {
    return { ok: false, message: '点位编号、门禁类型为必填缺项，请补齐' }
  }
  const rows = listRows('access')
  if (rows.some((row) => String(row.点位编号) === input.点位编号.trim())) {
    const msg = `点位编号 ${input.点位编号} 已登记，重复登记拒绝`
    pushAudit(operator, '登记安防点位', input.点位编号, '重复拦截', msg)
    return { ok: false, message: msg }
  }

  const roster = ENTRANCE_ROSTER[input.所属出入口]
  const id = nextId(rows)
  const doors = input.实际门数 === '' || input.实际门数 === null ? null : Number(input.实际门数)
  const inferred = inferAuthorizedCount(doors)
  const authorized = input.授权人数 === '' || input.授权人数 === null ? inferred.value : Number(input.授权人数)
  rows.push({
    id,
    status: '待检查',
    pending: true,
    abnormal: false,
    点位编号: input.点位编号.trim(),
    所属出入口: input.所属出入口,
    门禁类型: input.门禁类型.trim(),
    监控覆盖: input.监控覆盖.trim() || '',
    授权人数: authorized,
    归属班组: roster?.team ?? '',
    责任岗位: roster?.owner ? `${roster.owner.name}（${roster.owner.id}）` : '',
    授权来源: input.授权人数 === '' ? inferred.source : '现场登记',
    检查日期: '',
    检查人员: '',
    实际门数: input.实际门数 === '' ? '' : Number(input.实际门数),
    对照授权人数: inferred.alt,
    评估结论: '',
    迁移批次: '登记新增',
    归属依据: '按出入口名册登记',
    安防状态: '待检查',
  })
  saveRows('access', rows)
  pushAudit(operator, '登记安防点位', input.点位编号, '已执行', `归属${input.所属出入口}，授权人数 ${authorized === '' ? '留空' : authorized}`)
  return { ok: true, message: `点位 ${input.点位编号} 已登记，归属${input.所属出入口}` }
}

// ── 材料导入：同一指纹只留最早一版，重复导入不会多出一行 ──

function materialFingerprint(code: string, date: string): string {
  return `${code.trim()}|${date.trim()}`
}

export type ImportSummary = { accepted: number; duplicated: number; denied: number; invalid: number }

export function importMaterials(operator: Operator, text: string): { result: ActionResult; summary: ImportSummary } {
  const summary: ImportSummary = { accepted: 0, duplicated: 0, denied: 0, invalid: 0 }
  const logs = listCollection('imports') as ImportLogRow[]
  const points = listRows('access')
  const seen = new Set(logs.map((log) => log.指纹))
  const batchSeen = new Set<string>()

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    const [codeRaw = '', dateRaw = ''] = line.split(/[,，\t]+/)
    const code = codeRaw.trim()
    const date = dateRaw.trim()
    if (!code) {
      summary.invalid += 1
      continue
    }
    const point = points.find((item) => String(item.点位编号) === code)
    if (!point) {
      summary.invalid += 1
      pushAudit(operator, '材料导入', code, '缺项拦截', `台账无此点位：${line}`)
      continue
    }
    const verdict = judgeOperation(point, operator, '材料导入')
    if (!verdict.allow) {
      summary.denied += 1
      pushAudit(operator, '材料导入', code, '越权拒绝', verdict.reason)
      continue
    }
    const fingerprint = materialFingerprint(code, date)
    if (seen.has(fingerprint) || batchSeen.has(fingerprint)) {
      summary.duplicated += 1
      pushAudit(operator, '材料导入', code, '重复拦截', `指纹 ${fingerprint} 已有更早版本，仅留最早版`)
      continue
    }
    batchSeen.add(fingerprint)
    seen.add(fingerprint)
    logs.push({
      id: nextId(logs),
      指纹: fingerprint,
      点位编号: code,
      检查日期: date,
      导入时间: now(),
      导入账号: `${operator.name}（${operator.id}）`,
    })
    summary.accepted += 1
  }
  saveCollection('imports', logs)
  const ok = summary.accepted > 0
  const message = `导入完成：入账 ${summary.accepted} 份，重复拦回 ${summary.duplicated} 份（只留最早版），越权拒绝 ${summary.denied} 份，无效 ${summary.invalid} 行`
  pushAudit(operator, '材料导入', `共 ${lines.length} 行`, ok ? '已执行' : '越权拒绝', message)
  return { result: { ok, message }, summary }
}

// ── 待办：由台账实时派生，与台账读数永远一致 ──

export function todoList(operator: Operator | null): TodoRow[] {
  const todos: TodoRow[] = []
  for (const row of listRows('access')) {
    const entrance = String(row.所属出入口)
    const roster = ENTRANCE_ROSTER[entrance]
    const ownerName = roster?.owner ? `${roster.owner.name}（${roster.owner.id}）` : '责任岗位待指派'
    const canHandle = !!operator && !!roster?.owner && operator.role === '安防责任岗位' && operator.entrance === entrance
    const reason = canHandle ? '' : `归属${entrance} · 责任岗位 ${ownerName}，当前账号只读`
    if (String(row.status) === '待检查') {
      todos.push({ key: `check-${row.id}`, 点位编号: String(row.点位编号), 事项: '提交检查', 归属: `${entrance} / ${ownerName}`, 可处理: canHandle, 原因: reason })
    }
    if (String(row.status) === '检查中') {
      todos.push({ key: `verdict-${row.id}`, 点位编号: String(row.点位编号), 事项: '录入评估结论（合格/不合格）', 归属: `${entrance} / ${ownerName}`, 可处理: canHandle, 原因: reason })
    }
  }
  for (const hazard of listRows('hazard')) {
    if (String(hazard.status) === '已闭环') continue
    const point = listRows('access').find((row) => String(row.点位编号) === String(hazard.来源点位))
    const entrance = point ? String(point.所属出入口) : ''
    const roster = entrance ? ENTRANCE_ROSTER[entrance] : null
    const canHandle = !!operator && !!roster?.owner && operator.role === '安防责任岗位' && operator.entrance === entrance
    todos.push({
      key: `hazard-${hazard.id}`,
      点位编号: String(hazard.来源点位),
      事项: `隐患整改闭环（${hazard.隐患编号}）`,
      归属: `${entrance} / ${roster?.owner ? `${roster.owner.name}（${roster.owner.id}）` : '待指派'}`,
      可处理: canHandle,
      原因: canHandle ? '' : `隐患归属${entrance}，当前账号只读`,
    })
  }
  // 复核对口待办
  for (const review of reviews()) {
    if (String(review.一致性) !== '待对口复核') continue
    const target = String(review.复核出入口)
    const roster = ENTRANCE_ROSTER[target]
    const canHandle = !!operator && !!roster?.owner && operator.role === '安防责任岗位' && operator.entrance === target
    todos.push({
      key: `review-${review.id}`,
      点位编号: String(review.点位编号),
      事项: `对口复核（${String(review.来源出入口)}结论）`,
      归属: `${target} / ${roster?.owner ? `${roster.owner.name}（${roster.owner.id}）` : '待指派'}`,
      可处理: canHandle,
      原因: canHandle ? '' : `复核归属${target}责任岗位`,
    })
  }
  return todos
}

export function accessStats() {
  const rows = listRows('access')
  return {
    点位总数: rows.length,
    待检查: rows.filter((row) => String(row.status) === '待检查').length,
    状态正常: rows.filter((row) => String(row.status) === '状态正常').length,
    需整改: rows.filter((row) => String(row.status) === '需整改').length,
    已闭环: rows.filter((row) => String(row.status) === '已闭环').length,
    授权人数留空: rows.filter((row) => row.授权人数 === '').length,
  }
}

export function listAudits(): AuditRow[] {
  return [...audits()].sort((a, b) => b.id - a.id)
}
export function listImports(): ImportLogRow[] {
  return [...(listCollection('imports') as ImportLogRow[])].sort((a, b) => b.id - a.id)
}
export function listReviews(): ReviewRow[] {
  return [...reviews()].sort((a, b) => b.id - a.id)
}

/** 重置门禁治理全部数据（台账、隐患、交接、联动集合、迁移标记），便于重新演示。 */
export function resetAccessGovernance(): MigrationReport {
  resetRows('access')
  resetRows('hazard')
  resetRows('duty')
  resetCollections()
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(MIGRATION_KEY)
  }
  return ensureMigration()
}

export { ACCESS_COLLECTIONS }
