import { readFile } from 'node:fs/promises';

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

console.log('release-please manifest configuration validated locally.');
