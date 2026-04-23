// ============================================================
// Poker Tracker - app.js
// ============================================================

// ============================================================
// 設定
// ============================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwskfryE2q1QL0Z4cRso8PI45I0fp2wr6Dpq4OabIIUZOKjCxRTivRluVcyXlSazvXrAQ/exec';

const SEATS = 9;

// ポジション名テーブル
// キー = 着席人数、値 = ポジション名配列（index 0 が BTN）
// BTN から時計回りに SB → BB → UTG → ... → CO の順
const POS_MAP = {
  2: ['BTN/SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
};

// ============================================================
// アプリケーション状態
// ============================================================

let state = {
	// プレイヤー一覧: [{ id, name, created_at }]
  players: [],

  // 席割り当て: seats[0〜8] = player_id | null
	// インデックス 0 = 席1、インデックス 8 = 席9
  seats: Array(SEATS).fill(null),

  // BTNがある席のインデックス（0〜8）
	// NEXT HAND ごとに advanceBtn() で自動的に次の着席者へ移動
  btnSeat: 0,

  // 現在のハンド番号（NEXT HAND ごとに +1）
  handNumber: 1,

  // 現在のハンドで入力中のフラグ（未確定）
  // { seatIndex: Set<flagKey> }
	// flagKey: 'vpip' | 'raise' | '3bet' | '4bet' | '5bet' | 'allin | 3b_chance | 4b_chance'
	// NEXT HAND で commitHand() が呼ばれると hands に確定されリセット
  pendingFlags: {},

  straddleSeat: null,

	// 記録済みハンド一覧: [{ id, timestamp, session_id, player_id,
	//   position, hand_number, vpip, first_raise, three_bet,
	//   four_bet, five_bet, allin, memo }]
	// フラグは 0 or 1 の数値で保存
  hands: [],

	// セッションID: 起動日の YYYYMMDD 形式
  sessionId: null,
};

// ============================================================
// API（Google Apps Script）
// ============================================================

async function apiGet(type) {
  const res = await fetch(`${GAS_URL}?type=${type}`);
  return res.json();
}

async function apiPost(data) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.json();
}

// 同期ドットの状態を切り替える
// status: 'syncing'（オレンジ）| 'ok'（グリーン）| 'error'（レッド）
function setSyncDot(status) {
  const dot = document.getElementById('syncDot');
  if (dot) dot.className = 'sync-dot ' + status;
}

// ============================================================
// 初期化
// ============================================================

async function init() {
  showLoading(true);
  initSession();
  try {
	// Sheets から全データを並列取得
    const [playersRes, handsRes, stateRes] = await Promise.all([
      apiGet('players'),
      apiGet('hands'),
      apiPost({ type: 'get_state' }),
    ]);

    state.players = (playersRes || []).map(p => ({
      ...p,
      memo: p.memo || '',
    }));

	// hands: Sheets から来た値は文字列になる場合があるので数値に変換
    state.hands = (handsRes || []).map(h => ({
      ...h,
      vpip:             Number(h.vpip        || 0),
      limp:             Number(h.limp        || 0),
      first_raise:      Number(h.first_raise || 0),
      three_bet:        Number(h.three_bet   || 0),
      four_bet:         Number(h.four_bet    || 0),
      five_bet:         Number(h.five_bet    || 0),
      allin:            Number(h.allin       || 0),
      fold:             Number(h.fold        || 0),
      squeeze:          Number(h.squeeze     || 0),
      three_bet_chance: Number(h.three_bet_chance || 0),
      four_bet_chance:  Number(h.four_bet_chance  || 0),
      hand_number:      Number(h.hand_number || 0),
    }));

	// 席配置・BTN位置・ハンド番号を復元
    if (stateRes && stateRes.state) {
      const s = stateRes.state;
      state.seats        = s.seats        || Array(SEATS).fill(null);
      state.btnSeat      = s.btnSeat      ?? 0;
      state.handNumber   = s.handNumber   || 1;
      state.straddleSeat = Number.isInteger(s.straddleSeat) ? s.straddleSeat : null;
    }

    setSyncDot('ok');
  } catch (e) {
    setSyncDot('error');
    showFlash('読み込み失敗 - オフラインで続行', true);
		loadLocal(); // フォールバック
  }

  refreshPlayerSelects();
  renderTable();
  showLoading(false);
}

