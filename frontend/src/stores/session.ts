import { defineStore } from 'pinia'

import { findOperator, OPERATORS } from '@/data/access-domain'
import type { Operator } from '@/data/types'

export const useSessionStore = defineStore('session', {
  state: () => {
    const operator = findOperator('U1001')
    return {
      operatorId: operator.id,
      operatorName: operator.name,
      operator,
      shiftLabel: operator.shift,
      scope: '城市地下综合管廊运行维护管理平台',
    }
  },
  getters: {
    canOperate: (state) => state.operatorName.length > 0,
  },
  actions: {
    setOperator(operator: Operator) {
      this.operatorId = operator.id
      this.operatorName = operator.name
      this.operator = operator
      this.shiftLabel = operator.shift
    },
    setOperatorById(id: string) {
      this.setOperator(findOperator(id))
    },
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})

export { OPERATORS }
