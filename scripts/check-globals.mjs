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
];

function bufferReferences(file, source) {
  // Resolve only the bundle's own bindings; Node's ambient types would hide the missing global.
  const options = { allowJs: true, noLib: true, noResolve: true, types: [] };
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => name === file ? tree : undefined;
  const checker = ts.createProgram([file], options, host).getTypeChecker();
  let count = 0;

  const written = new Set();
  const markTarget = node => {
    if (ts.isIdentifier(node)) written.add(checker.getSymbolAtLocation(node));
    else if (ts.isParenthesizedExpression(node)) markTarget(node.expression);
    else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(markTarget);
    else if (ts.isObjectLiteralExpression(node)) node.properties.forEach(property => {
      if (ts.isShorthandPropertyAssignment(property)) {
        written.add(checker.getShorthandAssignmentValueSymbol(property));
      } else if (ts.isPropertyAssignment(property)) markTarget(property.initializer);
      else if (ts.isSpreadAssignment(property)) markTarget(property.expression);
    });
    else if (ts.isSpreadElement(node)) markTarget(node.expression);
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      markTarget(node.left);
    }
  };
  const findWrites = node => {
    if (ts.isBinaryExpression(node) && ts.isAssignmentOperator(node.operatorToken.kind)) markTarget(node.left);
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
      markTarget(node.operand);
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) markTarget(node.initializer);
    ts.forEachChild(node, findWrites);
  };
  findWrites(tree);

  // Follow aliases without writes by symbol so nested scopes and ordinary objects
  // cannot be confused with the real global object. Cycles are not aliases.
  const isGlobalObject = (node, seen = new Set()) => {
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    if (!ts.isIdentifier(node)) return false;
    const symbol = checker.getSymbolAtLocation(node);
    if (node.text === 'globalThis' && !symbol?.declarations?.length) return true;
    if (!symbol || seen.has(symbol) || written.has(symbol)) return false;
    seen.add(symbol);
    const declaration = symbol.valueDeclaration;
    return !!(declaration && ts.isVariableDeclaration(declaration) &&
      ts.isIdentifier(declaration.name) && declaration.initializer &&
      ts.isVariableDeclarationList(declaration.parent) &&
      symbol.declarations?.length === 1 &&
      isGlobalObject(declaration.initializer, seen));
  };

  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) &&
        node.initializer && isGlobalObject(node.initializer)) {
      for (const element of node.name.elements) {
        if (element.dotDotDotToken) continue;
        let key = element.propertyName ?? element.name;
        if (ts.isComputedPropertyName(key)) key = key.expression;
        if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === 'Buffer' &&
            (!element.propertyName || !ts.isComputedPropertyName(element.propertyName) || ts.isStringLiteralLike(key))) count++;
      }
    }
    if (ts.isIdentifier(node) && node.text === 'Buffer') {
      const parent = node.parent;
      if (ts.isShorthandPropertyAssignment(parent)) {
        if (!checker.getShorthandAssignmentValueSymbol(parent)) count++;
      } else if (
        !(ts.isPropertyAccessExpression(parent) && parent.name === node) &&
        !(ts.isBindingElement(parent) && parent.propertyName === node) &&
        !ts.isLabeledStatement(parent) && !ts.isBreakStatement(parent) &&
        !ts.isContinueStatement(parent) && !checker.getSymbolAtLocation(node)
      ) {
        count++;
      }
    }
    if (
      (ts.isPropertyAccessExpression(node) && node.name.text === 'Buffer') ||
      (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === 'Buffer')
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

  for (const [global, pattern] of FORBIDDEN) {
    const found = source.match(pattern);
    if (found) offences.push({ name, global, count: found.length });
  }
}

console.log(`Scanned ${scanned} bundles for globals Paperback 0.8 does not provide.`);

if (scanned === 0) {
  console.log('FAIL  no source bundles were scanned');
  process.exit(1);
}

if (offences.length > 0) {
  for (const { name, global, count } of offences) {
    console.log(`FAIL  ${name}: uses ${global} (${count}×) — not available on 0.8`);
  }
  console.log(`\n${offences.length} FAILED`);
  process.exit(1);
}

console.log('ok    none of them use a global the runtime lacks');
process.exit(0);
