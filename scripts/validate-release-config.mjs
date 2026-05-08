import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(await readFile('release-please-config.json', 'utf8'));
const manifest = JSON.parse(await readFile('.release-please-manifest.json', 'utf8'));

if (config['release-type'] !== 'node') {
  throw new Error('release-please-config.json must use node release type');
}

if (!config.packages || typeof config.packages !== 'object') {
  throw new Error('release-please-config.json must define manifest packages');
}

for (const [packagePath, packageConfig] of Object.entries(config.packages)) {
  const packageJson = JSON.parse(await readFile(`${packagePath}/package.json`, 'utf8'));
  if (packageConfig['package-name'] !== packageJson.name) {
    throw new Error(`${packagePath} package-name does not match package.json name`);
  }
  if (!manifest[packagePath]) {
    throw new Error(`${packagePath} is missing from .release-please-manifest.json`);
  }
  if (manifest[packagePath] !== packageJson.version) {
    throw new Error(`${packagePath} manifest version does not match package.json version`);
  }
}

const gh = process.platform === 'win32' ? 'gh.exe' : 'gh';
const remoteConfig = spawnSync(
  gh,
  ['api', 'repos/oaslananka-lab/a2a-mesh/contents/release-please-config.json', '--silent'],
  { stdio: 'ignore' },
);

if (remoteConfig.status !== 0) {
  console.log(
    'release-please config validated locally; remote debug-config will run after config reaches main.',
  );
  process.exit(0);
}

const pnpm = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
const pnpmArgs =
  process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm', 'dlx', 'release-please@17.6.0', 'debug-config']
    : ['dlx', 'release-please@17.6.0', 'debug-config'];
const result = spawnSync(
  pnpm,
  [...pnpmArgs, '--repo-url', 'oaslananka-lab/a2a-mesh', '--target-branch', 'main', '--dry-run'],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
