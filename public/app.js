const logElem = document.getElementById('log');
const apptList = document.getElementById('appointments');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');

// ui logging
function log(type, text) {
  const div = document.createElement('div');
  div.className = `line ${type}`;
  div.textContent = `${type === 'ai' ? 'Sarah' : 'You'}: ${text}`;
  logElem.appendChild(div);
  logElem.scrollTop = logElem.scrollHeight;
}

// fetch existing appointments
async function fetchAppointments() {
  const res = await fetch('/api/appointments');
  const { items } = await res.json();
  apptList.innerHTML = '';
  items.forEach(a => {
    const li = document.createElement('li');
    li.textContent = `${new Date(a.start_iso).toLocaleString()} - ${new Date(a.end_iso).toLocaleString()} | ${a.customer_name} ${a.customer_phone ? '(' + a.customer_phone + ')' : ''}`;
    apptList.appendChild(li);
  });
}

// manual booking form
const bookingForm = document.getElementById('bookingForm');
if (bookingForm) bookingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const start = document.getElementById('start').value;
  const end = document.getElementById('end').value;
  const notes = document.getElementById('notes').value.trim();
  const body = {
    customer_name: name,
    customer_phone: phone || undefined,
    notes: notes || undefined,
    start_iso: new Date(start).toISOString(),
    end_iso: new Date(end).toISOString()
  };
  const res = await fetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) {
    log('ai', 'All booked!');
    fetchAppointments();
  } else {
    const data = await res.json().catch(() => ({ error: 'Unknown' }));
    alert('Booking failed: ' + (data.error || res.status));
  }
});

// speech synthesis
let isSpeaking = false;
let lastAiSpokenAt = 0;
let currentUtterance = null;

function stopSpeaking() {
  try {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      isSpeaking = false;
      currentUtterance = null;
      if (statusEl) statusEl.textContent = 'Listening...';
    }
  } catch (e) {
    console.warn('Failed to stop speech:', e);
  }
}

async function speak(text) {
  if (!text || text.trim().length === 0) return;

  // gemini sometimes leaves SSML break tags in
  const cleanText = text
    .replace(/<[^>]*>/g, '')
    .replace(/break time="?[\d]+ms"?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleanText.length === 0) return;

  // Stop any existing speech
  stopSpeaking();

  const utter = new SpeechSynthesisUtterance(cleanText);
  currentUtterance = utter;
  
  const voices = window.speechSynthesis.getVoices();
  
  // prefer these if installed
  const femaleVoice = voices.find(v => 
    v.lang.startsWith('en') && (
      v.name.includes('Samantha') ||
      v.name.includes('Zira') ||
      v.name.includes('Karen') ||
      v.name.includes('Susan') ||
      v.name.includes('Victoria') ||
      v.name.includes('Fiona')
    )
  ) || voices.find(v => 
    v.lang.startsWith('en') && v.name.toLowerCase().includes('female')
  ) || voices.find(v => 
    v.lang.startsWith('en-US') && v.name.includes('Female')
  ) || voices.find(v => 
    v.lang.startsWith('en') && !v.name.toLowerCase().includes('male')
  );
  
  if (femaleVoice) {
    utter.voice = femaleVoice;
    console.log('Using voice:', femaleVoice.name);
  }
  
  utter.lang = 'en-US';
  utter.rate = 1.0;
  utter.pitch = 1.1;
  utter.volume = 0.95;

  utter.onstart = () => {
    isSpeaking = true;
    if (statusEl) statusEl.textContent = 'Speaking...';
  };

  utter.onend = () => {
    isSpeaking = false;
    lastAiSpokenAt = Date.now();
    currentUtterance = null;
    if (statusEl) statusEl.textContent = 'Listening...';
  };

  utter.onerror = (e) => {
    console.error('Speech error:', e);
    isSpeaking = false;
    currentUtterance = null;
    if (statusEl) statusEl.textContent = 'Listening...';
  };

  window.speechSynthesis.speak(utter);
}

