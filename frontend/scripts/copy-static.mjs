import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
await mkdir(join(out, 'vendor'), { recursive: true });
await cp(join(root, 'index.html'), join(out, 'index.html'));
await cp(join(root, 'src', 'styles.css'), join(out, 'styles.css'));
await cp(join(root, 'src', 'vendor', 'xlsx.full.min.js'), join(out, 'vendor', 'xlsx.full.min.js'));
await cp(join(root, 'public'), out, { recursive: true });
console.log('静态资源已复制到 dist/');
