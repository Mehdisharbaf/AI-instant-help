import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createAudioBlob, PCM_SAMPLE_RATE } from './utils/audioUtils';
import { Visualizer } from './components/Visualizer';

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

// Icons
const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>;
const StopIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>;
const UserIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>;
const BotIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>;
const DownloadIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>;

// Types
interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  isPartial: boolean;
}

const SYSTEM_INSTRUCTION = `
You are a helpful, witty, and friendly conversational partner.
Your output language must match the user's input language.
If the user speaks Persian (Farsi), you must respond in Persian (Farsi).
If the user speaks English, respond in English.
Keep your responses concise and engaging.
IMPORTANT: The user prefers to speak at length. Allow the user to speak for as long as they want. Do not interrupt or respond immediately to short pauses. Wait until the user has clearly finished their complete thought or asks a question before responding.
`;

export default function App() {
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Refs for Audio & Connection
  const aiRef = useRef<GoogleGenAI | null>(null);
  const sessionRef = useRef<any>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);

  // Text accumulation & tracking
  const currentInputTextRef = useRef('');
  const currentOutputTextRef = useRef('');
  const activeMessageIds = useRef<{ user: string | null; model: string | null }>({ user: null, model: null });

  // Scroll helper
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Initialize AI
  useEffect(() => {
    if (process.env.API_KEY) {
      aiRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY });
    } else {
      setError("API Key is missing.");
    }
  }, []);

  const updateMessage = (role: 'user' | 'model', text: string, isFinal: boolean) => {
    // Determine target ID from ref, or generate new one if needed
    let targetId = activeMessageIds.current[role];
    
    if (!targetId && text.trim()) {
        // Generate new ID
        targetId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
        activeMessageIds.current[role] = targetId;
    }

    if (!targetId) return;

    setMessages(prev => {
      const newMessages = [...prev];
      const msgIndex = newMessages.findIndex(m => m.id === targetId);

      if (msgIndex !== -1) {
        // Update existing message by ID
        newMessages[msgIndex] = {
            ...newMessages[msgIndex],
            text,
            isPartial: !isFinal
        };
      } else {
        // Create new message
        newMessages.push({
            id: targetId!,
            role,
            text,
            isPartial: !isFinal
        });
      }
      return newMessages;
    });

    // Reset active ID if this turn is complete
    if (isFinal) {
        activeMessageIds.current[role] = null;
    }
  };

  const downloadTranscript = () => {
    if (messages.length === 0) return;
    
    const content = messages.map(msg => {
      const role = msg.role === 'user' ? 'User' : 'AI';
      return `[${role}]: ${msg.text}`;
    }).join('\n\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transcript_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const connect = async () => {
    if (!aiRef.current) return;
    setError(null);
    
    try {
      // 1. Setup Audio Context for Input
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      inputContextRef.current = new AudioContextClass({ sampleRate: PCM_SAMPLE_RATE });

      // Ensure contexts are running (handling autoplay policies)
      if (inputContextRef.current.state === 'suspended') {
        await inputContextRef.current.resume();
      }
      
      // Setup Analyser for input visualizer
      inputAnalyserRef.current = inputContextRef.current.createAnalyser();
      inputAnalyserRef.current.fftSize = 256;

      // 2. Get Microphone Stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: PCM_SAMPLE_RATE,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true
        } 
      });
      
      // 3. Connect to Gemini Live
      const sessionPromise = aiRef.current.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO], // API requires Audio modality
          inputAudioTranscription: {}, 
          outputAudioTranscription: {}, 
          systemInstruction: SYSTEM_INSTRUCTION,
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            console.log("Connected to Gemini Live");

            // Start Audio Input Processing
            if (!inputContextRef.current) return;
            
            sourceNodeRef.current = inputContextRef.current.createMediaStreamSource(stream);
            sourceNodeRef.current.connect(inputAnalyserRef.current!); 

            // Use ScriptProcessor for raw PCM data access
            processorNodeRef.current = inputContextRef.current.createScriptProcessor(4096, 1, 1);
            
            processorNodeRef.current.onaudioprocess = (e) => {
               const inputData = e.inputBuffer.getChannelData(0);
               const blob = createAudioBlob(inputData);
               
               sessionPromise.then(session => {
                 session.sendRealtimeInput({ media: blob });
               });
            };

            sourceNodeRef.current.connect(processorNodeRef.current);
            processorNodeRef.current.connect(inputContextRef.current.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Handle Text (Transcription)
            if (msg.serverContent?.inputTranscription) {
                const text = msg.serverContent.inputTranscription.text;
                if (text) {
                    currentInputTextRef.current += text;
                    updateMessage('user', currentInputTextRef.current, false);
                }
            }
            
            if (msg.serverContent?.outputTranscription) {
                const text = msg.serverContent.outputTranscription.text;
                if (text) {
                    currentOutputTextRef.current += text;
                    updateMessage('model', currentOutputTextRef.current, false);
                }
            }

            if (msg.serverContent?.turnComplete) {
                // Commit messages
                if (currentInputTextRef.current) {
                    updateMessage('user', currentInputTextRef.current, true);
                    currentInputTextRef.current = '';
                }
                if (currentOutputTextRef.current) {
                    updateMessage('model', currentOutputTextRef.current, true);
                    currentOutputTextRef.current = '';
                }
            }

            // Audio Output is IGNORED (Text Only Mode)

            // Handle Interruption
            if (msg.serverContent?.interrupted) {
                // Mark current model message as done/interrupted
                if (currentOutputTextRef.current) {
                    updateMessage('model', currentOutputTextRef.current + " ...", true);
                    currentOutputTextRef.current = '';
                }
            }
          },
          onclose: () => {
            setIsConnected(false);
            console.log("Connection closed");
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError(err.message || "Connection error. Please try again.");
            disconnect();
          }
        }
      });

      sessionRef.current = sessionPromise; 

    } catch (e: any) {
      console.error("Connection failed:", e);
      setError(e.message);
      disconnect();
    }
  };

  const disconnect = async () => {
    setIsConnected(false);
    
    // Stop Audio Contexts
    if (inputContextRef.current) {
        try { await inputContextRef.current.close(); } catch (e) { console.error(e) }
    }
    
    // Stop Tracks
    if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
    if (processorNodeRef.current) processorNodeRef.current.disconnect();
    
    // Close Session
    if (sessionRef.current) {
        const session = await sessionRef.current;
        session.close();
        sessionRef.current = null;
    }

    // Reset text buffers and active IDs
    currentInputTextRef.current = '';
    currentOutputTextRef.current = '';
    activeMessageIds.current = { user: null, model: null };
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 sm:p-6 font-['Vazirmatn','Inter',sans-serif]">
      
      {/* Main Card */}
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[85vh]">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur flex justify-between items-center">
           <div className="flex items-center gap-2">
             <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
             </div>
             <h1 className="text-xl font-bold text-white tracking-tight">Live Lingua Echo</h1>
           </div>
           
           <div className="flex items-center gap-3">
              {messages.length > 0 && (
                <button 
                    onClick={downloadTranscript}
                    className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all active:scale-95"
                    title="Download Transcript"
                >
                    <DownloadIcon />
                </button>
              )}
               <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2 transition-colors duration-300 ${isConnected ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-slate-800 text-slate-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`}></span>
                  {isConnected ? 'Connected' : 'Offline'}
               </div>
           </div>
        </div>

        {/* Transcript Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scroll-smooth" ref={scrollRef}>
          {messages.length === 0 && !isConnected && (
             <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4 opacity-60">
                <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center border border-slate-700">
                    <MicIcon />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-lg font-medium text-slate-400">Start Conversation</p>
                  <p className="text-sm text-slate-600 max-w-xs mx-auto">
                    Speak in English or Farsi. I will listen and respond instantly (Text Only).
                  </p>
                </div>
             </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-4 animate-fade-in ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center mt-1 ${msg.role === 'user' ? 'bg-blue-500/10' : 'bg-purple-500/10'}`}>
                {msg.role === 'user' ? <UserIcon /> : <BotIcon />}
              </div>
              <div 
                dir="auto" 
                className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm sm:text-base leading-relaxed shadow-sm ${
                msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none' 
                  : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700'
              } ${msg.isPartial ? 'opacity-90' : ''}`}>
                {msg.text}
                {msg.isPartial && <span className="inline-block w-1 h-4 ml-1 align-middle bg-current animate-pulse"></span>}
              </div>
            </div>
          ))}
        </div>

        {/* Controls & Visualizer */}
        <div className="p-4 sm:p-6 bg-slate-900 border-t border-slate-800 flex flex-col gap-4 shadow-2xl z-10">
           
           {/* Visualizer Area - INPUT ONLY */}
           <div className="relative h-24 bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-inner group">
              <div className="absolute inset-0 flex">
                 <div className="w-full">
                     <Visualizer isActive={isConnected} analyser={inputAnalyserRef.current} color="#60a5fa" />
                 </div>
              </div>
              {/* Labels */}
              <div className="absolute bottom-2 left-3 text-[10px] text-blue-400/70 font-mono uppercase tracking-wider flex items-center gap-1.5">
                 <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-blue-400 animate-pulse' : 'bg-slate-700'}`}></div>
                 Input (Mic)
              </div>
           </div>

           {/* Action Buttons */}
           <div className="flex items-center justify-center gap-4">
              {!isConnected ? (
                 <button 
                   onClick={connect}
                   disabled={!!error && error !== "Connection closed" && !error.includes("Connection")} 
                   className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-bold transition-all duration-200 shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] hover:-translate-y-0.5 flex items-center gap-3 overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none disabled:hover:shadow-none"
                 >
                    <span className="relative z-10 flex items-center gap-2">
                        <MicIcon />
                        Start Listening
                    </span>
                 </button>
              ) : (
                <button 
                  onClick={disconnect}
                  className="mic-pulse px-8 py-4 bg-red-500 hover:bg-red-600 text-white rounded-full font-bold transition-all duration-200 flex items-center gap-3 shadow-lg hover:shadow-red-500/30 hover:-translate-y-0.5"
                >
                   <StopIcon />
                   End Session
                </button>
              )}
           </div>
           
           {error && (
             <div className="text-red-400 text-xs text-center bg-red-950/30 p-3 rounded-lg border border-red-500/20 animate-in fade-in slide-in-from-bottom-2">
               Error: {error}
             </div>
           )}
        </div>
      </div>
    </div>
  );
}