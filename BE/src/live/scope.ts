import type { HubLinkRef, LiveScope } from './hub-types'

/** Phạm vi `scope` có bao gồm liên kết `ref` không. Hàm thuần để dễ kiểm thử phân quyền. */
export function scopeMatches(scope: LiveScope, ref: HubLinkRef): boolean {
  switch (scope.kind) {
    case 'all':
      return true
    case 'owner':
      return ref.ownerId !== null && ref.ownerId === scope.ownerId
    case 'link':
      return ref.linkId === scope.linkId
  }
}
