import { SEED_COLLECTIONS, SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries:v2'
const COLLECTION_KEY = 'urban-utility-tunnel:access:v2'

export const ACCESS_COLLECTIONS = ['audits', 'imports', 'reviews'] as const
export type AccessCollectionKey = (typeof ACCESS_COLLECTIONS)[number]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// ── 门禁治理联动集合：审计轨迹、导入指纹、复核清单，独立于通用台账 ──

type GenericRow = Record<string, string | number>

function readCollections(): Record<AccessCollectionKey, GenericRow[]> {
  const fallback = clone(SEED_COLLECTIONS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(COLLECTION_KEY)
  if (!raw) {
    window.localStorage.setItem(COLLECTION_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<AccessCollectionKey, GenericRow[]>>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(COLLECTION_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let collectionCache: Record<AccessCollectionKey, GenericRow[]> | null = null

export function listCollection(key: AccessCollectionKey): GenericRow[] {
  if (collectionCache === null) {
    collectionCache = readCollections()
  }
  return collectionCache[key] ?? []
}

export function saveCollection(key: AccessCollectionKey, rows: GenericRow[]): void {
  const next = { ...(collectionCache ?? readCollections()), [key]: rows }
  collectionCache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(COLLECTION_KEY, JSON.stringify(next))
  }
}

export function resetCollections(): void {
  collectionCache = clone(SEED_COLLECTIONS)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(COLLECTION_KEY, JSON.stringify(collectionCache))
  }
}
