// ============================================================
// Poker Tracker - app.js
// ============================================================

// ============================================================
// 設定
// ============================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwskfryE2q1QL0Z4cRso8PI45I0fp2wr6Dpq4OabIIUZOKjCxRTivRluVcyXlSazvXrAQ/exec';

const SEATS = 9; // テーブルの最大席数

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

	state.players = playersRes || [];

	// hands: Sheets から来た値は文字列になる場合があるので数値に変換
	state.hands = (handsRes || []).map(h => ({
		...h,
		vpip: Number(h.vpip),
		first_raise: Number(h.first_raise),
		three_bet: Number(h.three_bet),
		four_bet: Number(h.four_bet),
		five_bet: Number(h.five_bet),
		allin: Number(h.allin),
		fold: Number(h.fold || 0),
		squeeze: Number(h.squeeze || 0),
		three_bet_chance: Number(h.three_bet_chance || 0),
		four_bet_chance: Number(h.four_bet_chance || 0),
		hand_number: Number(h.hand_number),
	}));

	// 席配置・BTN位置・ハンド番号を復元
	if (stateRes && stateRes.state) {
		const s = stateRes.state;
		state.seats      = s.seats      || Array(SEATS).fill(null);
		state.btnSeat    = s.btnSeat    ?? 0;
		state.handNumber = s.handNumber || 1;
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
	localStorage.setItem('pt_hands',     JSON.stringify(state.hands));
}

