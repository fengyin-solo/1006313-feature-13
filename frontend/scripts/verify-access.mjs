// 门禁归属治理规则核验：用内存 localStorage 垫片在 Node 中直跑服务层。
// 运行：node scripts/verify-access.mjs
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const mem = new Map()
const localStorageShim = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
}
globalThis.window = { localStorage: localStorageShim }

const scenario = `
import { listRows } from '@/data/local-store'
import { OPERATORS } from '@/data/access-domain'
import {
  ensureMigration, accessStats, submitInspection, judgeNormal, raiseRectification,
  closeRectification, adjustAuthorized, registerPoint, importMaterials,
  submitCounterpartReview, todoList, listAudits, listImports, listReviews,
  resetAccessGovernance,
} from '@/api/access-service'

const out = []
const log = (...a) => out.push(a.join(' '))
const assert = (cond, msg) => { if (!cond) { out.push('FAIL: ' + msg); process.exitCode = 1 } else out.push('PASS: ' + msg) }

const 张磊 = OPERATORS[0], 李芳 = OPERATORS[1], 王强 = OPERATORS[2], 赵敏 = OPERATORS[3], 陈涛 = OPERATORS[4]

resetAccessGovernance()
const report = ensureMigration()
const points = () => listRows('access')
const byCode = (code) => points().find((p) => p.点位编号 === code)

// 1) 存量迁移：授权人数门数×2推定；门数缺失留空；现场登记保留；归属按交接班次
assert(report.点位总数 === 6, '迁移覆盖6个存量点位')
assert(report.按门数推定 === 4, '4个点位按门数×2推定（实 ' + report.按门数推定 + '）')
assert(report.授权人数留空 === 1, '1个点位门数缺失显式留空（实 ' + report.授权人数留空 + '）')
assert(report.现场登记 === 1, '1个点位保留现场登记授权人数')
assert(byCode('ACCE-0001').授权人数 === 4, 'ACCE-0001 门数2 → 授权4')
assert(byCode('ACCE-0001').对照授权人数 === 2, '对照列门数×1=2仅对照')
assert(byCode('ACCE-0002').授权人数 === 6, 'ACCE-0002 门数3 → 6')
assert(byCode('ACCE-0003').授权人数 === 2, 'ACCE-0003 门数1 → 2')
assert(byCode('ACCE-0005').授权人数 === '' && byCode('ACCE-0005').授权来源 === '留空待补', 'ACCE-0005 门数缺失显式留空')
assert(byCode('ACCE-0006').授权人数 === 12 && byCode('ACCE-0006').授权来源 === '现场登记', 'ACCE-0006 现场登记12保留')
assert(byCode('ACCE-0001').归属班组 === '一班', '同日交接班次优先：0001→一班')
assert(byCode('ACCE-0003').归属班组 === '二班', '0003同日交接→二班')
assert(byCode('ACCE-0001').责任岗位.includes('张磊'), '责任岗位按名册回填张磊')

// 2) 外包全域禁写且写明归属；改动不生效
let res = submitInspection(赵敏, byCode('ACCE-0006').id)
assert(!res.ok && res.message.includes('越权拒绝') && res.message.includes('1号出入口'), '外包提交检查被拒并写明归属')
res = adjustAuthorized(赵敏, byCode('ACCE-0001').id, 99)
assert(!res.ok && res.message.includes('外包巡检'), '外包改授权人数被拒')
assert(byCode('ACCE-0001').授权人数 === 4, '越权改动未生效，授权仍为4')

// 3) 运行管理员只读
res = judgeNormal(陈涛, byCode('ACCE-0003').id)
assert(!res.ok && res.message.includes('运行管理员'), '运行管理员改动被拒')

// 4) 同班组非责任岗从严拒绝，宽松档降级提示
res = submitInspection(王强, byCode('ACCE-0006').id)
assert(!res.ok && res.message.includes('仅本出入口安防责任岗位'), '同班组王强只读被拒')
assert(res.message.includes('宽松档提示'), '班组可写宽松档降级为提示')

// 5) 他口责任岗越权
res = submitInspection(李芳, byCode('ACCE-0006').id)
assert(!res.ok && res.message.includes('非本口责任岗'), '2号口李芳动1号口被拒')

// 6) 3号口无责任岗，谁都不能写
res = submitInspection(张磊, byCode('ACCE-0005').id)
assert(!res.ok && res.message.includes('尚未指派'), '3号口无责任岗张磊也被拒')

// 7) 本口责任岗流转 + 重复检查只算一次
res = submitInspection(张磊, byCode('ACCE-0006').id)
assert(res.ok, '张磊提交0006检查成功')
res = submitInspection(张磊, byCode('ACCE-0006').id)
assert(!res.ok && res.message.includes('重复拦截'), '同一份检查重复提交被拦')

// 8) 2号口0003判定正常 → 复核写回对口1号口
res = judgeNormal(李芳, byCode('ACCE-0003').id)
assert(res.ok, '李芳判定0003正常')
const rv = listReviews().find((x) => x.点位编号 === 'ACCE-0003')
assert(rv && rv.本口结论 === '合格' && rv.复核出入口 === '1号出入口' && rv.一致性 === '待对口复核', '结论写回对口1号口待复核')

// 9) 对口复核权限 + 冲突从严（本口合格 vs 对口不合格 → 不合格）
res = submitCounterpartReview(赵敏, 'ACCE-0003', '2号出入口', '不合格')
assert(!res.ok, '外包不能录入对口复核')
res = submitCounterpartReview(张磊, 'ACCE-0003', '2号出入口', '不合格')
assert(res.ok, '张磊录入对口复核不合格')
const rv2 = listReviews().find((x) => x.点位编号 === 'ACCE-0003')
assert(rv2.有效结论 === '不合格' && rv2.一致性.includes('冲突从严'), '合格vs不合格从严取不合格')
assert(listReviews().filter((x) => x.点位编号 === 'ACCE-0003').length === 1, '同对组复核只一行')
// 两处一致场景：0004 提交检查→判定正常，对口张磊复核合格
res = submitInspection(李芳, byCode('ACCE-0004').id)
assert(res.ok, '李芳提交0004检查')
res = judgeNormal(李芳, byCode('ACCE-0004').id)
assert(res.ok, '李芳判定0004正常')
res = submitCounterpartReview(张磊, 'ACCE-0004', '2号出入口', '合格')
assert(res.ok, '张磊对口复核0004合格')
const rv3 = listReviews().find((x) => x.点位编号 === 'ACCE-0004')
assert(rv3.有效结论 === '合格' && rv3.一致性 === '两处一致', '两处合格 → 一致、有效结论合格')
// 改口为存疑：存疑比合格严，有效结论应升级为存疑
res = submitCounterpartReview(张磊, 'ACCE-0004', '2号出入口', '存疑')
const rv4 = listReviews().find((x) => x.点位编号 === 'ACCE-0004')
assert(rv4.有效结论 === '存疑' && rv4.一致性.includes('冲突从严'), '合格vs存疑 → 从严取存疑')

// 10) 0006 提出整改 → 隐患新增整改中；缺项拦截
const beforeH = listRows('hazard').length
res = raiseRectification(张磊, byCode('ACCE-0006').id, '')
assert(!res.ok && res.message.includes('缺项'), '整改措施缺项拦截')
res = raiseRectification(张磊, byCode('ACCE-0006').id, '清理超登记授权')
assert(res.ok && listRows('hazard').length === beforeH + 1, '提出整改隐患清单+1')
assert(listRows('hazard').some((h) => h.来源点位 === 'ACCE-0006' && h.status === '整改中'), '新隐患整改中并回填来源')
res = raiseRectification(张磊, byCode('ACCE-0006').id, '再提一次')
assert(!res.ok && res.message.includes('重复拦截'), '同一整改重复立项被拦')

// 11) 闭环：点位闭环 + 存量隐患随之已闭环
res = closeRectification(张磊, byCode('ACCE-0002').id, '授权核对一致、盲区补点')
assert(res.ok, '0002闭环')
assert(byCode('ACCE-0002').status === '已闭环', '0002点位已闭环')
const h02 = listRows('hazard').find((h) => h.来源点位 === 'ACCE-0002')
assert(h02.status === '已闭环' && h02.闭环日期 !== '', '存量隐患HAZA-0001随之已闭环')
res = closeRectification(张磊, byCode('ACCE-0002').id, '再次闭环')
assert(!res.ok, '闭环后不可再改')

// 12) 无在册隐患的点位闭环 → 清单多一条已闭环
const closedBefore = listRows('hazard').filter((h) => h.status === '已闭环').length
res = closeRectification(张磊, byCode('ACCE-0006').id, '整改完成')
assert(res.ok, '0006闭环')
const closedAfter = listRows('hazard').filter((h) => h.status === '已闭环').length
assert(closedAfter === closedBefore + 1, '隐患清单多一条已闭环记录')

// 13) 材料导入去重
let imp = importMaterials(张磊, 'ACCE-0001,2026-10-06\\nACCE-0001,2026-10-06')
assert(imp.summary.accepted === 1 && imp.summary.duplicated === 1, '重复材料入账1拦回1')
imp = importMaterials(张磊, 'ACCE-0001,2026-10-06')
assert(imp.summary.accepted === 0 && imp.summary.duplicated === 1, '再次导入不留新行')
assert(listImports().filter((l) => l.点位编号 === 'ACCE-0001').length === 1, '指纹账只有最早版')
imp = importMaterials(赵敏, 'ACCE-0001,2026-10-07')
assert(imp.summary.denied === 1, '外包导入越权拒绝')

// 14) 登记权限、重复编号、推定与归属
res = registerPoint(赵敏, { 点位编号: 'ACCE-0099', 所属出入口: '1号出入口', 门禁类型: '人脸闸机', 监控覆盖: '全覆盖', 授权人数: '', 实际门数: 2 })
assert(!res.ok, '外包不能登记')
res = registerPoint(张磊, { 点位编号: 'ACCE-0001', 所属出入口: '1号出入口', 门禁类型: '人脸闸机', 监控覆盖: '全覆盖', 授权人数: '', 实际门数: 2 })
assert(!res.ok && res.message.includes('重复登记'), '编号重复被拒')
res = registerPoint(张磊, { 点位编号: 'ACCE-0010', 所属出入口: '1号出入口', 门禁类型: '人脸闸机', 监控覆盖: '全覆盖', 授权人数: '', 实际门数: 2 })
assert(res.ok && byCode('ACCE-0010').授权人数 === 4, '新点位门数×2推定=4')
assert(byCode('ACCE-0010').归属班组 === '一班' && byCode('ACCE-0010').责任岗位.includes('张磊'), '新点位归属与责任岗落位')

// 15) 待办与台账同读数；外人全只读
const todos = todoList(张磊)
const openPoints = points().filter((p) => ['待检查', '检查中'].includes(String(p.status))).length
const openHazards = listRows('hazard').filter((h) => h.status !== '已闭环').length
const reviewWaits = listReviews().filter((x) => x.一致性 === '待对口复核').length
const pointTodos = todos.filter((t) => t.key.startsWith('check-') || t.key.startsWith('verdict-')).length
assert(pointTodos === openPoints, '待办点位与台账一致（' + pointTodos + '=' + openPoints + '）')
assert(todos.filter((t) => t.key.startsWith('hazard-')).length === openHazards, '待办隐患与台账一致')
assert(todos.filter((t) => t.key.startsWith('review-')).length === reviewWaits, '待复核待办与复核清单一致')
assert(todoList(赵敏).every((t) => !t.可处理), '外包视角待办全只读')
assert(todoList(张磊).some((t) => t.可处理), '责任岗有可处理待办')

// 16) 审计留痕
const audits = listAudits()
assert(audits.some((a) => a.结果 === '越权拒绝' && a.账号.includes('赵敏')), '越权拒绝有赵敏留痕')
assert(audits.some((a) => a.结果 === '已执行' && a.账号.includes('张磊')), '执行有张磊留痕')
assert(audits.some((a) => a.结果 === '重复拦截'), '重复提交留痕')

// 17) 统计一致
const s = accessStats()
assert(s.点位总数 === points().length, '统计与台账一致')
out.push('')
out.push('统计：' + JSON.stringify(s))
out.push('待办总数 ' + todos.length + ' = 点位' + openPoints + ' + 隐患' + openHazards + ' + 待复核' + reviewWaits)
console.log(out.join('\\n'))
`

const bundled = await build({
  stdin: { contents: scenario, resolveDir: root, sourcefile: 'scenario.ts', loader: 'ts' },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  alias: { '@': resolve(root, 'src') },
})

vm.runInThisContext(bundled.outputFiles[0].text, { filename: 'scenario.bundle.cjs' })
