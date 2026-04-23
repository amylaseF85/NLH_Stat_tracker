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
// POST: データ保存・更新・削除
// ======================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const type = data.type;

    if (type === 'save_player')   return jsonResponse(savePlayer(data.player));
    if (type === 'delete_player') return jsonResponse(deletePlayer(data.id));
    if (type === 'save_hand')     return jsonResponse(saveHand(data.hand));
    if (type === 'update_hand')   return jsonResponse(updateHand(data.hand));
    if (type === 'delete_hand')   return jsonResponse(deleteHandById(data.id));
    if (type === 'save_state')    return jsonResponse(saveState(data.state));
    if (type === 'get_state')     return jsonResponse(getState());

    return jsonResponse({ error: 'unknown type' }, 400);
  } catch(err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ======================================================
// Players
// ======================================================

// Sheets列: A=id, B=name, C=memo, D=created_at
function getPlayers() {
  const sheet = getSheet('players');
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(r => ({
    id:         r[0],
    name:       r[1],
    memo:       r[2] || '',
    created_at: r[3],
  })).filter(p => p.id);
}

function savePlayer(player) {
  const sheet = getSheet('players');
  const rows = sheet.getDataRange().getValues();
  // 既存チェック
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === player.id) {
      sheet.getRange(i + 1, 1, 1, 4).setValues([[
        player.id, player.name, player.memo || '', player.created_at
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
  const rows  = sheet.getDataRange().getValues();
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
// 列順（現在のシートに合わせた順）:
// A=id, B=timestamp, C=session_id, D=player_id, E=position,
// F=hand_number, G=vpip, H=first_raise, I=three_bet, J=four_bet,
// K=five_bet, L=allin, M=three_bet_chance, N=four_bet_chance,
// O=squeeze, P=fold, Q=memo, R=limp
// ======================================================

function getHands() {
  const sheet = getSheet('hands');
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(r => ({
    id:               r[0],
    timestamp:        r[1],
    session_id:       r[2],
    player_id:        r[3],
    position:         r[4],
    hand_number:      r[5],
    vpip:             r[6],  
    first_raise:      r[7],  
    three_bet:        r[8],  
    four_bet:         r[9],  
    five_bet:         r[10], 
    allin:            r[11], 
    three_bet_chance: r[12], 
    four_bet_chance:  r[13], 
    squeeze:          r[14], 
    fold:             r[15], 
    memo:             r[16], 
    limp:             r[17] || 0,
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
    hand.vpip             ? 1 : 0, 
    hand.first_raise      ? 1 : 0, 
    hand.three_bet        ? 1 : 0, 
    hand.four_bet         ? 1 : 0, 
    hand.five_bet         ? 1 : 0, 
    hand.allin            ? 1 : 0, 
    hand.three_bet_chance ? 1 : 0, 
    hand.four_bet_chance  ? 1 : 0, 
    hand.squeeze          ? 1 : 0, 
    hand.fold             ? 1 : 0, 
    hand.memo || '',                
    hand.limp             ? 1 : 0, 
  ]);
  return { ok: true };
}

// ハンドを行ごと上書き（修正機能用）
function updateHand(hand) {
  const sheet = getSheet('hands');
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === hand.id) {
      sheet.getRange(i + 1, 1, 1, 18).setValues([[
        hand.id,
        hand.timestamp,
        hand.session_id,
        hand.player_id,
        hand.position,
        hand.hand_number,
        hand.vpip             ? 1 : 0,
        hand.first_raise      ? 1 : 0,
        hand.three_bet        ? 1 : 0,
        hand.four_bet         ? 1 : 0,
        hand.five_bet         ? 1 : 0,
        hand.allin            ? 1 : 0,
        hand.three_bet_chance ? 1 : 0,
        hand.four_bet_chance  ? 1 : 0,
        hand.squeeze          ? 1 : 0,
        hand.fold             ? 1 : 0,
        hand.memo || '',
        hand.limp             ? 1 : 0,
      ]]);
      return { ok: true };
    }
  }
  return { ok: false, error: 'not found' };
}

// ハンドを削除（修正機能用）
function deleteHandById(id) {
  const sheet = getSheet('hands');
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'not found' };
}

// ======================================================
// State（席配置・BTN・ハンド番号）
// ======================================================
function saveState(state) {
  const sheet = getSheet('sessions');
  const key   = 'app_state';
  const rows  = sheet.getDataRange().getValues();
  const json  = JSON.stringify(state);
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
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === 'app_state') {
      return { ok: true, state: JSON.parse(rows[i][1]) };
    }
  }
  return { ok: true, state: null };
}

// ======================================================
// ヘッダー初期化（初回のみ実行）
// ======================================================
function initHeaders() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const playersSheet = ss.getSheetByName('players');
  if (playersSheet.getLastRow() === 0) {
    playersSheet.appendRow(['id', 'name', 'memo', 'created_at']);
  }

  const handsSheet = ss.getSheetByName('hands');
  if (handsSheet.getLastRow() === 0) {
    handsSheet.appendRow([
      'id','timestamp','session_id','player_id','position','hand_number',
      'vpip','first_raise','three_bet','four_bet','five_bet','allin',
      'three_bet_chance','four_bet_chance','squeeze','fold','memo','limp'
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
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Sheet "${name}" not found`);
  return sheet;
}

function jsonResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
