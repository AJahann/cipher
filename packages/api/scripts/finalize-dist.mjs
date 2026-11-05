import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const apiDist = path.join(apiRoot, 'dist');
const sharedDist = path.resolve(apiRoot, '../shared/dist');
const bundledShared = path.join(apiDist, 'shared');

function pruneTests(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test') {
        rmSync(full, { recursive: true, force: true });
      } else {
        pruneTests(full);
      }
    } else if (/\.test\.(?:js|d\.ts(?:\.map)?)$/.test(entry.name)) {
      rmSync(full, { force: true });
    }
  }
}

function resolveRelative(fromDir, specifier) {
  if (/\.(?:cjs|js|json|mjs)$/.test(specifier)) return specifier;
  const target = path.resolve(fromDir, specifier);
  if (existsSync(`${target}.js`)) return `${specifier}.js`;
  if (existsSync(path.join(target, 'index.js'))) {
    return `${specifier.replace(/\/$/, '')}/index.js`;
  }
  return specifier;
}

function resolveShared(fromDir, specifier) {
  const subpath =
    specifier === '@chat-app/shared'
      ? ''
      : specifier.slice('@chat-app/shared/'.length);
  const targetDir = subpath ? path.join(bundledShared, subpath) : bundledShared;
  let rel = path.relative(fromDir, targetDir).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return resolveRelative(fromDir, rel);
}

function rewriteFile(filePath) {
  const dir = path.dirname(filePath);
  const source = readFileSync(filePath, 'utf8');
  const updated = source.replace(
    /(\b(?:from|import)\s+)(["'])([^"']+)\2/g,
    (_match, prefix, quote, specifier) => {
      if (
        specifier === '@chat-app/shared' ||
        specifier.startsWith('@chat-app/shared/')
      ) {
        return `${prefix}${quote}${resolveShared(dir, specifier)}${quote}`;
      }
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        return `${prefix}${quote}${resolveRelative(dir, specifier)}${quote}`;
      }
      return `${prefix}${quote}${specifier}${quote}`;
    },
  );
  if (updated !== source) writeFileSync(filePath, updated, 'utf8');
}

function rewriteTree(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      rewriteTree(full);
    } else if (entry.endsWith('.js')) {
      rewriteFile(full);
    }
  }
}

pruneTests(sharedDist);
pruneTests(apiDist);
rmSync(bundledShared, { recursive: true, force: true });
cpSync(path.join(sharedDist, 'src'), bundledShared, { recursive: true });
rewriteTree(sharedDist);
rewriteTree(apiDist);
