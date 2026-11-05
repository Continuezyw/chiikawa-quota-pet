const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fetchEptQuota} = require('../src/providers/ept.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const direct = await fetchEptQuota();
  assert.equal(direct.source, 'ept');
  assert.equal(direct.kind, 'quota');
  assert.ok(Number.isFinite(direct.used) && Number.isFinite(direct.total));
  assert.equal(direct.remaining, Math.max(0, direct.total - direct.used));
  const {_electron: electron} = require('playwright');
  const packaged = process.argv.includes('--packaged');
  const artifacts = path.join(root, 'artifacts');
  fs.mkdirSync(artifacts, {recursive: true});
  const environment = {...process.env};
  delete environment.ELECTRON_RUN_AS_NODE;
  const options = {args: [...(packaged ? [] : [root]), '--data-dir=' + path.join(artifacts, 'ept-live-' + Date.now())], env: environment, timeout: 60000};
  if (packaged) options.executablePath = path.join(root, 'release', 'win-unpacked', 'ChiikawaQuotaPet.exe');
  const application = await electron.launch(options);
  try {
    await application.firstWindow();
    let pet;
    for (let attempt = 0; attempt < 50 && !pet; attempt += 1) {pet = application.windows().find((page) => page.url().endsWith('/renderer/index.html')); if (!pet) await new Promise((resolve) => setTimeout(resolve, 100));}
    assert.ok(pet);
    await pet.waitForFunction(() => Boolean(window.petAPI));
    let state;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      state = (await pet.evaluate(() => window.petAPI.getState())).data;
      if (state.sync.status === 'success') break;
      if (state.sync.status === 'error') throw new Error(state.sync.message);
      await pet.waitForTimeout(300);
    }
    assert.equal(state.sync.status, 'success');
    assert.equal(state.settings.sourceMode, 'ept');
    assert.equal(state.quota.source, 'ept');
    assert.equal(state.quota.remaining, Math.max(0, state.quota.total - state.quota.used));
    assert.ok(state.eptStatus.available);
    assert.equal('reportUrl' in state.settings, false);
    assert.equal(await pet.evaluate(() => typeof window.petAPI.openLogin), 'undefined');
    await pet.evaluate(() => window.petAPI.petHover(true));
    const panel = application.windows().find((page) => page.url().includes('view=panel'));
    assert.ok(panel);
    await panel.waitForFunction(() => document.querySelector('#source').textContent === 'EPT 查询');
    assert.equal(await panel.locator('#remaining').innerText(), state.quota.remaining.toFixed(2));
    assert.equal(await panel.locator('#percentage').innerText(), state.quota.percentage.toFixed(2) + '%');
    await panel.screenshot({path: path.join(artifacts, packaged ? 'ept-live-panel-packaged.png' : 'ept-live-panel.png'), omitBackground: true});
    const refreshed = await pet.evaluate(() => window.petAPI.refresh());
    assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
    assert.equal(refreshed.data.quota.source, 'ept');
    console.log(JSON.stringify({status: 'passed', packaged, source: 'ept', cycle: state.quota.ept.resetCycle, checks: ['actual local EPT command', 'startup auto query', 'numeric quota and remaining', 'hover panel matches', 'manual refresh', 'no browser IPC'], credentialsCopied: false}, null, 2));
  } finally {await application.close();}
}
run().catch((error) => {console.error(error.message); process.exitCode = 1;});
