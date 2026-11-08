
import StyleDictionary from 'style-dictionary';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Soma: DTCG JSON -> CSS, preserving aliases as CSS variables.
const ROOT = 'dtcg-tokens';
const T1 = join(ROOT, '☘️ - SOMA - T1', 'SOMA.json');
const T2 = join(ROOT, '☘️ - SOMA - T2');
const LIGHT = join(T2, '☀️  SOMA.LIFE [ Light ].json');
const DARK = join(T2, '🌙  SOMA.LIFE [ Dark ].json');
const OUTPUT = 'build/css';

for (const file of [T1, LIGHT, DARK]) {
  if (!existsSync(file)) {
    throw new Error(`Missing input file: ${file}`);
  }
}

const load = file => JSON.parse(readFileSync(file, 'utf8'));

const collect = (obj, prefix = [], result = new Map()) => {
  for (const [key, value] of Object.entries(obj)) {
    const path = [...prefix, key];

    if (
      value &&
      typeof value === 'object' &&
      '$type' in value &&
      '$value' in value
    ) {
      result.set(path.join('.'), { path, ...value });
    } else if (
      value &&
      typeof value === 'object' &&
      !key.startsWith('$')
    ) {
      collect(value, path, result);
    }
  }

  return result;
};

const t1 = collect(load(T1));
const themes = {
  light: collect(load(LIGHT)),
  dark: collect(load(DARK)),
};

const normalize = path =>
  path
    .map(part =>
      part
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    )
    .join('-');

const cssName = path => `--${normalize(path)}`;

const weights = {
  thin: 100,
  extralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
};

const isDimension = path =>
  /^(border|radius|spacing)\./.test(path) ||
  /\.typography\..*\.(size|lineheight)$/.test(`.${path}`) ||
  /^typography\.(size|lineheight)\./.test(path);

function formatColor(value) {
  if (
    !value ||
    value.colorSpace !== 'srgb' ||
    !Array.isArray(value.components) ||
    value.components.length !== 3
  ) {
    throw new Error('Unsupported colour representation');
  }

  const alpha = value.alpha ?? 1;

  if (
    ![...value.components, alpha].every(
      v =>
        typeof v === 'number' &&
        Number.isFinite(v) &&
        v >= 0 &&
        v <= 1
    )
  ) {
    throw new Error('Invalid sRGB colour value');
  }

  const rgb = value.components.map(c => Math.round(c * 255));

  const hex =
    '#' +
    rgb
      .map(c => c.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

  return alpha === 1
    ? hex
    : `rgb(${rgb.join(' ')} / ${Number(alpha.toFixed(5))})`;
}

function renderValue(key, token, all) {
  const value = token.$value;

  if (
    typeof value === 'string' &&
    /^\{[^{}]+\}$/.test(value)
  ) {
    const target = value.slice(1, -1);

    if (!all.has(target)) {
      throw new Error(`Broken reference: ${key} -> ${target}`);
    }

    if (all.get(target).$type !== token.$type) {
      throw new Error(`Type mismatch: ${key} -> ${target}`);
    }

    return `var(${cssName(target.split('.'))})`;
  }

  if (token.$type === 'color') {
    return formatColor(value);
  }

  if (token.$type === 'number') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value)
    ) {
      throw new Error(`Invalid number: ${key}`);
    }

    return `${value}${isDimension(key) ? 'px' : ''}`;
  }

  if (token.$type === 'text') {
    if (typeof value !== 'string') {
      throw new Error(`Invalid text: ${key}`);
    }

    if (/\.weight\./.test(key) || /\.weight$/.test(key)) {
      return String(weights[value.toLowerCase()] ?? value);
    }

    return JSON.stringify(value);
  }

  throw new Error(
    `Unsupported token type ${token.$type} at ${key}`
  );
}

function cssFile(tokens, all, selector) {
  const names = new Set();
  const lines = [];

  for (const [key, token] of tokens) {
    const name = cssName(token.path);

    if (names.has(name)) {
      throw new Error(`CSS name collision: ${name}`);
    }

    names.add(name);

    lines.push(
      `  ${name}: ${renderValue(key, token, all)};`
    );
  }

  return [
    '/* Generated from Soma Figma tokens. Do not edit manually. */',
    `${selector} {`,
    ...lines,
    '}',
    '',
  ].join('\n');
}

// Register a custom CSS format with Style Dictionary v4.
StyleDictionary.registerFormat({
  name: 'soma/css',
  format: ({ options }) => options.outputText,
});

mkdirSync(OUTPUT, { recursive: true });

async function write(
  fileName,
  tokens,
  all,
  selector,
  sourceFiles
) {
  const outputText = cssFile(tokens, all, selector);

  const sd = new StyleDictionary({
    usesDtcg: true,
    source: sourceFiles,
    platforms: {
      css: {
        buildPath: `${OUTPUT}/`,
        files: [
          {
            destination: fileName,
            format: 'soma/css',
            options: { outputText },
          },
        ],
      },
    },
  });

  await sd.buildPlatform('css');
}

// Build primitive tokens.
await write(
  'primitives.css',
  t1,
  t1,
  ':root',
  [T1]
);

// Build each theme independently.
for (const [mode, tokens] of Object.entries(themes)) {
  const all = new Map([...t1, ...tokens]);

  await write(
    `soma-life-${mode}.css`,
    tokens,
    all,
    `[data-soma-theme="${mode}"]`,
    [T1, mode === 'light' ? LIGHT : DARK]
  );
}

console.log('Soma CSS generated in build/css/');
