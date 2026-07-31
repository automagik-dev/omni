/**
 * Fluent WhatsApp Flow JSON builder.
 *
 * Hand-authored (not generated): produces Meta Flow JSON v6.x for the
 * whatsapp-flows routes (`POST /instances/{id}/whatsapp-flows` with the
 * built `flowJson`). `build()` enforces the structural rules Meta reports
 * late (or not at all) so mistakes fail at authoring time:
 *
 *   - RichText must be alone on its screen (Footer excepted)
 *   - navigate targets must be declared screens
 *   - at least one terminal screen
 *   - `dynamic` flows get `data_api_version: '3.0'`; static flows must not
 *     carry it (an endpoint-less data_api_version flow errors on open)
 *
 * The API re-validates server-side with the authoritative schema — this
 * builder exists so you rarely get that far with an invalid document.
 *
 * @example
 * ```typescript
 * const { flowJson } = flow({ version: '6.3' })
 *   .screen('INTRO', { title: 'Welcome' }, (s) => {
 *     s.image(base64Png, { height: 240 });
 *     s.heading('Hello!');
 *     s.footerNavigate('Start', 'FORM');
 *   })
 *   .screen('FORM', { title: 'About you', terminal: true }, (s) => {
 *     s.form('form', (f) => {
 *       f.textInput('name', 'Your name', { required: true });
 *       f.dropdown('channel', 'Favorite channel', [{ id: 'wa', title: 'WhatsApp' }]);
 *       f.footerComplete('Submit', { name: '${form.name}', channel: '${form.channel}' });
 *     });
 *   })
 *   .build();
 * ```
 */

export type FlowComponent = Record<string, unknown>;

export interface DataSourceItem {
  id: string;
  title: string;
}

export interface ScreenOptions {
  title?: string;
  terminal?: boolean;
  /** Dynamic-flow screens: declared data contract for endpoint-provided values. */
  data?: Record<string, unknown>;
  /** Call the data endpoint with BACK when the user navigates back here. */
  refreshOnBack?: boolean;
}

export interface FlowOptions {
  /** Flow JSON version. Default '6.3'. */
  version?: string;
  /** Endpoint-backed flow: emits data_api_version '3.0'. Pair with the route's `dynamic: true`. */
  dynamic?: boolean;
}

export class FlowBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowBuilderError';
  }
}

interface InputOptions {
  required?: boolean;
  [key: string]: unknown;
}

/** Builds the component list of one Form. */
export class FormBuilder {
  readonly components: FlowComponent[] = [];
  private footerSet = false;

  textInput(name: string, label: string, opts: InputOptions & { inputType?: string } = {}): this {
    const { inputType, ...rest } = opts;
    this.components.push({ type: 'TextInput', name, label, 'input-type': inputType ?? 'text', ...rest });
    return this;
  }

  textArea(name: string, label: string, opts: InputOptions = {}): this {
    this.components.push({ type: 'TextArea', name, label, ...opts });
    return this;
  }

  datePicker(name: string, label: string, opts: InputOptions = {}): this {
    this.components.push({ type: 'DatePicker', name, label, ...opts });
    return this;
  }

  optIn(name: string, label: string, opts: InputOptions = {}): this {
    this.components.push({ type: 'OptIn', name, label, ...opts });
    return this;
  }

  dropdown(name: string, label: string, dataSource: DataSourceItem[], opts: InputOptions = {}): this {
    this.components.push({ type: 'Dropdown', name, label, 'data-source': dataSource, ...opts });
    return this;
  }

  radioButtons(name: string, label: string, dataSource: DataSourceItem[], opts: InputOptions = {}): this {
    this.components.push({ type: 'RadioButtonsGroup', name, label, 'data-source': dataSource, ...opts });
    return this;
  }

  checkboxGroup(name: string, label: string, dataSource: DataSourceItem[], opts: InputOptions = {}): this {
    this.components.push({ type: 'CheckboxGroup', name, label, 'data-source': dataSource, ...opts });
    return this;
  }

  /** Terminal submit: completes the flow, `payload` reaches the nfm_reply webhook. */
  footerComplete(label: string, payload: Record<string, unknown>): this {
    this.footer(label, { name: 'complete', payload });
    return this;
  }

  /** Submit this screen to the data endpoint (dynamic flows) — it decides what's next. */
  footerDataExchange(label: string, payload: Record<string, unknown> = {}): this {
    this.footer(label, { name: 'data_exchange', payload });
    return this;
  }

  footerNavigate(label: string, nextScreen: string, payload: Record<string, unknown> = {}): this {
    this.footer(label, { name: 'navigate', next: { type: 'screen', name: nextScreen }, payload });
    return this;
  }

  /** Escape hatch for components the builder doesn't model. */
  raw(component: FlowComponent): this {
    this.components.push(component);
    return this;
  }

  private footer(label: string, action: Record<string, unknown>): void {
    if (this.footerSet) throw new FlowBuilderError('a Form can only have one Footer');
    this.footerSet = true;
    this.components.push({ type: 'Footer', label, 'on-click-action': action });
  }
}

export class ScreenBuilder {
  readonly components: FlowComponent[] = [];

  constructor(readonly id: string) {}

  heading(text: string): this {
    this.components.push({ type: 'TextHeading', text });
    return this;
  }

  subheading(text: string): this {
    this.components.push({ type: 'TextSubheading', text });
    return this;
  }

  body(text: string): this {
    this.components.push({ type: 'TextBody', text });
    return this;
  }

