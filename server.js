const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 모든 접속자가 같은 사다리판을 공유하는 단일 방(room) 상태.
// 여러 방을 지원하려면 이 객체를 roomId로 키를 가진 맵으로 바꾸면 됨.
function freshState() {
  return {
    names: [],
    goals: [],
    namesLocked: false,
    goalsLocked: false,
    ladder: null,       // { n, rows, rungs, finalCol, pathCols, slotGoals, singlePrizeMode }
    played: [],
    gameOver: false,
    statusMsg: '',
    results: [],         // [{ name, goal }]
  };
}

let state = freshState();

function buildLadder() {
  const n = state.names.length;
  const rows = Math.max(10, n * 3);

  const rungs = [];
  for (let r = 0; r < rows; r++) {
    const row = new Array(Math.max(0, n - 1)).fill(false);
    let i = 0;
    while (i < n - 1) {
      if (Math.random() < 0.35) { row[i] = true; i += 2; }
      else i += 1;
    }
    rungs.push(row);
  }

  const finalCol = [];
  const pathCols = [];
  for (let start = 0; start < n; start++) {
    let col = start;
    const path = [col];
    for (let r = 0; r < rows; r++) {
      const row = rungs[r];
      if (col > 0 && row[col - 1]) col -= 1;
      else if (col < n - 1 && row[col]) col += 1;
      path.push(col);
    }
    finalCol.push(col);
    pathCols.push(path);
  }

  // 목표 칸: 입력값 그대로 사용, 부족하면 "0원"으로 채움, 넘치면 버림
  const pool = state.goals.slice(0, n);
  while (pool.length < n) pool.push('0원');
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const singlePrizeMode = state.goals.length === 1 && n > 1;

  return { n, rows, rungs, finalCol, pathCols, slotGoals: pool, singlePrizeMode };
}

function broadcastState() {
  io.emit('state', state);
}

io.on('connection', (socket) => {
  // 새로 접속한 클라이언트에게 현재 상태 전달
  socket.emit('state', state);

  socket.on('addName', (name) => {
    if (state.namesLocked) return;
    const v = String(name || '').trim();
    if (!v) return;
    state.names.push(v);
    broadcastState();
  });

  socket.on('removeName', (idx) => {
    if (state.namesLocked) return;
    if (idx >= 0 && idx < state.names.length) {
      state.names.splice(idx, 1);
      broadcastState();
    }
  });

  socket.on('lockNames', () => {
    if (state.names.length < 2) {
      socket.emit('errorMsg', '참여자는 2명 이상 입력해주세요.');
      return;
    }
    state.namesLocked = true;
    broadcastState();
  });

  socket.on('addGoal', (goal) => {
    if (state.goalsLocked) return;
    const v = String(goal || '').trim();
    if (!v) return;
    state.goals.push(v);
    broadcastState();
  });

  socket.on('removeGoal', (idx) => {
    if (state.goalsLocked) return;
    if (idx >= 0 && idx < state.goals.length) {
      state.goals.splice(idx, 1);
      broadcastState();
    }
  });

  socket.on('lockGoals', () => {
    if (state.goals.length < 1) {
      socket.emit('errorMsg', '목표는 1개 이상 입력해주세요.');
      return;
    }
    state.goalsLocked = true;
    broadcastState();
  });

  socket.on('startLadder', () => {
    if (!state.namesLocked || !state.goalsLocked) return;
    state.ladder = buildLadder();
    state.played = [];
    state.gameOver = false;
    state.results = [];
    state.statusMsg = '첫번째 참여자를 클릭하면 순서대로 진행됩니다.';
    broadcastState();
  });

  // 클라이언트가 특정 참여자의 진행을 요청 (첫 참여자 클릭 또는 자동 연쇄 호출)
  socket.on('play', (start) => {
    if (!state.ladder || state.gameOver) return;
    if (state.played.includes(start)) return; // 이미 진행됨 (중복 요청 무시)
    if (start !== 0 && !state.played.includes(start - 1)) return; // 왼쪽부터 순서 보장

    state.played.push(start);
    const finalCol = state.ladder.finalCol[start];
    const goalText = state.ladder.slotGoals[finalCol];
    const name = state.names[start];
    state.results.push({ name, goal: goalText, start, finalCol });

    let finished = false;
    if (state.ladder.singlePrizeMode) {
      state.statusMsg = `${name}님이 ${goalText}에 당첨되어 게임이 종료되었습니다!`;
      state.gameOver = true;
      finished = true;
    } else if (state.played.length === state.ladder.n) {
      state.statusMsg = '모든 참여자가 사다리를 완료했습니다!';
      state.gameOver = true;
      finished = true;
    } else {
      state.statusMsg = `${name} 진행 중...`;
    }

    // 모든 클라이언트가 동일한 애니메이션을 동시에 보도록 play 결과를 브로드캐스트
    io.emit('playResult', { start, finalCol, goalText, name, finished, gameOver: state.gameOver, statusMsg: state.statusMsg });
  });

  socket.on('reset', () => {
    state = freshState();
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`사다리타기 서버 실행 중: http://localhost:${PORT}`);
});
