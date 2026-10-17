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
    function ringOnce(){
      if(!soundEnabled||!audio||audio.state!=='running')return false;
      try{
        // A single short, low-volume bell. No prerecorded file/network access.
        const tone=audio.createOscillator(),gain=audio.createGain();
        const at=audio.currentTime;
        tone.type='sine';
        tone.frequency.setValueAtTime(880,at);
        tone.frequency.exponentialRampToValueAtTime(1100,at+0.16);
        gain.gain.setValueAtTime(0.0001,at);
        gain.gain.exponentialRampToValueAtTime(0.075,at+0.014);
        gain.gain.exponentialRampToValueAtTime(0.0001,at+0.26);
        tone.connect(gain);gain.connect(audio.destination);
        tone.onended=()=>{try{tone.disconnect();gain.disconnect();}catch{}};
        tone.start(at);tone.stop(at+0.27);
        return true;
      }catch{
        // A browser/system audio failure never changes the server's check-in.
        soundEnabled=false;
        return false;
      }
    }
    function errorTone(){
      if(!soundEnabled||!audio||audio.state!=='running')return false;
      try{
        // Distinct from success: two brief descending, low-volume error tones.
        const at=audio.currentTime;
        for(const [offset,frequency] of [[0,370],[0.15,260]]){
          const tone=audio.createOscillator(),gain=audio.createGain();
          const start=at+offset;
          tone.type='sine';
          tone.frequency.setValueAtTime(frequency,start);
          gain.gain.setValueAtTime(0.0001,start);
          gain.gain.exponentialRampToValueAtTime(0.06,start+0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001,start+0.12);
          tone.connect(gain);gain.connect(audio.destination);
          tone.onended=()=>{try{tone.disconnect();gain.disconnect();}catch{}};
          tone.start(start);tone.stop(start+0.13);
        }
        return true;
      }catch{
        soundEnabled=false;
        return false;
      }
    }
    function rejected({audible=true}={}){
      // Never increments the successful count, even for a duplicated QR.
      return Object.freeze({count,played:audible?errorTone():false});
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
      confirmed,rejected,setSound,dispose,
      get count(){return count;},
      get soundEnabled(){return soundEnabled;}
    });
  }
  root.BombaxCheckinFeedback=Object.freeze({create});
})(window);
