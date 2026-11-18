// 从资料库 Markdown 生成两个网页共用的数据。
// 用法（在「竞赛网页」文件夹里运行）：node tools/build.mjs [Markdown路径]
// 不填路径时，自动使用上一级文件夹中最新的「*学科竞赛导航资料库*.md」。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const Core = require(path.join(web, 'assets/core.js'));

let mdPath = process.argv[2];
if (!mdPath) {
  const dir = path.resolve(web, '..');
  const cands = fs.readdirSync(dir).filter(f => /学科竞赛导航资料库.*\.md$/.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!cands.length) { console.error('找不到资料库 Markdown，请把路径作为参数传入。'); process.exit(1); }
  mdPath = path.join(dir, cands[0].f);
}
const md = fs.readFileSync(mdPath, 'utf8');
const { data, errors, warnings } = Core.parseMarkdown(md);
console.log('读取：' + mdPath);
warnings.forEach(w => console.log('提醒：' + w));
if (errors.length) { errors.forEach(e => console.error('错误：' + e)); console.error('有错误，未生成数据。'); process.exit(1); }

const dataJs = Core.makeDataJs(data);
fs.writeFileSync(path.join(web, 'assets/data.js'), dataJs);

// 手机单文件版：把查询器页面、核心脚本和数据合成一个 HTML
const page = fs.readFileSync(path.join(web, '01-竞赛查询与奖金计算器.html'), 'utf8');
const coreJs = fs.readFileSync(path.join(web, 'assets/core.js'), 'utf8');
fs.writeFileSync(path.join(web, '手机单文件版/竞赛查询器-手机版.html'), Core.makeSingleFile(page, coreJs, dataJs));

// 供「03-更新数据.html」离线生成手机单文件版使用的模板
fs.writeFileSync(path.join(web, 'assets/page-template.js'),
  '/* 由 tools/build.mjs 生成：查询器页面模板，供更新数据页生成手机单文件版。请勿手改。 */\n' +
  'window.PAGE_TEMPLATE = ' + JSON.stringify({ page, core: coreJs }) + ';\n');

const n = g => data.competitions.filter(c => c.grade === g).length;
console.log(`完成：A类 ${n('A')} 条，B类 ${n('B')} 条，C/D已批准 ${data.approvedCD.length} 条，日历节点 ${data.calendar.nodes.length} 个。`);
console.log('已写入 assets/data.js、assets/page-template.js、手机单文件版/竞赛查询器-手机版.html');
