// ======================================================
// Poker Tracker - Google Apps Script Web API
// スプレッドシートID
// ======================================================
const SHEET_ID = '1y0mlp32hnR6_hEGEinFogGTDF8N6gasMhcKAxwERBf4';

// ======================================================
// GET: データ取得
// ======================================================
function doGet(e) {
  const type = e.parameter.type;
  try {
    if (type === 'players') return jsonResponse(getPlayers());
    if (type === 'hands')   return jsonResponse(getHands());
    return jsonResponse({ error: 'unknown type' }, 400);
  } catch(err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ======================================================
// POST: データ保存
// ======================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const type = data.type;

    if (type === 'save_player') return jsonResponse(savePlayer(data.player));
    if (type === 'delete_player') return jsonResponse(deletePlayer(data.id));
    if (type === 'save_hand')   return jsonResponse(saveHand(data.hand));
    if (type === 'save_state')  return jsonResponse(saveState(data.state));
    if (type === 'get_state')   return jsonResponse(getState());

    return jsonResponse({ error: 'unknown type' }, 400);
  } catch(err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ======================================================
// Players
// ======================================================
function getPlayers() {
  const sheet = getSheet('players');
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(r => ({
    id:         r[0],
    name:       r[1],
    created_at: r[2],
  })).filter(p => p.id);
}

function savePlayer(player) {
  const sheet = getSheet('players');
  const rows = sheet.getDataRange().getValues();
  // 既存チェック
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === player.id) {
      sheet.getRange(i + 1, 1, 1, 3).setValues([[
        player.id, player.name, player.created_at
      ]]);
      return { ok: true, action: 'updated' };
    }
  }
  // 新規追加
  sheet.appendRow([player.id, player.name, player.created_at]);
  return { ok: true, action: 'created' };
}

function deletePlayer(id) {
  const sheet = getSheet('players');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'not found' };
}

// ======================================================
// Hands
// ======================================================
function getHands() {
  const sheet = getSheet('hands');
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(r => ({
    id:          r[0],
    timestamp:   r[1],
    session_id:  r[2],
    player_id:   r[3],
    position:    r[4],
    hand_number: r[5],
    joined:           r[6],   // G列: vpip → joined
    first_raise:      r[7],   // H列
    three_bet:        r[8],   // I列
    four_bet:         r[9],   // J列
    five_bet:         r[10],  // K列
    allin:            r[11],  // L列
    three_bet_chance: r[12],  // M列
    four_bet_chance:  r[13],  // N列
    squeeze:          r[14],  // O列
    fold:             r[15],  // P列
    memo:             r[16],  // Q列
  })).filter(h => h.id);
}

function saveHand(hand) {
  const sheet = getSheet('hands');
  sheet.appendRow([
    hand.id,
    hand.timestamp,
    hand.session_id,
    hand.player_id,
    hand.position,
    hand.hand_number,
    hand.joined           ? 1 : 0,  // G列
    hand.first_raise      ? 1 : 0,  // H列
    hand.three_bet        ? 1 : 0,  // I列
    hand.four_bet         ? 1 : 0,  // J列
    hand.five_bet         ? 1 : 0,  // K列
    hand.allin            ? 1 : 0,  // L列
    hand.three_bet_chance ? 1 : 0,  // M列
    hand.four_bet_chance  ? 1 : 0,  // N列
    hand.squeeze          ? 1 : 0,  // O列
    hand.fold             ? 1 : 0,  // P列
    hand.memo || '',                // Q列
  ]);
  return { ok: true };
}

// ======================================================
// State（席配置・BTN位置・ハンド番号を保存）
// ======================================================
function saveState(state) {
  const sheet = getSheet('sessions');
  const key = 'app_state';
  const rows = sheet.getDataRange().getValues();
  const json = JSON.stringify(state);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(json);
      return { ok: true };
    }
  }
  sheet.appendRow([key, json]);
  return { ok: true };
}

function getState() {
  const sheet = getSheet('sessions');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === 'app_state') {
      return { ok: true, state: JSON.parse(rows[i][1]) };
    }
  }
  return { ok: true, state: null };
}

// ======================================================
// ヘッダー初期化（初回のみ）
// ======================================================
function initHeaders() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const playersSheet = ss.getSheetByName('players');
  if (playersSheet.getLastRow() === 0) {
    playersSheet.appendRow(['id', 'name', 'created_at']);
  }

  const handsSheet = ss.getSheetByName('hands');
  if (handsSheet.getLastRow() === 0) {
    handsSheet.appendRow([
      'id','timestamp','session_id','player_id','position',
      'hand_number','joined','first_raise','three_bet',
      'four_bet','five_bet','allin','three_bet_chance','four_bet_chance','squeeze','fold','memo'
    ]);
  }

  const sessionsSheet = ss.getSheetByName('sessions');
  if (sessionsSheet.getLastRow() === 0) {
    sessionsSheet.appendRow(['key', 'value']);
  }
}

// ======================================================
// ユーティリティ
// ======================================================
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Sheet "${name}" not found`);
  return sheet;
}

function jsonResponse(data, status) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
