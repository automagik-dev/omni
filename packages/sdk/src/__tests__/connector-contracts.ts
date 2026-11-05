/** Compile-time proofs: this file is included by the SDK's regular tsc gate. */
import type { CreateConnectorBody, CreateConnectorSubscriptionBody, UpdateConnectorBody } from '../index';
import type { components } from '../types.generated';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type SubscriptionContract = Assert<
  Equal<CreateConnectorSubscriptionBody, components['schemas']['CreateSubscriptionBody']>
>;
export type CreateContract = Assert<Equal<CreateConnectorBody, components['schemas']['CreateConnectorBody']>>;
export type UpdateContract = Assert<Equal<UpdateConnectorBody, components['schemas']['UpdateConnectorBody']>>;

export const subscriptionBodies: CreateConnectorSubscriptionBody[] = [
  {
    eventKey: 'taskCreated',
    targetAutomationId: '33333333-3333-4333-8333-333333333333',
    verificationSecret: 'legacy-subscription-secret',
  },
  {
    ingress: 'subscription',
    eventKey: 'taskCreated',
    targetAutomationId: '33333333-3333-4333-8333-333333333333',
    verificationSecret: 'legacy-subscription-secret',
  },
  { ingress: 'connector', eventKey: 'connector.gitlab.*', filters: { projectId: 7 } },
  {
    ingress: 'connector',
    eventKey: 'connector.gitlab.merge_request.merged',
    targetAutomationId: '33333333-3333-4333-8333-333333333333',
  },
];

// These must remain compile errors; a widened or weakened public union fails tsc.
// @ts-expect-error Legacy ingress requires its per-subscription secret.
const missingLegacySecret: CreateConnectorSubscriptionBody = { eventKey: 'taskCreated', targetAutomationId: 'target' };
const connectorWithSecret: CreateConnectorSubscriptionBody = {
  ingress: 'connector',
  eventKey: 'connector.gitlab.*',
  // @ts-expect-error Connector ingress never accepts a per-subscription secret.
  verificationSecret: 'forbidden',
};
void missingLegacySecret;
void connectorWithSecret;
