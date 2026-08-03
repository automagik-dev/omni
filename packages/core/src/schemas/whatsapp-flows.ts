/**
 * WhatsApp Flow JSON validation (Meta Flow JSON v6.x, data API v3.0).
 *
 * Meta only reports `validation_errors` *after* an asset upload round-trip.
 * This schema encodes the structural rules — including the ones that fail
 * silently or cryptically in production — so callers get fast local feedback
 * before any Graph API call:
 *
 *   - `RichText.text` must be a string (Meta rejects arrays in v6.3+).
 *   - `RichText` must be the only component on its screen (Footer excepted).
 *   - `data_api_version` marks a flow as endpoint-backed; sending one without
 *     a registered `endpoint_uri` makes the client show "an error occurred"
 *     on open with no webhook trace. The pairing is enforced via
 *     `validateFlowJson(..., { dynamic })` because `endpoint_uri` is a flow
 *     *property* (set via Graph API), not part of the Flow JSON itself.
 *   - At least one `terminal: true` screen; `routing_model` and `navigate`
 *     actions may only reference declared screen ids.
 *
 * Unknown component types are allowed to pass through (Meta ships new
 * components frequently) — rules apply to the known set only.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** `on-click-action` / `on-select-action` object on Footer and interactive components. */
export const FlowActionSchema = z
  .object({
    name: z.enum(['navigate', 'complete', 'data_exchange', 'open_url', 'update_data']),
    next: z
      .object({
        type: z.enum(['screen', 'plugin']),
        name: z.string().min(1),
      })
      .optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    url: z.string().optional(),
  })
  .passthrough();

const dataSourceEntry = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
  })
  .passthrough();

/**
 * Known component shapes. Each entry validates the fields the rules below
 * depend on; everything else passes through. Unknown `type` values fall into
 * the generic branch so new Meta components don't hard-fail local validation.
 */
export const FlowComponentSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal('RichText'),
        // Meta v6.3 rejects arrays here — the docs' examples are misleading.
        text: z.string().min(1),
      })
      .passthrough(),
    z
      .object({
        type: z.literal('Image'),
        /** Base64-encoded image bytes (not a URL). */
        src: z.string().min(1),
        height: z.number().int().positive().optional(),
      })
      .passthrough(),
    z
      .object({
        type: z.literal('Footer'),
        label: z.string().min(1),
        'on-click-action': FlowActionSchema,
      })
      .passthrough(),
    z
      .object({
        type: z.literal('Form'),
        name: z.string().min(1),
        children: z.array(FlowComponentSchema),
      })
      .passthrough(),
    z
      .object({
        type: z.enum(['Dropdown', 'RadioButtonsGroup', 'CheckboxGroup', 'ChipsSelector']),
        name: z.string().min(1),
        'data-source': z.array(dataSourceEntry).min(1),
      })
      .passthrough(),
    z
      .object({
        type: z.enum(['TextInput', 'TextArea', 'DatePicker', 'OptIn']),
        name: z.string().min(1),
      })
      .passthrough(),
    z
      .object({
        type: z.enum(['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption']),
        text: z.string().min(1),
      })
      .passthrough(),
    // Generic fallback: any other component type Meta may introduce.
    z
      .object({ type: z.string().min(1) })
      .passthrough()
      .refine(
        (c) =>
          ![
            'RichText',
            'Image',
            'Footer',
            'Form',
            'Dropdown',
            'RadioButtonsGroup',
            'CheckboxGroup',
            'ChipsSelector',
            'TextInput',
            'TextArea',
            'DatePicker',
            'OptIn',
            'TextHeading',
            'TextSubheading',
            'TextBody',
            'TextCaption',
          ].includes(c.type as string),
        { message: 'known component failed its specific shape' },
      ),
  ]),
);

// ---------------------------------------------------------------------------
// Screens + document
// ---------------------------------------------------------------------------

export const FlowScreenSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    terminal: z.boolean().optional(),
    /** Screen-level dynamic data contract (endpoint-backed flows). */
    data: z.record(z.string(), z.unknown()).optional(),
    refresh_on_back: z.boolean().optional(),
    layout: z
      .object({
        type: z.literal('SingleColumnLayout'),
        children: z.array(FlowComponentSchema),
      })
      .passthrough(),
  })
  .passthrough();

type RefineCtx = z.RefinementCtx;
type FlowDoc = {
  routing_model?: Record<string, string[]>;
  screens: Array<z.infer<typeof FlowScreenSchema>>;
};

