import { RegistryServer } from '../src/index.js';

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const port = Number(process.env.PORT ?? '3099');
const registrationToken = process.env.REGISTRY_TOKEN?.trim() || undefined;
const allowedOrigins = process.env.REGISTRY_ALLOWED_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const server = new RegistryServer({
  allowLocalhost: readBoolean('ALLOW_LOCALHOST', process.env.NODE_ENV !== 'production'),
  allowPrivateNetworks: readBoolean('ALLOW_PRIVATE_NETWORKS', false),
  allowUnresolvedHostnames: readBoolean('ALLOW_UNRESOLVED_HOSTNAMES', false),
  ...(allowedOrigins && allowedOrigins.length > 0 ? { allowedOrigins } : {}),
  requireOrigin: readBoolean('REGISTRY_REQUIRE_ORIGIN', false),
  requireAuth: Boolean(registrationToken),
  ...(registrationToken ? { registrationToken } : {}),
});

server.start(port);
process.stdout.write(`Registry running on :${port}\n`);
