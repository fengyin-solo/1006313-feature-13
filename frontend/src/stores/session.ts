import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '张谨',
    role: '安防责任岗',
    team: '安防一班',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下综合管廊运行维护管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchIdentity(identity: { name: string; role: string; team: string }) {
      this.operator = identity.name
      this.role = identity.role
      this.team = identity.team
    },
  },
})
