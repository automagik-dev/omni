/**
 * Nav visibility — the sidebar and the ⌘K palette only offer routes the current
 * role may actually open, so the rail and the router's {@link RequireCapability}
 * gates tell the operator the same story. Pure, so it is unit-testable without a
 * host: the caller passes its own `can`.
 */
import type { Capability } from '../auth/capabilities';
import { routeCapability } from '../auth/capabilities';
import type { NavGroup } from './sitemap';

export function visibleNavGroups(groups: NavGroup[], can: (capability: Capability) => boolean): NavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => can(routeCapability(item.path))) }))
    .filter((group) => group.items.length > 0);
}
