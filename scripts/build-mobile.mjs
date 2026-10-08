import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const staging = path.join(root, '.mobile-build');

async function run(command, args, options = {}) {
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
    });
}

// Build a separate static client, leaving the web app's server routes intact.
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(path.join(root, 'src'), path.join(staging, 'src'), {
    recursive: true,
    filter: source => source !== path.join(root, 'src/app/api')
});
for (const name of ['public', 'package.json', 'package-lock.json', 'jsconfig.json']) {
    await cp(path.join(root, name), path.join(staging, name), { recursive: true });
}
await symlink(path.join(root, 'node_modules'), path.join(staging, 'node_modules'), 'dir');
await writeFile(path.join(staging, 'next.config.mjs'), `
import webConfig from '../next.config.mjs';
export default {
    ...webConfig,
    outputFileTracingRoot: ${JSON.stringify(root)},
    output: 'export',
    trailingSlash: true,
    images: { ...webConfig.images, unoptimized: true },
    env: {
        NEXT_PUBLIC_BUNDLED_APP: 'true',
        NEXT_PUBLIC_MONETAX_ALLOWED_ORIGINS: ${JSON.stringify(process.env.NEXT_PUBLIC_MONETAX_ALLOWED_ORIGINS || '')}
    }
};
`);
await run(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', staging, '--webpack']);
await readFile(path.join(staging, 'out/index.html'));
await rm(path.join(root, 'out'), { recursive: true, force: true });
await cp(path.join(staging, 'out'), path.join(root, 'out'), { recursive: true });

if (!process.argv.includes('--export-only')) {
    const platform = 'android';
    await run(process.execPath, [path.join(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', platform]);
    const configFile = path.join(root, 'android/app/src/main/assets/capacitor.config.json');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    if (config.server?.url) throw new Error('The native build must load bundled assets, not a remote website.');
}
console.log('Android interface and market API bundled in out/; providers are queried directly.');