// セッションIDを今日の日付で初期化
function initSession() {
  const d = new Date();
  state.sessionId = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================================
// ローカルストレージ（オフライン時のフォールバック）
// ============================================================

function saveLocal() {
  localStorage.setItem('pt_players',   JSON.stringify(state.players));
  localStorage.setItem('pt_seats',     JSON.stringify(state.seats));
  localStorage.setItem('pt_btn',       JSON.stringify(state.btnSeat));
  localStorage.setItem('pt_handnum',   JSON.stringify(state.handNumber));
  localStorage.setItem('pt_straddle',  JSON.stringify(state.straddleSeat));
  localStorage.setItem('pt_hands',     JSON.stringify(state.hands));
}

function loadLocal() {
  try {
    state.players    = JSON.parse(localStorage.getItem('pt_players'))  || [];
    state.seats      = JSON.parse(localStorage.getItem('pt_seats'))    || Array(SEATS).fill(null);
    state.btnSeat    = JSON.parse(localStorage.getItem('pt_btn'))      ?? 0;
    state.handNumber   = JSON.parse(localStorage.getItem('pt_handnum'))   || 1;
    state.straddleSeat = JSON.parse(localStorage.getItem('pt_straddle'));
    state.hands        = JSON.parse(localStorage.getItem('pt_hands'))     || [];
    if (!Number.isInteger(state.straddleSeat)) state.straddleSeat = null;
    if (state.seats.length !== SEATS) state.seats = Array(SEATS).fill(null);
  } catch (e) {}
}

// 席配置・BTN・ハンド番号を Sheets に保存（プレイヤー・ハンドとは別）
async function saveTableState() {
  setSyncDot('syncing');
  try {
    await apiPost({
      type: 'save_state',
      state: {
        seats: state.seats,
        btnSeat: state.btnSeat,
        handNumber: state.handNumber,
        straddleSeat: state.straddleSeat,
      },
    });
    setSyncDot('ok');
  } catch (e) {
    setSyncDot('error');
  }
	saveLocal(); // 常にローカルにもバックアップ
}

// ============================================================
// タブ切り替え
// ============================================================

function switchTab(name) {
  const names = ['record', 'stats', 'history', 'players'];
  document.querySelectorAll('.tab').forEach((t, i) =>
    t.classList.toggle('active', names[i] === name)
  );
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === 'page-' + name)
  );
  if (name === 'stats')   renderStats();
  if (name === 'history') renderHistory();
  if (name === 'players') renderPlayerList();
}

// ============================================================
// ポジション計算
// ============================================================

// 着席中の席インデックス一覧を昇順で返す
function getActiveSeats() {
  return state.seats.map((p, i) => (p ? i : null)).filter(i => i !== null);
}

function getBtnIndex(activeSeats) {
  let btnIdx = activeSeats.indexOf(state.btnSeat);
  if (btnIdx !== -1) return btnIdx;

  for (let off = 1; off < SEATS; off++) {
    const c = (state.btnSeat + off) % SEATS;
    btnIdx = activeSeats.indexOf(c);
    if (btnIdx !== -1) return btnIdx;
  }
  return 0;
}

function isStraddleTogglePos(pos) {
  return pos === 'UTG' || pos === 'BTN' || pos === 'BTN/SB';
}

function getStraddleSeat(posMap = getPosMap()) {
  const seat = state.straddleSeat;
  if (!Number.isInteger(seat)) return null;
  if (!state.seats[seat]) return null;
  if (!isStraddleTogglePos(posMap[seat] || '')) return null;
  return seat;
}

function getPosMap() {
  const active = getActiveSeats();
  const n = active.length;
  if (n < 2) return {};

  const posNames = POS_MAP[n] || POS_MAP[9];
  const map = {};
  const btnIdx = getBtnIndex(active);

	// BTN から時計回りにポジションを割り当て
  for (let i = 0; i < n; i++) {
    const seat = active[(btnIdx + i) % n];
    map[seat] = posNames[i] || '-';
  }
  return map;
}

// ============================================================
// テーブル描画
// ============================================================

