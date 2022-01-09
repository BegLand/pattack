// settings
const DEBUGLOG = true;
const GAMELOG = true;
const reset = false;
const limits = { attack: 7 }; // recommended value: 5-10 - Sends Y attacks within a interval. Should be safe up to 15, but should revise if you have a high attack speed.
const samples = 50; // recommended value: 20-100 - the higher the value, the more rigid to lag spikes. Should be safe with both 15-500.
const minimumAttackMS = 150; // recommended value: Sets the minimum attack speed overall. 100ms good.
const whileRacer = false; // experimental, if you want to block code until timing is achieved as opposed of rely on setTimeout(0)

// global variables /puke
const _lock = {};
const targets = {}; // enable target switching to last second
let needle;
let samplesTimes;

// math functions
function avg(array) {
  return array.reduce((sum, value) => sum + value) / array.length;
}
function std(array) {
  return Math.sqrt(avg(array.map((value) => (value - avg(array)) ** 2)));
}
// timing functions
function safetyCoefficientSmootherer(x) {
  if (x <= 5) return 2.5;
  if (x >= 60) return 1.1;
  return (0.0005 * x) ** 2 - (0.057 * x) + 2.7727;
}
function schedulingTiming() {
  return -1 * Math.min((1 / character.frequency) * 1000 * 0.8, Math.max(Math.max(...parent.pings) * 1.5, minimumAttackMS)); // never lower than attack speed, but higher than ping, or default
}

// cooldown functions
function getCD(skill) {
  if (!G.skills[skill]) return parent.next_skill[skill];
  const { share } = G.skills[skill];
  if (share) {
    return parent.next_skill[share];
  }
  return parent.next_skill[skill];
}

function getCDName(skill) {
  return G.skills[skill].share || skill;
}

// hook functions
function hookAttack() {
  !window.oldAttack && (window.oldAttack = attack); // save old attack
  window.attack = newAttack;

  !window.oldUse_skill && (window.oldUse_skill = use_skill); // save old attack
  window.use_skill = newUse_skill;
}
function newAttack(target) {
  return _use('attack', target);
}
function newUse_skill(skill, target, extra_args) {
  return _use(skill, target, extra_args);
}
// logging
function record(v, miss, i, attempt) {
  let value = v;
  if (v < 0) value = 0;
  samplesTimes[needle % samplesTimes.length] = value;
  needle += 1;
  if (needle % 10 === 0) {
    set(`pattack${character.id}`, samplesTimes);
    set(`pattackNeedle${character.id}`, needle);
  }
  DEBUGLOG && console.log(`Logging ${v}ms i:${i + 1}/${attempt} jsLag:${miss}ms`);
  GAMELOG && game_log(`Logging ${v}ms i:${i + 1}/${attempt} jsLag:${miss}ms`);
}
// lock functions
function lock(skill) {
  const cooldownTime = getCD(skill);
  _lock[getCDName(skill)] = cooldownTime;
  return cooldownTime;
}
function isLocked(skill) {
  const cooldownTime = getCD(skill);
  return _lock[getCDName(skill)] === cooldownTime;
}

function resetLock(skill) {
  _lock[getCDName(skill)] = 0;
  return 0;
}

// pattack logic functions
function _use(skill, target, extra_args) {
  /* enable target switching to last second */targets[skill] = { target, extra_args };
  if (!parent.next_skill) {
    return Promise.reject(new Error('Something is strange - Wait for parent.next_skill to init'));
  }
  const cooldownTime = getCD(skill);
  const allowScheduling = schedulingTiming(); // never lower than attack speed, but higher than ping, or default
  const sinceCooldownTime = mssince(cooldownTime);
  if (!cooldownTime) {
    oldUse_skill(skill, target, extra_args);
    return Promise.reject(new Error('No timer on this spell?'));
  }
  if (sinceCooldownTime < allowScheduling) {
    return Promise.reject(new Error(`cooldown: ${skill} ${sinceCooldownTime}`));
  }
  if (isLocked(skill)) return Promise.reject(new Error(`cooldown locked: ${skill}`));
  lock(skill); // lock function until attack changes, also remeber the timer which is what we compare with
  return _pTiming(skill, target, extra_args);
}

