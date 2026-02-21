declare module 'pgserve' {
  interface PgserveOptions {
    port?: number;
    host?: string;
    baseDir?: string | null;
    pgPort?: number;
    logLevel?: string;
    autoProvision?: boolean;
    maxConnections?: number;
    useRam?: boolean;
    enablePgvector?: boolean;
    syncTo?: string | null;
    syncDatabases?: string | null;
  }

  interface PgserveServer {
    port: number;
    host: string;
    pgPort: number;
    memoryMode: boolean;
    stop(): Promise<void>;
    getStats(): Record<string, unknown>;
    listDatabases(): string[];
  }

  export function startMultiTenantServer(options?: PgserveOptions): Promise<PgserveServer>;
}
