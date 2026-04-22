export interface TelemetryBootstrapConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  deploymentEnvironment?: string | undefined;
  endpoint?: string | undefined;
  tracesEndpoint?: string | undefined;
  metricsEndpoint?: string | undefined;
  headers?: Record<string, string> | undefined;
  traceSampleRatio?: number | undefined;
  metricExportIntervalMs?: number | undefined;
  logLevel?: 'none' | 'error' | 'info' | 'debug' | undefined;
}

export interface TelemetryBootstrapHandle {
  enabled: boolean;
  shutdown(): Promise<void>;
}

interface TelemetryModules {
  DiagConsoleLogger: (new () => unknown) | undefined;
  DiagLogLevel: Record<string, number> | undefined;
  diag:
    | {
        setLogger: (logger: unknown, level?: number) => void;
      }
    | undefined;
  NodeSDK: new (options: Record<string, unknown>) => {
    start(): Promise<void> | void;
    shutdown(): Promise<void>;
  };
  OTLPTraceExporter: new (options?: Record<string, unknown>) => unknown;
  OTLPMetricExporter: new (options?: Record<string, unknown>) => unknown;
  PeriodicExportingMetricReader: new (options: Record<string, unknown>) => unknown;
  resourceFromAttributes: ((attributes: Record<string, unknown>) => unknown) | undefined;
}

export interface TelemetryModuleFactory {
  load(): Promise<TelemetryModules>;
}

const defaultFactory: TelemetryModuleFactory = {
  async load() {
    const [api, sdkNode, traceExporter, metricExporter, sdkMetrics, resources] = await Promise.all([
      import('@opentelemetry/api'),
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/exporter-metrics-otlp-http'),
      import('@opentelemetry/sdk-metrics'),
      import('@opentelemetry/resources'),
    ]);

    return {
      diag: 'diag' in api ? (api.diag as TelemetryModules['diag']) : undefined,
      DiagConsoleLogger:
        'DiagConsoleLogger' in api
          ? (api.DiagConsoleLogger as TelemetryModules['DiagConsoleLogger'])
          : undefined,
      DiagLogLevel:
        'DiagLogLevel' in api
          ? (api.DiagLogLevel as unknown as TelemetryModules['DiagLogLevel'])
          : undefined,
      NodeSDK: sdkNode.NodeSDK as TelemetryModules['NodeSDK'],
      OTLPTraceExporter: traceExporter.OTLPTraceExporter as TelemetryModules['OTLPTraceExporter'],
      OTLPMetricExporter:
        metricExporter.OTLPMetricExporter as TelemetryModules['OTLPMetricExporter'],
      PeriodicExportingMetricReader:
        sdkMetrics.PeriodicExportingMetricReader as TelemetryModules['PeriodicExportingMetricReader'],
      resourceFromAttributes:
        'resourceFromAttributes' in resources
          ? (resources.resourceFromAttributes as TelemetryModules['resourceFromAttributes'])
          : undefined,
    };
  },
};

export function resolveTelemetryConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  defaults: Partial<TelemetryBootstrapConfig> = {},
): TelemetryBootstrapConfig {
  const enabled =
    defaults.enabled ??
    ['1', 'true', 'yes', 'on'].includes(String(env.A2A_TELEMETRY_ENABLED ?? '').toLowerCase());
  const endpoint = defaults.endpoint ?? env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const traceSampleRatio = Number(defaults.traceSampleRatio ?? env.OTEL_TRACES_SAMPLER_ARG ?? 1);
  const metricExportIntervalMs = Number(
    defaults.metricExportIntervalMs ?? env.A2A_OTEL_METRIC_EXPORT_INTERVAL_MS ?? 10000,
  );

  return {
    enabled,
    serviceName: defaults.serviceName ?? env.OTEL_SERVICE_NAME ?? 'a2a-mesh',
    serviceVersion: defaults.serviceVersion ?? env.A2A_SERVICE_VERSION ?? '0.0.0',
    deploymentEnvironment:
      defaults.deploymentEnvironment ?? env.DEPLOYMENT_ENVIRONMENT ?? env.NODE_ENV,
    endpoint,
    tracesEndpoint: defaults.tracesEndpoint ?? (endpoint ? `${endpoint}/v1/traces` : undefined),
    metricsEndpoint: defaults.metricsEndpoint ?? (endpoint ? `${endpoint}/v1/metrics` : undefined),
    headers: defaults.headers,
    traceSampleRatio: Number.isFinite(traceSampleRatio) ? traceSampleRatio : 1,
    metricExportIntervalMs: Number.isFinite(metricExportIntervalMs)
      ? metricExportIntervalMs
      : 10000,
    logLevel: defaults.logLevel ?? 'error',
  };
}

export async function bootstrapTelemetry(
  config: TelemetryBootstrapConfig,
  factory: TelemetryModuleFactory = defaultFactory,
): Promise<TelemetryBootstrapHandle> {
  if (!config.enabled) {
    return {
      enabled: false,
      async shutdown() {
        return;
      },
    };
  }

  const modules = await factory.load();
  configureDiagnostics(modules, config.logLevel ?? 'error');

  const resource = modules.resourceFromAttributes?.({
    'service.name': config.serviceName,
    'service.version': config.serviceVersion,
    ...(config.deploymentEnvironment
      ? { 'deployment.environment': config.deploymentEnvironment }
      : {}),
  });

  const sdk = new modules.NodeSDK({
    ...(resource ? { resource } : {}),
    traceExporter: new modules.OTLPTraceExporter({
      ...(config.tracesEndpoint ? { url: config.tracesEndpoint } : {}),
      ...(config.headers ? { headers: config.headers } : {}),
    }),
    metricReader: new modules.PeriodicExportingMetricReader({
      exporter: new modules.OTLPMetricExporter({
        ...(config.metricsEndpoint ? { url: config.metricsEndpoint } : {}),
        ...(config.headers ? { headers: config.headers } : {}),
      }),
      exportIntervalMillis: config.metricExportIntervalMs ?? 10000,
    }),
    sampler: {
      shouldSample: () => ({
        decision:
          (config.traceSampleRatio ?? 1) === 0
            ? 0
            : (config.traceSampleRatio ?? 1) >= 1 || Math.random() <= (config.traceSampleRatio ?? 1)
              ? 2
              : 0,
      }),
      toString: () => 'a2a-mesh-ratio-sampler',
    },
  });

  await sdk.start();

  return {
    enabled: true,
    async shutdown() {
      await sdk.shutdown();
    },
  };
}

function configureDiagnostics(
  modules: TelemetryModules,
  level: TelemetryBootstrapConfig['logLevel'],
): void {
  if (!modules.diag || !modules.DiagConsoleLogger || !modules.DiagLogLevel || level === 'none') {
    return;
  }

  const resolvedLevel =
    level === 'debug'
      ? modules.DiagLogLevel.DEBUG
      : level === 'info'
        ? modules.DiagLogLevel.INFO
        : modules.DiagLogLevel.ERROR;
  modules.diag.setLogger(new modules.DiagConsoleLogger(), resolvedLevel);
}
