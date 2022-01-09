// settings
const DEBUGLOG = false;
const GAMELOG = true;
const reset = false;
const safeCoefficient = 1.5; // recommended value: 1-2.5 - should be higher for low std, and lower for high std. low std= <15, high std >15
const limits = { attack: 7 }; // recommended value: 5-10 - Sends Y attacks within a interval. Should be safe up to 15, but should revise if you have a high attack speed.
const samples = 20; // recommended value: 20-100 - the higher the value, the more rigid to lag spikes. Should be safe with both 15-500.
const minimumAttackMS = 150; // recommended value: Sets the minimum attack speed overall. 100ms good.
const whileLocker = false; // experimental, if you want to block code until timing is achieved as opposed of rely on setTimeout(0)

game_log('pattack loaded');
function std(array) {
  return Math.sqrt(avg(array.map((value) => (value - avg(array)) ** 2)));
}
function avg(array) {
  return array.reduce((sum, value) => sum + value) / array.length;
}

function newAttack(target) {
  return _use('attack', target);
}
function newUse_skill(skill, target, extra_args) {
  return _use(skill, target, extra_args);
}

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
function _use(skill, target, extra_args) {
  /* enable target switching to last second */targets[skill] = { target, extra_args };
  if (!parent.next_skill) {
    return Promise.reject('Something is strange - Wait for parent.next_skill to init');
  }
  const cooldownTime = getCD(skill);
  if (!cooldownTime) {
    oldUse_skill(skill, target, extra_args); return Promise.reject('No timer on this spell?');
  }
  const sinceCooldowntime = mssince(cooldownTime);
  if (!!cooldownTime
        && timingsForAttacks[getCDName(skill)] === cooldownTime
        && sinceCooldowntime < 0) { return Promise.reject(`cooldown timed already: ${skill} ${sinceCooldowntime}`); } // if we already locked on the attack time
  const allowScheduling = -1 * Math.min((1 / character.frequency) * 1000, Math.max(Math.max(...parent.pings) * 1.5, minimumAttackMS)); // never lower than attack speed, but higher than ping, or default
  if (sinceCooldowntime < allowScheduling) {
    return Promise.reject(`cooldown: ${skill} ${sinceCooldowntime}`);
  }// if more than 100ms left say it's on cooldown
  if (timingsForAttacks[getCDName(skill)] === cooldownTime) return Promise.reject(`cooldown locked: ${skill}`);
  timingsForAttacks[getCDName(skill)] = cooldownTime; // lock function until attack changes, also remeber the timer which is what we compare with
  return _pTiming(skill, target, extra_args);
}

