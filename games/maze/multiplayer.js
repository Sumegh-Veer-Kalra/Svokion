import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getDatabase, ref, set, get, update, push, onValue, off, remove, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

var firebaseConfig = {
  apiKey: "AIzaSyDrSFAr555ScmDaPopTNIDGCtn8Tt_k4Dk",
  authDomain: "svk-games.firebaseapp.com",
  projectId: "svk-games",
  storageBucket: "svk-games.firebasestorage.app",
  messagingSenderId: "83781444329",
  appId: "1:83781444329:web:31a69a3e6fb4da1200c678",
  databaseURL: "https://svk-games-default-rtdb.asia-southeast1.firebasedatabase.app"
};

var fbApp = initializeApp(firebaseConfig);
var db = getDatabase(fbApp);

var PLAYER_COLORS = [
  '#38bdf8',
  '#f43f5e',
  '#a855f7',
  '#fbbf24',
  '#34d399',
  '#fb923c',
  '#ec4899',
  '#2dd4bf',
  '#6366f1',
  '#eab308'
];

function getPlayerIdentity(){
  var raw = null;
  try { raw = localStorage.getItem('_svk_cached_auth'); } catch(e){}
  var cached = null;
  if(raw){
    try { cached = JSON.parse(raw); } catch(e){}
  }
  var tabSuffix = Math.random().toString(36).substring(2, 7);

  var guestNum = '';
  try { guestNum = sessionStorage.getItem('_svk_guest_num'); } catch(e){}
  if(!guestNum){
    guestNum = Math.floor(1 + Math.random() * 9999).toString();
    try { sessionStorage.setItem('_svk_guest_num', guestNum); } catch(e){}
  }
  var guestName = 'Guest_' + guestNum;

  var uid = '';
  var name = guestName;
  if(cached && cached.uid){
    uid = cached.uid + '_' + tabSuffix;
    name = cached.username ? ('@' + cached.username) : (cached.displayName || guestName);
  } else {
    uid = 'g_' + Math.random().toString(36).substring(2, 7) + '_' + tabSuffix;
    name = guestName;
  }
  var initialColor = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
  return { uid: uid, name: name, color: initialColor };
}

