import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve('dist/assets');
const files = (await readdir(dir)).filter((file) => file.endsWith('.js')).map(async (file) => ({ file, bytes: (await stat(path.join(dir, file))).size }));
const assets = await Promise.all(files);
const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
const largest = [...assets].sort((a, b) => b.bytes - a.bytes)[0];
const maxTotal = 700 * 1024;
const maxSingle = 240 * 1024;
console.log(JSON.stringify({ totalJsBytes: total, largest, maxTotal, maxSingle }));
if (total > maxTotal || largest?.bytes > maxSingle) process.exit(1);
