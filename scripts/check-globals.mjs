/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Scans the built bundles for globals the Paperback 0.8 runtime does not have.
//
// This exists because `setTimeout` shipped in every source and nothing caught
// it: the typechecker accepts it, because @types/node declares it globally and
// cheerio pulls those declarations in. It only failed on a device, as
// "ReferenceError: Can't find variable: setTimeout". The bundle is the artifact
// that actually runs, so it is the thing worth checking.
//
// Only unambiguous names are listed. `fetch` and `document` are deliberately
// absent: both are used as ordinary local names in these sources (a callback
// parameter, a parsed cheerio document), so matching them by text produces
// false positives. The typechecker covers the real globals of that pair, since
// the DOM library is switched off in tsconfig.
//
// Bridge calls that exist but misbehave on a device are listed too, with the reason.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const FORBIDDEN = [
  ['setTimeout', /\bsetTimeout\s*\(/g],
  ['setInterval', /\bsetInterval\s*\(/g],
  ['clearTimeout', /\bclearTimeout\s*\(/g],
  ['clearInterval', /\bclearInterval\s*\(/g],
  ['requestAnimationFrame', /\brequestAnimationFrame\s*\(/g],
  ['queueMicrotask', /\bqueueMicrotask\s*\(/g],
  ['atob', /\batob\s*\(/g],
  ['btoa', /\bbtoa\s*\(/g],
  ['TextDecoder', /\bnew\s+TextDecoder\b/g],
  ['TextEncoder', /\bnew\s+TextEncoder\b/g],
  ['XMLHttpRequest', /\bnew\s+XMLHttpRequest\b/g],
  ['Image', /\bnew\s+Image\s*\(/g],
  ['ImageData', /\bnew\s+ImageData\b/g],
  ['HTMLCanvasElement', /\bnew\s+HTMLCanvasElement\b/g],
  ['crypto.subtle', /\bcrypto\s*\.\s*subtle\b/g],
  ['localStorage', /\blocalStorage\s*\./g],
  ['sessionStorage', /\bsessionStorage\s*\./g],
  ['window', /\bwindow\s*\./g],
  ['process', /\bprocess\s*\.\s*(?:env|exit|argv|cwd)\b/g],
  // Returns null on 0.8 and the reader drops the page; write into App.createByteArray(rawData) instead
  ['App.createRawData', /\bcreateRawData\s*\(/g, 'returns null on 0.8; decrypt into App.createByteArray(rawData) in place'],
];

function bufferReferences(file, source) {
  // Resolve only the bundle's own bindings; Node's ambient types would hide the missing global.
  const options = { allowJs: true, noLib: true, noResolve: true, types: [] };
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => name === file ? tree : undefined;
  const checker = ts.createProgram([file], options, host).getTypeChecker();
  let count = 0;

  const unwrap = node => {
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    return node;
  };
  const propertyKey = node => {
    if (ts.isComputedPropertyName(node)) {
      node = unwrap(node.expression);
      return ts.isStringLiteralLike(node) ? node.text : undefined;
    }
    return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined;
  };
  const blockOf = node => {
    while (node && !ts.isBlock(node) && !ts.isSourceFile(node)) node = node.parent;
    return node;
  };
  // Record writes with their positions. A later reassignment must not hide an
  // earlier use; an alias of an alias captures its value at initialization.
  const writes = new Map();
  const record = (target, value, writer, definite = false) => {
    target = unwrap(target);
    if (ts.isIdentifier(target)) {
      const symbol = ts.isShorthandPropertyAssignment(target.parent)
        ? checker.getShorthandAssignmentValueSymbol(target.parent)
        : checker.getSymbolAtLocation(target);
      if (!symbol) return;
      const events = writes.get(symbol) ?? [];
      events.push({ value, writer, definite, position: writer.end });
      writes.set(symbol, events);
    } else if (ts.isArrayLiteralExpression(target)) {
      target.elements.forEach(item => record(item, undefined, writer, definite));
    } else if (ts.isObjectLiteralExpression(target)) {
      target.properties.forEach(item => {
        if (ts.isShorthandPropertyAssignment(item)) record(item.name, undefined, writer, definite);
        else if (ts.isPropertyAssignment(item)) record(item.initializer, undefined, writer, definite);
        else if (ts.isSpreadAssignment(item)) record(item.expression, undefined, writer, definite);
      });
    } else if (ts.isSpreadElement(target)) record(target.expression, undefined, writer, definite);
    else if (ts.isBinaryExpression(target)) record(target.left, undefined, writer, definite);
  };
  const collectWrites = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      record(node.name, node.initializer, node, true);
    }
    if (ts.isBinaryExpression(node) && ts.isAssignmentOperator(node.operatorToken.kind)) {
      const plain = node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      let statement = node.parent;
      while (ts.isParenthesizedExpression(statement)) statement = statement.parent;
      const definite = plain && ts.isExpressionStatement(statement) &&
        (ts.isBlock(statement.parent) || ts.isSourceFile(statement.parent));
      record(node.left, plain ? node.right : undefined, node, definite);
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
      record(node.operand, undefined, node);
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) record(node.initializer, undefined, node.initializer, true);
    ts.forEachChild(node, collectWrites);
  };
  collectWrites(tree);
  for (const events of writes.values()) events.sort((a, b) => a.position - b.position);

  // This is bounded static alias analysis, not execution or a complete runtime
  // audit. Conditional writes retain possible global values. Dynamic keys,
  // interprocedural argument/return flow and reflective access are not resolved.
  const isGlobalObject = (node, seen = new Set()) => {
    if (!node) return false;
    node = unwrap(node);
    if (ts.isConditionalExpression(node)) {
      return isGlobalObject(node.whenTrue, new Set(seen)) || isGlobalObject(node.whenFalse, new Set(seen));
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.CommaToken || node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        return isGlobalObject(node.right, seen);
      }
      if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
        return isGlobalObject(node.left, new Set(seen)) || isGlobalObject(node.right, new Set(seen));
      }
    }
    if (!ts.isIdentifier(node)) return false;
    const symbol = checker.getSymbolAtLocation(node);
    if (['globalThis', 'global'].includes(node.text) && !symbol?.declarations?.length) return true;
    if (!symbol || seen.has(node)) return false;
    seen.add(node);
    let global = false;
    for (const event of writes.get(symbol) ?? []) {
      if (event.position > node.getStart()) continue;
      const value = isGlobalObject(event.value, new Set(seen));
      const loop = event.writer.parent;
      const sameBlock = blockOf(event.writer) === blockOf(node);
      const loopBody = (ts.isForInStatement(loop) || ts.isForOfStatement(loop)) &&
        node.getStart() >= loop.statement.getStart() && node.end <= loop.statement.end;
      global = event.definite && (sameBlock || loopBody) ? value : global || value;
    }
    return global;
  };
  const readsBuffer = pattern => pattern.some(element => {
    if (ts.isBindingElement(element)) {
      return !element.dotDotDotToken && propertyKey(element.propertyName ?? element.name) === 'Buffer';
    }
    return (ts.isPropertyAssignment(element) || ts.isShorthandPropertyAssignment(element)) &&
      propertyKey(element.name) === 'Buffer';
  });

  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) &&
        node.initializer && isGlobalObject(node.initializer)) {
      if (readsBuffer(node.name.elements)) count++;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isObjectLiteralExpression(unwrap(node.left)) && isGlobalObject(node.right) &&
        readsBuffer(unwrap(node.left).properties)) count++;
    if (ts.isIdentifier(node) && node.text === 'Buffer') {
      let probe = node;
      while (ts.isParenthesizedExpression(probe.parent)) probe = probe.parent;
      const parent = node.parent;
      if (ts.isTypeOfExpression(probe.parent)) return;
      if (ts.isShorthandPropertyAssignment(parent)) {
        if (!checker.getShorthandAssignmentValueSymbol(parent)) count++;
      } else if (
        !(ts.isPropertyAccessExpression(parent) && parent.name === node) &&
        !(ts.isBindingElement(parent) && parent.propertyName === node) &&
        !(ts.isPropertyAssignment(parent) && parent.name === node) &&
        !ts.isLabeledStatement(parent) && !ts.isBreakStatement(parent) &&
        !ts.isContinueStatement(parent) && !checker.getSymbolAtLocation(node)
      ) {
        count++;
      }
    }
    if (
      (ts.isPropertyAccessExpression(node) && node.name.text === 'Buffer') ||
      (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(unwrap(node.argumentExpression)) &&
        unwrap(node.argumentExpression).text === 'Buffer')
    ) {
      if (isGlobalObject(node.expression)) count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return count;
}

// The bundles are what ships, so they are rebuilt rather than trusted to be
// current.
const folder = process.argv.find(arg => arg.startsWith('--folder='))?.slice(9) ?? '';
const directory = path.join('bundles', folder);
if (!process.argv.includes('--skip-bundle')) {
  execFileSync(process.execPath, ['node_modules/@paperback/toolchain/bin/run', 'bundle',
    ...(folder ? [`--folder=${folder}`] : [])], { stdio: 'pipe' });
}

if (!existsSync(directory)) {
  console.log('FAIL  no bundles directory to scan');
  process.exit(1);
}

const offences = [];
let scanned = 0;

for (const name of readdirSync(directory)) {
  const file = path.join(directory, name, 'source.js');
  if (!existsSync(file)) continue;

  scanned += 1;
  const source = readFileSync(file, 'utf8');

  const buffers = bufferReferences(file, source);
  if (buffers) offences.push({ name, global: 'Buffer', count: buffers });

  for (const [global, pattern, reason] of FORBIDDEN) {
    const found = source.match(pattern);
    if (found) offences.push({ name, global, count: found.length, reason });
  }
}

console.log(`Scanned ${scanned} bundles for globals Paperback 0.8 does not provide.`);

if (scanned === 0) {
  console.log('FAIL  no source bundles were scanned');
  process.exit(1);
}

if (offences.length > 0) {
  for (const { name, global, count, reason } of offences) {
    console.log(`FAIL  ${name}: uses ${global} (${count}×) — ${reason ?? 'not available on 0.8'}`);
  }
  console.log(`\n${offences.length} FAILED`);
  process.exit(1);
}

console.log('ok    none of them use a global the runtime lacks');
process.exit(0);