function renderTable() {
  const posMap = getPosMap();
  const straddleSeat = getStraddleSeat(posMap);

	// ヘッダーのハンド番号・BTN席番号を更新
  document.getElementById('handNumLabel').innerHTML =
    `HAND ${state.handNumber}<span class="sync-dot" id="syncDot"></span>`;
  document.getElementById('btnSeatLabel').textContent = `BTN: 席${state.btnSeat + 1}`;

  const list = document.getElementById('seatList');
  list.innerHTML = '';

  for (let i = 0; i < SEATS; i++) {
    const playerId = state.seats[i];
    const player   = playerId ? state.players.find(p => p.id === playerId) : null;
    const pos      = posMap[i] || '';
    const isBtn    = pos === 'BTN' || pos === 'BTN/SB';
    const isSb     = pos === 'SB';
    const isBb     = pos === 'BB';
    const isStr    = straddleSeat === i;
    const flags    = state.pendingFlags[i] || new Set();

		// 席行
    const row = document.createElement('div');
    row.className = 'seat-row'
      + (isBtn   ? ' is-btn'    : '')
      + (isSb    ? ' is-sb'     : '')
      + (isBb    ? ' is-bb'     : '')
      + (!player ? ' empty-seat': '');

    // 上段：席番号・ポジション・プレイヤー名
    const topDiv = document.createElement('div');
    topDiv.className = 'seat-top';

    const numDiv = document.createElement('div');
    numDiv.className = 'seat-num';
    numDiv.textContent = i + 1;

		// ポジションバッジ：CSS クラス名（pos-badge.xxx）と対応
    const posKey = pos === 'BTN' || pos === 'BTN/SB' ? 'btn'
      : pos === 'SB' ? 'sb' : pos === 'BB' ? 'bb'
      : pos === 'UTG' ? 'utg' : pos === 'UTG+1' ? 'utg1'
      : pos === 'MP'  ? 'mp'  : pos === 'LJ' ? 'lj'
      : pos === 'HJ'  ? 'hj'  : pos === 'CO' ? 'co' : '';

    const posDiv = document.createElement('div');
    posDiv.className = `pos-badge ${isStr ? 'str' : posKey}`;
    posDiv.textContent = isStr ? 'STR' : (pos || '-');

    const canToggleStr = !!player && isStraddleTogglePos(pos);
    if (canToggleStr) {
      posDiv.classList.add('pos-toggle');
      posDiv.onclick = e => {
        e.stopPropagation();
        toggleStraddle(i);
      };
    }

    // プレイヤー名（タップでモーダルを開く）
    const infoDiv = document.createElement('div');
    infoDiv.className = 'seat-info';
    infoDiv.onclick = () => openAssignModal(i);
    infoDiv.innerHTML = player
      ? `<div class="seat-player-name">${player.name}</div>`
      : `<div class="seat-empty-label">空席 - タップして割当</div>`;

    topDiv.appendChild(numDiv);
    topDiv.appendChild(posDiv);
    topDiv.appendChild(infoDiv);
    row.appendChild(topDiv);

    // 下段：アクションフラグボタン
    if (player) {
      const actDiv = document.createElement('div');
      actDiv.className = 'seat-actions';

      [
        // ── VPIP系 ──
        // limp: BB額だけコール（レイズなし）。VPIP=1・PFR=0 のケース
        //       Callとの違い: Callは3BET等への対応コール、limpはプリフロップ初回のコール
        { key: 'limp',  label: 'Limp'   },
        { key: 'vpip',  label: 'Call'   },
        { key: 'raise', label: 'Open'   },
        { key: '3bet',  label: '3BET'   },
        { key: '4bet',  label: '4BET'   },
        { key: '5bet',  label: '5BET'   },
        { key: 'allin', label: 'All-in' },
        // Fold: 何もしない場合は自動fold。アクション後のfold（Open→3betされてfold等）は手動でON
        { key: 'fold',  label: 'Fold'   },
      ].forEach(({ key, label }) => {
        const btn = document.createElement('div');
        btn.className = 'flag-toggle' + (flags.has(key) ? ` on-${key}` : '');
        btn.textContent = label;
        btn.onclick = e => { e.stopPropagation(); toggleFlag(i, key); };
        actDiv.appendChild(btn);
      });

      row.appendChild(actDiv);
    }

    list.appendChild(row);
  }
}

// ============================================================
// フラグ操作
// ============================================================

// 指定席・指定フラグをトグル（ON ↔ OFF）
// pendingFlags はハンド確定（commitHand）まで保持される
function toggleFlag(seatIdx, flag) {
  if (!state.pendingFlags[seatIdx]) state.pendingFlags[seatIdx] = new Set();
  const flags = state.pendingFlags[seatIdx];
  flags.has(flag) ? flags.delete(flag) : flags.add(flag);
  renderTable();
}