function generateRoomCode(){
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for(var i = 0; i < 4; i++){
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

var MazeMP = {
  db: db,
  localPlayer: getPlayerIdentity(),
  activeRoomCode: null,
  isHost: false,
  isRacing: false,
  isFrozen: false,
  inQueue: false,
  queueRef: null,
  queueMatchRef: null,
  queueSelfMatchRef: null,
  queueCountdownRef: null,
  roomRef: null,
  positionsRef: null,
  winnerRef: null,
  stalkerSyncRef: null,
  syncedStalker: null,
  lastStalkerBroadcastTime: 0,
  lastStalkerReceiveTime: 0,
  lastStalkerSimTime: 0,
  hostWorker: null,
  isStartingCountdown: false,
  posBroadcastInterval: null,
  opponents: {},
  lastBroadcastTime: 0,
  queueCountdownTimer: null,
  queueCountdownVal: 10,
  lastQueueCount: 0,
  currentQueuePlayers: [],
  matchStartTime: 0,
  matchFinished: false,
  autoLeaveTimer: null,
  selectedHostMode: 'normal',

  init: function(){
    this.bindUI();
    this.checkUrlRoomParam();
  },

  bindUI: function(){
    var self = this;
    var btnMultiplayer = document.getElementById('btn-multiplayer');
    var modal = document.getElementById('mp-modal');
    var btnClose = document.getElementById('btn-mp-close');

    if(btnMultiplayer){
      btnMultiplayer.addEventListener('click', function(e){
        e.stopPropagation();
        self.localPlayer = getPlayerIdentity();
        self.openModal();
      });
    }

    if(btnClose){
      btnClose.addEventListener('click', function(e){
        e.stopPropagation();
        self.closeModal();
      });
    }

    var btnQuick = document.getElementById('btn-mp-quick');
    if(btnQuick){
      btnQuick.addEventListener('click', function(e){
        e.stopPropagation();
        self.startQuickPlay();
      });
    }

    var btnCustom = document.getElementById('btn-mp-custom');
    var customBranches = document.getElementById('mp-custom-branches');
    var customArrow = document.getElementById('mp-custom-arrow');
    if(btnCustom && customBranches){
      btnCustom.addEventListener('click', function(e){
        e.stopPropagation();
        var isOpen = customBranches.classList.contains('open');
        if(isOpen){
          customBranches.classList.remove('open');
          if(customArrow) customArrow.classList.remove('open');
        } else {
          customBranches.classList.add('open');
          if(customArrow) customArrow.classList.add('open');
        }
      });
    }

    var btnJoin = document.getElementById('btn-mp-join');
    if(btnJoin){
      btnJoin.addEventListener('click', function(e){
        e.stopPropagation();
        self.showScreen('join');
      });
    }

    var btnHost = document.getElementById('btn-mp-host');
    if(btnHost){
      btnHost.addEventListener('click', function(e){
        e.stopPropagation();
        self.createHostRoom();
      });
    }

    var btnQuickCancel = document.getElementById('btn-mp-quick-cancel');
    if(btnQuickCancel){
      btnQuickCancel.addEventListener('click', function(e){
        e.stopPropagation();
        self.leaveQueue();
        self.showScreen('main');
      });
    }

    var btnJoinBack = document.getElementById('btn-mp-join-back');
    if(btnJoinBack){
      btnJoinBack.addEventListener('click', function(e){
        e.stopPropagation();
        self.showScreen('main');
      });
    }

    var btnJoinSubmit = document.getElementById('btn-mp-join-submit');
    var joinInput = document.getElementById('mp-join-input');
    if(btnJoinSubmit && joinInput){
      btnJoinSubmit.addEventListener('click', function(e){
        e.stopPropagation();
        var code = joinInput.value.trim().toUpperCase();
        if(code.length === 4){
          self.joinRoomWithCode(code);
        } else {
          var err = document.getElementById('mp-join-error');
          if(err) err.textContent = 'Enter a valid 4-character code';
        }
      });
      joinInput.addEventListener('keydown', function(e){
        if(e.key === 'Enter'){
          btnJoinSubmit.click();
        }
      });
    }

    var btnShareLink = document.getElementById('btn-mp-share');
    if(btnShareLink){
      btnShareLink.addEventListener('click', function(e){
        e.stopPropagation();
        if(!self.activeRoomCode) return;
        var url = window.location.origin + '/games/maze/?room=' + self.activeRoomCode;
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(url).then(function(){
            btnShareLink.innerHTML = '<span>✓ COPIED!</span>';
            setTimeout(function(){
              btnShareLink.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>SHARE LINK</span>';
            }, 1800);
          });
        }
      });
    }

    var btnMapEasy = document.getElementById('btn-mp-map-easy');
    var btnMapHard = document.getElementById('btn-mp-map-hard');
    if(btnMapEasy && btnMapHard){
      btnMapEasy.addEventListener('click', function(e){
        e.stopPropagation();
        if(!self.isHost) return;
        self.setHostMapMode('normal');
      });
      btnMapHard.addEventListener('click', function(e){
        e.stopPropagation();
        if(!self.isHost) return;
        self.setHostMapMode('hard');
      });
    }

    var btnHostStart = document.getElementById('btn-mp-host-start');
    if(btnHostStart){
      btnHostStart.addEventListener('click', function(e){
        e.stopPropagation();
        if(!self.isHost || !self.activeRoomCode) return;
        self.launchHostRace();
      });
    }

    var btnHostCancel = document.getElementById('btn-mp-host-cancel');
    if(btnHostCancel){
      btnHostCancel.addEventListener('click', function(e){
        e.stopPropagation();
        self.leaveRoom();
        self.showScreen('main');
      });
    }
  },

  openModal: function(){
    var modal = document.getElementById('mp-modal');
    if(modal) modal.style.display = 'flex';
    this.showScreen('main');
  },

  closeModal: function(){
    var modal = document.getElementById('mp-modal');
    if(modal) modal.style.display = 'none';
    if(this.inQueue){
      this.leaveQueue();
    }
    if(this.activeRoomCode && !this.isRacing){
      this.leaveRoom();
    }
  },

  showScreen: function(screenName){
    var screens = ['main', 'quick', 'join', 'host'];
    for(var i = 0; i < screens.length; i++){
      var el = document.getElementById('mp-screen-' + screens[i]);
      if(el) el.style.display = (screens[i] === screenName) ? 'flex' : 'none';
    }
    if(screenName === 'main'){
      var customBranches = document.getElementById('mp-custom-branches');
      var customArrow = document.getElementById('mp-custom-arrow');
      if(customBranches) customBranches.classList.remove('open');
      if(customArrow) customArrow.classList.remove('open');
    }
    var err = document.getElementById('mp-join-error');
    if(err) err.textContent = '';
  },

  checkUrlRoomParam: function(){
    var room = null;
    try {
      var urlParams = new URLSearchParams(window.location.search);
      room = urlParams.get('room');
      if(!room && window.parent && window.parent !== window){
        var parentParams = new URLSearchParams(window.parent.location.search);
        room = parentParams.get('room');
      }
    } catch(e){}
    if(room){
      room = room.trim().toUpperCase();
      if(room.length === 4){
        this.openModal();
        this.showScreen('join');
        var joinInput = document.getElementById('mp-join-input');
        if(joinInput) joinInput.value = room;
        this.joinRoomWithCode(room);
      }
    }
  },

  cleanUrlRoomParam: function(){
    try {
      if(window.parent && window.parent !== window && window.parent.location){
        var pUrl = new URL(window.parent.location.href);
        if(pUrl.searchParams.has('room')){
          pUrl.searchParams.delete('room');
          window.parent.history.replaceState({}, window.parent.document.title, pUrl.pathname + pUrl.search);
        }
      }
    } catch(e){}
    try {
      var myUrl = new URL(window.location.href);
      if(myUrl.searchParams.has('room')){
        myUrl.searchParams.delete('room');
        window.history.replaceState({}, document.title, myUrl.pathname + myUrl.search);
      }
    } catch(e){}
  },

  startQuickPlay: function(){
    var self = this;
    this.inQueue = true;
    this.queueCountdownVal = 10;
    this.lastQueueCount = 0;
    this.showScreen('quick');

    var statusText = document.getElementById('mp-quick-status');
    if(statusText) statusText.textContent = 'FINDING RUNNERS...';
    var timerEl = document.getElementById('mp-quick-timer-box');
    if(timerEl) timerEl.style.display = 'none';

    var queuePlayerRef = ref(db, 'maze_matchmaking/' + this.localPlayer.uid);
    set(queuePlayerRef, {
      uid: this.localPlayer.uid,
      name: this.localPlayer.name,
      joinedAt: Date.now()
    });
    onDisconnect(queuePlayerRef).remove();

    var matchNoticeRef = ref(db, 'maze_matchmaking_match/' + this.localPlayer.uid);
    this.queueMatchRef = matchNoticeRef;
    onValue(matchNoticeRef, function(snap){
      var roomCode = snap.val();
      if(roomCode){
        remove(matchNoticeRef);
        self.leaveQueue();
        self.joinRoomDirect(roomCode);
      }
    });

    var queueSelfRef = ref(db, 'maze_matchmaking/' + this.localPlayer.uid + '/matchedRoom');
    this.queueSelfMatchRef = queueSelfRef;
    onValue(queueSelfRef, function(snap){
      var roomCode = snap.val();
      if(roomCode){
        self.leaveQueue();
        self.joinRoomDirect(roomCode);
      }
    });

    var countdownRef = ref(db, 'maze_matchmaking_countdown');
    this.queueCountdownRef = countdownRef;
    onValue(countdownRef, function(snap){
      var cData = snap.val();
      if(cData && typeof cData.val === 'number' && self.inQueue){
        var tBox = document.getElementById('mp-quick-timer-box');
        var tVal = document.getElementById('mp-quick-timer-val');
        if(tBox) tBox.style.display = 'block';
        if(tVal) tVal.textContent = cData.val;
      }
    });

    var allQueueRef = ref(db, 'maze_matchmaking');
    this.queueRef = allQueueRef;
    onValue(allQueueRef, function(snap){
      if(!self.inQueue) return;
      var data = snap.val() || {};
      var players = [];
      for(var k in data){
        if(data.hasOwnProperty(k) && data[k] && data[k].uid){
          players.push(data[k]);
        }
      }
      players.sort(function(a, b){ return a.joinedAt - b.joinedAt; });
      self.currentQueuePlayers = players;

      var countEl = document.getElementById('mp-quick-count');
      if(countEl) countEl.textContent = players.length;

      var listEl = document.getElementById('mp-quick-player-list');
      if(listEl){
        var html = '';
        for(var i = 0; i < players.length; i++){
          var p = players[i];
          var isMe = p.uid === self.localPlayer.uid;
          var col = PLAYER_COLORS[i % PLAYER_COLORS.length];
          html += '<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(15,23,42,0.85);border:1px solid ' + col + ';padding:5px 10px;border-radius:6px;font-size:9px;color:#fff;">';
          html += '<span style="width:8px;height:8px;border-radius:50%;background:' + col + ';box-shadow:0 0 6px ' + col + ';"></span>';
          html += '<span>' + (p.name || 'Guest') + (isMe ? ' (YOU)' : '') + '</span>';
          html += '</div>';
        }
        listEl.innerHTML = html;
      }

      if(players.length >= 2){
        var isLeader = (players[0].uid === self.localPlayer.uid);

        if(players.length < 5){
          if(players.length !== self.lastQueueCount){
            self.queueCountdownVal = 10;
            self.lastQueueCount = players.length;
          }
        } else {
          if(self.queueCountdownVal > 3){
            self.queueCountdownVal = 3;
          }
          self.lastQueueCount = players.length;
        }

        var timerBox = document.getElementById('mp-quick-timer-box');
        var timerVal = document.getElementById('mp-quick-timer-val');
        if(timerBox) timerBox.style.display = 'block';
        if(timerVal) timerVal.textContent = self.queueCountdownVal;

        if(isLeader){
          set(ref(db, 'maze_matchmaking_countdown'), {
            val: self.queueCountdownVal,
            count: players.length,
            ts: Date.now()
          });

          if(!self.queueCountdownTimer){
            self.queueCountdownTimer = setInterval(function(){
              if(!self.inQueue){
                clearInterval(self.queueCountdownTimer);
                self.queueCountdownTimer = null;
                return;
              }
              self.queueCountdownVal--;
              if(self.queueCountdownVal < 0) self.queueCountdownVal = 0;

              set(ref(db, 'maze_matchmaking_countdown'), {
                val: self.queueCountdownVal,
                count: self.lastQueueCount,
                ts: Date.now()
              });

              if(self.queueCountdownVal <= 0){
                clearInterval(self.queueCountdownTimer);
                self.queueCountdownTimer = null;
                self.launchMatchForPlayers(self.currentQueuePlayers || players);
              }
            }, 1000);
          }
        }
      } else {
        self.lastQueueCount = players.length;
        self.queueCountdownVal = 10;
        if(self.queueCountdownTimer){
          clearInterval(self.queueCountdownTimer);
          self.queueCountdownTimer = null;
        }
        var tBox = document.getElementById('mp-quick-timer-box');
        if(tBox) tBox.style.display = 'none';
        try {
          remove(ref(db, 'maze_matchmaking_countdown'));
        } catch(e){}
      }
    });
  },

  launchMatchForPlayers: function(fallbackPlayers){
    var self = this;
    get(ref(db, 'maze_matchmaking')).then(function(snap){
      var data = snap.val() || {};
      var freshPlayers = [];
      for(var k in data){
        if(data.hasOwnProperty(k) && data[k] && data[k].uid){
          freshPlayers.push(data[k]);
        }
      }
      freshPlayers.sort(function(a, b){ return a.joinedAt - b.joinedAt; });
      var players = (freshPlayers.length >= 2) ? freshPlayers : (self.currentQueuePlayers || fallbackPlayers || []);
      if(players.length < 2) return;
      var newCode = generateRoomCode();
      var randomMode = (Math.random() < 0.5) ? 'hard' : 'normal';
      var matched = players.slice(0, 5);
      var roomPlayers = {};
      for(var j = 0; j < matched.length; j++){
        roomPlayers[matched[j].uid] = {
          uid: matched[j].uid,
          name: matched[j].name,
          color: PLAYER_COLORS[j % PLAYER_COLORS.length],
          isHost: (j === 0),
          ready: true
        };
      }
      var newRoomRef = ref(db, 'maze_rooms/' + newCode);
      set(newRoomRef, {
        code: newCode,
        mode: randomMode,
        hostUid: matched[0].uid,
        status: 'countdown',
        createdAt: Date.now(),
        startedAt: Date.now(),
        players: roomPlayers
      }).then(function(){
        for(var m = 0; m < matched.length; m++){
          var uid = matched[m].uid;
          set(ref(db, 'maze_matchmaking_match/' + uid), newCode);
          set(ref(db, 'maze_matchmaking/' + uid + '/matchedRoom'), newCode);
        }
      });
    }).catch(function(){
      var players = self.currentQueuePlayers || fallbackPlayers || [];
      if(players.length < 2) return;
      var newCode = generateRoomCode();
      var randomMode = (Math.random() < 0.5) ? 'hard' : 'normal';
      var matched = players.slice(0, 5);
      var roomPlayers = {};
      for(var j = 0; j < matched.length; j++){
        roomPlayers[matched[j].uid] = {
          uid: matched[j].uid,
          name: matched[j].name,
          color: PLAYER_COLORS[j % PLAYER_COLORS.length],
          isHost: (j === 0),
          ready: true
        };
      }
      var newRoomRef = ref(db, 'maze_rooms/' + newCode);
      set(newRoomRef, {
        code: newCode,
        mode: randomMode,
        hostUid: matched[0].uid,
        status: 'countdown',
        createdAt: Date.now(),
        startedAt: Date.now(),
        players: roomPlayers
      }).then(function(){
        for(var m = 0; m < matched.length; m++){
          var uid = matched[m].uid;
          set(ref(db, 'maze_matchmaking_match/' + uid), newCode);
          set(ref(db, 'maze_matchmaking/' + uid + '/matchedRoom'), newCode);
        }
      });
    });
  },

  leaveQueue: function(){
    this.inQueue = false;
    this.lastQueueCount = 0;
    this.queueCountdownVal = 10;
    if(this.queueCountdownTimer){
      clearInterval(this.queueCountdownTimer);
      this.queueCountdownTimer = null;
    }
    if(this.queueCountdownRef){
      off(this.queueCountdownRef);
      this.queueCountdownRef = null;
    }
    if(this.queueRef){
      off(this.queueRef);
      this.queueRef = null;
    }
    if(this.queueMatchRef){
      off(this.queueMatchRef);
      remove(this.queueMatchRef);
      this.queueMatchRef = null;
    }
    if(this.queueSelfMatchRef){
      off(this.queueSelfMatchRef);
      this.queueSelfMatchRef = null;
    }
    try {
      remove(ref(db, 'maze_matchmaking/' + this.localPlayer.uid));
    } catch(e){}
  },

  createHostRoom: function(){
    var self = this;
    var code = generateRoomCode();
    this.activeRoomCode = code;
    this.isHost = true;
    this.selectedHostMode = 'normal';
    this.showScreen('host');

    var codeEl = document.getElementById('mp-host-code');
    if(codeEl) codeEl.textContent = code;

    var roomRef = ref(db, 'maze_rooms/' + code);
    this.roomRef = roomRef;

    var myColor = this.localPlayer.color || PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
    this.localPlayer.color = myColor;
    var initialPlayers = {};
    initialPlayers[this.localPlayer.uid] = {
      uid: this.localPlayer.uid,
      name: this.localPlayer.name,
      color: myColor,
      isHost: true,
      ready: true
    };

    set(roomRef, {
      code: code,
      mode: 'normal',
      status: 'waiting',
      hostUid: this.localPlayer.uid,
      createdAt: Date.now(),
      players: initialPlayers
    });

    var myPlayerRef = ref(db, 'maze_rooms/' + code + '/players/' + this.localPlayer.uid);
    var myPosRef = ref(db, 'maze_rooms/' + code + '/positions/' + this.localPlayer.uid);
    onDisconnect(myPlayerRef).remove();
    onDisconnect(myPosRef).remove();
    this.listenToRoom(code);
    this.updateHostModeButtons();
  },

  setHostMapMode: function(mode){
    this.selectedHostMode = mode;
    this.updateHostModeButtons();
    if(this.activeRoomCode && this.isHost){
      update(ref(db, 'maze_rooms/' + this.activeRoomCode), { mode: mode });
    }
  },

  updateHostModeButtons: function(){
    var btnEasy = document.getElementById('btn-mp-map-easy');
    var btnHard = document.getElementById('btn-mp-map-hard');
    if(btnEasy && btnHard){
      if(this.selectedHostMode === 'normal'){
        btnEasy.style.borderColor = '#4ade80';
        btnEasy.style.background = '#052e16';
        btnEasy.style.color = '#4ade80';
        btnHard.style.borderColor = '#334155';
        btnHard.style.background = '#0f172a';
        btnHard.style.color = '#64748b';
      } else {
        btnHard.style.borderColor = '#ef4444';
        btnHard.style.background = '#2d0000';
        btnHard.style.color = '#ef4444';
        btnEasy.style.borderColor = '#334155';
        btnEasy.style.background = '#0f172a';
        btnEasy.style.color = '#64748b';
      }
    }
  },

  joinRoomWithCode: function(code){
    var self = this;
    var err = document.getElementById('mp-join-error');
    if(err) err.textContent = 'CONNECTING...';

    var targetRoomRef = ref(db, 'maze_rooms/' + code);
    get(targetRoomRef).then(function(snapshot){
      if(!snapshot.exists()){
        if(err) err.textContent = 'Room ' + code + ' does not exist';
        return;
      }
      var roomData = snapshot.val();
      if(roomData.status !== 'waiting'){
        if(err) err.textContent = 'Race already in progress';
        return;
      }
      var players = roomData.players || {};
      var count = Object.keys(players).length;
      if(count >= 5){
        if(err) err.textContent = 'Room is full (5/5)';
        return;
      }
      self.joinRoomDirect(code);
    }).catch(function(e){
      if(err) err.textContent = 'Connection failed. Try again.';
    });
  },

  joinRoomDirect: function(code){
    var self = this;
    this.activeRoomCode = code;
    this.cleanUrlRoomParam();
    this.showScreen('host');

    var codeEl = document.getElementById('mp-host-code');
    if(codeEl) codeEl.textContent = code;

    var targetRoomRef = ref(db, 'maze_rooms/' + code);
    this.roomRef = targetRoomRef;

    get(targetRoomRef).then(function(snap){
      var r = snap.val() || {};
      var players = r.players || {};
      var takenColors = [];
      for(var pk in players){
        if(players.hasOwnProperty(pk) && players[pk] && players[pk].color){
          takenColors.push(players[pk].color);
        }
      }
      var available = PLAYER_COLORS.filter(function(c){ return takenColors.indexOf(c) === -1; });
      if(available.length === 0) available = PLAYER_COLORS;
      var myColor = available[Math.floor(Math.random() * available.length)];
      self.localPlayer.color = myColor;

      var amIHost = (r.hostUid === self.localPlayer.uid) || (players[self.localPlayer.uid] && players[self.localPlayer.uid].isHost);
      self.isHost = !!amIHost;

      var btnHostStart = document.getElementById('btn-mp-host-start');
      if(btnHostStart) btnHostStart.style.display = self.isHost ? 'inline-flex' : 'none';

      var mapSelectors = document.getElementById('mp-host-map-selector');
      if(mapSelectors) mapSelectors.style.pointerEvents = self.isHost ? 'auto' : 'none';

      var myPlayerRef = ref(db, 'maze_rooms/' + code + '/players/' + self.localPlayer.uid);
      if(!players[self.localPlayer.uid]){
        set(myPlayerRef, {
          uid: self.localPlayer.uid,
          name: self.localPlayer.name,
          color: myColor,
          isHost: self.isHost,
          ready: true
        });
      }
      onDisconnect(myPlayerRef).remove();
      var myPosRef = ref(db, 'maze_rooms/' + code + '/positions/' + self.localPlayer.uid);
      onDisconnect(myPosRef).remove();

      self.listenToRoom(code);
    });
  },

  listenToRoom: function(code){
    var self = this;
    var roomRef = ref(db, 'maze_rooms/' + code);
    onValue(roomRef, function(snapshot){
      if(!snapshot.exists()){
        if(!self.isRacing){
          self.leaveRoom();
          self.showScreen('main');
        }
        return;
      }
      var room = snapshot.val();
      self.selectedHostMode = room.mode || 'normal';
      self.updateHostModeButtons();

      var players = room.players || {};
      var pArray = [];
      for(var k in players){
        if(players.hasOwnProperty(k) && players[k]){
          pArray.push(players[k]);
        }
      }

      pArray.sort(function(a, b){
        var tA = a.joinedAt || 0;
        var tB = b.joinedAt || 0;
        if(tA !== tB) return tA - tB;
        return a.uid.localeCompare(b.uid);
      });

      for(var pi = 0; pi < pArray.length; pi++){
        var assignedCol = PLAYER_COLORS[pi % PLAYER_COLORS.length];
        pArray[pi].color = assignedCol;
        if(pArray[pi].uid === self.localPlayer.uid){
          self.localPlayer.color = assignedCol;
        }
      }

      var hostStillPresent = room.hostUid && players[room.hostUid];
      if(!hostStillPresent && pArray.length > 0){
        var newHost = pArray[0];
        if(newHost.uid === self.localPlayer.uid){
          self.isHost = true;
          update(ref(db, 'maze_rooms/' + code), { hostUid: self.localPlayer.uid });
          update(ref(db, 'maze_rooms/' + code + '/players/' + self.localPlayer.uid), { isHost: true });
        }
      } else if(room.hostUid === self.localPlayer.uid){
        self.isHost = true;
      }

      if(self.isRacing && pArray.length < 2 && !self.matchFinished){
        self.matchFinished = true;
        self.onMatchFinished({
          uid: self.localPlayer.uid,
          name: self.localPlayer.name,
          time: window.runTimer || 0,
          byForfeit: true
        });
      }

      var countEl = document.getElementById('mp-host-count');
      if(countEl) countEl.textContent = pArray.length;

      var listEl = document.getElementById('mp-host-player-list');
      if(listEl){
        var html = '';
        for(var i = 0; i < pArray.length; i++){
          var p = pArray[i];
          var isMe = p.uid === self.localPlayer.uid;
          var col = p.color || PLAYER_COLORS[i % PLAYER_COLORS.length];
          html += '<div style="display:flex;align-items:center;justify-content:space-between;background:#030712;border:1px solid ' + col + ';padding:8px 12px;border-radius:6px;font-size:10px;color:#fff;">';
          html += '<div style="display:flex;align-items:center;gap:8px;">';
          html += '<span style="width:10px;height:10px;border-radius:50%;background:' + col + ';box-shadow:0 0 8px ' + col + ';"></span>';
          html += '<span style="color:#f8fafc;">' + (p.name || 'Guest') + (isMe ? ' (YOU)' : '') + '</span>';
          html += '</div>';
          if(p.isHost){
            html += '<span style="background:rgba(250,204,21,0.2);color:#facc15;border:1px solid #facc15;padding:2px 6px;border-radius:4px;font-size:8px;">HOST</span>';
          }
          html += '</div>';
        }
        listEl.innerHTML = html;
      }

      var btnStart = document.getElementById('btn-mp-host-start');
      var mapSelectors = document.getElementById('mp-host-map-selector');
      if(mapSelectors) mapSelectors.style.pointerEvents = self.isHost ? 'auto' : 'none';
      if(btnStart){
        btnStart.style.display = self.isHost ? 'inline-flex' : 'none';
        if(self.isHost){
          if(pArray.length >= 2){
            btnStart.disabled = false;
            btnStart.style.opacity = '1';
            btnStart.style.cursor = 'pointer';
            btnStart.innerHTML = '<span>🏁 START RACE</span>';
          } else {
            btnStart.disabled = true;
            btnStart.style.opacity = '0.5';
            btnStart.style.cursor = 'not-allowed';
            btnStart.innerHTML = '<span>WAITING FOR PLAYERS</span>';
          }
        }
      }

      if(room.status === 'starting' && !self.isStartingCountdown && !self.isRacing && !self.matchFinished){
        self.handleStartingCountdown(room);
      }
      if(room.status === 'countdown' && !self.isRacing && !self.matchFinished){
        self.startRaceCountdown(room);
      }
    });
  },

  launchHostRace: function(){
    if(!this.isHost || !this.activeRoomCode) return;
    update(ref(db, 'maze_rooms/' + this.activeRoomCode), {
      status: 'starting',
      mode: this.selectedHostMode,
      startedAt: Date.now()
    });
  },

  handleStartingCountdown: function(room){
    this.isStartingCountdown = true;
    var modal = document.getElementById('mp-modal');
    if(modal) modal.style.display = 'flex';
    this.showScreen('host');

    var timerBox = document.getElementById('mp-host-timer-box');
    var timerVal = document.getElementById('mp-host-timer-val');
    if(timerBox) timerBox.style.display = 'block';

    var btnStart = document.getElementById('btn-mp-host-start');
    if(btnStart){
      btnStart.disabled = true;
      btnStart.style.opacity = '0.7';
      btnStart.innerHTML = '<span>STARTING RACE...</span>';
    }
    var btnCancel = document.getElementById('btn-mp-host-cancel');
    if(btnCancel){
      btnCancel.disabled = true;
      btnCancel.style.opacity = '0.5';
      btnCancel.style.cursor = 'not-allowed';
    }

    if(room && room.players && room.players[this.localPlayer.uid] && room.players[this.localPlayer.uid].color){
      this.localPlayer.color = room.players[this.localPlayer.uid].color;
    }

    var count = 3;
    if(timerVal) timerVal.textContent = count;
    if(window.playSound) window.playSound('click');

    var self = this;
    var countdownInterval = setInterval(function(){
      count--;
      if(count > 0){
        if(timerVal) timerVal.textContent = count;
        if(window.playSound) window.playSound('click');
      } else {
        clearInterval(countdownInterval);
        if(timerVal) timerVal.textContent = 'GO!';
        setTimeout(function(){
          if(timerBox) timerBox.style.display = 'none';
          if(modal) modal.style.display = 'none';
          self.isStartingCountdown = false;
          if(self.isHost && self.activeRoomCode){
            update(ref(db, 'maze_rooms/' + self.activeRoomCode), {
              status: 'countdown',
              startedAt: Date.now()
            });
          }
          self.startRaceCountdown(room);
        }, 400);
      }
    }, 1000);
  },

  startRaceCountdown: function(room){
    this.isRacing = true;
    this.isFrozen = false;
    this.isStartingCountdown = false;

    var modal = document.getElementById('mp-modal');
    if(modal) modal.style.display = 'none';

    var timerBox = document.getElementById('mp-host-timer-box');
    if(timerBox) timerBox.style.display = 'none';

    var countdownOverlay = document.getElementById('mp-countdown-overlay');
    if(countdownOverlay) countdownOverlay.style.display = 'none';

    this.matchStartTime = room.startedAt || Date.now();
    if(room && room.players && room.players[this.localPlayer.uid] && room.players[this.localPlayer.uid].color){
      this.localPlayer.color = room.players[this.localPlayer.uid].color;
    }

    var isHard = (room && room.mode === 'hard');
    if(window.launchGame && !window.isRunActive){
      window.launchGame(isHard);
    }
    this.isFrozen = false;

    this.startLiveStreaming();
    if(this.isHost){
      this.initHostWorker();
    }
  },

  startLiveStreaming: function(){
    var self = this;
    var code = this.activeRoomCode;
    if(!code) return;

    var posRef = ref(db, 'maze_rooms/' + code + '/positions');
    this.positionsRef = posRef;

    onValue(posRef, function(snapshot){
      var positions = snapshot.val() || {};
      for(var uid in positions){
        if(positions.hasOwnProperty(uid) && uid !== self.localPlayer.uid){
          self.updateOpponentPosition(uid, positions[uid]);
        }
      }
      for(var exUid in self.opponents){
        if(self.opponents.hasOwnProperty(exUid) && !positions[exUid]){
          if(self.opponents[exUid] && self.opponents[exUid].group && window.scene){
            window.scene.remove(self.opponents[exUid].group);
          }
          delete self.opponents[exUid];
        }
      }
    });

    var winRef = ref(db, 'maze_rooms/' + code + '/winner');
    this.winnerRef = winRef;
    onValue(winRef, function(snapshot){
      var winner = snapshot.val();
      if(winner){
        self.onMatchFinished(winner);
      }
    });

    var sSyncRef = ref(db, 'maze_rooms/' + code + '/stalker');
    this.stalkerSyncRef = sSyncRef;
    onValue(sSyncRef, function(snap){
      var sData = snap.val();
      if(sData){
        self.syncedStalker = sData;
        self.lastStalkerReceiveTime = performance.now();
      }
    });
  },

  createOpponentMesh: function(uid, info){
    var col = (info && info.color) ? info.color : '#38bdf8';
    var group = new THREE.Group();

    var headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    var headMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5
    });
    var head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, -0.15, 0);
    group.add(head);

    var faceGeo = new THREE.BoxGeometry(0.42, 0.36, 0.04);
    var faceMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(col),
      roughness: 0.35,
      metalness: 0.1,
      emissive: new THREE.Color(col),
      emissiveIntensity: 0.25
    });
    var face = new THREE.Mesh(faceGeo, faceMat);
    face.position.set(0, -0.15, -0.255);
    group.add(face);

    var bodyGeo = new THREE.BoxGeometry(0.62, 1.25, 0.38);
    var bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(col),
      roughness: 0.45,
      metalness: 0.15,
      emissive: new THREE.Color(col),
      emissiveIntensity: 0.15
    });
    var body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, -0.95, 0);
    group.add(body);

    var canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.roundRect ? ctx.roundRect(4, 4, 248, 56, 12) : ctx.rect(4, 4, 248, 56);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = col;
    ctx.stroke();

    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var displayName = (info && info.name) ? info.name : 'Runner';
    if(displayName.length > 14) displayName = displayName.substring(0, 13) + '..';
    ctx.fillText(displayName, 128, 34);

    var texture = new THREE.CanvasTexture(canvas);
    var spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false });
    var sprite = new THREE.Sprite(spriteMat);
    sprite.position.y = 0.38;
    sprite.scale.set(1.3, 0.32, 1);
    group.add(sprite);

    group.position.set(-1, 2.62, 14);
    if(window.scene) window.scene.add(group);

    headMat._origColor = headMat.color.clone();
    faceMat._origColor = faceMat.color.clone();
    bodyMat._origColor = bodyMat.color.clone();

    return {
      group: group,
      targetPos: new THREE.Vector3(-1, 2.62, 14),
      targetRotY: 0,
      currentColor: col,
      materials: [headMat, faceMat, bodyMat]
    };
  },

  updateOpponentPosition: function(uid, data){
    if(!this.opponents[uid]){
      this.opponents[uid] = this.createOpponentMesh(uid, data);
    }
    var opp = this.opponents[uid];
    if(opp && data.color && opp.currentColor && opp.currentColor !== data.color){
      if(opp.group && window.scene) window.scene.remove(opp.group);
      this.opponents[uid] = this.createOpponentMesh(uid, data);
      opp = this.opponents[uid];
    }
    if(opp && opp.targetPos){
      opp.targetPos.set(data.x, data.y, data.z);
      opp.targetRotY = data.r || 0;
      opp.isDead = !!data.dead;
    }
  },

  onFrame: function(dt, pos, rotY){
    if(!this.isRacing) return;
    if(!pos || typeof pos.x !== 'number') return;
    var safeRotY = (typeof rotY === 'number') ? rotY : 0;

    var now = performance.now();
    if(now - this.lastBroadcastTime > 50){
      this.lastBroadcastTime = now;
      if(this.activeRoomCode){
        var myPosRef = ref(db, 'maze_rooms/' + this.activeRoomCode + '/positions/' + this.localPlayer.uid);
        set(myPosRef, {
          x: Number(pos.x.toFixed(2)),
          y: Number(pos.y.toFixed(2)),
          z: Number(pos.z.toFixed(2)),
          r: Number(safeRotY.toFixed(2)),
          name: this.localPlayer.name,
          color: this.localPlayer.color || '#38bdf8',
          dead: !!(window.playerHP <= 0)
        });
      }
    }

    if(this.isHost && this.activeRoomCode && window.stalker && window.stalker.pos && typeof window.stalker.pos.x === 'number' && window.stalkerMesh && (now - this.lastStalkerBroadcastTime > 40)){
      this.lastStalkerBroadcastTime = now;
      this.lastStalkerSimTime = now;
      var sRef = ref(db, 'maze_rooms/' + this.activeRoomCode + '/stalker');
      set(sRef, {
        x: Number(window.stalker.pos.x.toFixed(2)),
        y: Number(window.stalker.pos.y.toFixed(2)),
        z: Number(window.stalker.pos.z.toFixed(2)),
        rotY: Number(window.stalkerMesh.rotation.y.toFixed(2)),
        state: window.stalker.state || 'patrol'
      });
    }

    var factor = Math.min(1, dt * 12);
    for(var uid in this.opponents){
      if(this.opponents.hasOwnProperty(uid)){
        var opp = this.opponents[uid];
        if(opp && opp.group){
          opp.group.position.lerp(opp.targetPos, factor);
          opp.group.rotation.y += (opp.targetRotY - opp.group.rotation.y) * factor;
          var targetRotZ = opp.isDead ? (Math.PI / 2) : 0;
          opp.group.rotation.z += (targetRotZ - opp.group.rotation.z) * factor;
          if(opp.materials){
            for(var mIdx = 0; mIdx < opp.materials.length; mIdx++){
              var mat = opp.materials[mIdx];
              if(opp.isDead){
                if(mat.color) mat.color.setHex(0xef4444);
              } else {
                if(mat.color && mat._origColor) mat.color.copy(mat._origColor);
              }
            }
          }
        }
      }
    }
  },

  onVictoryTrigger: function(){
    if(!this.isRacing || !this.activeRoomCode || this.matchFinished) return;
    this.matchFinished = true;
    var winRef = ref(db, 'maze_rooms/' + this.activeRoomCode + '/winner');
    var finalTime = window.runTimer || 0;
    set(winRef, {
      uid: this.localPlayer.uid,
      name: this.localPlayer.name,
      time: finalTime
    });
    if(this.isHost){
      update(ref(db, 'maze_rooms/' + this.activeRoomCode), { status: 'finished' });
    }
  },

  onMatchFinished: function(winner){
    this.isRacing = false;
    this.matchFinished = true;
    this.isFrozen = false;

    var isMe = (winner.uid === this.localPlayer.uid);
    var t = Number(winner.time) || 0;
    var m = Math.floor(t / 60);
    var s = Math.floor(t % 60);
    var timeStr = (m<10?'0':'')+m + ':' + (s<10?'0':'')+s;

    if(window.showCheckpointBanner){
      var title = isMe ? '🏆 YOU WON!' : ((winner.name || 'Runner') + ' ESCAPED FIRST!');
      var sub = isMe ? ('FINISH TIME: ' + timeStr) : ((winner.name || 'Runner') + ' WON WITH ' + timeStr);
      window.showCheckpointBanner(title, sub, 15000);
    }

    if(window.drawBillboardVictory) window.drawBillboardVictory();
    if(window.updateLiveHud) window.updateLiveHud();

    var leaveNotice = document.getElementById('mp-auto-leave-notice');
    if(!leaveNotice){
      leaveNotice = document.createElement('div');
      leaveNotice.id = 'mp-auto-leave-notice';
      leaveNotice.style.cssText = 'position:fixed;top:54px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.92);border:2px solid #38bdf8;padding:8px 16px;border-radius:8px;font-family:\'Press Start 2P\',monospace;font-size:10px;color:#38bdf8;z-index:2100;letter-spacing:1px;box-shadow:0 0 15px rgba(56,189,248,0.4);white-space:nowrap;';
      document.body.appendChild(leaveNotice);
    }
    leaveNotice.style.display = 'block';

    var leaveRemaining = 30;
    leaveNotice.textContent = 'LEAVING MATCH IN ' + leaveRemaining + 's';

    var self = this;
    if(this.autoLeaveTimer) clearInterval(this.autoLeaveTimer);
    this.autoLeaveTimer = setInterval(function(){
      leaveRemaining--;
      if(leaveRemaining > 0){
        leaveNotice.textContent = 'LEAVING MATCH IN ' + leaveRemaining + 's';
      } else {
        clearInterval(self.autoLeaveTimer);
        self.autoLeaveTimer = null;
        if(leaveNotice) leaveNotice.style.display = 'none';
        self.resetToMenu();
      }
    }, 1000);
  },

  leaveRoom: function(){
    this.stopHostWorker();
    var timerBox = document.getElementById('mp-host-timer-box');
    if(timerBox) timerBox.style.display = 'none';
    var btnCancel = document.getElementById('btn-mp-host-cancel');
    if(btnCancel){
      btnCancel.disabled = false;
      btnCancel.style.opacity = '1';
      btnCancel.style.cursor = 'pointer';
    }
    if(this.roomRef){
      off(this.roomRef);
      this.roomRef = null;
    }
    if(this.positionsRef){
      off(this.positionsRef);
      this.positionsRef = null;
    }
    if(this.winnerRef){
      off(this.winnerRef);
      this.winnerRef = null;
    }
    if(this.stalkerSyncRef){
      off(this.stalkerSyncRef);
      this.stalkerSyncRef = null;
    }
    this.syncedStalker = null;
    if(this.activeRoomCode){
      try {
        var myPlayerRef = ref(db, 'maze_rooms/' + this.activeRoomCode + '/players/' + this.localPlayer.uid);
        var myPosRef = ref(db, 'maze_rooms/' + this.activeRoomCode + '/positions/' + this.localPlayer.uid);
        remove(myPlayerRef);
        remove(myPosRef);
      } catch(e){}
    }
    this.clearOpponentMeshes();
    this.activeRoomCode = null;
    this.isHost = false;
    this.isRacing = false;
    this.isFrozen = false;
    this.matchFinished = false;
  },

  clearOpponentMeshes: function(){
    for(var uid in this.opponents){
      if(this.opponents.hasOwnProperty(uid)){
        var opp = this.opponents[uid];
        if(opp && opp.group && window.scene){
          window.scene.remove(opp.group);
        }
      }
    }
    this.opponents = {};
  },

  resetToMenu: function(){
    if(this.autoLeaveTimer){
      clearInterval(this.autoLeaveTimer);
      this.autoLeaveTimer = null;
    }
    var leaveNotice = document.getElementById('mp-auto-leave-notice');
    if(leaveNotice) leaveNotice.style.display = 'none';

    var vicOverlay = document.getElementById('mp-victory-overlay');
    if(vicOverlay) vicOverlay.style.display = 'none';

    if(window.controls && window.controls.unlock){
      window.controls.unlock();
    }
    if(document.exitPointerLock){
      try { document.exitPointerLock(); } catch(e){}
    }

    this.stopHostWorker();
    this.leaveRoom();
    var timerBox = document.getElementById('mp-host-timer-box');
    if(timerBox) timerBox.style.display = 'none';
    var btnCancel = document.getElementById('btn-mp-host-cancel');
    if(btnCancel){
      btnCancel.disabled = false;
      btnCancel.style.opacity = '1';
      btnCancel.style.cursor = 'pointer';
    }
    var countdownOverlay = document.getElementById('mp-countdown-overlay');
    if(countdownOverlay) countdownOverlay.style.display = 'none';
    var modal = document.getElementById('mp-modal');
    if(modal) modal.style.display = 'none';

    if(window.clearProgressData){
      window.clearProgressData();
    }

    var diffScreen = document.getElementById('difficulty-screen');
    if(diffScreen) diffScreen.style.display = 'flex';
    var liveHud = document.getElementById('live-hud-badge');
    if(liveHud) liveHud.style.display = 'none';
    window.isRunActive = false;
    this.isFrozen = false;
    this.matchFinished = false;
    if(window.checkSavedGame) window.checkSavedGame();
  },

  initHostWorker: function(){
    var self = this;
    if(this.hostWorker) return;
    try {
      var blob = new Blob([
        'setInterval(function(){ postMessage(1); }, 45);'
      ], { type: 'application/javascript' });
      var worker = new Worker(URL.createObjectURL(blob));
      worker.onmessage = function(){
        if(!self.isRacing || !self.isHost || !self.activeRoomCode) return;
        var now = performance.now();
        if(now - self.lastStalkerSimTime > 60){
          var dt = Math.min(0.08, (now - self.lastStalkerSimTime) / 1000);
          self.lastStalkerSimTime = now;
          if(window.updateStalker){
            var curPos = (window.camera && window.camera.position) ? window.camera.position : {x:-1, y:2.62, z:14};
            window.updateStalker(dt, curPos);
          }
          if(window.stalker && window.stalker.pos && typeof window.stalker.pos.x === 'number' && window.stalkerMesh){
            self.lastStalkerBroadcastTime = now;
            var sRef = ref(db, 'maze_rooms/' + self.activeRoomCode + '/stalker');
            set(sRef, {
              x: Number(window.stalker.pos.x.toFixed(2)),
              y: Number(window.stalker.pos.y.toFixed(2)),
              z: Number(window.stalker.pos.z.toFixed(2)),
              rotY: Number(window.stalkerMesh.rotation.y.toFixed(2)),
              state: window.stalker.state || 'patrol'
            });
          }
        }
      };
      this.hostWorker = worker;
    } catch(e){}
  },

  stopHostWorker: function(){
    if(this.hostWorker){
      try { this.hostWorker.terminate(); } catch(e){}
      this.hostWorker = null;
    }
  }
};

window.MazeMP = MazeMP;

window.addEventListener('DOMContentLoaded', function(){
  MazeMP.init();
});
