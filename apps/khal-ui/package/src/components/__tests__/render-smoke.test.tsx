import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';
import { DataTable } from '../DataTable';
import { FreshnessBadge } from '../FreshnessBadge';
import { JsonInspector } from '../JsonInspector';
import { LiveTestResult } from '../LiveTestResult';
import { MutationResult } from '../MutationResult';
import { SchemaForm } from '../SchemaForm';
import { REDACTION_MASK } from '../json-inspector/redact';

// Server-render (no DOM needed): proves each primitive mounts and shows its
// content. useEffect side effects don't run under SSR, which is exactly what we
// want for a static "does it render" smoke check.

describe('SchemaForm renders a non-trivial schema', () => {
  const schema = z.object({
    name: z.string().describe('Display name'),
    channel: z.enum(['whatsapp', 'discord', 'slack']),
    tags: z.array(z.string()),
    route: z.object({ priority: z.number(), fallback: z.string().optional() }),
    enabled: z.boolean().default(true),
  });

  const html = renderToStaticMarkup(<SchemaForm schema={schema} submitLabel="Create" />);

  test('renders a form with the field labels', () => {
    expect(html).toContain('<form');
    expect(html).toContain('name');
    expect(html).toContain('channel');
    expect(html).toContain('tags');
    expect(html).toContain('route');
  });

  test('renders enum options and nested object fields', () => {
    expect(html).toContain('whatsapp');
    expect(html).toContain('discord');
    expect(html).toContain('priority');
  });

  test('renders the submit label', () => {
    expect(html).toContain('Create');
  });
});

describe('JsonInspector', () => {
  test('masks sensitive values and shows plain ones by default', () => {
    const html = renderToStaticMarkup(<JsonInspector value={{ name: 'omni', apiKey: 'omni_sk_live_x' }} />);
    expect(html).toContain('omni');
    expect(html).toContain(REDACTION_MASK);
    expect(html).not.toContain('omni_sk_live_x');
  });
});

describe('DataTable', () => {
  interface Row {
    id: string;
    label: string;
  }
  test('renders headers and rows', () => {
    const html = renderToStaticMarkup(
      <DataTable<Row>
        columns={[
          { key: 'id', header: 'ID' },
          { key: 'label', header: 'Label' },
        ]}
        rows={[{ id: 'r1', label: 'Alpha' }]}
        getRowKey={(r) => r.id}
      />,
    );
    expect(html).toContain('ID');
    expect(html).toContain('Alpha');
  });

  test('renders an empty state when there are no rows', () => {
    const html = renderToStaticMarkup(
      <DataTable<Row> columns={[{ key: 'id', header: 'ID' }]} rows={[]} getRowKey={(r) => r.id} emptyTitle="Nothing" />,
    );
    expect(html).toContain('Nothing');
  });
});

describe('evidence + status primitives', () => {
  test('FreshnessBadge shows the source', () => {
    const html = renderToStaticMarkup(<FreshnessBadge observedAt={Date.now()} source="backend" />);
    expect(html).toContain('backend');
  });

  test('MutationResult renders request + read-back diff', () => {
    const html = renderToStaticMarkup(
      <MutationResult
        effect="live"
        request={{ method: 'PATCH', path: '/instances/x' }}
        before={{ name: 'old' }}
        after={{ name: 'new' }}
      />,
    );
    expect(html).toContain('Request');
    expect(html).toContain('LIVE');
    expect(html).toContain('name');
  });

  test('LiveTestResult renders name, effect, and pass state', () => {
    const html = renderToStaticMarkup(
      <LiveTestResult name="health check" effect="read-only" status="pass" evidence={{ status: 'healthy' }} />,
    );
    expect(html).toContain('health check');
    expect(html).toContain('READ-ONLY');
  });
});
