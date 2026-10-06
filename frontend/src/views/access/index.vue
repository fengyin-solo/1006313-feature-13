<template>
  <section class="page" data-module="access">
    <header class="page-head">
      <div>
        <h2>门禁安防运维管理</h2>
        <p class="page-desc">
          每个安防点位登记所属出入口、门禁类型、监控覆盖与授权人数；只有本出入口的安防责任岗位能提交检查与整改，其他人只读，越权改动一律拒绝并写明归属。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="migrateLegacy">存量台账迁移</button>
        <button class="btn" type="button" @click="importMaterials">导入检查材料</button>
        <button class="btn" type="button" @click="exportRows">导出门禁安防运维清单</button>
      </div>
    </header>

    <div class="identity-bar">
      <label class="filter-item">
        <span>当前身份</span>
        <select v-model="identityIndex" @change="switchIdentity">
          <option v-for="(item, index) in identities" :key="item.label" :value="index">
            {{ item.label }}
          </option>
        </select>
      </label>
      <span class="ownership-note">
        归属登记：东/西出入口 → 安防一班·安防责任岗；南出入口 → 安防二班·安防责任岗。规则冲突时以更严的一档为准，宽松档降级为提示。
      </span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
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
          <td v-for="column in columns" :key="column">{{ display(row[column]) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="doSubmitInspection(row)">提交检查</button>
            <button class="link" type="button" @click="doRaiseRectification(row)">提出整改</button>
            <button class="link" type="button" @click="doCloseRectification(row)">整改闭环</button>
            <button class="link" type="button" @click="doUpdateAuthorized(row)">调整授权人数</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无门禁安防运维数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条门禁安防运维记录</span>
      <span>
        待办读数（与运营概览同源）：待办点位 {{ todo.pendingPoints }} · 隐患已闭环 {{ todo.closedHazards }} · 隐患待办 {{ todo.pendingHazards }}
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="hintMessage" class="hint-text">{{ hintMessage }}</span>
      <span v-if="okMessage" class="ok-text">{{ okMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  ACCESS_IDENTITIES,
  accessTodoSummary,
  closeRectification,
  importInspectionMaterials,
  migrateLegacyRows,
  raiseRectification,
  submitInspection,
  updateAuthorizedCount,
  type GovernanceResult,
} from '@/api/access-governance'
import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('access')
const columns = [
  '点位编号',
  '所属出入口',
  '门禁类型',
  '监控覆盖',
  '授权人数',
  '授权对照值',
  '现场门数',
  '责任班组',
  '检查日期',
  '检查人员',
  '评估结论',
]
const statuses = ['待检查', '检查中', '状态正常', '需整改']
const filterFields = columns.slice(0, 3)
const identities = ACCESS_IDENTITIES

const session = useSessionStore()
const identityIndex = ref(0)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})
const errorMessage = ref('')
const hintMessage = ref('')
const okMessage = ref('')
const todo = ref(accessTodoSummary())

const stats = computed(() => [
  { label: '待检查点位', value: rows.value.filter((row) => row.status === '待检查').length },
  { label: '状态正常点位', value: rows.value.filter((row) => row.status === '状态正常').length },
  { label: '需整改点位', value: rows.value.filter((row) => row.status === '需整改').length },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function display(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '—'
  }
  return String(value)
}

function operator() {
  return { name: session.operator, role: session.role, team: session.team }
}

function switchIdentity() {
  session.switchIdentity(identities[identityIndex.value])
  show({ ok: true, message: `已切换身份：${identities[identityIndex.value].label}` })
}

function show(result: GovernanceResult) {
  errorMessage.value = result.ok ? '' : result.message
  hintMessage.value = result.hint ?? ''
  okMessage.value = result.ok ? result.message : ''
  if (result.ok) {
    reload()
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function doSubmitInspection(row: EntryRow) {
  show(submitInspection(Number(row.id), today(), operator()))
}

function doRaiseRectification(row: EntryRow) {
  show(raiseRectification(Number(row.id), operator()))
}

function doCloseRectification(row: EntryRow) {
  const input = window.prompt(
    '填写评估结论（写回隐患整改清单的复核结论，两处一致）',
    `复核通过：${row['所属出入口']}${row['点位编号']}整改完成`,
  )
  if (input === null) {
    return
  }
  show(closeRectification(Number(row.id), input, operator()))
}

function doUpdateAuthorized(row: EntryRow) {
  const input = window.prompt('调整授权人数', String(row['授权人数'] ?? ''))
  if (input === null) {
    return
  }
  show(updateAuthorizedCount(Number(row.id), Number(input), operator()))
}

function migrateLegacy() {
  show(migrateLegacyRows())
}

// 演示批次：三条材料里两条与既有台账/批次前条重复，重复导入只留最早一版。
const DEMO_MATERIALS: EntryRow[] = [
  {
    id: 0, status: '待检查', pending: true, abnormal: false,
    点位编号: 'ACCE-0101', 所属出入口: '西出入口', 门禁类型: '人脸识别', 监控覆盖: '全覆盖',
    授权人数: 24, 现场门数: 2, 责任班组: '安防一班', 检查日期: '2026-10-01', 检查人员: '张谨',
    评估结论: '', 交接班次: '白班',
  },
  {
    id: 0, status: '待检查', pending: true, abnormal: false,
    点位编号: 'ACCE-0101', 所属出入口: '西出入口', 门禁类型: '人脸识别', 监控覆盖: '全覆盖',
    授权人数: 99, 现场门数: 2, 责任班组: '安防一班', 检查日期: '2026-10-01', 检查人员: '张谨',
    评估结论: '', 交接班次: '白班',
  },
  {
    id: 0, status: '待检查', pending: true, abnormal: false,
    点位编号: 'ACCE-0003', 所属出入口: '南出入口', 门禁类型: '人脸识别', 监控覆盖: '部分覆盖',
    授权人数: 20, 现场门数: 2, 责任班组: '安防二班', 检查日期: '2026-09-03', 检查人员: '李卫',
    评估结论: '', 交接班次: '中班',
  },
]

function importMaterials() {
  show(importInspectionMaterials(DEMO_MATERIALS))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    todo.value = accessTodoSummary()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '门禁安防运维列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.identity-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.ownership-note {
  color: #5b6472;
  font-size: 13px;
}
.hint-text {
  color: #b26a00;
}
.ok-text {
  color: #1a7f37;
}
</style>
