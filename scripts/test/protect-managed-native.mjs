// ADR-050 F6: actual Windows managed storage delivery, scoped to a random test extension ID only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

assert.equal(process.platform, 'win32', 'this native policy delivery check requires Windows');
const root = resolve(import.meta.dirname, '../..');
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/protect-managed-')), extension = join(run, 'extension');
cpSync(join(root, 'dist/chrome'), extension, { recursive: true });
const helper = join(run, 'test-policy.ps1');
writeFileSync(helper, String.raw`param(
  [ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [ValidateSet('reserve','true','false','remove')][string]$Action
)
$ErrorActionPreference = 'Stop'
$testPolicyPaths = @(
  "HKCU:\Software\Policies\Chromium\3rdparty\extensions\$ExtensionId",
  "HKCU:\Software\Policies\Google\Chrome\3rdparty\extensions\$ExtensionId",
  "HKCU:\Software\Policies\Google\Chrome for Testing\3rdparty\extensions\$ExtensionId"
)
if ($Action -eq 'reserve') {
  foreach ($testPolicyPath in $testPolicyPaths) {
    if (Test-Path -LiteralPath $testPolicyPath) { throw 'Refusing existing test extension policy path' }
  }
  foreach ($testPolicyPath in $testPolicyPaths) {
    New-Item -Path ($testPolicyPath + '\policy') -Force | Out-Null
  }
} elseif ($Action -eq 'remove') {
  foreach ($testPolicyPath in $testPolicyPaths) {
    $testPolicyResolved = (Get-Item -LiteralPath $testPolicyPath).Name
    if (-not $testPolicyResolved.EndsWith('\3rdparty\extensions\' + $ExtensionId)) { throw 'Unexpected policy cleanup path' }
    Remove-Item -LiteralPath $testPolicyPath -Recurse -Force
  }
} else {
  foreach ($testPolicyPath in $testPolicyPaths) {
    if (-not (Test-Path -LiteralPath ($testPolicyPath + '\policy'))) { throw 'Unreserved policy path' }
    New-ItemProperty -LiteralPath ($testPolicyPath + '\policy') -Name ProtectModuleDisabled -Value ([int]($Action -eq 'true')) -PropertyType DWord -Force | Out-Null
  }
}
`, 'utf8');
const evidence = { checks: [], at: new Date().toISOString(), registryScope: 'HKCU, random temporary extension ID only' };
let context, policyPage, reserved = false, id;
const policy = action => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-ExtensionId', id, '-Action', action], { windowsHide: true, stdio: 'pipe' });
const launch = () => chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
try {
  context = await launch();
  evidence.browser = context.browser()?.version();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  id = new URL(worker.url()).host; assert.match(id, /^[a-p]{32}$/); evidence.extensionId = id;
  // Discover the ID through Chrome, then seed only this reserved ID before a new policy-provider startup.
  await context.close(); policy('reserve'); reserved = true; policy('false');
  context = await launch();
  const restartedWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  assert.equal(new URL(restartedWorker.url()).host, id);
  const options = await context.newPage(); await options.goto('chrome-extension://' + id + '/options.html');
  const send = message => options.evaluate(m => chrome.runtime.sendMessage(m), { schemaVersion: 1, ...message });
  const getState = () => send({ type: 'ui-protect-get-state' });
  assert.equal((await getState()).state.state, 'off');
  policyPage = await context.newPage(); await policyPage.goto('chrome://policy');
  const waitFor = async (read, accept, label) => {
    const deadline = Date.now() + 20000; let value;
    do { value = await read(); if (accept(value)) return value; await options.waitForTimeout(100); } while (Date.now() < deadline);
    assert.fail(label + ': ' + JSON.stringify(value));
  };
  const setPolicy = async value => {
    policy(String(value)); await policyPage.evaluate(() => chrome.send('reloadPolicies'));
    const state = await waitFor(() => options.evaluate(() => chrome.storage.managed.get(null)), v => v.ProtectModuleDisabled === value, 'native managed value');
    evidence.checks.push({ name: 'OS policy delivered', value: state.ProtectModuleDisabled });
  };
  await setPolicy(false);
  assert.equal((await getState()).state.state, 'off', 'false never enables without user consent');
  const enabled = await send({ type: 'ui-protect-enable', consentVersion: 1, features: ['value-match', 'firewall', 'gpc'], preset: 'normal' });
  assert.equal(enabled.type, 'protect-state'); assert.equal(enabled.state.state, 'active');
  await setPolicy(true);
  const stopped = await waitFor(getState, v => v.state?.state === 'organization-disabled', 'controller disable onChanged');
  evidence.checks.push({ name: 'controller stopped on policy change', state: stopped.state.state });
  const clean = () => options.evaluate(async () => ({
    registrations: (await chrome.scripting.getRegisteredContentScripts()).filter(v => v.id.startsWith('detector-protect-')).length,
    dynamic: (await chrome.declarativeNetRequest.getDynamicRules()).length,
    session: (await chrome.declarativeNetRequest.getSessionRules()).length,
  }));
  evidence.stopped = await waitFor(clean, v => v.registrations === 0 && v.dynamic === 0 && v.session === 0, 'policy removes module activity');
  const refused = await send({ type: 'ui-protect-enable', consentVersion: 1, features: ['value-match'], preset: 'normal' });
  assert.equal(refused.code, 'disabled-by-organization');
  evidence.checks.push({ name: 'policy blocks activation and removes registrations/rules' });
  await setPolicy(false);
  await waitFor(getState, v => v.state?.state === 'active', 'existing user consent resumes');
  assert.equal((await send({ type: 'ui-protect-disable', purge: true })).state.state, 'off');
  evidence.checks.push({ name: 'false restores existing user choice; purge returns off' });
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL'; evidence.failure = String(error.stack ?? error);
  evidence.policyPage = await policyPage?.locator('body').innerText().catch(() => 'unavailable');
  throw error;
} finally {
  try { if (reserved) { policy('remove'); evidence.registryCleanup = true; } } finally {
    await context?.close();
    writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    mkdirSync(join(root, 'test-results/audit/2026-10-20'), { recursive: true });
    writeFileSync(join(root, 'test-results/audit/2026-10-20/managed-native.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
}
console.log('PASS: native managed delivery and lifecycle (' + evidence.checks.length + ' checks); temporary policy keys removed');
