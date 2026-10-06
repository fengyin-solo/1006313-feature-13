<template>
  <section class="page" data-module="access">
    <header class="page-head">
      <div>
        <h2>门禁安防运维管理（按归属管控）</h2>
        <p class="page-desc">
          每个安防点位登记所属出入口、门禁类型、监控覆盖与授权人数；仅本出入口安防责任岗位能提交检查与整改，其他人只读，越权改动一律拒绝并写明归属。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openRegister">登记安防点位</button>
        <button class="btn" type="button" @click="openImport">材料导入</button>
        <button class="btn ghost" type="button" @click="resetAll">重置演示数据</button>
      </div>
    </header>

    <!-- 当前账号：身份决定边界 -->
    <div class="identity-bar">
      <div class="identity-main">
        <span class="identity-label">当前账号</span>
        <select v-model="operatorId" class="identity-select" @change="switchOperator">
          <option v-for="op in OPERATORS" :key="op.id" :value="op.id">
            {{ op.name }}（{{ op.id }}）· {{ op.role }} · {{ op.team }}{{ op.entrance ? ` · ${op.entrance}` : '' }}
          </option>
        </select>
        <span class="identity-note">{{ current.note }}</span>
      </div>
      <span class="identity-shift">{{ current.shift }}</span>
    </div>

    <!-- 存量迁移报告 -->
    <div v-if="migration" class="migration-banner">
      <strong>存量台账迁移（批次 {{ batch }}）：</strong>
      点位 {{ migration.点位总数 }} 个 ｜ 授权人数：现场登记 {{ migration.现场登记 }}、按现场实际门数×2 推定 {{ migration.按门数推定 }}、门数缺失显式留空 {{ migration.授权人数留空 }}
      ｜ 归属：按交接班次迁移 {{ migration.按交接班次归属 }}、无交接记录显式留空 {{ migration.归属留空 }}
      <span class="migration-rule">推定口径：门数×2（一主一备）；门数×1 仅在「对照授权人数」列留底</span>
    </div>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 待办：台账实时派生，两边读数一致 -->
    <div class="todo-panel">
      <div class="todo-head">
        <h3>待办清单（与台账同源派生 · 共 {{ todos.length }} 项，本账号可处理 {{ actionableTodos.length }} 项）</h3>
      </div>
      <table class="data-table" v-if="todos.length">
        <thead>
          <tr><th>点位</th><th>待办事项</th><th>归属</th><th>本账号</th></tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="todo.key" :class="{ 'row-locked': !todo.可处理 }">
            <td>{{ todo.点位编号 }}</td>
            <td>{{ todo.事项 }}</td>
            <td>{{ todo.归属 }}</td>
            <td>
              <span v-if="todo.可处理" class="ok-text">可处理</span>
              <span v-else class="muted-text">只读：{{ todo.原因 }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state" style="padding:8px">暂无待办，台账与待办读数一致（均为 0）</p>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>点位编号</span>
        <input v-model="filters.点位编号" placeholder="按点位编号检索" />
      </label>
      <label class="filter-item">
        <span>所属出入口</span>
        <input v-model="filters.所属出入口" placeholder="按出入口检索" />
      </label>
      <label class="filter-item">
        <span>归属班组</span>
        <input v-model="filters.归属班组" placeholder="按班组检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '授权人数'">
              <strong>{{ row[column] === '' ? '显式留空' : row[column] }}</strong>
              <button class="link inline-link" type="button" @click="openAdjust(row)">调整</button>
            </template>
            <template v-else-if="column === '对照授权人数'">
              <span class="muted-text">{{ row[column] === '' ? '—' : row[column] }}（对照不采用）</span>
            </template>
            <template v-else-if="column === '责任岗位'">
              {{ row[column] === '' ? '待指派（留空）' : row[column] }}
            </template>
            <template v-else>{{ row[column] === '' ? '显式留空' : (row[column] ?? '—') }}</template>
          </td>
          <td>
            <span :class="['status-badge', `status-${String(row.status)}`]">{{ row.status }}</span>
            <div v-if="row.评估结论" class="muted-text">评估：{{ row.评估结论 }}</div>
          </td>
          <td class="row-actions">
            <button v-if="String(row.status) === '待检查'" class="link" type="button" @click="act('提交检查', row)">提交检查</button>
            <template v-if="String(row.status) === '检查中'">
              <button class="link" type="button" @click="act('判定正常', row)">判定正常</button>
              <button class="link danger-link" type="button" @click="openRectify(row)">提出整改</button>
            </template>
            <button v-if="String(row.status) === '需整改'" class="link" type="button" @click="openClose(row)">整改闭环</button>
            <span v-if="['状态正常', '已闭环'].includes(String(row.status))" class="muted-text">终态只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的安防点位</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 个安防点位 ｜ 授权人数留空 {{ stats.授权人数留空 }} 个（门数缺失，待现场补齐）</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 隐患整改清单（联动只读视图） -->
    <div class="link-panel">
      <h3>隐患整改清单（门禁整改自动并入，闭环后多一条已闭环记录）</h3>
      <table class="data-table">
        <thead>
          <tr><th>隐患编号</th><th>隐患部位</th><th>整改措施</th><th>来源点位</th><th>责任人员</th><th>闭环日期</th><th>状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="hazard in hazards" :key="String(hazard.id)">
            <td>{{ hazard.隐患编号 }}</td>
            <td>{{ hazard.隐患部位 }}</td>
            <td>{{ hazard.整改措施 }}</td>
            <td>{{ hazard.来源点位 }}</td>
            <td>{{ hazard.责任人员 }}</td>
            <td>{{ hazard.闭环日期 || '—' }}</td>
            <td><span :class="['status-badge', `status-${String(hazard.status)}`]">{{ hazard.status }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 出入口复核清单 -->
    <div class="link-panel">
      <h3>出入口复核清单（评估结论写回对口出入口，两处结论一致；冲突取更严一档）</h3>
      <table class="data-table">
        <thead>
          <tr><th>对组</th><th>点位</th><th>本口结论</th><th>对口结论</th><th>有效结论</th><th>一致性</th><th>更新时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="review in reviews" :key="String(review.id)">
            <td>{{ review.对组 }}</td>
            <td>{{ review.点位编号 }}</td>
            <td>{{ review.本口结论 }}</td>
            <td>{{ review.对口结论 }}</td>
            <td><strong>{{ review.有效结论 }}</strong></td>
            <td>{{ review.一致性 }}</td>
            <td class="muted-text">{{ review.更新时间 }}</td>
            <td>
              <button
                v-if="review.一致性 === '待对口复核' || !['合格', '不合格', '存疑'].includes(String(review.对口结论))"
                class="link"
                type="button"
                @click="openCounterpart(review)"
              >
                录入对口复核
              </button>
              <span v-else class="muted-text">已对齐</span>
            </td>
          </tr>
          <tr v-if="!reviews.length">
            <td colspan="8" class="empty-state">暂无复核记录：判定正常或提出整改后，结论自动写回对口出入口</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 导入指纹账 -->
    <div class="link-panel">
      <h3>材料导入留底（同一指纹只留最早一版，不会多出一行）</h3>
      <table class="data-table">
        <thead><tr><th>指纹</th><th>点位</th><th>检查日期</th><th>导入时间</th><th>导入账号</th></tr></thead>
        <tbody>
          <tr v-for="log in importLogs" :key="String(log.id)">
            <td class="muted-text">{{ log.指纹 }}</td>
            <td>{{ log.点位编号 }}</td>
            <td>{{ log.检查日期 || '—' }}</td>
            <td>{{ log.导入时间 }}</td>
            <td>{{ log.导入账号 }}</td>
          </tr>
          <tr v-if="!importLogs.length"><td colspan="5" class="empty-state">尚未导入材料</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 操作审计轨迹 -->
    <div class="link-panel">
      <h3>操作留痕（含越权拒绝、重复拦截、缺项拦截，写明是谁动的、归属是谁）</h3>
      <table class="data-table">
        <thead><tr><th>时间</th><th>账号</th><th>岗位</th><th>班组</th><th>动作</th><th>对象</th><th>结果</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="audit in audits" :key="String(audit.id)">
            <td>{{ audit.time }}</td>
            <td>{{ audit.账号 }}</td>
            <td>{{ audit.岗位 }}</td>
            <td>{{ audit.班组 }}</td>
            <td>{{ audit.动作 }}</td>
            <td>{{ audit.对象 }}</td>
            <td><span :class="audit.结果 === '已执行' ? 'ok-text' : 'error-text'">{{ audit.结果 }}</span></td>
            <td>{{ audit.说明 }}</td>
          </tr>
          <tr v-if="!audits.length"><td colspan="8" class="empty-state">暂无操作记录</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 调整授权人数 -->
    <div v-if="dialog === 'adjust'" class="modal-mask" @click.self="dialog = ''">
      <div class="modal">
        <h3>调整授权人数 · {{ activeRow?.点位编号 }}</h3>
        <p class="muted-text">归属：{{ activeRow?.所属出入口 }} ｜ 责任岗位 {{ activeRow?.责任岗位 || '待指派' }}（仅本口责任岗可改，改动留痕）</p>
        <label class="form-row"><span>新授权人数</span><input v-model.number="adjustValue" type="number" min="0" /></label>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="confirmAdjust">确认调整</button>
          <button class="btn ghost" type="button" @click="dialog = ''">取消</button>
        </div>
      </div>
    </div>

    <!-- 提出整改 -->
    <div v-if="dialog === 'rectify'" class="modal-mask" @click.self="dialog = ''">
      <div class="modal">
        <h3>提出整改 · {{ activeRow?.点位编号 }}</h3>
        <label class="form-row"><span>整改措施（缺项将被拦截）</span><textarea v-model="measure" rows="3" placeholder="如：清理超登记授权、补装监控摄像头"></textarea></label>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="confirmRectify">提交并并入隐患清单</button>
          <button class="btn ghost" type="button" @click="dialog = ''">取消</button>
        </div>
      </div>
    </div>

    <!-- 整改闭环 -->
    <div v-if="dialog === 'close'" class="modal-mask" @click.self="dialog = ''">
      <div class="modal">
        <h3>整改闭环 · {{ activeRow?.点位编号 }}</h3>
        <label class="form-row"><span>整改完成说明</span><textarea v-model="measure" rows="3" placeholder="如：授权名单已核对一致，监控盲区已补点"></textarea></label>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="confirmClose">闭环（隐患清单同步加一条已闭环）</button>
          <button class="btn ghost" type="button" @click="dialog = ''">取消</button>
        </div>
      </div>
    </div>

    <!-- 登记点位 -->
    <div v-if="dialog === 'register'" class="modal-mask" @click.self="dialog = ''">
      <div class="modal">
        <h3>登记安防点位</h3>
        <div class="form-grid">
          <label class="form-row"><span>点位编号</span><input v-model="form.点位编号" placeholder="ACCE-00xx" /></label>
          <label class="form-row">
            <span>所属出入口</span>
            <select v-model="form.所属出入口">
              <option v-for="entrance in ENTRANCES" :key="entrance" :value="entrance">{{ entrance }}</option>
            </select>
          </label>
          <label class="form-row"><span>门禁类型</span><input v-model="form.门禁类型" placeholder="双向刷卡门/人脸闸机" /></label>
          <label class="form-row">
            <span>监控覆盖</span>
            <select v-model="form.监控覆盖">
              <option value="">显式留空</option>
              <option value="全覆盖">全覆盖</option>
              <option value="部分覆盖">部分覆盖</option>
              <option value="盲区">盲区</option>
            </select>
          </label>
          <label class="form-row"><span>授权人数（留空则按门数×2推定）</span><input v-model.number="form.授权人数" type="number" min="0" placeholder="留空=按门数推定" /></label>
          <label class="form-row"><span>现场实际门数</span><input v-model.number="form.实际门数" type="number" min="0" /></label>
        </div>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="confirmRegister">登记</button>
          <button class="btn ghost" type="button" @click="dialog = ''">取消</button>
        </div>
      </div>
    </div>

    <!-- 材料导入 -->
    <div v-if="dialog === 'import'" class="modal-mask" @click.self="dialog = ''">
      <div class="modal">
        <h3>材料导入</h3>
        <p class="muted-text">每行一份：点位编号,检查日期（如 ACCE-0001,2026-10-06）。同一「点位+日期」重复导入只留最早一版；非本口点位一律越权拒绝。</p>
        <textarea v-model="importText" rows="6" class="import-box" placeholder="ACCE-0001,2026-10-06&#10;ACCE-0002,2026-10-06"></textarea>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="confirmImport">开始导入</button>
          <button class="btn ghost" type="button" @click="dialog = ''">取消</button>
        </div>
      </div>
    </div>

    <!-- 对口复核 -->
    <div v-if="dialog === 'counterpart'" class="modal-mask" @click.self="dialog = ''">
      <div class="modal">
        <h3>对口复核 · {{ activeReview?.点位编号 }}</h3>
        <p class="muted-text">{{ activeReview?.对组 }}：仅{{ activeReview?.复核出入口 }}责任岗位可录入；与本口结论冲突时取更严一档。</p>
        <label class="form-row">
          <span>复核结论</span>
          <select v-model="counterVerdict">
            <option value="合格">合格</option>
            <option value="存疑">存疑</option>
            <option value="不合格">不合格</option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="confirmCounterpart">写回复核清单</button>
          <button class="btn ghost" type="button" @click="dialog = ''">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { filterRows } from '@/api/local-service'
import { listRows } from '@/data/local-store'
import { OPERATORS, ENTRANCES } from '@/data/access-domain'
import { useSessionStore } from '@/stores/session'
import {
  accessStats,
  adjustAuthorized,
  closeRectification,
  ensureMigration,
  importMaterials,
  judgeNormal,
  listAudits,
  listImports,
  listReviews,
  migrationReport,
  raiseRectification,
  registerPoint,
  resetAccessGovernance,
  submitCounterpartReview,
  submitInspection,
  todoList,
} from '@/api/access-service'
import type { AuditRow, EntryRow, ImportLogRow, MigrationReport, ReviewRow, TodoRow } from '@/data/types'

const session = useSessionStore()
const batch = 'MIG-20261006-01'

const columns = [
  '点位编号', '所属出入口', '门禁类型', '监控覆盖', '授权人数', '对照授权人数',
  '归属班组', '责任岗位', '授权来源', '归属依据', '检查日期', '检查人员', '实际门数',
]

const rows = ref<EntryRow[]>([])
const hazards = ref<EntryRow[]>([])
const audits = ref<AuditRow[]>([])
const importLogs = ref<ImportLogRow[]>([])
const reviews = ref<ReviewRow[]>([])
const todos = ref<TodoRow[]>([])
const stats = ref(accessStats())
const migration = ref<MigrationReport | null>(null)
const total = ref(0)
const message = ref('')
const messageOk = ref(true)
const filters = ref<Record<string, string>>({ 点位编号: '', 所属出入口: '', 归属班组: '' })

const operatorId = ref(session.operatorId)
const current = computed(() => session.operator)

const dialog = ref('')
const activeRow = ref<EntryRow | null>(null)
const activeReview = ref<ReviewRow | null>(null)
const adjustValue = ref<number | ''>('')
const measure = ref('')
const counterVerdict = ref('合格')
const importText = ref('')
const form = reactive({ 点位编号: '', 所属出入口: ENTRANCES[0], 门禁类型: '', 监控覆盖: '', 授权人数: '' as number | '', 实际门数: '' as number | '' })

const statusSummary = computed(() =>
  ['待检查', '检查中', '状态正常', '需整改', '已闭环'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const statCards = computed(() => [
  { label: '点位总数', value: stats.value.点位总数 },
  { label: '待检查点位', value: stats.value.待检查 },
  { label: '需整改点位', value: stats.value.需整改 },
  { label: '已闭环点位', value: stats.value.已闭环 },
  { label: '授权人数留空', value: stats.value.授权人数留空 },
])

const actionableTodos = computed(() => todos.value.filter((todo) => todo.可处理))

function switchOperator() {
  session.setOperatorById(operatorId.value)
  message.value = `已切换为 ${current.value.name}（${current.value.role}）`
  messageOk.value = true
  reload()
}

function flash(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function resetFilters() {
  filters.value = { 点位编号: '', 所属出入口: '', 归属班组: '' }
  reload()
}

function reload() {
  const active = Object.fromEntries(Object.entries(filters.value).filter(([, v]) => v.trim() !== ''))
  rows.value = filterRows(listRows('access'), active)
  total.value = rows.value.length
  hazards.value = listRows('hazard')
  audits.value = listAudits()
  importLogs.value = listImports()
  reviews.value = listReviews()
  todos.value = todoList(session.operator)
  stats.value = accessStats()
  migration.value = migrationReport()
}

function act(action: string, row: EntryRow) {
  let res: { ok: boolean; message: string }
  if (action === '提交检查') res = submitInspection(session.operator, Number(row.id))
  else if (action === '判定正常') res = judgeNormal(session.operator, Number(row.id))
  else return
  flash(res.ok, res.message)
  reload()
}

function openAdjust(row: EntryRow) {
  activeRow.value = row
  adjustValue.value = row.授权人数 === '' ? '' : Number(row.授权人数)
  dialog.value = 'adjust'
}
function confirmAdjust() {
  if (!activeRow.value) return
  const res = adjustAuthorized(session.operator, Number(activeRow.value.id), Number(adjustValue.value))
  flash(res.ok, res.message)
  dialog.value = ''
  reload()
}

function openRectify(row: EntryRow) {
  activeRow.value = row
  measure.value = ''
  dialog.value = 'rectify'
}
function confirmRectify() {
  if (!activeRow.value) return
  const res = raiseRectification(session.operator, Number(activeRow.value.id), measure.value)
  flash(res.ok, res.message)
  dialog.value = ''
  reload()
}

function openClose(row: EntryRow) {
  activeRow.value = row
  measure.value = ''
  dialog.value = 'close'
}
function confirmClose() {
  if (!activeRow.value) return
  const res = closeRectification(session.operator, Number(activeRow.value.id), measure.value)
  flash(res.ok, res.message)
  dialog.value = ''
  reload()
}

function openRegister() {
  Object.assign(form, { 点位编号: '', 所属出入口: ENTRANCES[0], 门禁类型: '', 监控覆盖: '', 授权人数: '', 实际门数: '' })
  dialog.value = 'register'
}
function confirmRegister() {
  const res = registerPoint(session.operator, { ...form })
  flash(res.ok, res.message)
  if (res.ok) dialog.value = ''
  reload()
}

function openImport() {
  importText.value = ''
  dialog.value = 'import'
}
function confirmImport() {
  const { result } = importMaterials(session.operator, importText.value)
  flash(result.ok, result.message)
  dialog.value = ''
  reload()
}

function openCounterpart(review: ReviewRow) {
  activeReview.value = review
  counterVerdict.value = '合格'
  dialog.value = 'counterpart'
}
function confirmCounterpart() {
  if (!activeReview.value) return
  const res = submitCounterpartReview(
    session.operator,
    String(activeReview.value.点位编号),
    String(activeReview.value.来源出入口),
    counterVerdict.value,
  )
  flash(res.ok, res.message)
  dialog.value = ''
  reload()
}

function resetAll() {
  const report = resetAccessGovernance()
  migration.value = report
  reload()
  flash(true, '演示数据已重置并重新迁移')
}

onMounted(() => {
  ensureMigration()
  reload()
})
</script>