function getPTiming(cooldownTime, skill) {
  const av = avg(samplesTimes); // 50
  const st = std(samplesTimes); // 15

  const min = av - Math.max(3, safetyCoefficientSmootherer(st) * st);
  const max = av + Math.max(3, safetyCoefficientSmootherer(st) * st);

  const amin = Math.max(0, Math.min(300, min)); // make sure it's between good pings, -300 and 0, things get wierd when ping > attackspeed
  const amax = Math.max(0, Math.min(300, max));

  const spamTimeStart = cooldownTime - amax;
  const spamTimeEnd = cooldownTime - amin;

  const attemptLimit = limits[skill] || 5;
  const targetMS = 1;

  const interval = spamTimeEnd - spamTimeStart;
  const attempts = Math.floor(Math.min(interval / targetMS, attemptLimit));
  const sliceSize = interval / attempts;

  return {
    start: spamTimeStart,
    interval,
    attempts,
    sliceSize,
    meta: {
      amin, amax, av, st,
    },
  };
}
function _pTiming(skill) {
  const cooldownTime = getCD(skill).getTime();
  const pTiming = getPTiming(cooldownTime, skill);

  if (Date.now() >= cooldownTime) {
    DEBUGLOG && console.log(`Instant skip queue -  ${skill}: \tmin ${Math.floor(pTiming.meta.amin)} \tmax ${Math.floor(pTiming.meta.amax)} \tav${Math.floor(pTiming.meta.av)} \tstd${Math.floor(pTiming.meta.st)}`);
    return _use_skill(skill, targets[skill].target, targets[skill].extra_args);
  }
  const results = new Array(pTiming.attempts).fill(false);
  DEBUGLOG && console.log('Loop start \n ---------------', _lock[skill].getTime(), Date.now() - _lock[skill].getTime());
  return new Promise((resolve, reject) => {
    let trackI = 0;
    setTimeout(timer, 0);
    function timer() {
      const i = trackI;
      let nowTime = new Date().getTime();
      const inc = i * pTiming.sliceSize;
      const timing = Math.floor(pTiming.start + inc);

      const raceTimer = Math.min(3, pTiming.sliceSize) * -1;
      if (nowTime - timing < raceTimer) { // start while race when less than 2ms left OR spanPiece size, do not want to "overlap" if supposed to send with 1ms or less delay (never happens due to other constraints but as safety)
        return setTimeout(timer, 0);
      }
      trackI += 1;
      while (whileRacer && nowTime - timing < -1) { // race until exact MS, if whileLocker is enabled
        nowTime = new Date().getTime();
      }
      const value = cooldownTime - nowTime;
      _use_skill(skill, targets[skill].target, targets[skill].extra_args).then(success, fail);
      scheduleNext();
      return 0;

      function success() {
        results[i] = true;
        resolve();
        record(value, nowTime - timing, i, pTiming.attempts);
        DEBUGLOG && console.log(`Success ${skill}: \tattempt ${i + 1} out of ${results.length} sent. Maximum allowed attempts: ${limits[skill]} \tvalue ${Math.floor(value)} \t${Math.floor(inc)} MS:${pTiming.sliceSize} \tDiff ${Math.floor(pTiming.meta.amax - pTiming.meta.amin)} \tmin ${Math.floor(pTiming.meta.amin)} \tmax ${Math.floor(pTiming.meta.amax)} \tav${Math.floor(pTiming.meta.av)} \tstd${Math.floor(pTiming.meta.st)}`);
      }
      function fail(e) {
        results[i] = false;
        const isLastAttempt = i === pTiming.attempts - 1;
        const hasNoSuccessAttempts = results.findIndex((v) => !!v) === -1;
        if (isLastAttempt && hasNoSuccessAttempts && e.reason === 'cooldown') { // and no attempt succeeded
          const remaining = e.remaining || 0;
          record(value - remaining, nowTime - timing, i, pTiming.attempts);
          reattemptAttack();
          DEBUGLOG && console.log(`Failed ${skill}: \tattempt ${i + 1} out of ${results.length} sent. Maximum allowed attempts: ${limits[skill]} \tvalue ${Math.floor(value)} \t${Math.floor(inc)} MS:${pTiming.sliceSize} \tDiff ${Math.floor(pTiming.meta.amax - pTiming.meta.amin)} \tmin ${Math.floor(pTiming.meta.amin)} \tmax ${Math.floor(pTiming.meta.amax)} \tav${Math.floor(pTiming.meta.av)} \tstd${Math.floor(pTiming.meta.st)}`);
        } else if (isLastAttempt && hasNoSuccessAttempts) { // if some other reason fails
          DEBUGLOG && console.log(e);
          reattemptAttack();
        } else {

        }
      }
      function reattemptAttack() {
        setTimeout(() => {
          _use_skill(skill, targets[skill].target, targets[skill].extra_args).then(resolve, () => {
            reject();
            resetLock();
          });
        }, cooldownTime - nowTime);
      }
      function scheduleNext() {
        if (i + 1 >= pTiming.attempts) {
          return;
        }
        const nextInc = (i + 1) * pTiming.sliceSize;
        const nextTiming = Math.floor(pTiming.start + nextInc);
        if (nowTime - nextTiming < raceTimer) {
          setTimeout(timer, 0);
          return;
        }
        DEBUGLOG && console.log('Urgent', nowTime, nextTiming, raceTimer, nowTime - nextTiming);
        timer();
      }
    }
  });
}
function _use_skill(skill, target, extra_args) {
  if (skill === 'attack') { return oldAttack(target); }
  return oldUse_skill(skill, target, extra_args);
}

// init

function fixCorruptedSampleValues() {
  if (samplesTimes) {
    for (let i = 0; i < samplesTimes.length; i += 1) {
      if (typeof samplesTimes[i] !== 'number') {
        samplesTimes = undefined;
        /* cleanup if savedSample is corrupt */
        break;
      }
    }
  }
}
function loadSavedSamples() {
  const savedNeedle = get(`pattackNeedle${character.id}`);
  const savedSample = get(`pattack${character.id}`);
  needle = savedNeedle || 0;
  samplesTimes = savedSample || new Array(samples);
}

function resetSamples() {
  if (reset || !samplesTimes) {
    samplesTimes = new Array(samples); // the lower this number, the more responsive
    const spans = [Math.max(...parent.pings) * 1.5, Math.min(...parent.pings) * 1.5];
    const interval = spans[1] - spans[0];
    for (let i = 0; i < samplesTimes.length; i += 1) {
      samplesTimes[i] = Math.floor(Math.random() * interval) + spans[0];
    }
  }
}

function init() {
  loadSavedSamples();
  fixCorruptedSampleValues();
  resetSamples();
  hookAttack();
  game_log('pattack loaded');
}
init();
