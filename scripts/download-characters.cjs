const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const assetDirectory = path.resolve(__dirname, '../assets/characters');
const manifestPath = path.join(assetDirectory, 'manifest.json');
const sourceUrl = 'https://www.anime-chiikawa.jp/images/characters/img_charapage.png';
const sourceSha256 = '856b8b0e181c4a1c2a826816ed0b19eaad271fb580e76c5b21273885ec0ff07e';
const cropBoxes = {
  chiikawa: [0, 0, 335, 362],
  hachiware: [343, 0, 335, 374],
  usagi: [690, 0, 335, 463],
  kurimanju: [1457, 0, 308, 365],
  momonga: [1035, 0, 419, 391],
  rakko: [2289, 0, 340, 362],
  shisa: [2636, 0, 400, 355],
  furuhonya: [3456, 0, 314, 424]
};

const cropProgram = `
import hashlib
import json
import os
import sys
from PIL import Image

source_path, destination, configuration = sys.argv[1:]
entries = json.loads(configuration)
with Image.open(source_path) as source:
    if source.size != (3766, 463) or source.format != 'PNG':
        raise ValueError('Unexpected official sprite dimensions or format')
    results = []
    for entry in entries:
        left, top, width, height = entry['box']
        region = source.crop((left, top, min(left + width, source.width), min(top + height, source.height)))
        bounds = region.convert('RGBA').getchannel('A').getbbox()
        if bounds is None:
            raise ValueError('Empty character crop: ' + entry['id'])
        image = region.crop(bounds)
        alpha = image.convert('RGBA').getchannel('A')
        if alpha.getextrema() != (0, 255):
            raise ValueError('Character must retain transparent and opaque pixels: ' + entry['id'])
        filename = os.path.join(destination, entry['file'])
        image.save(filename, format='PNG', optimize=True)
        with open(filename, 'rb') as output:
            digest = hashlib.sha256(output.read()).hexdigest()
        results.append({'id': entry['id'], 'file': entry['file'], 'width': image.width, 'height': image.height, 'bytes': os.path.getsize(filename), 'sha256': digest})
    print(json.dumps(results, indent=2))
`;

function execute(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${command} exited with ${result.status}`);
  return result.stdout;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--source')) {
    throw new Error('Usage: node scripts/download-characters.cjs [--source existing-official-sprite.png]');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest) || manifest.length !== Object.keys(cropBoxes).length) {
    throw new Error('Manifest must contain the eight verified characters');
  }
  const seenIds = new Set();
  const entries = manifest.map(entry => {
    if (!Object.hasOwn(cropBoxes, entry.id) || seenIds.has(entry.id) || entry.file !== `${entry.id}.png` || entry.sourceUrl !== sourceUrl) {
      throw new Error(`Unexpected character manifest entry: ${entry.id}`);
    }
    seenIds.add(entry.id);
    return { id: entry.id, file: entry.file, box: cropBoxes[entry.id] };
  });
  let temporaryDirectory;
  let downloadedPath;
  try {
    let sourcePath;
    if (args.length === 2) {
      sourcePath = path.resolve(args[1]);
    } else {
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'chiikawa-characters-'));
      downloadedPath = path.join(temporaryDirectory, 'official-sprite.png');
      execute(process.platform === 'win32' ? 'curl.exe' : 'curl', [
        '-fLsS', '--proto', '=https', '--proto-redir', '=https', '--max-time', '35',
        '--max-filesize', '1048576', sourceUrl, '-o', downloadedPath
      ]);
      sourcePath = downloadedPath;
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
    if (digest !== sourceSha256) {
      throw new Error('Official sprite changed; reverify the character page and CSS before updating its hash or crop boxes');
    }
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const results = execute(python, ['-c', cropProgram, sourcePath, assetDirectory, JSON.stringify(entries)]);
    process.stdout.write(results);
  } finally {
    if (downloadedPath && fs.existsSync(downloadedPath)) fs.unlinkSync(downloadedPath);
    if (temporaryDirectory) fs.rmdirSync(temporaryDirectory);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
