//settings
const DEBUGLOG=true;
const reset=false
const timingsForAttacks = {};
const safeCoefficient = 2 //should be higher for low std, and lower for high std. low std= <15, high std >15
const limits = {attack:7} //should be safe up to 15. 
const samples = 50 //the higher the more rigid to lag spikes.


game_log("pattack loaded")


const savedNeedle = get('pattackNeedle' + character.id);
var needle = savedNeedle || 0
const savedSample = get('pattack' + character.id)
var samplesTimes = savedSample
if (samplesTimes) {
    for(var i=0; i<samplesTimes.length;i++){
        if (typeof samplesTimes[i] !== 'number') {
            samplesTimes=undefined;
            /*cleanup if savedSample is corrupt*/
            break;
        }
    }
}
if (reset || !samplesTimes) {
    samplesTimes = new Array(samples) //the lower this number, the more responsive 
    const spans = [-1*60, -1*30]
    const interval = spans[1] - spans[0]
    for(let i = 0; i < 100; i++) {
        samplesTimes[i] = Math.floor(Math.random() * interval) + spans[0]
    }
}

//attack = newAttack
const targets = {}; //enable target switching to last second


function newAttack(target) {
    return _use("attack",target)
}
function newUse_skill(skill,target,extra_args) {
    return _use(skill,target,extra_args)
}

const sharedCD= {
    //use skill, main tracker
    "regen_hp": "use_hp",
    "regen_mp": "use_mp", 
    "3shot": "attack",
    "5shot": "attack"
}

function _use(skill,target,extra_args) {
    /*enable target switching to last second*/targets[skill]=target;
    if (!parent.next_skill) {
        return Promise.reject("Something is strange - Wait for parent.next_skill to init")
    }
    let sharedcd = skill;
    if (sharedCD[skill]) sharedcd=sharedCD[skill];
    if (!parent.next_skill[sharedcd]) { oldUse_skill(skill,target,extra_args); return Promise.reject("No timer on this spell?")
}
    if (!!parent.next_skill[sharedcd] && 
        timingsForAttacks[sharedcd] === parent.next_skill[sharedcd] && 
        mssince(parent.next_skill[sharedcd]) < 0) 
        return Promise.reject("cooldown: "+skill+ " "+mssince(parent.next_skill[sharedcd])) //if we already timed on the attack time
    if (mssince(parent.next_skill[sharedcd]) < -700) {
        return Promise.reject("cooldown: "+skill+ " "+mssince(parent.next_skill[sharedcd])) 
    }//if more than 100ms left say it's on cooldown
    timingsForAttacks[sharedcd] = parent.next_skill[sharedcd] //lock function until attack changes, also remeber the timer which is what we compare with
    return _pTiming(skill,target,extra_args)
}

!window.oldAttack && (window.oldAttack = attack) //save old attack
window.attack = newAttack

!window.oldUse_skill && (window.oldUse_skill = use_skill) //save old attack
window.use_skill = newUse_skill

function _pTiming(skill,target,extra_args) {
    const nowTime = new Date().getTime()
    
    sharedCD[skill] && skill = sharedCD[skill] 

    const cooldownTime = parent.next_skill[skill].getTime()
    const av = avg(samplesTimes)
    const st = std(samplesTimes)

    const min = av - st; 
    const max = av + st

    const amin = Math.min(0, Math.max(-300, (min - (safeCoefficient*st)))) //make sure it's between good pings, -300 and 0, things get wierd when ping > attackspeed
    const amax = Math.min(0, (max + (safeCoefficient*st))) 

    const spamTimeStart = cooldownTime + amin
    const spamTimeEnd = cooldownTime + amax
    
    const attemptLimit = limits[skill] || 5
    const targetMS = 2

    const interval = (st*2*safeCoefficient)
    const attempts = Math.round(Math.min(interval/targetMS,attemptLimit))
    const spanPiece = interval / attempts

    if (nowTime > cooldownTime) {
		DEBUGLOG && console.log(`Instant skip queue -  ${skill}: \tmin ${Math.floor(min)} \tmax ${Math.floor(max)} \tav${Math.floor(av)} \tstd${Math.floor(st)}`)
        return _use_skill(skill,targets[skill],extra_args)
    }
    var results = new Array(attempts)
	return new Promise((resolve,reject) => {
    for (let i = 0; i < results.length; i++) {       
        const inc = i * spanPiece
        const timing = (spamTimeStart + inc)
        const value = (cooldownTime-timing) * -1
        const timeout = timing-nowTime
        const cb = async () => {
            try {
                results[i] = await _use_skill(skill,targets[skill],extra_args)
                resolve();
                DEBUGLOG && console.log(`Success ${skill}: \tattempt ${i} out of ${results.length} sent. Maximum allowed attempts: ${limits[skill]} \tvalue ${Math.floor(value)} \t(ADJUSTED FROM ${Math.floor(timeout)}) \t${Math.floor(inc)} MS:${spanPiece} \tDiff ${Math.floor(max - min)} \tmin ${Math.floor(min)} \tmax ${Math.floor(max)} \tav${Math.floor(av)} \tstd${Math.floor(st)}`)
                record(value)
                results[i] = true
            } catch (e) {
                results[i] = false
                if (i === attempts - 1) { //if last attempt
                    if (results.findIndex(v => v) === -1) {//and no attempt succeeded 
                        if (e.reason === 'cooldown') {
                            reject();
                            record(value)
                        }
                        timingsForAttacks[skill] = new Date(0);
                    }
                }
            }
        }
        setTimeout(cb,timeout)
        results[i]=cb
    }
    })
}


function _use_skill(skill,target,extra_args) {
    if (skill === "attack")
        return oldAttack(target);
    return oldUse_skill(skill,target,extra_args)
}

function record(v) {
    samplesTimes[needle++ % samplesTimes.length] = v
    if (needle % 10 === 0) {
        set('pattack' + character.id, samplesTimes)
        set('pattackNeedle' + character.id, needle)
    }
}


function std(array) {
    return Math.sqrt(avg(array.map(value => (value - avg(array)) ** 2)))
}
function avg(array) {
    return array.reduce((sum, value) => sum + value) / array.length
}
