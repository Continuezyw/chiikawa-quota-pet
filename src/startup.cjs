const {win32} = require('node:path');

const READ_ERROR = '无法读取系统开机启动状态，请稍后重试。';
const WRITE_ERROR = '无法修改系统开机启动设置，请检查系统权限后重试。';
const VERIFY_ERROR = '开机启动设置未通过系统回读验证，请检查系统权限和任务管理器后重试。';
const DISABLED_MESSAGE = '开机启动已注册，但被 Windows 系统或任务管理器禁用；请在任务管理器的“启动应用”中启用后重试。';
const CLOSED_MESSAGE = '开机启动已关闭；若移动过程序目录，请关闭开关后重新开启以重新启用。';

function createStartup(app, options = {isolated: false, platform: process.platform}) {
  const platform = options.platform ?? process.platform;
  const isolated = Boolean(options.isolated) || process.argv.some((argument) => argument === '--data-dir' || argument.startsWith('--data-dir='));
  const unavailableMessage = isolated ? '隔离测试模式不支持开机启动，不会读写系统登录项。'
    : platform !== 'win32' ? '开机启动仅支持 Windows 已打包版本。'
      : app.isPackaged !== true ? '开发版不支持开机启动，不会读写系统登录项。' : '';

  function executablePath() {
    const executable = app.getPath('exe');
    if (typeof executable !== 'string' || !executable.trim()) throw new Error(READ_ERROR);
    return executable;
  }

  function readSettings(executable) {
    const settings = app.getLoginItemSettings({path: executable, args: []});
    if (!settings || typeof settings.openAtLogin !== 'boolean' || (settings.launchItems !== undefined && !Array.isArray(settings.launchItems))) throw new Error(READ_ERROR);
    const launchItems = settings.launchItems || [];
    const matchingItems = launchItems.filter((item) => item && typeof item.enabled === 'boolean'
      && (item.path === undefined || (typeof item.path === 'string' && win32.normalize(item.path).toLowerCase() === win32.normalize(executable).toLowerCase()))
      && (item.args === undefined || (Array.isArray(item.args) && item.args.length === 0)));
    const blocked = settings.openAtLogin && (settings.executableWillLaunchAtLogin === false
      || (matchingItems.length > 0 && !matchingItems.some((item) => item.enabled)));
    return {
      registered: settings.openAtLogin,
      state: {available: true, enabled: settings.openAtLogin && !blocked,
        message: blocked ? DISABLED_MESSAGE : settings.openAtLogin ? '开机启动已启用。' : CLOSED_MESSAGE}
    };
  }

  return {
    status() {
      if (unavailableMessage) return {available: false, enabled: false, message: unavailableMessage};
      try {return readSettings(executablePath()).state;}
      catch {return {available: false, enabled: false, message: READ_ERROR};}
    },
    setEnabled(enabled) {
      if (unavailableMessage) throw new Error(unavailableMessage);
      if (typeof enabled !== 'boolean') throw new Error('开机启动开关必须为布尔值。');
      let executable;
      try {executable = executablePath();}
      catch {throw new Error(READ_ERROR);}
      try {app.setLoginItemSettings({openAtLogin: enabled, path: executable, args: []});}
      catch {throw new Error(WRITE_ERROR);}
      let result;
      try {result = readSettings(executable);}
      catch {throw new Error(VERIFY_ERROR);}
      if (result.registered !== enabled || (enabled && !result.state.enabled)) {
        throw new Error(result.registered && !result.state.enabled && enabled ? DISABLED_MESSAGE : VERIFY_ERROR);
      }
      return result.state;
    }
  };
}

module.exports = {createStartup};