function addIssue(ctx: RefineCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function checkScreenIdentity(flow: FlowDoc, idSet: Set<string>, ctx: RefineCtx): void {
  if (idSet.size !== flow.screens.length) {
    addIssue(ctx, ['screens'], 'screen ids must be unique');
  }
  if (!flow.screens.some((s) => s.terminal === true)) {
    addIssue(ctx, ['screens'], 'at least one screen must set terminal: true');
  }
}

function checkRoutingModel(flow: FlowDoc, idSet: Set<string>, ctx: RefineCtx): void {
  for (const [from, targets] of Object.entries(flow.routing_model ?? {})) {
    if (!idSet.has(from)) {
      addIssue(ctx, ['routing_model', from], `routing_model references unknown screen '${from}'`);
    }
    for (const target of targets) {
      if (!idSet.has(target)) {
        addIssue(ctx, ['routing_model', from], `routing_model routes '${from}' to unknown screen '${target}'`);
      }
    }
  }
}

function checkRichTextIsolation(screen: FlowDoc['screens'][number], screenIdx: number, ctx: RefineCtx): void {
  const children = screen.layout.children as Array<Record<string, unknown>>;
  const hasRichText = children.some((c) => c.type === 'RichText');
  if (hasRichText && children.some((c) => c.type !== 'RichText' && c.type !== 'Footer')) {
    addIssue(
      ctx,
      ['screens', screenIdx, 'layout', 'children'],
      `screen '${screen.id}': RichText must be the only component on the screen (Footer excepted)`,
    );
  }
}

/** Recursively verify that every navigate action targets a declared screen. */
function checkNavigateTargets(
  node: unknown,
  path: (string | number)[],
  screen: FlowDoc['screens'][number],
  screenIdx: number,
  idSet: Set<string>,
  ctx: RefineCtx,
): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => checkNavigateTargets(child, [...path, i], screen, screenIdx, idSet, ctx));
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const action = obj['on-click-action'] as Record<string, unknown> | undefined;
  if (action?.name === 'navigate') {
    const next = action.next as Record<string, unknown> | undefined;
    if (next?.type === 'screen' && typeof next.name === 'string' && !idSet.has(next.name)) {
      addIssue(
        ctx,
        ['screens', screenIdx, ...path],
        `screen '${screen.id}': navigate targets unknown screen '${next.name}'`,
      );
    }
  }
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null) {
      checkNavigateTargets(value, [...path, key], screen, screenIdx, idSet, ctx);
    }
  }
}

export const FlowJsonSchema = z
  .object({
    version: z.string().min(1),
    /** Present ⇔ the flow is endpoint-backed (see validateFlowJson pairing). */
    data_api_version: z.literal('3.0').optional(),
    routing_model: z.record(z.string(), z.array(z.string())).optional(),
    screens: z.array(FlowScreenSchema).min(1),
  })
  .passthrough()
  .superRefine((flow, ctx) => {
    const idSet = new Set(flow.screens.map((s) => s.id));
    checkScreenIdentity(flow, idSet, ctx);
    checkRoutingModel(flow, idSet, ctx);
    flow.screens.forEach((screen, screenIdx) => {
      checkRichTextIsolation(screen, screenIdx, ctx);
      checkNavigateTargets(screen.layout.children, ['layout', 'children'], screen, screenIdx, idSet, ctx);
    });
  });

export type FlowJson = z.infer<typeof FlowJsonSchema>;

// ---------------------------------------------------------------------------
// Full validation (schema + endpoint pairing)
// ---------------------------------------------------------------------------

export interface FlowJsonIssue {
  path: string;
  message: string;
}

export interface ValidateFlowJsonResult {
  valid: boolean;
  issues: FlowJsonIssue[];
}

/**
 * Validate a Flow JSON document (object or stringified) against the schema
 * *and* the endpoint pairing rule that Meta itself does not check:
 *
 *   - `dynamic: true` (an `endpoint_uri` will be registered) requires
 *     `data_api_version: '3.0'`.
 *   - `data_api_version` without `dynamic` produces a flow that errors on
 *     open — the exact failure we hit live.
 */
export function validateFlowJson(flowJson: unknown, opts: { dynamic?: boolean } = {}): ValidateFlowJsonResult {
  let doc: unknown = flowJson;
  if (typeof flowJson === 'string') {
    try {
      doc = JSON.parse(flowJson);
    } catch {
      return { valid: false, issues: [{ path: '', message: 'flowJson is not valid JSON' }] };
    }
  }

  const parsed = FlowJsonSchema.safeParse(doc);
  const issues: FlowJsonIssue[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

  const hasDataApiVersion =
    typeof doc === 'object' && doc !== null && 'data_api_version' in (doc as Record<string, unknown>);
  if (opts.dynamic && !hasDataApiVersion) {
    issues.push({
      path: 'data_api_version',
      message: "dynamic (endpoint-backed) flows must set data_api_version: '3.0'",
    });
  }
  if (!opts.dynamic && hasDataApiVersion) {
    issues.push({
      path: 'data_api_version',
      message:
        "data_api_version is set but the flow is not dynamic — without a registered endpoint_uri the flow fails on open ('an error occurred'). Remove it or create/update the flow with dynamic: true",
    });
  }

  return { valid: issues.length === 0, issues };
}
