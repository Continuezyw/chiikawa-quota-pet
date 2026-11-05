const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {parseEptText, parseEptJson, restoreEptQuota, fetchEptQuota} = require('../src/providers/ept.cjs');
const {createStore} = require('../src/store.cjs');
const now = '2026-11-04T08:00:00.000Z';
const text = '## 使用情况汇总\n• 本月使用总金额: 175.79 元\n• 月额度: 600 元\n• 部门额度\n• 花费 / 额度: 175.79 元 / 600 元\n• 已使用百分比: 29.30%\n\n## 统计时间范围\n• 开始时间: 2026-11-01 00:00:00\n• 结束时间: 2026-11-04 15:48:50';

test('用户原格式支持项目符号但不读取部门后的百分比，也不制造报告比例', () => {
  const parsed = parseEptText(text, now);
  assert.equal(parsed.used, 175.79);
  assert.equal(parsed.total, 600);
  assert.equal(parsed.ept.reportedPercentage, null);
  assert.equal(restoreEptQuota(parsed).ept.reportedPercentage, null);
});

test('上期额度、Coding-only和带分项前缀的汇总必须拒绝', () => {
  for (const invalid of [text.replace('月额度:', '上月额度:'), text.replace('## 使用情况汇总', '## 使用情况汇总\n### Coding'), text.replace('• 本月使用总金额:', '• Coding 本月使用总金额:')]) assert.throws(() => parseEptText(invalid, now));
});

test('缺少元的长空白输出在限量内快速拒绝，无重叠正则回溯', {timeout: 1000}, () => {
  const invalid = '## 使用情况汇总\n本月使用总金额: 1' + ' '.repeat(800000) + 'X\n月额度: 600 元';
  assert.throws(() => parseEptText(invalid, now));
});

test('非法日期不能通过解析或缓存恢复被归一化成别的采样日期', () => {
  const payload = {total_budget: 600, actual_cost: 175.79, usage_percentage: 175.79 / 600 * 100, reset_cycle: 'monthly'};
  assert.throws(() => parseEptJson(payload, '2026-02-30T00:00:00.000Z'));
  assert.throws(() => restoreEptQuota({...parseEptJson(payload, now), updatedAt: '2026-02-30T00:00:00.000Z'}));
});

test('stdout与stderr合计超限拒绝，即便分别低于1MiB', async () => {
  const payload = JSON.stringify({total_budget: 600, actual_cost: 175.79, usage_percentage: 175.79 / 600 * 100, reset_cycle: 'monthly'});
  await assert.rejects(() => fetchEptQuota({}, {platform: 'win32', homeDirectory: 'C:\\Fixture', env: {}, existsSync: () => true, execFileImpl: (_executable, _args, _options, callback) => {callback(null, payload + ' '.repeat(600000), ' '.repeat(600000)); return {kill: () => {}};}}), /超过限制/);
});

test('旧缺省来源的手动数据迁移到EPT未知，不保留历史样例', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ept-legacy-manual-'));
  try {
    fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({settings: {reportUrl: '', character: 'usagi'}, quota: {total: 600, used: 100, source: 'manual'}}));
    const state = createStore(directory).get();
    assert.equal(state.settings.sourceMode, 'ept');
    assert.equal(state.quota.source, 'ept');
    assert.equal(state.quota.remaining, null);
    assert.equal(state.settings.character, 'usagi');
  } finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('ept-legacy-manual-')) throw new Error('Unsafe cleanup');
    fs.rmSync(resolved, {recursive: true, force: true});
  }
});