  caption(text: string): this {
    this.components.push({ type: 'TextCaption', text });
    return this;
  }

  /**
   * Markdown-ish rich text. Meta requires RichText to be ALONE on its screen
   * (Footer excepted) and `text` to be a single string — both enforced at build.
   */
  richText(text: string): this {
    this.components.push({ type: 'RichText', text });
    return this;
  }

  /** `src` is base64-encoded image bytes (not a URL). */
  image(src: string, opts: { height?: number; scaleType?: 'cover' | 'contain'; altText?: string } = {}): this {
    this.components.push({
      type: 'Image',
      src,
      ...(opts.height !== undefined ? { height: opts.height } : {}),
      ...(opts.scaleType ? { 'scale-type': opts.scaleType } : {}),
      ...(opts.altText ? { 'alt-text': opts.altText } : {}),
    });
    return this;
  }

  form(name: string, define: (form: FormBuilder) => void): this {
    const builder = new FormBuilder();
    define(builder);
    this.components.push({ type: 'Form', name, children: builder.components });
    return this;
  }

  footerNavigate(label: string, nextScreen: string, payload: Record<string, unknown> = {}): this {
    this.components.push({
      type: 'Footer',
      label,
      'on-click-action': { name: 'navigate', next: { type: 'screen', name: nextScreen }, payload },
    });
    return this;
  }

  footerComplete(label: string, payload: Record<string, unknown>): this {
    this.components.push({ type: 'Footer', label, 'on-click-action': { name: 'complete', payload } });
    return this;
  }

  footerDataExchange(label: string, payload: Record<string, unknown> = {}): this {
    this.components.push({ type: 'Footer', label, 'on-click-action': { name: 'data_exchange', payload } });
    return this;
  }

  /** Escape hatch for components the builder doesn't model. */
  raw(component: FlowComponent): this {
    this.components.push(component);
    return this;
  }
}

interface ScreenDefinition {
  id: string;
  options: ScreenOptions;
  components: FlowComponent[];
}

export class FlowBuilder {
  private readonly screens: ScreenDefinition[] = [];

  constructor(private readonly options: FlowOptions = {}) {}

  screen(id: string, options: ScreenOptions, define: (screen: ScreenBuilder) => void): this;
  screen(id: string, define: (screen: ScreenBuilder) => void): this;
  screen(
    id: string,
    optionsOrDefine: ScreenOptions | ((screen: ScreenBuilder) => void),
    maybeDefine?: (screen: ScreenBuilder) => void,
  ): this {
    const options = typeof optionsOrDefine === 'function' ? {} : optionsOrDefine;
    const define = typeof optionsOrDefine === 'function' ? optionsOrDefine : maybeDefine;
    if (!define) throw new FlowBuilderError(`screen '${id}' needs a definition callback`);
    if (this.screens.some((s) => s.id === id)) throw new FlowBuilderError(`duplicate screen id '${id}'`);

    const builder = new ScreenBuilder(id);
    define(builder);
    this.screens.push({ id, options, components: builder.components });
    return this;
  }

  /** Validate and produce the document + its stringified form for the API. */
  build(): { json: Record<string, unknown>; flowJson: string } {
    if (this.screens.length === 0) throw new FlowBuilderError('a flow needs at least one screen');

    const ids = new Set(this.screens.map((s) => s.id));
    if (!this.screens.some((s) => s.options.terminal)) {
      throw new FlowBuilderError('at least one screen must be terminal: true');
    }

    const routingModel: Record<string, string[]> = {};
    for (const screen of this.screens) {
      // RichText isolation rule.
      const hasRichText = screen.components.some((c) => c.type === 'RichText');
      if (hasRichText && screen.components.some((c) => c.type !== 'RichText' && c.type !== 'Footer')) {
        throw new FlowBuilderError(
          `screen '${screen.id}': RichText must be the only component on the screen (Footer excepted)`,
        );
      }

      // Collect navigate edges (screen-level and inside forms) + target check.
      const targets: string[] = [];
      const visit = (component: FlowComponent): void => {
        const action = component['on-click-action'] as Record<string, unknown> | undefined;
        if (action?.name === 'navigate') {
          const next = action.next as { type?: string; name?: string } | undefined;
          if (next?.type === 'screen' && next.name) {
            if (!ids.has(next.name)) {
              throw new FlowBuilderError(`screen '${screen.id}': navigate targets unknown screen '${next.name}'`);
            }
            targets.push(next.name);
          }
        }
        const children = component.children as FlowComponent[] | undefined;
        if (Array.isArray(children)) for (const child of children) visit(child);
      };
      for (const component of screen.components) visit(component);
      routingModel[screen.id] = targets;
    }

    const json: Record<string, unknown> = {
      version: this.options.version ?? '6.3',
      ...(this.options.dynamic ? { data_api_version: '3.0' } : {}),
      routing_model: routingModel,
      screens: this.screens.map((screen) => ({
        id: screen.id,
        ...(screen.options.title ? { title: screen.options.title } : {}),
        ...(screen.options.terminal ? { terminal: true } : {}),
        ...(screen.options.data ? { data: screen.options.data } : {}),
        ...(screen.options.refreshOnBack ? { refresh_on_back: true } : {}),
        layout: { type: 'SingleColumnLayout', children: screen.components },
      })),
    };

    return { json, flowJson: JSON.stringify(json) };
  }
}

/** Entry point: `flow().screen(...).build()`. */
export function flow(options: FlowOptions = {}): FlowBuilder {
  return new FlowBuilder(options);
}
