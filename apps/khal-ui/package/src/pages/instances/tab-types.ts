import type { InstanceRow } from '../../api/ext';

/** Props shared by every instance detail tab. */
export interface InstanceTabProps {
  /** The full instance row (all config columns). */
  instance: InstanceRow;
  /** True for the two live production instances — mutations are blocked. */
  isProduction: boolean;
  /** Re-fetch the instance row after a mutation lands. */
  refetchInstance: () => void;
}

/** Guard message shown on any mutating control targeting a production instance. */
export const PRODUCTION_GUARD_REASON = 'Production instance — mutations are prohibited here.';
