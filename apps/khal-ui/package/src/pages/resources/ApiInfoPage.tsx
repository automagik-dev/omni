'use client';

/**
 * API Info — backend version/health and the documentation surface. Renders
 * GET /info and GET /health, plus links (through the BFF) to the OpenAPI JSON
 * download, the Swagger docs, and the Prometheus metrics endpoint.
 */
import { Badge, Button, SectionCard } from '@khal-os/ui';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { FieldGrid, JsonInspector, PageShell } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg } from './shared';

function linkStyle(): React.CSSProperties {
  return { color: T.accentBlue, fontSize: 13, textDecoration: 'none', fontFamily: T.mono };
}

export function ApiInfoPage() {
  const { ext } = useOmniClient();

  const info = useOmniQuery(['api-info', 'info'], () => ext.apiInfo.info());
  const health = useOmniQuery(['api-info', 'health'], () => ext.apiInfo.health(), { refetchInterval: 15_000 });

  const infoData = (info.data ?? {}) as Record<string, unknown>;
  const healthData = (health.data ?? {}) as Record<string, unknown>;
  const version = infoData.version ?? (infoData.data as Record<string, unknown> | undefined)?.version ?? '—';
  const healthStatus = String(
    healthData.status ?? (healthData.data as Record<string, unknown> | undefined)?.status ?? '—',
  );

  return (
    <PageShell
      eyebrow="Configuration"
      title="API Info"
      description="Backend version, health, and the documentation surface."
      actions={
        <Button
          size="small"
          variant="secondary"
          onClick={() => {
            void info.refetch();
            void health.refetch();
          }}
        >
          Refresh
        </Button>
      }
    >
      <SectionCard padding="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.fg }}>Backend</h3>
          <Badge variant={healthStatus === 'ok' || healthStatus === 'healthy' ? 'green' : 'gray'}>{healthStatus}</Badge>
        </div>
        <FieldGrid
          fields={[
            { label: 'Version', value: String(version), mono: true },
            { label: 'Info status', value: info.error ? errMsg(info.error) : 'loaded' },
            { label: 'Health status', value: healthStatus },
          ]}
        />
      </SectionCard>

      <SectionCard padding="md">
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: T.fg }}>Documentation</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <a href={ext.apiInfo.openApiUrl()} target="_blank" rel="noreferrer" style={linkStyle()} download>
            ↓ OpenAPI spec (openapi.json)
          </a>
          <a href={ext.apiInfo.docsUrl()} target="_blank" rel="noreferrer" style={linkStyle()}>
            → Swagger docs (/api/v2/docs)
          </a>
        </div>
      </SectionCard>

      {info.data && (
        <SectionCard padding="md">
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: T.fg }}>/info</h3>
          <JsonInspector value={info.data} />
        </SectionCard>
      )}
      {health.data && (
        <SectionCard padding="md">
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: T.fg }}>/health</h3>
          <JsonInspector value={health.data} />
        </SectionCard>
      )}
    </PageShell>
  );
}
