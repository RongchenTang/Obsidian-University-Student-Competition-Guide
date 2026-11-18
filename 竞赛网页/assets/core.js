/*!
 * 竞赛网页共用核心：Markdown 解析、数据校验、赛事查询、奖金计算
 * 查询器、网页PPT、更新数据页面和 tools/build.mjs 都使用这一个文件，保证规则一致。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CompCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- Markdown 基础解析 ---------------- */

  function stripMd(s) {
    return String(s || '')
      .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
      .replace(/\*\*|__|`/g, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .trim();
  }

  function cellLinks(s) {
    var out = [], re = /\[([^\]]*)\]\(([^)]*)\)/g, m;
    while ((m = re.exec(String(s || '')))) out.push({ text: m[1].replace(/\*\*/g, ''), url: m[2] });
    var bare = String(s || '').replace(re, '').match(/https?:\/\/[^\s|）)，,；;]+/g);
    if (bare) bare.forEach(function (u) { out.push({ text: u, url: u }); });
    return out;
  }

  function splitRow(line) {
    var t = line.trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
    return t.split('|').map(function (c) { return c.trim(); });
  }

  function frontmatter(md) {
    var m = md.match(/^---\s*\n([\s\S]*?)\n---/);
    var fm = {};
    if (m) m[1].split('\n').forEach(function (l) {
      var i = l.indexOf(':');
      if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });
    return fm;
  }

  // 把文档切成标题段落：{level, title, lines}
  function sections(md) {
    var lines = md.replace(/\r\n?/g, '\n').split('\n');
    var secs = [], cur = { level: 0, title: '', lines: [] };
    lines.forEach(function (l) {
      var h = l.match(/^(#{1,6})\s+(.*)$/);
      if (h) { secs.push(cur); cur = { level: h[1].length, title: h[2].trim(), lines: [] }; }
      else cur.lines.push(l);
    });
    secs.push(cur);
    return secs;
  }

  // 找到以 prefix 开头的标题，返回该标题下（直到同级或更高级标题前）的全部行
  function blockOf(secs, prefix) {
    for (var i = 0; i < secs.length; i++) {
      if (secs[i].level && secs[i].title.indexOf(prefix) === 0) {
        var lv = secs[i].level, lines = secs[i].lines.slice();
        for (var j = i + 1; j < secs.length && secs[j].level > lv; j++) {
          lines.push('#'.repeat(secs[j].level) + ' ' + secs[j].title);
          lines = lines.concat(secs[j].lines);
        }
        return { found: true, title: secs[i].title, ownLines: secs[i].lines, lines: lines };
      }
    }
    return { found: false, title: prefix, ownLines: [], lines: [] };
  }

  // 解析一段文字中的第 n 个表格
  function tables(lines) {
    var out = [], cur = null;
    lines.forEach(function (l) {
      if (/^\s*\|/.test(l)) {
        if (!cur) cur = [];
        cur.push(l);
      } else if (cur) { out.push(cur); cur = null; }
    });
    if (cur) out.push(cur);
    return out.map(function (rows) {
      var header = splitRow(rows[0]).map(stripMd);
      var body = rows.slice(2).map(splitRow);
      return { header: header, rows: body };
    });
  }

  function tableToObjects(t) {
    if (!t) return [];
    return t.rows.map(function (r) {
      var o = {};
      t.header.forEach(function (h, i) { o[h] = r[i] === undefined ? '' : r[i]; });
      return o;
    });
  }

  function pick(o, keys) {
    for (var i = 0; i < keys.length; i++) if (o[keys[i]] !== undefined) return o[keys[i]];
    // 允许列名带额外说明，例如「专业方向（本MD整理）」
    var ks = Object.keys(o);
    for (i = 0; i < keys.length; i++) for (var j = 0; j < ks.length; j++) if (ks[j].indexOf(keys[i]) === 0) return o[ks[j]];
    return '';
  }

  function ids(s) { return (String(s || '').match(/[AB]\d{2}/g) || []); }
  function list(s) { return stripMd(s).split(/[、，,]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function num(s) { var n = Number(String(s).replace(/[,，\s]/g, '')); return isNaN(n) ? null : n; }

  /* ---------------- 从 Markdown 生成数据 ---------------- */

  function parseMarkdown(md) {
    var errors = [], warnings = [];
    var fm = frontmatter(md);
    var secs = sections(md);

    function need(prefix) {
      var b = blockOf(secs, prefix);
      if (!b.found) errors.push('找不到标题「' + prefix + '」');
      return b;
    }

    /* 奖励标准 */
    var b21 = need('2.1');
    var typeKey = { '理工类（硬件类）': 'hw', '理工类（其他类）': 'sci', '人文社科类': 'hum' };
    function rewardTableOf(block, label) {
      var t = tables(block.lines)[0], out = {};
      if (t) t.rows.forEach(function (r) {
        var k = typeKey[stripMd(r[0])];
        if (!k) return;
        var v = r.slice(1, 7).map(num);
        out[k] = { A: { 1: v[0], 2: v[1], 3: v[2] }, B: { 1: v[3], 2: v[4], 3: v[5] } };
      });
      ['hw', 'sci', 'hum'].forEach(function (k) {
        if (!out[k]) errors.push(label + '缺少一行：' + Object.keys(typeKey).filter(function (n) { return typeKey[n] === k; })[0]);
      });
      return out;
    }
    var student = rewardTableOf(b21, '2.1 学生奖励表');
    var b22 = need('2.2');
    var teacher = rewardTableOf(b22, '2.2 指导教师奖励表');
    var tsp = b22.lines.join('\n').match(/指导教师特等奖[\s\S]{0,40}?一等奖奖励基础\s*[×xX*]\s*([\d.]+)/);
    var teacherSpecial = tsp ? +tsp[1] : null;
    if (!tsp) errors.push('2.2 未找到指导教师特等奖系数（格式：指导教师特等奖…一等奖奖励基础×1.5）');
    var t21 = b21.lines.join('\n');
    var team = null;
    var tm = t21.match(/个人\s*([\d.]+)[；;，,\s]*2人\s*([\d.]+)[；;，,\s]*3人\s*([\d.]+)[；;，,\s]*4人及以上\s*([\d.]+)/);
    if (tm) team = { 1: +tm[1], 2: +tm[2], 3: +tm[3], 4: +tm[4] };
    else errors.push('2.1 未找到团队系数（格式：个人1.0；2人1.1；3人1.2；4人及以上1.3）');
    var sp = t21.match(/特等奖[\s\S]{0,40}?一等奖奖励基础\s*[×xX*]\s*([\d.]+)/);
    var specialFactor = sp ? +sp[1] : null;
    if (!sp) errors.push('2.1 未找到特等奖系数（格式：对应一等奖奖励基础×1.5）');

    /* 页码对照 */
    var pageMap = tableToObjects(tables(need('10.3').lines)[0]).map(function (o) {
      var r = String(pick(o, ['序号范围'])).split(/[-—–]/).map(Number);
      return { att: stripMd(pick(o, ['附件'])), from: r[0], to: r[1] || r[0], page: num(pick(o, ['PDF页码'])) };
    });
    function pageOf(att, n) {
      for (var i = 0; i < pageMap.length; i++) if (pageMap[i].att === att && n >= pageMap[i].from && n <= pageMap[i].to) return pageMap[i].page;
      return null;
    }

    /* 方向归并 */
    var groupMap = {};
    tableToObjects(tables(need('10.6').lines)[0]).forEach(function (o) {
      groupMap[stripMd(pick(o, ['资料库方向标签']))] = stripMd(pick(o, ['查询器筛选组']));
    });

    function hwFlag(s) { return /^是/.test(stripMd(s)); }

    /* A 类 */
    var aRows = tableToObjects(tables(need('四、A类').lines)[0]);
    var comps = [];
    aRows.forEach(function (o) {
      var id = stripMd(pick(o, ['A编号']));
      if (!/^A\d{2}$/.test(id)) return;
      var n = +id.slice(1), dir = stripMd(pick(o, ['专业方向']));
      comps.push({
        id: id, grade: 'A', no: n,
        name: stripMd(pick(o, ['竞赛名称'])),
        direction: dir, group: groupMap[dir] || '其他',
        unit: stripMd(pick(o, ['校内承办单位'])),
        hardware: hwFlag(pick(o, ['原表标硬件'])),
        source: { doc: fm.source_policy || '', att: '附件1', no: n, page: pageOf('附件1', n) }
      });
      if (!groupMap[dir]) warnings.push(id + ' 的方向标签「' + dir + '」未在10.6归并表中');
    });

    /* B 类 */
    var bRows = tableToObjects(tables(need('五、B类').lines)[0]);
    bRows.forEach(function (o) {
      var id = stripMd(pick(o, ['B编号']));
      if (!/^B\d{2}$/.test(id)) return;
      var n = +id.slice(1), dir = stripMd(pick(o, ['专业方向']));
      comps.push({
        id: id, grade: 'B', no: n,
        name: stripMd(pick(o, ['文件所列竞赛名称', '竞赛名称'])),
        direction: dir, group: groupMap[dir] || '其他',
        unit: stripMd(pick(o, ['校内承办单位'])),
        hardware: hwFlag(pick(o, ['原表标硬件'])),
        source: { doc: fm.source_policy || '', att: '附件2', no: n, page: pageOf('附件2', n) }
      });
      if (!groupMap[dir]) warnings.push(id + ' 的方向标签「' + dir + '」未在10.6归并表中');
    });

    /* C/D 已批准记录 */
    var cd = [];
    tableToObjects(tables(need('5.1').lines)[0]).forEach(function (o) {
      var g = stripMd(pick(o, ['学校认定']));
      var doc = stripMd(pick(o, ['批准部门与文件编号']));
      if (/^[CD]$/.test(g) && doc && doc !== '—' && doc !== '-') {
        cd.push({
          id: stripMd(pick(o, ['赛事ID'])), grade: g, name: stripMd(pick(o, ['赛事名称'])),
          unit: doc, approvedOn: stripMd(pick(o, ['批准日期'])), edition: stripMd(pick(o, ['赛事届次'])),
          evidence: cellLinks(pick(o, ['证据链接'])), status: stripMd(pick(o, ['状态'])),
          direction: '', group: '其他', hardware: false,
          source: { doc: doc, att: '学校批准记录', no: null, page: null }
        });
      }
    });

    var byId = {};
    comps.concat(cd).forEach(function (c) { byId[c.id] = c; c.aliases = []; c.stages = []; });

    /* 别名 */
    tableToObjects(tables(need('10.1').lines)[0]).forEach(function (o) {
      var id = stripMd(pick(o, ['编号']));
      if (!byId[id]) { errors.push('10.1 别名表中的编号 ' + id + ' 不存在'); return; }
      byId[id].aliases = byId[id].aliases.concat(list(pick(o, ['常用简称与别名'])));
    });

    /* 5.2 消歧提示 */
    var hints = tableToObjects(tables(need('5.2').lines)[0]).map(function (o) {
      return { input: stripMd(pick(o, ['学生常输入'])), ids: ids(pick(o, ['可能对应'])), ask: stripMd(pick(o, ['查询器必须再问什么'])) };
    });
    hints.forEach(function (h) { h.ids.forEach(function (id) { if (!byId[id]) errors.push('5.2 中的编号 ' + id + ' 不存在'); }); });

    /* A → B 对应关系 */
    var mappedB = {};
    tableToObjects(tables(need('10.2').lines)[0]).forEach(function (o) {
      var a = stripMd(pick(o, ['A编号'])), b = ids(pick(o, ['对应B编号']))[0] || null;
      var status = stripMd(pick(o, ['状态']));
      if (!byId[a]) { errors.push('10.2 中的A编号 ' + a + ' 不存在'); return; }
      if (b && !byId[b]) { errors.push('10.2 中的B编号 ' + b + ' 不存在'); return; }
      var st = { label: stripMd(pick(o, ['选拔赛层级名称'])), bId: b, basis: stripMd(pick(o, ['对应依据'])), verified: status === '已核实' };
      byId[a].stages.push(st);
      if (b && st.verified) mappedB[b] = a;
    });
    Object.keys(mappedB).forEach(function (b) { byId[b].parentA = mappedB[b]; });

    /* 日历 */
    var monthPlan = tableToObjects(tables(need('3.2').lines)[0]).map(function (o) {
      return {
        month: num(String(pick(o, ['月份'])).replace('月', '')),
        watch: stripMd(pick(o, ['应关注'])), prepare: stripMd(pick(o, ['建议完成的准备工作'])), status: stripMd(pick(o, ['信息状态']))
      };
    });
    var nodes = tableToObjects(tables(need('10.4').lines)[0]).map(function (o) {
      var status = stripMd(pick(o, ['状态']));
      if (['已核实', '备赛参考', '待公布'].indexOf(status) < 0) errors.push('10.4 状态只能是 已核实/备赛参考/待公布，发现：' + status);
      var srcCell = pick(o, ['来源']);
      return {
        month: num(pick(o, ['月份'])), name: stripMd(pick(o, ['竞赛'])), ids: ids(pick(o, ['关联ID'])),
        date: stripMd(pick(o, ['日期'])), type: stripMd(pick(o, ['事项类型'])), year: stripMd(pick(o, ['届次年份'])),
        status: status, source: (cellLinks(srcCell)[0] || {}).url || ''
      };
    });
    nodes.forEach(function (n) {
      n.ids.forEach(function (id) { if (!byId[id]) errors.push('10.4 中的编号 ' + id + ' 不存在'); });
      if (n.status === '已核实' && !n.source) errors.push('10.4「' + n.name + ' ' + n.type + '」标为已核实但没有来源链接');
    });

    /* 路线、案例、费用、备赛要点 */
    var routes = tableToObjects(tables(need('10.5').lines)[0]).map(function (o) {
      return { direction: stripMd(pick(o, ['方向'])), ids: ids(pick(o, ['代表比赛'])), works: stripMd(pick(o, ['适合的作品'])), action: stripMd(pick(o, ['马上可以开始的准备动作'])) };
    });
    routes.forEach(function (r) { r.ids.forEach(function (id) { if (!byId[id]) errors.push('10.5 中的编号 ' + id + ' 不存在'); }); });
    var cases = tableToObjects(tables(need('10.7').lines)[0]).map(function (o) {
      return {
        comp: stripMd(pick(o, ['竞赛'])), ids: ids(pick(o, ['关联ID'])), work: stripMd(pick(o, ['作品'])), award: stripMd(pick(o, ['奖项'])),
        what: stripMd(pick(o, ['作品做了什么'])), learn: stripMd(pick(o, ['学生可以借鉴'])), source: (cellLinks(pick(o, ['来源']))[0] || {}).url || ''
      };
    });
    var money = tableToObjects(tables(need('10.8').lines)[0]).map(function (o) {
      return { item: stripMd(pick(o, ['项目'])), kind: stripMd(pick(o, ['归类'])), note: stripMd(pick(o, ['说明'])) };
    });
    var tips = tableToObjects(tables(need('7.1').lines)[0]).map(function (o) {
      return { type: stripMd(pick(o, ['竞赛类型'])), focus: stripMd(pick(o, ['常见关注点'])), mistakes: stripMd(pick(o, ['常见错误'])) };
    });
    var gradeRules = tableToObjects(tables(need('一、').lines)[0]).map(function (o) {
      return { grade: stripMd(pick(o, ['级别'])), plain: stripMd(pick(o, ['大白话'])), how: stripMd(pick(o, ['判断方法'])), list: stripMd(pick(o, ['是否有完整校内名单'])) };
    });

    /* 基本校验 */
    var nA = comps.filter(function (c) { return c.grade === 'A'; }).length;
    var nB = comps.filter(function (c) { return c.grade === 'B'; }).length;
    if (nA !== 80) warnings.push('A类条目数为 ' + nA + '（原文件为80条）');
    if (nB !== 46) warnings.push('B类条目数为 ' + nB + '（原文件为46条）');
    var seen = {};
    comps.forEach(function (c) { if (seen[c.id]) errors.push('编号重复：' + c.id); seen[c.id] = 1; if (!c.source.page) warnings.push(c.id + ' 没有对应的PDF页码'); });
    if (monthPlan.length !== 12) warnings.push('3.2 月历应有12行，当前 ' + monthPlan.length + ' 行');

    return {
      data: {
        meta: { title: fm.title || '', version: fm.version || '', updated: fm.updated || '', policy: fm.source_policy || '', generatedAt: new Date().toISOString().slice(0, 10) },
        reward: { student: student, team: team, specialFactor: specialFactor, teacher: teacher, teacherSpecial: teacherSpecial },
        competitions: comps, approvedCD: cd, hints: hints,
        calendar: { months: monthPlan, nodes: nodes },
        routes: routes, cases: cases, money: money, tips: tips, gradeRules: gradeRules
      },
      errors: errors, warnings: warnings
    };
  }

  /* ---------------- 查询 ---------------- */

  var CN_NUM = '零〇一二三四五六七八九十百';
  function normalize(s) {
    s = String(s || '').toLowerCase();
    s = s.replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); });
    s = s.replace(new RegExp('第[0-9' + CN_NUM + ']+届', 'g'), '');
    s = s.replace(/[（(]?20\d{2}[）)]?年?/g, '');
    s = s.replace(/[\s"'“”‘’·•・.\-—–_()（）〔〕\[\]【】《》<>、，,。:：;；!！?？/\\|]/g, '');
    return s;
  }
  // 去掉层级词，得到“赛事本体”
  var LEVEL_WORDS = /(重庆市级赛|重庆市赛|重庆市选拔赛|重庆赛区选拔赛|重庆赛区|重庆分赛区|重庆分赛|重庆市分区赛|重庆市|重庆|分赛区|分区赛|选拔赛|赛区|省赛|市赛|市级赛|省级|市级|分赛|全国总决赛|总决赛|国赛|决赛)/g;
  function core(s) { return normalize(s).replace(LEVEL_WORDS, ''); }
  function levelIntent(q) {
    var n = normalize(q);
    return {
      regional: /(重庆|省赛|市赛|赛区|分赛|选拔|省级|市级|分区)/.test(n),
      national: /(国赛|总决赛|全国赛|全国决赛)/.test(n)
    };
  }
  // 去掉「全国大学生」「大赛」等通用词，只拿有区分度的部分做相似度
  function distinct(s) { return s.replace(/(全国普通高校|全国高等院校|全国高校|中国高校|全国大学生|中国大学生|大学生|全国|中国|国际|大赛|竞赛|比赛|挑战赛|创新|设计)/g, ''); }
  function bigrams(s) { var o = []; for (var i = 0; i < s.length - 1; i++) o.push(s.substr(i, 2)); return o; }
  function dice(a, b) {
    if (a.length < 2 || b.length < 2) return 0;
    var A = bigrams(a), B = bigrams(b), m = 0, used = {};
    A.forEach(function (x) { for (var i = 0; i < B.length; i++) if (!used[i] && B[i] === x) { used[i] = 1; m++; break; } });
    return 2 * m / (A.length + B.length);
  }

  function scoreEntry(c, q) {
    var qn = normalize(q), qc = core(q);
    if (!qn) return 0;
    var best = 0;
    var nameN = normalize(c.name), nameC = core(c.name);
    function upd(v) { if (v > best) best = v; }
    if (qn === nameN) upd(100);
    if (qc && qc === nameC) upd(96);
    if (qc.length >= 2 && nameC.indexOf(qc) >= 0) upd(60 + 30 * qc.length / nameC.length);
    if (nameC.length >= 4 && qc.indexOf(nameC) >= 0) upd(88);
    c.aliases.forEach(function (a) {
      var an = normalize(a), ac = core(a);
      if (!an) return;
      if (qn === an || (qc && qc === ac)) upd(95);
      else if (ac.length >= 2 && qc.indexOf(ac) >= 0) upd(78 + Math.min(10, ac.length));
      else if (qc.length >= 2 && ac.indexOf(qc) >= 0) upd(55 + 25 * qc.length / ac.length);
    });
    upd(dice(distinct(qc), distinct(nameC)) * 70);
    return best;
  }

  // 返回：{families:[...], standalone:[...], weak:[...], hint, intent, autoPick}
  // family = A类条目 + 可选层级；standalone = 未挂到A类的B类/C/D条目
  function search(data, q) {
    var all = data.competitions.concat(data.approvedCD || []);
    var byId = {}; all.forEach(function (c) { byId[c.id] = c; });
    var intent = levelIntent(q);
    var scored = all.map(function (c) { return { c: c, s: scoreEntry(c, q) }; }).filter(function (x) { return x.s >= 30; });

    // B类条目若已挂靠A类，则并入其A类“家族”
    var famScore = {}, standalone = [];
    scored.forEach(function (x) {
      var c = x.c;
      if (c.grade === 'A') famScore[c.id] = Math.max(famScore[c.id] || 0, x.s);
      else if (c.grade === 'B' && c.parentA) famScore[c.parentA] = Math.max(famScore[c.parentA] || 0, x.s - 2);
      else standalone.push(x);
    });
    var STRONG = 50;
    var families = Object.keys(famScore).map(function (id) {
      var a = byId[id];
      var opts = [{ key: id + '|N', level: '全国赛（含全国总决赛）', grade: 'A', compId: id, aId: id }];
      var verified = a.stages.filter(function (s) { return s.verified; });
      verified.forEach(function (s, i) {
        opts.push({ key: id + '|S' + i, level: s.label, grade: 'B', compId: s.bId || id, aId: id, stage: s });
      });
      if (!verified.length) opts.push({ key: id + '|U', level: '省市级 / 分赛区选拔赛', grade: 'PENDING', compId: id, aId: id, stage: null });
      return { a: a, score: famScore[id], options: opts };
    }).filter(function (f) { return f.score >= STRONG; });
    standalone = standalone.filter(function (x) { return x.s >= STRONG; });

    // 层级意图加权排序
    families.forEach(function (f) { if (intent.national) f.score += 4; });
    standalone.forEach(function (x) { if (intent.regional) x.s += 6; if (intent.national) x.s -= 6; });
    families.sort(function (a, b) { return b.score - a.score; });
    standalone.sort(function (a, b) { return b.s - a.s; });

    var weak = scored.filter(function (x) { return x.s < STRONG && x.s >= 30; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 5).map(function (x) { return x.c; });

    // 5.2 消歧提示
    var qn = normalize(q), hint = null;
    (data.hints || []).forEach(function (h) {
      var hn = normalize(h.input.split('/')[0]);
      if (hn && (qn.indexOf(hn) >= 0 || hn.indexOf(qn) >= 0) && qn.length >= 2) hint = h;
    });

    // 是否可直接给出结论：只有一个明显最佳、且层级明确
    var autoPick = null;
    var top = [];
    families.forEach(function (f) { top.push({ s: f.score, f: f }); });
    standalone.forEach(function (x) { top.push({ s: x.s, x: x }); });
    top.sort(function (a, b) { return b.s - a.s; });
    if (top.length && top[0].s >= 85 && (top.length === 1 || top[0].s - top[1].s >= 8)) {
      var t = top[0];
      if (t.x) autoPick = { key: t.x.c.id + '|X', grade: t.x.c.grade, compId: t.x.c.id, level: t.x.c.grade === 'B' ? '重庆市级（附件2）' : '学校批准记录' };
      else if (intent.regional) {
        var reg = t.f.options.filter(function (o) { return o.grade !== 'A'; });
        if (reg.length === 1) autoPick = reg[0];
      } else if (intent.national) autoPick = t.f.options[0];
    }
    return { families: families, standalone: standalone.map(function (x) { return x.c; }), weak: weak, hint: hint, intent: intent, autoPick: autoPick };
  }

  // 根据用户选定的 option 给出认定结论
  function resolve(data, opt) {
    var all = data.competitions.concat(data.approvedCD || []);
    var byId = {}; all.forEach(function (c) { byId[c.id] = c; });
    var c = byId[opt.compId], a = opt.aId ? byId[opt.aId] : null;
    var r = { grade: opt.grade, level: opt.level, comp: c, parentA: a, unit: '', unitNote: '', sources: [], notes: [] };
    function attSrc(x) {
      return '移通〔2026〕83号 ' + x.source.att + ' 第' + x.source.no + '项' + (x.source.page ? '（PDF第' + x.source.page + '页）' : '');
    }
    if (opt.grade === 'A') {
      r.title = c.name; r.unit = c.unit;
      r.sources.push(attSrc(c));
      r.sources.push('第五条：「全国普通高校大学生竞赛榜单内竞赛项目名单」所列为A类');
    } else if (opt.grade === 'B' && opt.stage) {
      if (opt.stage.bId) {
        var b = byId[opt.stage.bId];
        r.title = b.name; r.unit = b.unit; r.comp = b;
        r.sources.push(attSrc(b));
        r.sources.push('对应A类：' + a.id + ' ' + a.name + '（' + opt.stage.basis + '）');
      } else {
        r.title = a.name + ' — ' + opt.stage.label; r.unit = a.unit;
        r.unitNote = '附件未单列该选拔赛，承办单位按对应A类条目显示，报名前请向承办单位确认';
        r.sources.push('第五条及附件1备注：A类赛事对应的省（市）级、分赛区级选拔赛为B类');
        r.sources.push('对应A类：' + attSrc(a) + '；对应依据：' + opt.stage.basis);
      }
    } else if (opt.grade === 'B') {
      r.title = c.name; r.unit = c.unit;
      r.sources.push(attSrc(c));
      r.sources.push('第五条：重庆市教育委员会公布的《普通本科高校大学生竞赛项目》（附件2）为B类');
      if (c.parentA) r.sources.push('对应A类：' + c.parentA + ' ' + byId[c.parentA].name);
    } else if (opt.grade === 'C' || opt.grade === 'D') {
      r.title = c.name; r.unit = c.unit;
      r.sources.push('学校批准记录：' + c.unit + (c.approvedOn ? '（' + c.approvedOn + '）' : ''));
    } else { // PENDING：A类的省级层级但对应关系未核实
      r.grade = 'PENDING';
      r.title = a.name + ' — 省市级 / 分赛区选拔赛'; r.unit = a.unit;
      r.unitNote = '对应关系未核实，承办单位仅供参考';
      r.sources.push('第五条规定A类对应的省（市）级、分赛区级选拔赛为B类，但资料库10.2尚未核实这项赛事的选拔赛对应关系');
      r.notes.push('核实前不按B类显示。请向校内承办单位确认：该选拔赛是否为 ' + a.name + ' 官方对应的省级/分赛区赛事。');
    }
    // 「原表标硬件」：以实际认定条目为准；附件未单列的选拔赛、待核实层级沿用对应A类条目
    var hwSrc = (opt.grade === 'PENDING' || (opt.grade === 'B' && opt.stage && !opt.stage.bId)) ? a : r.comp;
    r.hardware = !!(hwSrc && hwSrc.hardware);
    r.group = (r.comp && r.comp.group) || (a && a.group) || '';
    if (/未在附件标明/.test(r.unit) || !r.unit) { r.unitNote = '附件未写明校内承办单位，待学校确认'; }
    var tid = r.comp ? r.comp.id : '';
    if (/高职/.test(r.title) || ['A75', 'A76', 'A77'].indexOf(tid) >= 0) r.notes.push('该项涉及高职/技能赛组别，普通本科生不一定有参赛资格，报名前请核实组别要求。');
    return r;
  }

  function unknownResult(q) {
    return {
      grade: 'UNCONFIRMED', title: q, unit: '', sources: [
        '在资料库A类80条、重庆市B类46条及学校C/D批准记录中均未找到',
        '第五条：C类、D类须「经学校批准」，资料库目前没有对应批准记录'
      ],
      notes: ['未收录 ≠ 不能参加，也 ≠ 已认定为C类或D类。请向教务处或校内承办单位确认是否有学校批准记录。']
    };
  }

  /* ---------------- 奖金计算 ---------------- */

  var TYPE_NAMES = { hw: '理工类（硬件类）', sci: '理工类（其他类）', hum: '人文社科类' };
  var RANK_NAMES = { S: '特等奖', 1: '一等奖', 2: '二等奖', 3: '三等奖', X: '金/银/铜奖、优秀奖等其他名称' };
  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function round2(n) { return Math.round(n * 100) / 100; }

  // input: {grade:'A'|'B'|'C'|'D'|'UNCONFIRMED', type:'hw'|'sci'|'hum'|'unsure', rank:'S'|1|2|3|'X', size:1..4}
  function calcReward(data, input) {
    var R = data.reward, out = { ok: false, missing: [], verify: [], lines: [], amount: null, label: '', range: null };
    if (!input.grade) out.missing.push('赛事类别');
    if (!input.type) out.missing.push('奖励专业类型');
    if (!input.rank) out.missing.push('获奖等次');
    if (!input.size) out.missing.push('参赛人数');
    if (input.grade === 'C' || input.grade === 'D') {
      out.status = 'NO_STANDARD';
      out.message = '暂无可用的校内奖励标准';
      out.detail = '83号文只规定了A、B类竞赛的学生获奖奖励标准；经学校批准的C、D类竞赛给予承办单位工作经费支持，资料库没有学生现金奖励标准。';
      return out;
    }
    if (input.grade === 'UNCONFIRMED' || input.grade === 'PENDING') {
      out.status = 'NO_STANDARD';
      out.message = '暂无可用的校内奖励标准';
      out.detail = '赛事类别尚待学校确认。先确认它属于A类或B类，才能按学校标准估算。';
      out.verify.push('赛事类别：向教务处或承办单位确认该赛事（及其层级）是否属于A类或B类');
      return out;
    }
    if (out.missing.length) { out.status = 'MISSING'; return out; }
    var size = Math.min(4, Math.max(1, +input.size));
    var coef = R.team[size];
    var isTeam = size > 1;
    out.label = isTeam ? '预计团队奖励总额' : '预计个人奖励';
    if (input.rank === 'X') {
      out.status = 'VERIFY';
      out.verify.push('证书等次：学校文件未把金/银/铜奖、优秀奖、入围奖等映射为一/二/三等奖，需学校正式确认对应关系');
    }
    if (input.type === 'unsure') {
      out.status = 'VERIFY';
      out.verify.push('奖励专业类型：需学校确认该赛事按 理工类（硬件类）/ 理工类（其他类）/ 人文社科类 中的哪一类计奖');
      if (input.rank !== 'X') {
        var vals = ['hw', 'sci', 'hum'].map(function (t) { return { t: t, v: baseOf(R, input.grade, t, input.rank) * coef, tv: teacherOf(R, input.grade, t, input.rank) }; });
        out.range = vals.map(function (x) { return { type: TYPE_NAMES[x.t], amount: round2(x.v), teacher: x.tv }; });
      }
    }
    if (out.status === 'VERIFY') return out;
    var base1 = R.student[input.type][input.grade][1];
    var base = baseOf(R, input.grade, input.type, input.rank);
    if (input.rank === 'S') out.lines.push('特等奖基础 = ' + input.grade + '类·' + TYPE_NAMES[input.type] + '·一等奖 ' + fmt(base1) + ' 元 × ' + R.specialFactor + ' = ' + fmt(base) + ' 元');
    else out.lines.push('基础标准：' + input.grade + '类 · ' + TYPE_NAMES[input.type] + ' · ' + RANK_NAMES[input.rank] + ' = ' + fmt(base) + ' 元');
    out.lines.push((isTeam ? '团队系数：' + (size >= 4 ? '4人及以上' : size + '人') : '个人参赛系数') + ' = ' + coef);
    out.amount = round2(base * coef);
    out.formula = fmt(base) + ' 元 × ' + coef + ' = ' + fmt(out.amount) + ' 元';
    out.status = 'OK'; out.ok = true;
    // 指导教师（团队）奖励：按获奖项目计，不乘学生团队系数
    var t1 = R.teacher[input.type][input.grade][1], tAmt = teacherOf(R, input.grade, input.type, input.rank);
    out.teacher = {
      amount: tAmt,
      lines: input.rank === 'S'
        ? ['特等奖基础 = ' + input.grade + '类·' + TYPE_NAMES[input.type] + '·一等奖 ' + fmt(t1) + ' 元 × ' + R.teacherSpecial + ' = ' + fmt(tAmt) + ' 元']
        : ['基础标准：' + input.grade + '类 · ' + TYPE_NAMES[input.type] + ' · ' + RANK_NAMES[input.rank] + ' = ' + fmt(tAmt) + ' 元', '不乘学生团队系数'],
      formula: fmt(tAmt) + ' 元'
    };
    out.total = round2(out.amount + tAmt);
    return out;
  }
  function teacherOf(R, grade, type, rank) {
    var t = R.teacher[type][grade];
    return rank === 'S' ? round2(t[1] * R.teacherSpecial) : t[rank];
  }
  function baseOf(R, grade, type, rank) {
    var t = R.student[type][grade];
    return rank === 'S' ? round2(t[1] * R.specialFactor) : t[rank];
  }

  /* ---------------- 生成文件 ---------------- */

  function makeDataJs(data) {
    return '/* 由资料库 Markdown 自动生成，请勿手改。修改 Markdown 后用「03-更新数据.html」或 tools/build.mjs 重新生成。 */\n' +
      'window.COMP_DATA = ' + JSON.stringify(data) + ';\n';
  }
  function inlineScript(js) { return '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '\n</script>'; }
  // 把查询器页面和脚本、数据合成一个可单独打开的 HTML（发到手机即可用）
  function makeSingleFile(page, coreJs, dataJs) {
    var tagData = '<script src="assets/data.js"></script>', tagCore = '<script src="assets/core.js"></script>';
    var rest = page.split(tagData).join('').split(tagCore).join('');
    if (page.indexOf(tagData) < 0 || page.indexOf(tagCore) < 0 || /(src|href)="assets\//.test(rest)) throw new Error('查询器页面的 assets 引用与预期不符，无法生成单文件版');
    return page
      .replace(tagData, function () { return inlineScript(dataJs); })
      .replace(tagCore, function () { return inlineScript(coreJs); });
  }

  return {
    makeDataJs: makeDataJs, makeSingleFile: makeSingleFile,
    parseMarkdown: parseMarkdown, search: search, resolve: resolve, unknownResult: unknownResult,
    calcReward: calcReward, normalize: normalize, fmt: fmt, TYPE_NAMES: TYPE_NAMES, RANK_NAMES: RANK_NAMES
  };
});