// speech recognition
function startRecognition(onResult) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Speech recognition not supported. Use Chrome or Edge.');
    return null;
  }

  const recog = new SpeechRecognition();
  recog.lang = 'en-US';
  recog.continuous = true;
  recog.interimResults = true;

  let finalTranscript = '';
  let processingTimeout = null;

  recog.onresult = (event) => {
    let interim = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript + ' ';
      } else {
        interim += transcript;
      }
    }

    // Interrupt AI if user starts talking
    if (interim && isSpeaking) {
      stopSpeaking();
    }

    if (processingTimeout) clearTimeout(processingTimeout);

    // Process final transcript after brief pause
    if (finalTranscript.trim()) {
      processingTimeout = setTimeout(() => {
        if (!isSpeaking && Date.now() - lastAiSpokenAt > 500) {
          const text = finalTranscript.trim();
          finalTranscript = '';
          onResult(text);
        }
      }, 1000); // wait for the user to finish
    }
  };

  recog.onerror = (e) => {
    if (!['aborted', 'no-speech'].includes(e.error)) {
      console.error('Recognition error:', e);
    }
  };

  recog.onend = () => {
    if (!stopBtn.disabled && !isSpeaking) {
      setTimeout(() => {
        try {
          if (!recognition) recognition = startRecognition(onResult);
        } catch (e) {
          console.warn('Failed to restart:', e);
        }
      }, 500);
    }
  };

  try {
    recog.start();
    if (statusEl) statusEl.textContent = 'Listening...';
  } catch (e) {
    console.error('Start failed:', e);
  }

  return recog;
}

// main logic
let recognition = null;
let conversationState = { 
  pendingStartIso: null, 
  pendingEndIso: null, 
  pendingName: null
};

startBtn.addEventListener('click', () => {
  if (recognition) return;
  
  const greeting = "Hey! This is Sarah. How can I help?";
  log('ai', greeting);
  speak(greeting);

  const onResult = async (text) => {
    log('user', text);

    let intent;
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, context: conversationState })
      });
      const j = await r.json();
      intent = j.intent || { type: 'smalltalk', reply: 'Could you repeat that?' };
    } catch (err) {
      intent = { type: 'smalltalk', reply: "Sorry, didn't catch that." };
    }

    // Slot filling
    if (intent.type === 'book' && intent.start_iso && intent.end_iso) {
      conversationState.pendingStartIso = intent.start_iso;
      conversationState.pendingEndIso = intent.end_iso;
      
      if (!conversationState.pendingName) {
        const reply = "Got it! What's your name?";
        log('ai', reply);
        speak(reply);
        return;
      }
    } else if (/\b(?:for|name is|i'm|im)\s+(\w[\w\s'-]{1,30})\b/i.test(text) || intent.name) {
      const m = text.match(/\b(?:for|name is|i'm|im)\s+(\w[\w\s'-]{1,30})\b/i);
      const name = intent.name || (m ? m[1] : null);
      
      if (name) {
        conversationState.pendingName = name.trim();
        
        if (!conversationState.pendingStartIso) {
          const reply = "Thanks! What time works?";
          log('ai', reply);
          speak(reply);
          return;
        }
      }
    }

    const finalStart = intent.start_iso || conversationState.pendingStartIso;
    const finalEnd = intent.end_iso || conversationState.pendingEndIso;
    const finalName = conversationState.pendingName || 'Caller';

    // Complete booking
    if (finalStart && finalEnd && finalName) {
      try {
        const res = await fetch('/api/appointments/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_name: finalName,
            customer_phone: '',
            start_iso: finalStart,
            end_iso: finalEnd,
            notes: 'Voice booking',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          })
        });
        
        if (res.ok) {
          const time = new Date(finalStart).toLocaleString('en-US', { 
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' 
          });
          const reply = `Perfect! You're booked for ${time}.`;
          log('ai', reply);
          speak(reply);
          fetchAppointments();
          conversationState = { pendingStartIso: null, pendingEndIso: null, pendingName: null };
        } else if (res.status === 409) {
          const reply = "That time's taken. Got another?";
          log('ai', reply);
          speak(reply);
          conversationState.pendingStartIso = null;
          conversationState.pendingEndIso = null;
        } else {
          const reply = "Hmm, booking failed. Try again?";
          log('ai', reply);
          speak(reply);
        }
      } catch {
        speak("Connection issue. One more time?");
      }
    } else {
      const reply = intent.reply || "I can book appointments. What time works?";
      log('ai', reply);
      speak(reply);
    }
  };

  window.onSpeechResult = onResult;

  // Request mic
  const primeMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch {
      alert('Please allow microphone access.');
    }
  };

  primeMic().finally(() => {
    recognition = startRecognition(onResult);
  });

  startBtn.disabled = true;
  stopBtn.disabled = false;
});

stopBtn.addEventListener('click', () => {
  if (recognition) recognition.stop();
  recognition = null;
  stopSpeaking();
  
  speak("Thanks for calling!");
  
  setTimeout(() => {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Idle';
  }, 2000);
});

// voices load async in chrome
if (window.speechSynthesis.onvoiceschanged !== undefined) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

window.speechSynthesis.getVoices();

fetchAppointments();