function loadLocal() {
	try {
		state.players    = JSON.parse(localStorage.getItem('pt_players'))  || [];
		state.seats      = JSON.parse(localStorage.getItem('pt_seats'))    || Array(SEATS).fill(null);
		state.btnSeat    = JSON.parse(localStorage.getItem('pt_btn'))      ?? 0;
		state.handNumber = JSON.parse(localStorage.getItem('pt_handnum'))  || 1;
		state.hands      = JSON.parse(localStorage.getItem('pt_hands'))    || [];
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
			seats:      state.seats,
			btnSeat:    state.btnSeat,
			handNumber: state.handNumber,
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

// 各席にポジション名を割り当てたマップを返す
// 戻り値: { seatIndex: posName, ... }
// 例: { 0: 'BTN', 1: 'SB', 2: 'BB', 3: 'UTG', ... }
function getPosMap() {
	const active = getActiveSeats();
	const n = active.length;
	if (n < 2) return {};

	const posNames = POS_MAP[n] || POS_MAP[9];
	const map = {};

	// BTN席がどの着席者インデックスにあるかを特定
	// state.btnSeat が空席の場合は時計回りで次の着席者を探す
	let btnIdx = active.indexOf(state.btnSeat);
	if (btnIdx === -1) {
		for (let off = 1; off < SEATS; off++) {
		const c = (state.btnSeat + off) % SEATS;
		btnIdx = active.indexOf(c);
		if (btnIdx !== -1) break;
		}
	}

	// BTN から時計回りにポジションを割り当て
	for (let i = 0; i < n; i++) {
		const seat = active[(btnIdx + i) % n];
		map[seat] = posNames[i] || '—';
	}
	return map;
}

// ============================================================
// テーブル描画
// ============================================================

function renderTable() {
	const posMap = getPosMap();

	// ヘッダーのハンド番号・BTN席番号を更新
	document.getElementById('handNumLabel').innerHTML =
		`HAND ${state.handNumber}<span class="sync-dot" id="syncDot"></span>`;
	document.getElementById('btnSeatLabel').textContent = `BTN: 席${state.btnSeat + 1}`;

	const list = document.getElementById('seatList');
	list.innerHTML = '';

	for (let i = 0; i < SEATS; i++) {
		const playerId     = state.seats[i];
		const player       = playerId ? state.players.find(p => p.id === playerId) : null;
		const pos          = posMap[i] || '';
		const isBtn        = pos === 'BTN' || pos === 'BTN/SB';
		const isSb         = pos === 'SB';
		const isBb         = pos === 'BB';
		const flags        = state.pendingFlags[i] || new Set();

		// 席行
		const row = document.createElement('div');
		row.className = 'seat-row'
		+ (isBtn   ? ' is-btn'    : '')
		+ (isSb    ? ' is-sb'     : '')
		+ (isBb    ? ' is-bb'     : '')
		+ (!player ? ' empty-seat': '');

		// ── 上段：席番号・ポジション・プレイヤー名 ──
		const topDiv = document.createElement('div');
		topDiv.className = 'seat-top';

		const numDiv = document.createElement('div');
		numDiv.className = 'seat-num';
		numDiv.textContent = i + 1;

		// ポジションバッジ：CSS クラス名（pos-badge.xxx）と対応
		const posKey = pos === 'BTN' || pos === 'BTN/SB' ? 'btn'
		: pos === 'SB'    ? 'sb'
		: pos === 'BB'    ? 'bb'
		: pos === 'UTG'   ? 'utg'
		: pos === 'UTG+1' ? 'utg1'
		: pos === 'MP'    ? 'mp'
		: pos === 'LJ'    ? 'lj'
		: pos === 'HJ'    ? 'hj'
		: pos === 'CO'    ? 'co' : '';
		const posDiv = document.createElement('div');
		posDiv.className = `pos-badge ${posKey}`;
		posDiv.textContent = pos || '—';

		// プレイヤー名（タップでモーダルを開く）
		const infoDiv = document.createElement('div');
		infoDiv.className = 'seat-info';
		infoDiv.onclick = () => openAssignModal(i);
		infoDiv.innerHTML = player
		? `<div class="seat-player-name">${player.name}</div>`
		: `<div class="seat-empty-label">空席 — タップして割当</div>`;

		topDiv.appendChild(numDiv);
		topDiv.appendChild(posDiv);
		topDiv.appendChild(infoDiv);
		row.appendChild(topDiv);

		// ── 下段：アクションフラグボタン（着席時のみ） ──
		if (player) {
		const actDiv = document.createElement('div');
		actDiv.className = 'seat-actions';

		[
			{ key: 'vpip',  label: 'Call' }, // コール（手動のみ、他アクションでは自動ON不可）
			{ key: 'raise', label: 'Open' }, // オープンレイズ（RFI）
			{ key: '3bet',  label: '3BET' },
			{ key: '4bet',  label: '4BET' },
			{ key: '5bet',  label: '5BET' },
			{ key: 'allin', label: 'All-in'   }, // All-in
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

// ============================================================
// ハンド確定（NEXT HAND）
// ============================================================

async function commitHand() {
	const posMap = getPosMap();
	const btn = document.getElementById('nextHandBtn');
	btn.disabled = true;

	const activeSeats = getActiveSeats();
	const btnIdx = activeSeats.indexOf(state.btnSeat);
	const orderedSeats = [];
	for (let i = 0; i < activeSeats.length; i++) {
		orderedSeats.push(activeSeats[(btnIdx + i) % activeSeats.length]);
	}

	let openFound = false;
	let callAfterOpen = false;
	let threeBetFound = false;
	const chanceMap = {};
	const newHands = [];

	orderedSeats.forEach(seat => {
		const flags = state.pendingFlags[seat] || new Set();
		const acted = flags.size > 0;

		chanceMap[seat] = {
			three: openFound && !threeBetFound ? 1 : 0,
			four: threeBetFound ? 1 : 0,
		};

		const raiseLike = flags.has('raise') || flags.has('3bet') || flags.has('4bet') || flags.has('5bet');
		const vpip = flags.has('vpip') || raiseLike || flags.has('allin');
		const fold = !acted ? 1 : 0;
		const squeeze = flags.has('3bet') && openFound && callAfterOpen ? 1 : 0;

		newHands.push({
			id: `h_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
			timestamp: new Date().toISOString(),
			session_id: state.sessionId,
			player_id: state.seats[seat],
			position: posMap[seat] || '',
			hand_number: state.handNumber,
			vpip: vpip ? 1 : 0,
			first_raise: raiseLike ? 1 : 0,
			three_bet: flags.has('3bet') ? 1 : 0,
			four_bet: flags.has('4bet') ? 1 : 0,
			five_bet: flags.has('5bet') ? 1 : 0,
			allin: flags.has('allin') ? 1 : 0,
			fold,
			squeeze,
			three_bet_chance: chanceMap[seat].three,
			four_bet_chance: chanceMap[seat].four,
			memo: '',
		});

		if (flags.has('raise')) openFound = true;
		if (openFound && flags.has('vpip') && !raiseLike) callAfterOpen = true;
		if (flags.has('3bet')) threeBetFound = true;
	});

	state.hands.push(...newHands);
	state.pendingFlags = {};
	state.handNumber++;
	advanceBtn();
	renderTable();

	try {
		await Promise.all([
			...newHands.map(h => apiPost({ type: 'save_hand', hand: h })),
			saveTableState(),
		]);
	} catch (e) {
		saveLocal();
	}
	btn.disabled = false;
}

// ============================================================
// BTN 移動
// ============================================================

// BTN を時計回りに次の着席者へ自動移動
function advanceBtn() {
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
	saveTableState();
	closeModal();
	renderTable();
}

function closeModal() {
	document.getElementById('assignModal').classList.remove('open');
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
	const name = input.value.trim();
	if (!name) return;
	if (state.players.find(p => p.name === name)) { alert('同名が既に存在します'); return; }

	const addBtn = document.getElementById('addPlayerBtn');
	addBtn.disabled = true;

	const player = { id: 'p_' + Date.now(), name, created_at: new Date().toISOString() };
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
		return `<div class="player-list-item">
			<div>
				<div style="font-size:14px;font-weight:500">${p.name}</div>
				<div class="player-meta">${seatStr} · ${hands} hands</div>
			</div>
			<button class="delete-btn" onclick="deletePlayer('${p.id}')">✕</button>
		</div>`;
	}).join('');
}

// ============================================================
// 統計計算
// ============================================================
//
// 【データ構造】
//   hands 配列の各レコード（hand）は以下のフラグを持つ（値: 0 or 1）
//
//     hand.vpip        ... Call ボタンで記録（コール）
//     hand.first_raise ... Open ボタンで記録（オープンレイズ / RFI）
//     hand.three_bet   ... 3BET ボタンで記録
//     hand.four_bet    ... 4BET ボタンで記録
//     hand.five_bet    ... 5BET ボタンで記録（5BET以上を含む）
//     hand.allin       ... AI ボタンで記録（オールイン）
//
//   ※各フラグは独立。Open を押しても Call は自動でONにならない。
//     同じハンドに複数フラグを立てることで、例えば
//     「Open → 3BETされたのでCall」なら Open + Call 両方ON。
//
// 【統計計算式】
//   現在はすべて「記録した全ハンド数 n を分母」とするシンプルな集計。
//   例: Call% = Call フラグが立っているハンド数 / n * 100
//
//   ⚠️ 本来のポーカー統計では分母が「機会数」になる場合がある。
//     例: 3BET% の本来の分母は「3BETの機会があったハンド数」
//        （= 誰かがオープンした状況で自分が行動したハンド数）
//        現在は n を使った近似値で計算している。
//
// 【調整したい場合】
//   calcStats() 内の各 pct() の引数か分母 n を変更する。
//   例: 3BET% を「オープンされた回数」を分母にしたい場合は
//     three_bet_opp などの新しいフラグをデータに追加し、
//     pct(three, openCount) のように変更する。
//
// ============================================================

function calcStats(hands) {
	const n = hands.length;
	if (!n) return null;
	const pct = (v,d) => d ? Math.round(v / d * 100) : 0;

	const vpip = hands.filter(h => h.vpip).length;
	const pfr = hands.filter(h => h.first_raise).length;
	const three = hands.filter(h => h.three_bet).length;
	const sqz = hands.filter(h => h.squeeze).length;
	const threeChance = hands.filter(h => h.three_bet_chance).length;

	return {
		hands: n,
		vpip: pct(vpip, n),
		pfr: pct(pfr, n),
		three: pct(three, threeChance),
		sqz: pct(sqz, n),
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
			<div class="stat-item"><span class="stat-value">${s.vpip}</span>
			<span class="stat-label">VPIP</span>
		</div>
			<div class="stat-item"><span class="stat-value orange">${s.pfr}</span>
			<span class="stat-label">PFR</span>
		</div>
			<div class="stat-item"><span class="stat-value orange">${s.three}</span>
			<span class="stat-label">3bet%</span>
		</div>
			<div class="stat-item"><span class="stat-value red">${s.sqz}</span>
			<span class="stat-label">Squeeze%</span>
		</div>
			<div class="stat-item"><span class="stat-value">${s.ats}</span>
			<span class="stat-label">ATS</span>
		</div>
			<div class="stat-item"><span class="stat-value">${s.f3b}</span>
			<span class="stat-label">F3B</span>
		</div>
			<div class="stat-item"><span class="stat-value">${s.fold}</span>
			<span class="stat-label">FOLD</span>
		</div>
			<div class="stat-item"><span class="stat-value">${s.ai}</span>
			<span class="stat-label">AI</span>
		</div>
		</div>
		<div style="margin-top:8px;font-size:12px;opacity:.8">STYLE: ${s.style}</div>
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
  const recent = [...state.hands].reverse().slice(0, 60); // 最新60件
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
	if (h.vpip)        flags.push('<span class="flag-chip chip-vpip">Call</span>');
	if (h.first_raise) flags.push('<span class="flag-chip chip-raise">Open</span>');
	if (h.three_bet)   flags.push('<span class="flag-chip chip-3bet">3BET</span>');
	if (h.four_bet)    flags.push('<span class="flag-chip chip-4bet">4BET</span>');
	if (h.five_bet)    flags.push('<span class="flag-chip chip-5bet">5BET+</span>');
	if (h.allin)       flags.push('<span class="flag-chip chip-allin">AI</span>');
	if (h.position)    flags.push(`<span class="flag-chip chip-pos">${h.position}</span>`);

	return `<div class="history-item">
	  <div style="flex:1">
		<div class="history-player">
		  ${name}
		  <span style="color:var(--text-dim);font-size:10px;font-family:'IBM Plex Mono',monospace">
			H${h.hand_number || '?'}
		  </span>
		</div>
		<div class="history-flags">
		  ${flags.join('') || '<span style="color:var(--text-dim);font-size:10px">fold / no action</span>'}
		</div>
	  </div>
	  <div class="history-time">${timeStr}</div>
	</div>`;
  }).join('');
}

// ============================================================
// ローディング表示
// ============================================================

function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

// ============================================================
// テーブルクリア処理
// ============================================================
function clearAllTable() {
    state.seats = Array(SEATS).fill(null);
    state.pendingFlags = {};
    state.btnSeat = 0;
    state.handNumber = 1;

    localStorage.removeItem('pt_seats');
    localStorage.removeItem('pt_btn');
    localStorage.removeItem('pt_handnum');

    saveTableState();
    renderTable();
}

// ============================================================
// 起動
// ============================================================

init();
