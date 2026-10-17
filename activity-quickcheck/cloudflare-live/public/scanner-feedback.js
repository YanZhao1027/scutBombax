/* Staff-only scanner feedback. Never send QR secrets, staff IDs or personal data to sound APIs. */
(function(root){
  'use strict';
  function create({audioFactory}={}){
    let count=0, soundEnabled=false, audio=null;
    const makeAudio=audioFactory||(()=>{
      const Audio=root.AudioContext||root.webkitAudioContext;
      return Audio?new Audio():null;
    });
    async function setSound(enabled){
      if(!enabled){soundEnabled=false;return false;}
      try{
        if(!audio)audio=makeAudio();
        if(!audio)throw new Error('Web Audio unsupported');
        // This MUST be called from a real tap on the opt-in switch to meet
        // browser/WebView playback restrictions, not on page load.
        if(audio.state==='suspended')await audio.resume();
        if(audio.state!=='running')throw new Error('Audio not running');
        soundEnabled=true;
        return true;
      }catch{
        soundEnabled=false;
        return false;
      }
    }
    // Original 8-bit (square-wave) cues: no copyrighted audio assets,
    // network requests or third-party players. Avoid deep bass because small
    // phone speakers barely reproduce it. Peaks are below digital clipping.
    const chipSounds=Object.freeze({
      success:Object.freeze({
        peak:0.28,
        notes:Object.freeze([[0,880,0.13],[0.15,1320,0.19]]) // one rising chime
      }),
      failure:Object.freeze({
        peak:0.36,
        notes:Object.freeze([[0,698,0.21],[0.235,523,0.23]]) // two descending buzzes
      })
    });
    function playChipSound(kind){
      if(!soundEnabled||!audio||audio.state!=='running')return false;
      const cue=chipSounds[kind];
      if(!cue)return false;
      try{
        const at=audio.currentTime+0.006;
        for(const [offset,frequency,duration] of cue.notes){
          const tone=audio.createOscillator(),gain=audio.createGain();
          const start=at+offset;
          tone.type='square'; // distinct, audible 8-bit timbre
          tone.frequency.setValueAtTime(frequency,start);
          // Fast but smooth attack/release prevents sharp clipping clicks.
          gain.gain.setValueAtTime(0.0001,start);
          gain.gain.exponentialRampToValueAtTime(cue.peak,start+0.012);
          gain.gain.setValueAtTime(cue.peak,start+duration-0.036);
          gain.gain.exponentialRampToValueAtTime(0.0001,start+duration);
          tone.connect(gain);gain.connect(audio.destination);
          tone.onended=()=>{try{tone.disconnect();gain.disconnect();}catch{}};
          tone.start(start);tone.stop(start+duration+0.003);
        }
        return true;
      }catch{
        // Audio output failure must never alter the server's check-in result.
        soundEnabled=false;
        return false;
      }
    }
    function ringOnce(){return playChipSound('success');}
    function errorTone(){return playChipSound('failure');}
    function rejected({audible=true}={}){
      // Never increments the successful count, even for a duplicated QR.
      return Object.freeze({count,played:audible?errorTone():false});
    }
    function preview(kind,{audible=true}={}){
      // Explicit staff-only preview. No check-in API, no successful count,
      // no lastAccepted state, and no QR data.
      const played=audible
        ?kind==='success'?ringOnce():kind==='failure'?errorTone():false
        :false;
      return Object.freeze({count,played});
    }
    function confirmed({audible=true}={}){
      // Caller MUST invoke only once after a successful response from /redeem.
      ++count;
      const played=audible?ringOnce():false;
      return Object.freeze({
        count,marker:'#'+String(count).padStart(3,'0'),
        variant:count%2===0?'even':'odd',played
      });
    }
    function dispose(){
      soundEnabled=false;
      if(audio){
        try{Promise.resolve(audio.close?.()).catch(()=>{});}catch{}
        audio=null;
      }
    }
    return Object.freeze({
      confirmed,rejected,preview,setSound,dispose,
      get count(){return count;},
      get soundEnabled(){return soundEnabled;}
    });
  }
  root.BombaxCheckinFeedback=Object.freeze({create});
})(window);
