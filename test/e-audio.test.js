// 驗收測試 E（36–41）：劇情及音效
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C, readyCompetition, typeInto, submit } from './helpers.js';
import { AUDIO_EVENTS, AUDIO_EVENT_BY_ID } from '../server/episode1/dialogue.js';
import { resolvedEvent } from '../server/audio-assets.js';
import { publicView, studentView } from '../server/views.js';
import { correctInputs } from '../server/episode1/fixtures.js';
import { LEVELS } from '../server/episode1/blueprint.js';
import { bus } from '../server/bus.js';
import { addClient } from '../server/realtime.js';
import { EventEmitter } from 'node:events';

const SPEC_FIELDS = ['event_id', 'line_id', 'speaker', 'spoken_cantonese_text', 'subtitle_zh_Hant', 'audio_url', 'estimated_duration', 'trigger_policy', 'spoiler_level', 'asset_status'];

test('36. 每關開場廣東話對白都有繁體中文字幕及 Speaker；資產欄位齊全', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const ev = AUDIO_EVENT_BY_ID[`L${n}_OPEN`];
    assert.equal(ev.lines.length, 3);
    for (const l of ev.lines) {
      for (const f of SPEC_FIELDS) assert.ok(f in l, `${l.line_id} 缺少 ${f}`);
      assert.match(l.subtitle_zh_Hant, /[一-鿿]/);
      assert.ok(l.estimated_duration >= 2 && l.estimated_duration <= 5);
    }
  }
  for (const id of ['E1_INTRO', 'L1_FIRST_CLEAR', 'L1_CLOSE', 'L2_CLOSE', 'L3_CLOSE', 'L4_CLOSE', 'L5_FIRST_CLEAR', 'E1_FINAL_REVEAL', 'TIMER_WARNING']) assert.ok(AUDIO_EVENT_BY_ID[id]?.lines.length, id);
});

test('41. 已附帶粵語配音會自動播放；音檔缺失時字幕仍然提供（audio_url 為 null）', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { AUDIO_DIR } = await import('../server/audio-assets.js');
  const r = resolvedEvent('L1_OPEN');
  assert.ok(r.lines.every((l) => l.audio_url && l.subtitle_zh_Hant), '附帶的配音可直接播放');
  const f = path.join(AUDIO_DIR, 'L1_OPEN_02.mp3');
  const tmp = `${f}.bak`;
  fs.renameSync(f, tmp);
  try {
    const m = resolvedEvent('L1_OPEN').lines.find((l) => l.line_id === 'L1_OPEN_02');
    assert.equal(m.audio_url, null);
    assert.equal(m.asset_status, 'missing');
    assert.ok(m.subtitle_zh_Hant);
  } finally {
    fs.renameSync(tmp, f);
  }
});

test('37. 未啟用聲音／自動播放被阻止時，播放器只顯示字幕並繼續，不會卡住', async () => {
  globalThis.window = globalThis;
  globalThis.Audio = class { play() { return Promise.reject(new Error('NotAllowedError')); } pause() {} };
  const { VoicePlayer } = await import('../public/js/audio.js');
  const shown = [];
  const p = new VoicePlayer({ onLine: (l) => shown.push(l ? l.subtitle_zh_Hant : null) });
  const item = { eventId: 'L1_OPEN', lines: resolvedEvent('L1_OPEN').lines.map((l) => ({ ...l, estimated_duration: 0.01, audio_url: '/audio/x.mp3' })) };
  p.enqueue(item);
  await new Promise((resolve) => { const iv = setInterval(() => { if (!p.playing && !p.queue.length) { clearInterval(iv); resolve(); } }, 50); });
  assert.deepEqual(shown.filter(Boolean), item.lines.map((l) => l.subtitle_zh_Hant));
  // 跳過、緊急靜音不會出錯
  p.enqueue(item); p.control('emergency_mute');
  assert.equal(p.muted, true);
  assert.equal(p.queue.length, 0);
});

test('38. 學生裝置預設靜音：劇情音訊只推送到投影端／老師端', () => {
  const got = { projector: [], student: [], teacher: [] };
  const fake = (role) => {
    const req = new EventEmitter();
    const res = { writeHead() {}, write: (s) => { if (s.startsWith('event: audio')) got[role].push(s); } };
    addClient(req, res, { role, compId: 'cX', teamId: 't1' }, () => ({}));
    return req;
  };
  const reqs = ['projector', 'student', 'teacher'].map(fake);
  bus.emit('audio', 'cX', { type: 'play', eventId: 'L1_OPEN' });
  assert.equal(got.projector.length, 1);
  assert.equal(got.teacher.length, 1);
  assert.equal(got.student.length, 0);
  reqs.forEach((r) => r.emit('close'));
});

