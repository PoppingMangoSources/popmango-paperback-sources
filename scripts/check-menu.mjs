/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Settings row helpers against stubbed App.createDUI* factories, from common/ transpiled into tmp/.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const out = path.join(repo, 'tmp', 'check-menu');
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'common'), { recursive: true });
for (const file of readdirSync(path.join(repo, 'common')).filter(f => f.endsWith('.ts'))) {
  const js = ts.transpileModule(readFileSync(path.join(repo, 'common', file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
  writeFileSync(path.join(out, 'common', file.replace(/\.ts$/, '.js')), js);
}

const factory = type => info => ({ type, ...info });
globalThis.App = Object.fromEntries(['Binding', 'Select', 'InputField', 'SecureInputField', 'Switch', 'Stepper', 'Label',
  'MultilineLabel', 'Button', 'Link', 'Header', 'OAuthButton', 'Form', 'Section', 'NavigationButton']
  .map(name => [`createDUI${name}`, factory(`DUI${name}`)]));
const menu = require(path.join(out, 'common', 'Menu.js'));

let fail = 0;
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`); };

let stored;
const stepper = menu.stepperRow('pages', { label: 'Pages', min: 1, max: 10, step: 1, get: () => 3, set: v => { stored = v; } });
t('stepper row', [stepper.type, stepper.min, stepper.max, await stepper.value.get()], ['DUIStepper', 1, 10, 3]);
await stepper.value.set(5); await stepper.value.set('7'); await stepper.value.set(Number.NaN);
t('  stepper keeps only finite numbers', stored, 5);

const secure = menu.secureInputRow('token', { label: 'Token', get: () => 'abc', set: v => { stored = v; } });
await secure.value.set(undefined);
t('secure input row', [secure.type, await secure.value.get(), stored], ['DUISecureInputField', 'abc', '']);

let tapped = 0;
const button = menu.buttonRow('reset', 'Reset', () => { tapped++; });
await button.onTap();
t('button row', [button.type, button.label, tapped], ['DUIButton', 'Reset', 1]);

t('link row', menu.linkRow('site', 'Website', 'https://example.com'),
  { type: 'DUILink', id: 'site', label: 'Website', value: 'https://example.com' });
t('header row', menu.headerRow('top', { imageUrl: 'https://example.com/i.png', title: 'Title' }),
  { type: 'DUIHeader', id: 'top', imageUrl: 'https://example.com/i.png', title: 'Title' });
t('multiline label row', menu.multilineLabelRow('note', 'Note', 'long text'),
  { type: 'DUIMultilineLabel', id: 'note', label: 'Note', value: 'long text' });

const oauth = menu.oauthButtonRow('login', { label: 'Sign in', authorizeEndpoint: 'https://example.com/auth', clientId: 'id',
  responseType: { type: 'token' }, onSuccess: (access, refresh) => { stored = [access, refresh]; } });
await oauth.successHandler('a', 'r');
t('oauth button row', [oauth.type, oauth.clientId, 'onSuccess' in oauth, stored], ['DUIOAuthButton', 'id', false, ['a', 'r']]);

const nested = menu.formRow('more', 'More', async () => [{ id: 's', rows: [button] }]);
const sections = await nested.form.sections();
t('form row opens nested sections', [nested.type, sections[0].type, (await sections[0].rows())[0].type],
  ['DUINavigationButton', 'DUISection', 'DUIButton']);

const root = menu.settingsMenu('Settings', () => [{ id: 's', rows: [stepper] }]);
const [entry] = await root.rows();
t('settings menu still opens through one button', [entry.id, (await (await entry.form.sections())[0].rows())[0].type],
  ['settings_button', 'DUIStepper']);

rmSync(out, { recursive: true, force: true });
if (fail) { console.error(`\n${fail} failed`); process.exit(1); }
console.log('\nall passed');