function _pTiming(skill) {
  const cooldownTime = getCD(skill).getTime();

  const av = avg(samplesTimes); // 50
  const st = std(samplesTimes); // 15

  const min = av - Math.max(3, safeCoefficient * st); // 50-2.5*15
  const max = av + Math.max(3, safeCoefficient * st); // 50+2.5*15

  const amin = Math.max(0, Math.min(300, min)); // make sure it's between good pings, -300 and 0, things get wierd when ping > attackspeed
  const amax = Math.max(0, Math.min(300, max));

  const spamTimeStart = cooldownTime - amax;
  const spamTimeEnd = cooldownTime - amin;

  const attemptLimit = limits[skill] || 5;
  const targetMS = 1;

  const interval = spamTimeEnd - spamTimeStart;
  const attempts = Math.floor(Math.min(interval / targetMS, attemptLimit));
  const spanPiece = interval / attempts;

  if (Date.now() >= cooldownTime) {
    DEBUGLOG && console.log(`Instant skip queue -  ${skill}: \tmin ${Math.floor(amin)} \tmax ${Math.floor(amax)} \tav${Math.floor(av)} \tstd${Math.floor(st)}`);
    return _use_skill(skill, targets[skill].target, targets[skill].extra_args);
  }
  const results = new Array(attempts);
  DEBUGLOG && console.log('Loop start \n ---------------', timingsForAttacks[skill].getTime(), Date.now() - timingsForAttacks[skill].getTime());
  return new Promise((resolve, reject) => {
    let trackI = 0;
    const timer = () => {
      const i = trackI;
      if (i >= attempts) {
        return;
      }
      let nowTime = new Date().getTime();
      const inc = i * spanPiece;
      const timing = Math.floor(spamTimeStart + inc);
      const lockTimer = Math.min(3, spanPiece) * -1;
      if (nowTime - timing < lockTimer) { // start while lock when less than 2ms left OR spanPiece size, do not want to "overlap" if supposed to send with 1ms or less delay (never happens due to other constraints but as safety)
        return setTimeout(timer, 0);
      }
      trackI++;

      while (whileLocker && nowTime - timing < -1) { // lock until exact MS.
        nowTime = new Date().getTime();
      }
      const value = cooldownTime - nowTime;
      results[i] = false;
      DEBUGLOG && console.log('I:', i, value);
      _use_skill(skill, targets[skill].target, targets[skill].extra_args).then(
        () => {
          results[i] = true;
          resolve();
          DEBUGLOG && console.log(`Success ${skill}: \tattempt ${i + 1} out of ${results.length} sent. Maximum allowed attempts: ${limits[skill]} \tvalue ${Math.floor(value)} \t${Math.floor(inc)} MS:${spanPiece} \tDiff ${Math.floor(amax - amin)} \tmin ${Math.floor(amin)} \tmax ${Math.floor(amax)} \tav${Math.floor(av)} \tstd${Math.floor(st)}`);
          record(value, nowTime - timing, i, attempts);
        },
        (e) => {
          results[i] = false;
          if (i === attempts - 1) { // if last attempt
            if (results.findIndex((v) => !!v) === -1) { // and no attempt succeeded
              if (e.reason === 'cooldown') {
                record(Math.floor(value * 0.9), nowTime - timing, i, attempts);
                DEBUGLOG && console.log(`Failed ${skill}: \tattempt ${i + 1} out of ${results.length} sent. Maximum allowed attempts: ${limits[skill]} \tvalue ${Math.floor(value)} \t${Math.floor(inc)} MS:${spanPiece} \tDiff ${Math.floor(amax - amin)} \tmin ${Math.floor(amin)} \tmax ${Math.floor(max)} \tav${Math.floor(av)} \tstd${Math.floor(st)}`);
                setTimeout(async () => {
                  try {
                    await _use_skill(skill, targets[skill].target, targets[skill].extra_args);
                    resolve();
                  } catch (e) {
                    reject();
                    timingsForAttacks[getCDName(skill)] = new Date(0).getTime();
                  }
                }, cooldownTime - nowTime);
              } else {
                DEBUGLOG && console.log(e);
              }
            }
          }
        },
      );
      const nextInc = (i + 1) * spanPiece;
      const nextTiming = Math.floor(spamTimeStart + nextInc);
      if (nowTime - nextTiming < lockTimer) {
        return setTimeout(timer, 0);
      }
      DEBUGLOG && console.log('Urgent', nowTime, nextTiming, lockTimer, nowTime - nextTiming);
      return timer();
    };
    setTimeout(timer, 0);
  });
}

function _use_skill(skill, target, extra_args) {
  if (skill === 'attack') { return oldAttack(target); }
  return oldUse_skill(skill, target, extra_args);
}

function record(v, miss, i, attempt) {
  if (v < 0) v = 0;
  samplesTimes[needle++ % samplesTimes.length] = v;
  if (needle % 10 === 0) {
    set(`pattack${character.id}`, samplesTimes);
    set(`pattackNeedle${character.id}`, needle);
  }
  DEBUGLOG && console.log(`Logging ${v}ms i:${i + 1}/${attempt} miss:${miss}ms`);
  GAMELOG && game_log(`Logging ${v}ms i:${i + 1}/${attempt} miss:${miss}ms`);
}

const timingsForAttacks = {};
const savedNeedle = get(`pattackNeedle${character.id}`);
let needle = savedNeedle || 0;
const savedSample = get(`pattack${character.id}`);
let samplesTimes = savedSample;
if (samplesTimes) {
  for (let i = 0; i < samplesTimes.length; i += 1) {
    if (typeof samplesTimes[i] !== 'number') {
      samplesTimes = undefined;
      /* cleanup if savedSample is corrupt */
      break;
    }
  }
}
if (reset || !samplesTimes) {
  samplesTimes = new Array(samples); // the lower this number, the more responsive
  const spans = [Math.max(...parent.pings) * 1.5, Math.min(...parent.pings) * 1.5];
  const interval = spans[1] - spans[0];
  for (let i = 0; i < samplesTimes.length; i++) {
    samplesTimes[i] = Math.floor(Math.random() * interval) + spans[0];
  }
}

// attack = newAttack
const targets = {}; // enable target switching to last second

!window.oldAttack && (window.oldAttack = attack); // save old attack
window.attack = newAttack;

!window.oldUse_skill && (window.oldUse_skill = use_skill); // save old attack
window.use_skill = newUse_skill;
