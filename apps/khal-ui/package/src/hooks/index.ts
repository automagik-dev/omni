export { mergeById } from './merge-by-id';
export type { MergeByIdOptions } from './merge-by-id';
export { SseConnection } from './sse-connection';
export type {
  EventSourceFactory,
  EventSourceLike,
  SseConnectionOptions,
  TimerHost,
} from './sse-connection';
export { useSse } from './useSse';
export type { SseMessage, UseSseOptions, UseSseResult } from './useSse';
export { useIncrementalPoll } from './useIncrementalPoll';
export type { UseIncrementalPollOptions, UseIncrementalPollResult } from './useIncrementalPoll';
export { useDiag } from './useDiag';
export type { DiagResult, UseDiagResult } from './useDiag';
export { useOmniMutation, useOmniQuery } from './useOmniQuery';
export type {
  OmniMutationConfig,
  OmniMutationResult,
} from './useOmniQuery';
