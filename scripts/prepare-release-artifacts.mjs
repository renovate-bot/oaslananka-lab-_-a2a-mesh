import { mkdir, rm } from 'node:fs/promises';

const npmArtifactDir = '.artifacts/npm';

await rm(npmArtifactDir, { force: true, recursive: true });
await mkdir(npmArtifactDir, { recursive: true });