test('39–40. L5 第一隊完成不劇透；只在 L5 結算時觸發 E1_FINAL_REVEAL，可重播且不影響分數', async () => {
  const { t, comp, students } = await readyCompetition();
  const played = [];
  bus.on('audio', (id, p) => { if (id === comp.id && p.type === 'play') played.push(p); });
  for (const n of [1, 2, 3, 4]) { C.startLevel(comp, t, n); C.endLevel(comp, t, n); }
  C.startLevel(comp, t, 5);
  const fast = comp.teams[0];
  const slow = comp.teams[1];
  for (const id of ['L5-T1', 'L5-T2']) {
    typeInto(comp, fast, 5, correctInputs(id));
    assert.equal((await submit(comp, students[fast.id][0], id)).status, 'VERIFIED');
  }
  assert.equal(comp.levels[5].firstClear.teamId, fast.id);
  const fc = played.find((p) => p.eventId === 'L5_FIRST_CLEAR');
  assert.ok(fc, '播放首隊完成事件');
  assert.ok(!JSON.stringify(fc).includes('LUNCH'), '首隊完成配音不含答案');
  // 未完成隊伍及投影都看不到 LUNCH
  assert.ok(!JSON.stringify(publicView(comp)).includes('LUNCH'));
  assert.ok(!JSON.stringify(studentView(comp, students[slow.id][0])).includes('LUNCH'));
  assert.ok(!played.some((p) => JSON.stringify(p).includes('LUNCH')));
  assert.throws(() => C.triggerAudio(comp, 'E1_FINAL_REVEAL', { by: t }), (e) => e.code === 'SPOILER_BLOCKED');
  // 已完成隊伍的畫面亦提示保密
  assert.match(studentView(comp, students[fast.id][0]).levelDetails.find((l) => l.level === 5).successEffect, /保密/);

  const { computeTeamScore } = await import('../server/scoring.js');
  C.endLevel(comp, t, 5);
  const before = computeTeamScore(comp, fast.id).total;
  const reveal = played.filter((p) => p.eventId === 'E1_FINAL_REVEAL');
  assert.equal(reveal.length, 1, 'L5 截止時自動播放最終揭曉');
  assert.ok(JSON.stringify(reveal[0]).includes('LUNCH'));
  assert.equal(publicView(comp).reveal.word, 'LUNCH');
  const again = C.triggerAudio(comp, 'E1_FINAL_REVEAL', { by: t });
  assert.equal(again.replay, true);
  assert.equal(computeTeamScore(comp, fast.id).total, before, '重播不重計分');
});

test('只有公開事件可由老師觸發；L4_CLOSE 只含部分線索', () => {
  assert.equal(AUDIO_EVENT_BY_ID.L4_CLOSE.spoiler, 'partial');
  assert.ok(!JSON.stringify(AUDIO_EVENT_BY_ID.L4_CLOSE).includes('LUNCH'));
  for (const e of AUDIO_EVENTS.filter((x) => x.id !== 'E1_FINAL_REVEAL')) assert.ok(!JSON.stringify(e).includes('LUNCH'), e.id);
  assert.ok(LEVELS.every((l) => !l.successEffect.includes('LUNCH')));
});

test('劇情聲音只由一個指定投影畫面播放：第一個啟用者、離線接手、手動接手', async () => {
  const { t, comp } = await readyCompetition();
  const { clock } = await import('../server/clock.js');
  void t;
  assert.equal(C.audioOutput(comp), null, '未有投影畫面啟用聲音');
  C.projectorStatus(comp, { deviceId: 'pjAAAAAAAA', audioEnabled: false });
  assert.equal(C.audioOutput(comp), null);
  C.projectorStatus(comp, { deviceId: 'pjAAAAAAAA', audioEnabled: true });
  assert.equal(C.audioOutput(comp), 'pjAAAAAAAA');
  C.projectorStatus(comp, { deviceId: 'pjBBBBBBBB', audioEnabled: true });
  assert.equal(C.audioOutput(comp), 'pjAAAAAAAA', '第二個投影畫面不會搶走');
  C.projectorStatus(comp, { deviceId: 'pjBBBBBBBB', audioEnabled: true, claim: true });
  assert.equal(C.audioOutput(comp), 'pjBBBBBBBB', '按「改由這個畫面播放」可接手');
  clock.advance(60000);
  assert.equal(C.audioOutput(comp), null, '指定畫面離線 → 沒有播放裝置');
  C.projectorStatus(comp, { deviceId: 'pjAAAAAAAA', audioEnabled: true });
  assert.equal(C.audioOutput(comp), 'pjAAAAAAAA', '另一個已啟用的畫面自動接手');
  assert.throws(() => C.projectorStatus(comp, { deviceId: 'x', audioEnabled: true }));
});

test('學生遊戲音效只送到相關隊伍；新一關解鎖送到全班學生', async () => {
  const { t, comp, students } = await readyCompetition();
  const got = {};
  const reqs = [];
  for (const team of comp.teams.slice(0, 2)) {
    const req = new EventEmitter();
    got[team.id] = [];
    const res = { writeHead() {}, write: (s) => { if (s.startsWith('event: sfx')) got[team.id].push(JSON.parse(s.split('data: ')[1]).kind); } };
    addClient(req, res, { role: 'student', compId: comp.id, teamId: team.id }, () => ({}));
    reqs.push(req);
  }
  C.startLevel(comp, t, 1);
  const [a, b] = comp.teams;
  typeInto(comp, a, 1, correctInputs('L1-T3'));
  await submit(comp, students[a.id][0], 'L1-T3');
  typeInto(comp, b, 1, { H3: '=1' });
  await submit(comp, students[b.id][0], 'L1-T3');
  C.requestHint(comp, students[b.id][0], b, 1);
  assert.deepEqual(got[a.id], ['unlock', 'correct']);
  assert.deepEqual(got[b.id], ['unlock', 'wrong', 'hint']);
  reqs.forEach((r) => r.emit('close'));
});
