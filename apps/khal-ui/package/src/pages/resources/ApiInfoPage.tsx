'use client';

/**
 * API Info — backend version/health and the documentation surface. Renders
 * GET /info and GET /health, plus links (through the BFF) to the OpenAPI JSON
 * download, the Swagger docs, and the Prometheus metrics endpoint.
 */
import { Badge, Button, SectionCard } from '@khal-os/ui';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { JsonInspector, PageShell, SectionHead } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { DataRowList, errMsg } from './shared';

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
          <SectionHead>Backend</SectionHead>
          <Badge variant={healthStatus === 'ok' || healthStatus === 'healthy' ? 'green' : 'gray'}>{healthStatus}</Badge>
        </div>
        <DataRowList
          rows={[
            { label: 'Version', value: String(version) },
            { label: 'Info status', value: info.error ? (errMsg(info.error) ?? 'error') : 'loaded' },
            { label: 'Health status', value: healthStatus },
          ]}
        />
      </SectionCard>

      <SectionCard padding="md">
        <div style={{ marginBottom: 10 }}>
          <SectionHead>Documentation</SectionHead>
        </div>
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
          <div style={{ marginBottom: 10 }}>
            <SectionHead>/info</SectionHead>
          </div>
          <JsonInspector value={info.data} />
        </SectionCard>
      )}
      {health.data && (
        <SectionCard padding="md">
          <div style={{ marginBottom: 10 }}>
            <SectionHead>/health</SectionHead>
          </div>
          <JsonInspector value={health.data} />
        </SectionCard>
      )}
    </PageShell>
  );
}
