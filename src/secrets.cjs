const fs = require('node:fs');
const path = require('node:path');

function createSecretStore(directory, safeStorage, provider = 'deepseek') {
  if (!['deepseek', 'custom'].includes(provider)) throw new Error('不支持的 Key 来源');
  const label = provider === 'deepseek' ? 'DeepSeek' : '第三方平台';
  const filename = path.join(directory, provider === 'deepseek' ? 'deepseek-key.bin' : 'custom-api-key.bin');
  const temporary = filename + '.tmp';
  const removeSaved = () => {for (const target of [filename, temporary]) if (fs.existsSync(target)) fs.unlinkSync(target);};
  let sessionKey = '';
  const prepare = (key, persist) => {
    if (typeof key !== 'string' || !key.trim() || key.length > 1000 || /[\x00-\x1f\x7f]/.test(key) || typeof persist !== 'boolean') throw new Error('请输入有效的 ' + label + ' API Key');
    const normalized = key.trim();
    let encrypted;
    if (persist) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，请取消「记住 Key」，改为仅本次使用');
      try {encrypted = safeStorage.encryptString(normalized);} catch {throw new Error('系统加密失败，未保存 Key；请改为仅本次使用');}
    }
    return () => {
      if (persist) {
        fs.mkdirSync(directory, {recursive: true});
        try {fs.writeFileSync(temporary, encrypted, {mode: 0o600}); fs.renameSync(temporary, filename);}
        catch (error) {if (fs.existsSync(temporary)) fs.unlinkSync(temporary); throw error;}
      } else removeSaved();
      sessionKey = normalized;
    };
  };
  return {
    available: () => Boolean(sessionKey || fs.existsSync(filename)),
    persistent: () => fs.existsSync(filename),
    prepare,
    save: (key, persist) => prepare(key, persist)(),
    get: () => {
      if (sessionKey) return sessionKey;
      if (!fs.existsSync(filename)) throw new Error('请先在设置中填写自己的 ' + label + ' API Key');
      try {return safeStorage.decryptString(fs.readFileSync(filename));} catch {throw new Error('无法解密本机 Key；跨电脑请重新输入自己的 Key');}
    },
    clear: () => {sessionKey = ''; removeSaved();}
  };
}

module.exports = {createSecretStore};