function toggleStraddle(seatIdx) {
  const posMap = getPosMap();
  const pos = posMap[seatIdx] || '';
  if (!state.seats[seatIdx] || !isStraddleTogglePos(pos)) return;

  state.straddleSeat = (state.straddleSeat === seatIdx) ? null : seatIdx;
  saveTableState();
  renderTable();
}
// ============================================================
// ハンド確定（NEXT HAND）
// ============================================================
//
// アクション順序の処理ロジック:
//   プリフロップのアクション順は UTG → UTG+1 → ... → CO → BTN → SB → BB
//   = POS_MAP 上の index 3 以降 → 0(BTN) → 1(SB) → 2(BB) の順
//
// 3BET機会の判定:
//   「オープンが既に存在し、かつまだ3BETが出ていない状態」で
//   自分の番が来た場合に three_bet_chance=1
//
// 4BET機会の判定:
//   「3BETが既に存在する状態」で自分の番が来た場合に four_bet_chance=1
//   ※ オープンした本人が3BETを受けた後の再アクション機会もこれに含む
//
// Squeeze機会の判定:
//   「オープンがあり、かつそのハンドでCallした人が1人以上いる状態」で
//   3BETを行った場合が Squeeze
//
// ============================================================
async function commitHand() {
  const posMap = getPosMap();
  const btn = document.getElementById('nextHandBtn');
  btn.disabled = true;

  const activeSeats = getActiveSeats();
  const n = activeSeats.length;
  if (n < 2) { btn.disabled = false; return; }

  const btnIdx = getBtnIndex(activeSeats);
  const actionOffsets = [];

  if (n === 2) {
    actionOffsets.push(0, 1);
  } else if (n === 3) {
    actionOffsets.push(0, 1, 2);
  } else {
    for (let i = 3; i < n; i++) actionOffsets.push(i);
    actionOffsets.push(0, 1, 2);
  }

  const straddleSeat = getStraddleSeat(posMap);
  const straddlePos = straddleSeat !== null ? (posMap[straddleSeat] || '') : '';

  if (straddlePos === 'UTG' && n >= 4) {
    actionOffsets.length = 0;
    for (let i = 4; i < n; i++) actionOffsets.push(i);
    actionOffsets.push(0, 1, 2, 3);
  } else if (straddlePos === 'BTN' || straddlePos === 'BTN/SB') {
    actionOffsets.length = 0;
    for (let i = 1; i < n; i++) actionOffsets.push(i);
    actionOffsets.push(0);
  }

  const actionOrder = actionOffsets.map(off => activeSeats[(btnIdx + off) % n]);

  let openFound     = false;
  let callAfterOpen = false;
  let threeBetFound = false;
  const chanceMap = {};

  actionOrder.forEach(seat => {
    const flags = state.pendingFlags[seat] || new Set();

    // この席が行動する時点での機会を記録
    chanceMap[seat] = {
      // 3BET機会: オープンがあり、まだ3BETが出ていない
      three: openFound && !threeBetFound ? 1 : 0,
      // 4BET機会: 3BETが出ている（オープンした人が再アクションする場面も含む）
      four:  threeBetFound ? 1 : 0,
    };

    const isRaise = flags.has('raise') || flags.has('3bet') || flags.has('4bet') || flags.has('5bet');
    if (flags.has('raise')) openFound = true;
    if (openFound && flags.has('vpip') && !isRaise) callAfterOpen = true;
    if (flags.has('3bet')) threeBetFound = true;
  });

  // 2パス目: ハンドレコードを生成
  const newHands = [];

  actionOrder.forEach(seat => {
    const playerId = state.seats[seat];
    if (!playerId) return;

    const flags = state.pendingFlags[seat] || new Set();
    const acted = flags.size > 0;
    const isRaise = flags.has('raise') || flags.has('3bet') || flags.has('4bet') || flags.has('5bet');

    // VPIP: limp / call / raise系 / allin のいずれかがあればポットに参加
    const vpip = flags.has('limp') || flags.has('vpip') || isRaise || flags.has('allin') ? 1 : 0;

    // fold: 何もしなかった（acted=false）か、Foldボタンを明示的に押した場合
    //       ただし raise系/allin をしている場合は fold にならない
    const fold = ((!acted || flags.has('fold')) && !isRaise && !flags.has('allin')) ? 1 : 0;

    // squeeze: 3BETであり、かつオープン後にCallが出ていた状況
    const squeeze = (flags.has('3bet') && openFound && callAfterOpen) ? 1 : 0;
    const isStr = straddleSeat === seat;

    newHands.push({
      id:               `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp:        new Date().toISOString(),
      session_id:       state.sessionId,
      player_id:        playerId,
      position:         isStr ? 'STR' : (posMap[seat] || ''),
      hand_number:      state.handNumber,
      vpip,
      limp:             flags.has('limp')  ? 1 : 0,
      first_raise:      isRaise            ? 1 : 0,
      three_bet:        flags.has('3bet')  ? 1 : 0,
      four_bet:         flags.has('4bet')  ? 1 : 0,
      five_bet:         flags.has('5bet')  ? 1 : 0,
      allin:            flags.has('allin') ? 1 : 0,
      fold,
      squeeze,
      three_bet_chance: chanceMap[seat].three,
      four_bet_chance:  chanceMap[seat].four,
      memo: '',
    });
  });

  state.hands.push(...newHands);
  state.pendingFlags = {};
  state.handNumber++;
  advanceBtn();
  renderTable();

  setSyncDot('syncing');
  try {
    await Promise.all([
      ...newHands.map(h => apiPost({ type: 'save_hand', hand: h })),
      saveTableState(),
    ]);
    setSyncDot('ok');
  } catch (e) {
    setSyncDot('error');
    saveLocal();
  }
  btn.disabled = false;
}

// ============================================================
// BTN 移動
// ============================================================

// BTN を時計回りに次の着席者へ自動移動
function advanceBtn() {
  state.straddleSeat = null;
  const active = getActiveSeats();
  if (active.length < 2) return;
  for (let off = 1; off <= SEATS; off++) {
    const next = (state.btnSeat + off) % SEATS;
    if (state.seats[next]) { state.btnSeat = next; return; }
  }
}

// BTN ▶ ボタン：手動で1席進める
function moveBtnManual() {
  advanceBtn();
  saveTableState();
  renderTable();
}

// ============================================================
// テーブルクリア
// ============================================================

function clearAllTable() {
  state.seats        = Array(SEATS).fill(null);
  state.pendingFlags = {};
  state.btnSeat      = 0;
  state.handNumber   = 1;
  state.straddleSeat = null;
  localStorage.removeItem('pt_seats');
  localStorage.removeItem('pt_btn');
  localStorage.removeItem('pt_handnum');
  localStorage.removeItem('pt_straddle');
  saveTableState();
  renderTable();
}

// ============================================================
// 席割り当てモーダル
// ============================================================

function openAssignModal(seatIdx) {
  document.getElementById('modalTitle').textContent = `席 ${seatIdx + 1} にプレイヤーを割り当て`;
  const list = document.getElementById('modalPlayerList');
  list.innerHTML = '';

	// 空席オプション
  const emptyOpt = document.createElement('div');
  emptyOpt.className = 'modal-empty-option';
  emptyOpt.textContent = '空席にする';
  emptyOpt.onclick = () => assignSeat(seatIdx, null);
  list.appendChild(emptyOpt);

	// プレイヤー一覧（現在の着席席番号も表示）
  state.players.forEach(p => {
    const opt = document.createElement('div');
    opt.className = 'modal-player-option';
    const cur = state.seats.indexOf(p.id);
    opt.textContent = p.name + (cur >= 0 ? `  （席${cur + 1}）` : '');
    opt.onclick = () => assignSeat(seatIdx, p.id);
    list.appendChild(opt);
  });

  document.getElementById('assignModal').classList.add('open');
}

function assignSeat(seatIdx, playerId) {
	// 同じプレイヤーが他の席にいれば空席に
  if (playerId) {
    const prev = state.seats.indexOf(playerId);
    if (prev >= 0 && prev !== seatIdx) state.seats[prev] = null;
  }
  state.seats[seatIdx] = playerId;
  if (!state.seats[state.straddleSeat]) state.straddleSeat = null;
  saveTableState();
  closeModal();
  renderTable();
}

function closeModal() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
}

// ============================================================
// フラッシュメッセージ
// ============================================================

function showFlash(msg = '記録しました', isError = false) {
  const f = document.getElementById('flash');
  f.textContent = msg;
  f.className = 'flash' + (isError ? ' error-flash' : '');
  f.classList.add('show');
  setTimeout(() => f.classList.remove('show'), 2000);
}

// ============================================================
// プレイヤー管理
// ============================================================

// 統計ページの絞り込みセレクトを再構築
function refreshPlayerSelects() {
  const sel = document.getElementById('statsPlayer');
  const cur = sel.value;
  sel.innerHTML = '<option value="all">全プレイヤー</option>'
    + state.players.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  sel.value = cur;
}

async function addPlayer() {
  const input = document.getElementById('newPlayerName');
  const name  = input.value.trim();
  if (!name) return;
  if (state.players.find(p => p.name === name)) { alert('同名が既に存在します'); return; }

  const addBtn = document.getElementById('addPlayerBtn');
  addBtn.disabled = true;

  const player = { id: 'p_' + Date.now(), name, memo: '', created_at: new Date().toISOString() };
  state.players.push(player);
  input.value = '';
  refreshPlayerSelects();
  renderPlayerList();

  setSyncDot('syncing');
  try {
    await apiPost({ type: 'save_player', player });
    setSyncDot('ok');
  } catch (e) {
    setSyncDot('error');
    saveLocal();
  }
  addBtn.disabled = false;
}

async function deletePlayer(id) {
  if (!confirm('削除しますか？')) return;
  state.players = state.players.filter(p => p.id !== id);
  state.seats   = state.seats.map(s => s === id ? null : s);
  if (!state.seats[state.straddleSeat]) state.straddleSeat = null;
  refreshPlayerSelects();
  renderPlayerList();
  renderTable();

  setSyncDot('syncing');
  try {
    await Promise.all([
      apiPost({ type: 'delete_player', id }),
      saveTableState(),
    ]);
    setSyncDot('ok');
  } catch (e) {
    setSyncDot('error');
    saveLocal();
  }
}

// プレイヤー名編集モーダルを開く
function openEditPlayerModal(id) {
  const player = state.players.find(p => p.id === id);
  if (!player) return;
  document.getElementById('editPlayerId').value    = id;
  document.getElementById('editPlayerName').value  = player.name;
  document.getElementById('editPlayerMemo').value  = player.memo || '';
  document.getElementById('editPlayerModal').classList.add('open');
}

async function saveEditPlayer() {
  const id   = document.getElementById('editPlayerId').value;
  const name = document.getElementById('editPlayerName').value.trim();
  const memo = document.getElementById('editPlayerMemo').value.trim();
  if (!name) { alert('名前を入力してください'); return; }

  const dup = state.players.find(p => p.name === name && p.id !== id);
  if (dup) { alert('同名が既に存在します'); return; }

  const player = state.players.find(p => p.id === id);
  if (!player) return;
  player.name = name;
  player.memo = memo;

  closeModal();
  refreshPlayerSelects();
  renderPlayerList();
  renderTable();

  setSyncDot('syncing');
  try {
    await apiPost({ type: 'save_player', player });
    setSyncDot('ok');
  } catch (e) {
    setSyncDot('error');
    saveLocal();
  }
}

function renderPlayerList() {
  const c = document.getElementById('playerListContainer');
  if (!state.players.length) {
    c.innerHTML = '<div class="empty-state">プレイヤーが未登録です</div>';
    return;
  }
  c.innerHTML = state.players.map(p => {
    const hands   = state.hands.filter(h => h.player_id === p.id).length;
    const seatIdx = state.seats.indexOf(p.id);
    const seatStr = seatIdx >= 0 ? `席${seatIdx + 1}` : '未着席';
    const memoStr = p.memo ? `<div class="player-memo-preview">${p.memo}</div>` : '';
    return `<div class="player-list-item">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:500">${p.name}</div>
        <div class="player-meta">${seatStr} · ${hands} hands</div>
        ${memoStr}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="edit-btn" onclick="openEditPlayerModal('${p.id}')">✎</button>
        <button class="delete-btn" onclick="deletePlayer('${p.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// 統計計算
// ============================================================
//
// 【データ構造】各 hand レコードのフラグ（0 or 1）:
//
//   hand.vpip             ... Call ボタン（3BET等へのコール）
//   hand.limp             ... Limp ボタン（BB額のみコール）
//   hand.first_raise      ... Open/3BET/4BET/5BET いずれかのレイズ
//   hand.three_bet        ... 3BET ボタン
//   hand.four_bet         ... 4BET ボタン
//   hand.five_bet         ... 5BET ボタン
//   hand.allin            ... All-in ボタン
//   hand.fold             ... Fold（何もしない=自動fold、またはアクション後の手動fold）
//   hand.squeeze          ... Squeeze（オープン後にcallがある状況での3BET）
//   hand.three_bet_chance ... 3BET機会（オープンあり・まだ3BETなし の状況で自分の番だった）
//   hand.four_bet_chance  ... 4BET機会（3BETあり の状況で自分の番だった）
//
// 【統計計算式と分母の考え方】
//
//   VPIP%  = (limp + call + raise系) / n
//            → 分母: 全ハンド数 n（標準的な定義）
//
//   PFR%   = first_raise / n
//            → 分母: 全ハンド数 n
//
//   Limp%  = limp / n
//            → 分母: 全ハンド数 n
//
//   3BET%  = three_bet / three_bet_chance
//            → 分母: 3BET機会数（オープンを見た状況の回数）
//            ⚠️ n を分母にすると「3BET機会がないのに低く出る」ため機会ベースが正確
//
//   Squeeze% = squeeze / three_bet_chance
//            → 分母: 3BET機会数（squeezeも3BET機会がある状況でのみ発生）
//
//   F3B%   = fold後 / four_bet_chance
//            → 分母: 4BET機会数（= 自分が3BETされた回数）
//            ⚠️ four_bet_chance は「オープンして3BETを受けた場面」を意味する
//               そのうち fold した割合が Fold to 3Bet
//
//   ATS%   = BTN/CO/SBでのオープン / BTN/CO/SBでの記録ハンド数
//            → steal可能ポジションでのオープン率
//
//   Fold%  = fold / n
//   AI%    = allin / n
//
// 【統計項目を追加する手順】
//   ① renderTable() のボタン定義配列にキーを追加
//   ② commitHand() のハンドレコードにフィールドを追加
//   ③ calcStats() にカウント変数・戻り値を追加
//   ④ statsCard() の HTML に stat-item を追加
//   ⑤ GAS の saveHand()/getHands() と Sheets に列を追加
//
// ============================================================

function calcStats(hands) {
  const n = hands.length;
  if (!n) return null;

  const pct = (v, d) => d ? Math.round(v / d * 100) : 0;

  const vpipCount  = hands.filter(h => h.vpip || h.limp || h.first_raise || h.allin).length;
  const pfrCount   = hands.filter(h => h.first_raise).length;
  const threeCount = hands.filter(h => h.three_bet).length;
  const foldCount  = hands.filter(h => h.fold).length;

    // ── 機会ベースの分母 ──
	// three_bet_chance: オープンがあり自分が3BETできる状況だったハンド数
  const threeChance = hands.filter(h => h.three_bet_chance).length;
    // ── F3B (Fold to 3-Bet) ──
  // 分母: four_bet_chance（3BETを受けた場面 = 4BET機会）
  // 分子: その中でfoldしたもの
  const f3bHands    = hands.filter(h => h.four_bet_chance);
  const f3bFold     = f3bHands.filter(h => h.fold).length;

  const aggrCount = hands.filter(h => h.first_raise || h.three_bet || h.four_bet || h.five_bet || h.allin).length;
  const callCount = hands.filter(h => h.vpip && !h.first_raise && !h.limp && !h.allin).length;
  const afValue = callCount ? (aggrCount / callCount) : aggrCount;

	// ── STYLE 判定 ──
	// VPIP と PFR の値からプレイスタイルを大まかに分類
	// VPIP高 + PFR高 → Aggressive (LAG)
	// VPIP高 + PFR低 → Loose Passive (LP)
	// VPIP低 + PFR高 → Tight Aggressive (TAG)
	// VPIP低 + PFR低 → Tight Passive / Nit
  const vpipPct = pct(vpipCount, n);
  const pfrPct  = pct(pfrCount, n);
  const style =
    vpipPct >= 30 && pfrPct >= 20 ? 'LAG'
    : vpipPct >= 30 && pfrPct < 20 ? 'LP'
    : vpipPct < 20 && pfrPct >= 15 ? 'TAG'
    : vpipPct < 20                  ? 'Nit'
    : 'Unknown';

  return {
    hands: n,
    vpip:  pct(vpipCount, n),
    pfr:   pct(pfrCount, n),
    three: pct(threeCount, threeChance),
    f3b:   pct(f3bFold, f3bHands.length),
    fold:  pct(foldCount, n),
    af:    Math.round(afValue * 100) / 100,
    style,
  };
}

// 統計カードのHTMLを生成
function statsCard(player, hands) {
  const s = calcStats(hands);
  if (!s) {
    return `<div class="stats-card">
      <div class="stats-card-header">
        <span class="stats-player-name">${player.name}</span>
        <span class="stats-hands">0 hands</span>
      </div>
      <div class="empty-state" style="padding:8px">記録なし</div>
    </div>`;
  }
  return `<div class="stats-card">
    <div class="stats-card-header">
      <span class="stats-player-name">${player.name}</span>
      <span class="stats-hands">${s.hands} hands</span>
    </div>
    <div class="stats-grid">
      <div class="stat-item"><span class="stat-value">${s.vpip}</span><span class="stat-label">VPIP</span></div>
      <div class="stat-item"><span class="stat-value orange">${s.pfr}</span><span class="stat-label">PFR</span></div>
      <div class="stat-item"><span class="stat-value orange">${s.three}</span><span class="stat-label">3bet%</span></div>
      <div class="stat-item"><span class="stat-value red">${s.f3b}</span><span class="stat-label">F3B</span></div>
      <div class="stat-item"><span class="stat-value">${s.fold}</span><span class="stat-label">Fold%</span></div>
      <div class="stat-item"><span class="stat-value red">${s.af.toFixed(2)}</span><span class="stat-label">AF</span></div>
    </div>
    <div style="margin-top:8px;font-size:12px;opacity:.7;font-family:'IBM Plex Mono',monospace">STYLE: ${s.style}</div>
    ${player.memo ? `<div class="stats-memo">${player.memo}</div>` : ''}
  </div>`;
}
function renderStats() {
  const c = document.getElementById('statsContainer');
  const filter = document.getElementById('statsPlayer').value;
  const players = filter === 'all'
    ? state.players
    : state.players.filter(p => p.id === filter);
  if (!players.length) {
    c.innerHTML = '<div class="empty-state">プレイヤーが未登録です</div>';
    return;
  }
  c.innerHTML = players
    .map(p => statsCard(p, state.hands.filter(h => h.player_id === p.id)))
    .join('');
}

// ============================================================
// 履歴
// ============================================================

function renderHistory() {
  const c = document.getElementById('historyContainer');
  const recent = [...state.hands].reverse().slice(0, 60);
  if (!recent.length) {
    c.innerHTML = '<div class="empty-state">記録がありません</div>';
    return;
  }
  c.innerHTML = recent.map(h => {
    const player  = state.players.find(p => p.id === h.player_id);
    const name    = player ? player.name : '不明';
    const t       = new Date(h.timestamp);
    const timeStr = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;

    const flags = [];
    if (h.limp)        flags.push('<span class="flag-chip chip-limp">Limp</span>');
    if (h.vpip)        flags.push('<span class="flag-chip chip-vpip">Call</span>');
    if (h.first_raise) flags.push('<span class="flag-chip chip-raise">Open</span>');
    if (h.three_bet)   flags.push('<span class="flag-chip chip-3bet">3BET</span>');
    if (h.four_bet)    flags.push('<span class="flag-chip chip-4bet">4BET</span>');
    if (h.five_bet)    flags.push('<span class="flag-chip chip-5bet">5BET+</span>');
    if (h.allin)       flags.push('<span class="flag-chip chip-allin">AI</span>');
    if (h.fold)        flags.push('<span class="flag-chip chip-fold">Fold</span>');
    if (h.squeeze)     flags.push('<span class="flag-chip chip-sqz">Sqz</span>');
    if (h.position)    flags.push(`<span class="flag-chip chip-pos">${h.position}</span>`);

    return `<div class="history-item" id="hist-${h.id}">
      <div style="flex:1;min-width:0">
        <div class="history-player">
          ${name}
          <span style="color:var(--text-dim);font-size:10px;font-family:'IBM Plex Mono',monospace">H${h.hand_number || '?'}</span>
        </div>
        <div class="history-flags">
          ${flags.join('') || '<span style="color:var(--text-dim);font-size:10px">fold / no action</span>'}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <div class="history-time">${timeStr}</div>
        <button class="edit-btn" onclick="openEditHandModal('${h.id}')">笨・/button>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// ハンド修正モーダル
// ============================================================

// 修正可能なフラグ一覧（ラベルとキーの対応）
const HAND_FLAG_KEYS = [
  { key: 'limp',        label: 'Limp'    },
  { key: 'vpip',        label: 'Call'    },
  { key: 'first_raise', label: 'Open'    },
  { key: 'three_bet',   label: '3BET'    },
  { key: 'four_bet',    label: '4BET'    },
  { key: 'five_bet',    label: '5BET'    },
  { key: 'allin',       label: 'All-in'  },
  { key: 'fold',        label: 'Fold'    },
  { key: 'squeeze',     label: 'Squeeze' },
];

function openEditHandModal(handId) {
  const hand = state.hands.find(h => h.id === handId);
  if (!hand) return;

  document.getElementById('editHandId').value = handId;

  const player = state.players.find(p => p.id === hand.player_id);
  document.getElementById('editHandTitle').textContent =
    `${player ? player.name : '不明'} - H${hand.hand_number} (${hand.position})`;

  // フラグチェックボックスを生成
  const container = document.getElementById('editHandFlags');
  container.innerHTML = HAND_FLAG_KEYS.map(({ key, label }) => `
    <label class="edit-flag-label">
      <input type="checkbox" class="edit-flag-cb" data-key="${key}" ${hand[key] ? 'checked' : ''}>
      ${label}
    </label>
  `).join('');

  document.getElementById('editHandModal').classList.add('open');
}

async function saveEditHand() {
  const handId = document.getElementById('editHandId').value;
  const hand   = state.hands.find(h => h.id === handId);
  if (!hand) return;

  // チェックボックスの状態を反映
  document.querySelectorAll('.edit-flag-cb').forEach(cb => {
    hand[cb.dataset.key] = cb.checked ? 1 : 0;
  });

  closeModal();
  renderHistory();
  renderStats();

  setSyncDot('syncing');
  try {
    await apiPost({ type: 'update_hand', hand });
    setSyncDot('ok');
  } catch (e) {
    setSyncDot('error');
    saveLocal();
  }
}

async function deleteHand() {
  const handId = document.getElementById('editHandId').value;
  if (!confirm('このハンドを削除しますか？')) return;

  state.hands = state.hands.filter(h => h.id !== handId);
  closeModal();
  renderHistory();
  renderStats();

  setSyncDot('syncing');
  try {
    await apiPost({ type: 'delete_hand', id: handId });
    setSyncDot('ok');
  } catch (e) {
    setSyncDot('error');
    saveLocal();
  }
}

// ============================================================
// ローディング表示
// ============================================================

function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

// ============================================================
// 起動
// ============================================================

init();


