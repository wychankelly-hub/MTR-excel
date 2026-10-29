// 《定過抬油：站長爭奪戰》Episode 1 伺服器。
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { config, features, ROOT } from './config.js';
import http from 'node:http';
import { db, init, save, close, getAsset, storageInfo, listAssets, putAsset, deleteAsset, persistNow, heartbeat } from './store.js';
import {
  HttpError, currentUser, requireUser, requireTeacher, requireStudent, createSession, destroySession,
  loginWithGoogle, loginDemo, publicUser, guestDeviceKey,
} from './auth.js';
import * as C from './competition.js';
import { clock } from './clock.js';
import { submitTask } from './submission.js';
import { publicView, studentView, teacherView, resultsCsv, toCsv } from './views.js';
import { addClient, clientCount } from './realtime.js';
import { bus } from './bus.js';
import { assetTable, reviewAsset, uploadAsset, resolvedEvent, regenerateAsset, revertAsset, autoFillMissingAudio } from './audio-assets.js';
import { localTtsStatus } from './tts/local-tts.js';
import { googleCredentialStatus, oauthClient, OAUTH_SCOPES } from './adapters/google-adapter.js';
import { SERIES_TITLE, EPISODE_TITLE, TEAM_PRESETS, LEVELS } from './episode1/blueprint.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use('/api', express.json({ limit: '256kb' }));

  const pub = path.join(ROOT, 'public');
  for (const page of ['teacher', 'student', 'projector']) {
    app.get(`/${page}`, (req, res) => res.sendFile(path.join(pub, `${page}.html`)));
  }
  app.use(express.static(pub, { extensions: ['html'], maxAge: 0 }));

  // 雲端資產（老師上載的錄音、角色圖片、重新合成的配音）—— 存放在資料庫
  app.get(/^\/media\/(.+)$/, async (req, res) => {
    const a = await getAsset(req.params[0]);
    if (!a) return res.status(404).end();
    res.setHeader('Content-Type', a.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(a.data);
  });

  // 雲端平台健康檢查
  app.get('/healthz', (req, res) => {
    const ok = db.ready && !db.fenced;
    res.status(ok ? 200 : 503).json({ ok, storage: storageInfo() });
  });

  // 會改變資料的請求（提交答案、提示、老師操作、工作表作答等）：先確認已寫入資料庫才回覆。
  // 伺服器即使在回覆後立即當機或重新啟動，已回覆的結果亦不會遺失；
  // 未能寫入時回覆 503，學生端會以同一 Idempotency Key 自動重試（不會重複計分）。
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const send = res.json.bind(res);
    res.json = (body) => {
      persistNow().catch(() => false).then((ok) => {
        if (ok || res.statusCode >= 400) return send(body);
        res.status(503);
        return send({ error: '伺服器暫時未能儲存資料，系統會自動重試（不會扣分，也不會重複計分）。', code: 'NOT_SAVED' });
      });
      return res;
    };
    next();
  });

  const api = express.Router();
  app.use('/api', api);

  // ------------------------------------------------------------ 公開設定
  api.get('/config', (req, res) => {
    res.json({
      seriesTitle: SERIES_TITLE,
      episodeTitle: EPISODE_TITLE,
      features: features(),
      googleClientId: config.googleClientId || null,
      demoLoginAllowed: config.allowDemoLogin,
      teams: TEAM_PRESETS,
      levels: LEVELS.map((l) => ({ level: l.level, title: l.title, defaultSeconds: l.defaultSeconds, sheet: l.sheet })),
    });
  });

  // ------------------------------------------------------------ 登入
  api.get('/me', (req, res) => {
    const u = currentUser(req);
    res.json({ user: publicUser(u), currentCompId: u?.currentCompId || null });
  });
  api.post('/auth/google', async (req, res) => {
    const u = await loginWithGoogle(String(req.body?.credential || ''));
    createSession(res, u.id);
    res.json({ user: publicUser(u) });
  });
  api.post('/auth/demo', (req, res) => {
    const body = req.body || {};
    const u = loginDemo({ ...body, deviceKey: body.role === 'student' ? guestDeviceKey(req, res) : null });
    createSession(res, u.id);
    res.json({ user: publicUser(u), demo: true });
  });
  api.post('/auth/logout', (req, res) => {
    destroySession(req, res);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ Google（老師 OAuth 連接 Drive/Sheets）
  const oauthStates = new Map();
  api.get('/google/connect', (req, res) => {
    const t = requireTeacher(req);
    if (!config.googleClientSecret) throw new HttpError(400, '伺服器未設定 GOOGLE_CLIENT_SECRET，不能以 OAuth 連接 Google Drive。');
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, { teacherId: t.id, at: Date.now() });
    const url = oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: OAUTH_SCOPES, state, include_granted_scopes: true, login_hint: t.email || undefined });
    res.redirect(url);
  });
  api.get('/google/callback', async (req, res) => {
    const t = requireTeacher(req);
    const st = oauthStates.get(String(req.query.state || ''));
    oauthStates.delete(String(req.query.state || ''));
    if (!st || st.teacherId !== t.id || Date.now() - st.at > 10 * 60 * 1000) throw new HttpError(400, 'OAuth 狀態無效或已過期，請重新連接。');
    if (req.query.error) return res.redirect(`/teacher#system?google_error=${encodeURIComponent(String(req.query.error))}`);
    const client = oauthClient();
    const { tokens } = await client.getToken(String(req.query.code || ''));
    if (!tokens.refresh_token) throw new HttpError(400, 'Google 沒有回傳 refresh token。請到 Google 帳戶「第三方存取權」移除此應用程式後重新連接。');
    let email = t.email;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId });
      email = ticket.getPayload().email;
    }
    const granted = String(tokens.scope || '').split(' ');
    db.state.googleOAuth = { refreshToken: tokens.refresh_token, email, connectedAt: Date.now(), scopes: granted, by: t.id };
    save();
    res.redirect('/teacher#system');
  });
  api.post('/google/disconnect', (req, res) => {
    requireTeacher(req);
    db.state.googleOAuth = null;
    save();
    res.json({ ok: true });
  });
  api.get('/system/status', (req, res) => {
    requireTeacher(req);
    res.json({ features: features(), localTts: localTtsStatus(), google: googleCredentialStatus(), googleOAuth: db.state.googleOAuth ? { email: db.state.googleOAuth.email, connectedAt: db.state.googleOAuth.connectedAt, scopes: db.state.googleOAuth.scopes } : null, audioRequireApproval: config.audioRequireApproval });
  });

  // ------------------------------------------------------------ 老師
  const owned = (req) => {
    const t = requireTeacher(req);
    const comp = C.getComp(req.params.id);
    if (comp.ownerId !== t.id) throw new HttpError(403, '只有建立此比賽的老師可以管理。', 'NOT_OWNER');
    return { t, comp };
  };
  api.get('/teacher/competitions', (req, res) => {
    const t = requireTeacher(req);
    res.json(Object.values(db.state.competitions).filter((c) => c.ownerId === t.id).sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => ({ id: c.id, title: c.title, classCode: c.classCode, status: c.status, adapter: c.adapter, createdAt: c.createdAt, joinCode: c.joinCode, teamCount: c.teams.length })));
  });
  api.post('/teacher/competitions', (req, res) => {
    const t = requireTeacher(req);
    const comp = C.createCompetition(t, req.body || {});
    res.json({ id: comp.id });
  });
  api.get('/teacher/competitions/:id', (req, res) => {
    const { comp } = owned(req);
    res.json({ ...teacherView(comp), clients: clientCount(comp.id) });
  });
  api.patch('/teacher/competitions/:id', (req, res) => { const { t, comp } = owned(req); C.updateSettings(comp, t, req.body || {}); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/generate', (req, res) => { const { t, comp } = owned(req); res.json(C.generate(comp, t, { newSeed: req.body?.newSeed !== false })); });
  api.get('/teacher/competitions/:id/preflight/:teamId', (req, res) => { const { t, comp } = owned(req); res.json(C.preflightDetail(comp, t, req.params.teamId)); });
  api.post('/teacher/competitions/:id/approve', async (req, res) => { const { t, comp } = owned(req); res.json(await C.approve(comp, t)); });
  api.post('/teacher/competitions/:id/provision', async (req, res) => { const { t, comp } = owned(req); res.json(await C.provisionAll(comp, t, { teamIds: req.body?.teamIds || null })); });
  api.post('/teacher/competitions/:id/teams/:teamId/preset-sheet', (req, res) => { const { t, comp } = owned(req); C.setPresetSheet(comp, t, req.params.teamId, req.body?.fileId); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/lobby', (req, res) => { const { t, comp } = owned(req); C.openLobby(comp, t); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/start-episode', (req, res) => { const { t, comp } = owned(req); C.startEpisode(comp, t); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/levels/:n/start', (req, res) => { const { t, comp } = owned(req); C.startLevel(comp, t, req.params.n); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/levels/:n/end', (req, res) => { const { t, comp } = owned(req); C.endLevel(comp, t, req.params.n, 'teacher'); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/levels/:n/extend', (req, res) => { const { t, comp } = owned(req); C.extendLevel(comp, t, req.params.n, req.body?.seconds); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/levels/:n/skip', (req, res) => { const { t, comp } = owned(req); C.skipLevel(comp, t, req.params.n, req.body?.reason); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/pause', (req, res) => { const { t, comp } = owned(req); C.pause(comp, t, req.body?.reason || '老師暫停'); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/resume', (req, res) => { const { t, comp } = owned(req); C.resume(comp, t); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/leaderboard', (req, res) => { const { t, comp } = owned(req); C.setLeaderboard(comp, t, req.body || {}); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/audio/trigger', (req, res) => { const { t, comp } = owned(req); res.json(C.triggerAudio(comp, req.body?.eventId, { by: t })); });
  api.post('/teacher/competitions/:id/audio/control', (req, res) => { const { t, comp } = owned(req); C.audioControl(comp, t, req.body?.action, req.body?.value); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/assign', async (req, res) => { const { t, comp } = owned(req); await C.assignStudent(comp, t, String(req.body?.userId || ''), String(req.body?.teamId || '')); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/auto-assign', async (req, res) => { const { t, comp } = owned(req); res.json(await C.autoAssign(comp, t)); });
  api.post('/teacher/competitions/:id/remove-student', async (req, res) => { const { t, comp } = owned(req); await C.removeStudent(comp, t, String(req.body?.userId || ''), req.body?.reason); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/copy-roster', async (req, res) => { const { t, comp } = owned(req); res.json(await C.copyRoster(comp, t, String(req.body?.sourceId || ''))); });
  api.post('/teacher/competitions/:id/transfer', async (req, res) => { const { t, comp } = owned(req); await C.transferStudent(comp, t, req.body?.userId, req.body?.toTeamId, req.body?.reason); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/roles', (req, res) => { const { t, comp } = owned(req); res.json(C.setRoles(comp, t, req.body?.teamId, Number(req.body?.level), req.body?.roles || {})); });
  api.post('/teacher/competitions/:id/adjust', (req, res) => { const { t, comp } = owned(req); res.json(C.adjustScore(comp, t, req.body?.teamId, req.body?.delta, req.body?.reason)); });
  api.post('/teacher/competitions/:id/cancel-task', (req, res) => { const { t, comp } = owned(req); C.cancelTask(comp, t, req.body?.taskId, req.body?.reason); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/results', (req, res) => { const { t, comp } = owned(req); C.showResults(comp, t); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/archive', (req, res) => { const { t, comp } = owned(req); C.archive(comp, t); res.json({ ok: true }); });
  api.post('/teacher/competitions/:id/cancel', (req, res) => { const { t, comp } = owned(req); C.cancelCompetition(comp, t, req.body?.reason); res.json({ ok: true }); });
  api.delete('/teacher/competitions/:id', (req, res) => { const { t, comp } = owned(req); C.deleteCompetition(comp, t); res.json({ ok: true }); });
  api.get('/teacher/competitions/:id/export.csv', (req, res) => {
    const { comp } = owned(req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="E1-results-${comp.classCode || comp.id}.csv"`);
    res.send(toCsv(resultsCsv(comp)));
  });
  api.post('/teacher/competitions/:id/export-google', async (req, res) => {
    const { comp } = owned(req);
    if (!googleCredentialStatus().ready) throw new HttpError(409, 'Google 尚未連接，請改用 CSV 匯出。');
    const url = await C.adapters.google.exportResults(comp, resultsCsv(comp).map((r) => r.map((v) => (v ?? ''))));
    res.json({ url });
  });

  // 配音資產
  api.get('/teacher/audio/assets', (req, res) => { requireTeacher(req); res.json({ lines: assetTable(), requireApproval: config.audioRequireApproval, localTts: localTtsStatus() }); });
  api.post('/teacher/audio/assets/:lineId/tts', async (req, res) => { const t = requireTeacher(req); await regenerateAsset(t, req.params.lineId); res.json({ ok: true }); });
  api.post('/teacher/audio/assets/:lineId/revert', async (req, res) => { const t = requireTeacher(req); await revertAsset(t, req.params.lineId); res.json({ ok: true }); });
  api.get('/teacher/audio/preview/:eventId', (req, res) => { requireTeacher(req); res.json(resolvedEvent(req.params.eventId)); });
  api.post('/teacher/audio/assets/:lineId/review', (req, res) => { const t = requireTeacher(req); reviewAsset(t, req.params.lineId, req.body?.status); res.json({ ok: true }); });
  api.post('/teacher/audio/assets/:lineId/upload', express.raw({ type: 'audio/*', limit: '5mb' }), async (req, res) => {
    const t = requireTeacher(req);
    await uploadAsset(t, req.params.lineId, req.body, req.headers['content-type']);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ 角色圖片（雲端資產庫；缺少時前端使用內建 SVG）
  const CHAR_IDS = ['chanding', 'rocket', 'fatmaster', 'bat', 'uncle', 'passenger'];
  const CHAR_EXPRS = ['neutral', 'talk', 'blink', 'happy', 'worried', 'surprised', 'think'];
  const IMG_TYPES = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif' };
  api.get('/characters', (req, res) => {
    const out = {};
    for (const a of listAssets('characters/')) {
      const m = /^characters\/([a-z]+)\/([a-z]+)\.\w+$/.exec(a.path);
      if (m) (out[m[1]] ??= {})[m[2]] = `/media/${a.path}?v=${a.version}`;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.json(out);
  });
  api.post('/teacher/characters/:id/:expr', express.raw({ type: 'image/*', limit: '4mb' }), async (req, res) => {
    requireTeacher(req);
    const { id, expr } = req.params;
    if (!CHAR_IDS.includes(id) || !CHAR_EXPRS.includes(expr)) throw new HttpError(400, '角色或表情名稱不正確。');
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = IMG_TYPES[type];
    if (!ext) throw new HttpError(415, '只接受 PNG、WebP、JPEG 或 GIF 圖片（建議透明背景 PNG／WebP）。');
    if (!req.body?.length) throw new HttpError(400, '圖片是空的。');
    for (const a of listAssets(`characters/${id}/${expr}.`)) await deleteAsset(a.path);
    await putAsset(`characters/${id}/${expr}.${ext}`, type, req.body);
    res.json({ ok: true });
  });
  api.delete('/teacher/characters/:id/:expr', async (req, res) => {
    requireTeacher(req);
    for (const a of listAssets(`characters/${req.params.id}/${req.params.expr}.`)) await deleteAsset(a.path);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ 學生
  // 學生的比賽及隊伍一律由伺服器按登入身份及隊伍名單決定；網址或參數中的隊伍／比賽編號都不會被採用
  const studentComp = (req) => {
    const u = requireStudent(req);
    const cc = u.currentCompId && db.state.competitions[u.currentCompId];
    if (!cc || [C.STATUS.ARCHIVED, C.STATUS.CANCELLED].includes(cc.status) || !C.isMember(cc, u.id)) throw new HttpError(404, '尚未加入比賽。', 'NOT_JOINED');
    return { u, comp: cc };
  };
  api.post('/student/lookup', (req, res) => {
    const u = requireStudent(req);
    const comp = C.findByJoinCode(req.body?.joinCode);
    C.checkJoinAllowed(comp, u);
    const selfSelect = comp.settings.teamSelection !== 'teacher';
    const mine = C.teamOfUser(comp, u.id);
    res.json({
      title: comp.title, classCode: comp.classCode, episode: comp.episode, adapter: comp.adapter, teamSelection: selfSelect ? 'student' : 'teacher',
      myTeam: mine ? { id: mine.id, name: mine.name } : null,
      teams: selfSelect ? comp.teams.map((t) => ({ id: t.id, name: t.name, color: t.color, code: t.code, memberCount: t.memberIds.length, full: t.memberIds.length >= comp.settings.maxTeamSize })) : [],
    });
  });
  api.post('/student/join', async (req, res) => {
    const u = requireStudent(req);
    const { comp, team } = await C.joinTeam(u, req.body?.joinCode, req.body?.teamId);
    u.currentCompId = comp.id;
    save();
    res.json({ compId: comp.id, teamId: team?.id || null, waiting: !team });
  });
  api.post('/student/leave', (req, res) => {
    const u = requireStudent(req);
    u.currentCompId = null;
    save();
    res.json({ ok: true });
  });
  api.get('/student/state', (req, res) => {
    const { u, comp } = studentComp(req);
    res.json(studentView(comp, u));
  });
  api.post('/student/submit', async (req, res) => {
    const { u, comp } = studentComp(req);
    res.json(await submitTask(comp, u, { taskId: String(req.body?.taskId || ''), idempotencyKey: req.body?.idempotencyKey }));
  });
  api.post('/student/hint', (req, res) => {
    const { u, comp } = studentComp(req);
    const team = C.teamOfUser(comp, u.id);
    if (!team) throw new HttpError(403, '你未加入任何隊伍。');
    res.json(C.requestHint(comp, u, team, req.body?.level));
  });

  // Demo 模擬工作表（只在 Demo 比賽可用）
  const demoTeam = (req) => {
    const { u, comp } = studentComp(req);
    if (comp.adapter !== 'demo') throw new HttpError(400, '此比賽使用真實 Google Sheets，請在 Google Sheets 作答。');
    const team = C.teamOfUser(comp, u.id);
    if (!team) throw new HttpError(403, '你未加入任何隊伍。');
    if (team.workbook?.status !== 'READY') throw new HttpError(409, '工作表尚未準備好，請等候老師。');
    const unlocked = LEVELS.filter((l) => comp.levels[l.level].startedAt).map((l) => l.level);
    return { u, comp, team, unlocked };
  };
  api.get('/student/demo-sheet/:sheet', (req, res) => {
    const { comp, team, unlocked } = demoTeam(req);
    res.json(C.adapters.demo.sheetView(comp, team, req.params.sheet, { unlockedLevels: unlocked }));
  });
  const editAllowed = (comp, sheet, unlocked) => {
    const lv = LEVELS.find((l) => l.sheet === sheet);
    if (!lv || !unlocked.includes(lv.level)) throw new HttpError(403, '此關尚未開始。');
    if (comp.levels[lv.level].phase !== 'active') throw new HttpError(409, '此關已截止，工作表已鎖定。');
  };
  api.post('/student/demo-sheet/:sheet/edit', (req, res) => {
    const { u, comp, team, unlocked } = demoTeam(req);
    editAllowed(comp, req.params.sheet, unlocked);
    const edits = Array.isArray(req.body?.edits) ? req.body.edits.slice(0, 600) : [];
    C.adapters.demo.applyEdits(comp, team, req.params.sheet, edits);
    bus.emit('sheet', comp.id, team.id, req.params.sheet, u.id);
    res.json(C.adapters.demo.sheetView(comp, team, req.params.sheet, { unlockedLevels: unlocked }));
  });
  api.post('/student/demo-sheet/:sheet/paste', (req, res) => {
    const { u, comp, team, unlocked } = demoTeam(req);
    editAllowed(comp, req.params.sheet, unlocked);
    C.adapters.demo.copyPaste(comp, team, req.params.sheet, String(req.body?.source || ''), String(req.body?.target || ''));
    bus.emit('sheet', comp.id, team.id, req.params.sheet, u.id);
    res.json(C.adapters.demo.sheetView(comp, team, req.params.sheet, { unlockedLevels: unlocked }));
  });

  // ------------------------------------------------------------ 投影
  const projectorComp = (req) => {
    const comp = C.getComp(String(req.params.id || req.query.comp || ''));
    if (String(req.query.key || req.headers['x-projector-key'] || '') !== comp.projectorKey) throw new HttpError(403, '投影連結無效。', 'BAD_PROJECTOR_KEY');
    return comp;
  };
  api.get('/projector/:id', (req, res) => res.json(publicView(projectorComp(req))));
  api.get('/projector/:id/join', (req, res) => {
    const comp = projectorComp(req);
    if ([C.STATUS.RESULTS, C.STATUS.ARCHIVED, C.STATUS.CANCELLED].includes(comp.status)) throw new HttpError(409, '比賽已結束。');
    res.json({ joinCode: comp.joinCode });
  });
  api.post('/projector/:id/status', (req, res) => {
    const comp = projectorComp(req);
    res.json(C.projectorStatus(comp, req.body || {}));
  });

  // ------------------------------------------------------------ 即時推送
  api.get('/stream', (req, res) => {
    const role = String(req.query.role || '');
    if (role === 'projector') {
      const comp = projectorComp(req);
      return addClient(req, res, { role, compId: comp.id }, () => publicView(db.state.competitions[comp.id]));
    }
    if (role === 'teacher') {
      const t = requireTeacher(req);
      const comp = C.getComp(String(req.query.comp || ''));
      if (comp.ownerId !== t.id) throw new HttpError(403, '只有建立此比賽的老師可以管理。');
      return addClient(req, res, { role, compId: comp.id }, () => ({ ...teacherView(db.state.competitions[comp.id]), clients: clientCount(comp.id) }));
    }
    if (role === 'student') {
      const { u, comp } = studentComp(req);
      const info = { role, compId: comp.id, userId: u.id, get teamId() { return C.teamOfUser(db.state.competitions[comp.id], u.id)?.id; } };
      return addClient(req, res, info, () => studentView(db.state.competitions[comp.id], u));
    }
    throw new HttpError(400, '未知角色。');
  });

  api.use((req, res) => res.status(404).json({ error: '找不到此 API。' }));

  // 錯誤處理：一律回傳繁體中文訊息
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code || null });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: '上載內容過大。' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: '請求格式不正確。' });
    console.error(err);
    return res.status(500).json({ error: '伺服器內部錯誤，請稍後重試或通知老師。此錯誤不會扣分。', code: 'INTERNAL' });
  });
  return app;
}

export function startServer(port = config.port) {
  const app = createApp();
  const server = http.createServer(app);
  // SSE 連線長時間保持；雲端負載平衡器通常 60 秒以上才逾時，keep-alive 每 20 秒一次
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  let recovered = false;
  const timer = setInterval(() => { if (recovered && !db.fenced) C.tick(); }, 500);
  // 比賽計時中每 5 秒記錄「伺服器仍在運行」（很小的紀錄）；另每分鐘完整檢查一次有否未寫入的改變
  let beats = 0;
  const alive = setInterval(() => {
    if (!recovered || db.fenced) return;
    if (C.anyLevelRunning()) heartbeat(clock.now());
    if (++beats % 12 === 0) save();
  }, 5000);
  // Render 免費方案閒置 15 分鐘會休眠：比賽進行中（大堂至結果）每 10 分鐘經公開網址自我喚醒一次
  const awake = process.env.RENDER_EXTERNAL_URL ? setInterval(() => {
    const live = db.ready && Object.values(db.state.competitions).some((c) => /^(LOBBY|RUNNING_|PAUSED|RESULTS)/.test(c.status));
    if (live) fetch(`${config.publicBaseUrl}/healthz`).catch(() => {});
  }, 10 * 60 * 1000) : null;
  init().then(() => {
    for (const r of C.recoverAfterRestart(db.lastAliveAt)) {
      console.log(`⏸ 伺服器重新啟動：比賽 ${r.compId} 第 ${r.levels.join('、')} 關已自動暫停（中斷約 ${Math.round(r.gapMs / 1000)} 秒，時間已補回）`);
    }
    recovered = true;
    server.listen(port, () => {
      const f = features();
      console.log(`\n${SERIES_TITLE} ${EPISODE_TITLE}`);
      console.log(`伺服器：${config.publicBaseUrl}  （port ${server.address().port}）`);
      console.log(`資料儲存：${db.driver === 'postgres' ? '雲端 PostgreSQL（持久）' : `本機檔案 ${config.dataDir}${config.production ? '（⚠️ 雲端部署請設定 DATABASE_URL，否則重新部署會遺失資料）' : ''}`}`);
      console.log(`老師訪客登入：${f.demoLogin && config.demoTeacherPin ? (config.production ? '已開放（登入碼由 DEMO_TEACHER_PIN 設定）' : `已開放（PIN：${config.demoTeacherPin}）`) : '已停用'}`);
      console.log(`Google Sign-in：${f.googleSignIn ? '已設定' : '未設定（只可使用訪客／Demo 登入）'}`);
      const tts = localTtsStatus();
      console.log(`粵語語音：${tts.ready ? '本機 TTS 就緒（sherpa-onnx 粵語模型）' : `本機 TTS 未就緒（${tts.reason}）；使用已附帶的音檔`}`);
      const n = autoFillMissingAudio();
      if (n) console.log(`  正在自動產生 ${n} 句缺少的粵語配音…`);
      console.log(`Google Sheets：${googleCredentialStatus().ready ? `已連接（${googleCredentialStatus().mode}）` : `未連接 — ${googleCredentialStatus().reason}`}\n`);
    });
  }).catch((e) => {
    console.error('✗ 無法連接資料庫，伺服器沒有啟動：', e.message);
    process.exitCode = 1;
    clearInterval(timer);
    clearInterval(alive);
    clearInterval(awake);
  });
  server.stop = async () => { clearInterval(timer); clearInterval(alive); clearInterval(awake); server.closeAllConnections?.(); server.close(); await close(); };
  if (!process.env.NODE_TEST_CONTEXT) {
    const shutdown = async () => { await server.stop().catch(() => {}); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
