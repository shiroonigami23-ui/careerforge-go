import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { v4 as uuidv4 } from 'uuid';
import {
  ArrowLeft, BadgeCheck, BarChart3, BookOpenCheck, Briefcase, Check, ChevronRight, CircleAlert, ClipboardCopy, Command,
  Download, FileSearch, FileText, FileUp, HardDrive, History, KeyRound, LayoutDashboard, LifeBuoy, Link2, ListChecks,
  LogIn, LogOut, Mail, MessageSquareText, MessagesSquare, Moon, PanelLeftClose, PanelLeftOpen, Phone, Printer, RefreshCw, Search,
  Send, Server, Settings, ShieldCheck, Sparkles, Sun, Target, TrendingUp, UserRound, X, Zap,
} from 'lucide-react';
import { apiFetch, assetUrl, getEngineMode } from './engine/api.js';
import { getAiSettings, saveAiSettings, DEFAULT_GEMINI_MODEL } from './engine/llm.js';
import FitDial, { MeterRow } from './components/FitDial.jsx';
import { scoreBand } from './components/score.js';
import Emblem from './components/Emblem.jsx';
import Dropzone from './components/Dropzone.jsx';
import { reportToMarkdown, downloadText } from './reportExport.js';

const APP_NAME = 'CareerForge';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const DOC_EXT = ['pdf', 'docx', 'txt', 'md', 'epub'];
const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
const ALL_EXT = [...DOC_EXT, ...IMG_EXT];
const ACCEPT = ALL_EXT.map((e) => `.${e}`).join(',');

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'analyzer', label: 'Analyze', icon: FileSearch },
  { id: 'chats', label: 'Direct chat', icon: MessagesSquare },
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'help', label: 'Help', icon: LifeBuoy },
];

const QUICK_PROMPTS = [
  'Am I qualified for this role?',
  'What are my top 5 missing skills?',
  'Give me a 14-day plan to close the gaps.',
  'Rewrite my summary for this job.',
];

const SAMPLE = {
  quality_score: 78,
  matched: ['python', 'docker', 'kubernetes', 'ci/cd', 'postgres'],
  missing: ['terraform', 'grpc', 'observability'],
};

const extOf = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const validateFile = (file, allowed = ALL_EXT) => {
  if (!file) return 'No file selected.';
  const ext = extOf(file.name);
  if (!allowed.includes(ext)) return `.${ext || '?'} files are not supported. Use ${allowed.join(', ')}.`;
  const image = IMG_EXT.includes(ext);
  if (file.size > (image ? 5 : 10) * 1024 * 1024) return `${file.name} is too large. The limit is ${image ? 5 : 10} MB.`;
  return '';
};
const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const shortDate = (iso) => {
  const d = new Date(String(iso || '').replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const emptyProfile = (userId, email = '') => ({ user_id: userId, email, display_name: '', headline: '', bio: '', profile_image_url: '' });
const readJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch { return fallback; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function CareerForge() {
  // ---------- app state ----------
  const [view, setView] = useState('landing'); // landing | app
  const [activeTab, setActiveTab] = useState('dashboard');
  const [theme, setTheme] = useState(() => localStorage.getItem('careerforge_theme') || 'light');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [toast, setToast] = useState(null);
  const [engineMode, setEngineMode] = useState('');

  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ display_name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authUser, setAuthUser] = useState(() => readJSON('careerforge_auth_user', null));
  const [userId, setUserId] = useState(() => {
    const auth = readJSON('careerforge_auth_user', null);
    if (auth?.user_id) return auth.user_id;
    const existing = localStorage.getItem('careerforge_user_id');
    if (existing) return existing;
    const created = uuidv4();
    localStorage.setItem('careerforge_user_id', created);
    return created;
  });

  // analysis
  const [resumeFile, setResumeFile] = useState(null);
  const [jdMode, setJdMode] = useState('paste');
  const [jdText, setJdText] = useState('');
  const [jdFile, setJdFile] = useState(null);
  const [analysis, setAnalysis] = useState(null); // { sessionId, resumeName, jdName }
  const [report, setReport] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | uploading | processing | ready | error
  const [phaseError, setPhaseError] = useState('');
  const [doneRecs, setDoneRecs] = useState({});

  // assistant
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [detailed, setDetailed] = useState(false);
  const [asking, setAsking] = useState(false);

  // profile / dashboard / settings
  const [profile, setProfile] = useState(() => emptyProfile(userId));
  const [profileFile, setProfileFile] = useState(null);
  const [profileFiles, setProfileFiles] = useState([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [visitId, setVisitId] = useState('');
  const [visited, setVisited] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [aiSettings, setAiSettings] = useState(() => getAiSettings());
  const [emailTest, setEmailTest] = useState({ to: '', subject: 'CareerForge update', message: 'Your CareerForge notifications are working.' });

  // P2P
  const [localSdp, setLocalSdp] = useState('');
  const [remoteSdp, setRemoteSdp] = useState('');
  const [p2pConnected, setP2pConnected] = useState(false);
  const [p2pInput, setP2pInput] = useState('');
  const [p2pMessages, setP2pMessages] = useState([]);

  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const chatRef = useRef(null);
  const mountedRef = useRef(true);
  const googleRef = useRef(null);
  const paletteRef = useRef(null);

  const notify = useCallback((text, tone = 'ok') => {
    setToast({ text, tone, id: Date.now() });
  }, []);

  // ---------- effects ----------
  useEffect(() => {
    mountedRef.current = true; // StrictMode mounts twice: reset after the simulated unmount
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('careerforge_theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    getEngineMode().then((mode) => { if (mountedRef.current) setEngineMode(mode); });
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (analysis?.sessionId) setDoneRecs(readJSON(`careerforge_done_${analysis.sessionId}`, {}));
  }, [analysis?.sessionId]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((p) => !p);
      } else if (e.altKey && /^[1-6]$/.test(e.key)) {
        e.preventDefault();
        setView('app');
        setActiveTab(TABS[Number(e.key) - 1].id);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
        setAuthOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (paletteOpen) setTimeout(() => paletteRef.current?.focus(), 0);
  }, [paletteOpen]);

  // ---------- data ----------
  const fetchProfile = useCallback(async () => {
    try {
      const res = await apiFetch(`/profile/${userId}`);
      const data = res.ok ? await res.json() : null;
      if (!mountedRef.current) return;
      if (!data?.profile) {
        setProfile(emptyProfile(userId, authUser?.email || ''));
        setProfileFiles([]);
        return;
      }
      setProfile(data.profile);
      setProfileFiles(data.files || []);
    } catch {
      /* offline: keep what is on screen */
    }
  }, [userId, authUser?.email]);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await apiFetch(`/dashboard/${userId}`);
      const data = res.ok ? await res.json() : null;
      if (mountedRef.current) setDashboard(data && !data.error ? data : null);
    } catch {
      if (mountedRef.current) setDashboard(null);
    }
  }, [userId]);

  useEffect(() => {
    fetchProfile();
    fetchDashboard();
  }, [fetchProfile, fetchDashboard]);

  useEffect(() => {
    if (view === 'app' && activeTab === 'dashboard') fetchDashboard();
  }, [view, activeTab, fetchDashboard]);

  // The Go server analyses uploads in the background, so poll until the report is ready.
  const loadReport = useCallback(async (sid, { attempts = 40 } = {}) => {
    for (let i = 0; i < attempts; i += 1) {
      const fd = new FormData();
      fd.append('session_id', sid);
      try {
        const res = await apiFetch('/analysis/quality', { method: 'POST', body: fd });
        const data = res.ok ? await res.json() : null;
        if (data && typeof data.quality_score === 'number') return data;
      } catch {
        /* retry */
      }
      await sleep(i < 10 ? 300 : 800);
    }
    return null;
  }, []);

  // ---------- auth ----------
  const persistAuth = (payload) => {
    const next = { user_id: payload.user_id, email: payload.email || '', display_name: payload.display_name || 'User', auth_provider: payload.auth_provider || 'email' };
    localStorage.setItem('careerforge_auth_user', JSON.stringify(next));
    localStorage.setItem('careerforge_user_id', next.user_id);
    setAuthUser(next);
    setUserId(next.user_id);
    setProfile(emptyProfile(next.user_id, next.email));
    setAuthOpen(false);
    setView('app');
    notify(`Signed in as ${next.display_name}.`);
  };

  const submitAuth = async (event) => {
    event?.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const fd = new FormData();
      fd.append('email', authForm.email.trim());
      fd.append('password', authForm.password);
      if (authMode === 'signup') fd.append('display_name', authForm.display_name.trim());
      const res = await apiFetch(authMode === 'signup' ? '/auth/signup' : '/auth/login', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Sign-in failed.');
      persistAuth(data);
    } catch (error) {
      setAuthError(String(error.message || error));
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    if (!authOpen || !GOOGLE_CLIENT_ID) return;
    const render = () => {
      if (!window.google || !googleRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (!response?.credential) return;
          const fd = new FormData();
          fd.append('credential', response.credential);
          try {
            const res = await apiFetch('/auth/google', { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Google sign-in failed.');
            persistAuth(data);
          } catch (error) {
            setAuthError(String(error.message || error));
          }
        },
      });
      googleRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleRef.current, { theme: theme === 'dark' ? 'filled_black' : 'outline', size: 'large', width: 320 });
    };
    if (document.getElementById('google-identity-script')) { render(); return; }
    const s = document.createElement('script');
    s.id = 'google-identity-script';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = render;
    document.body.appendChild(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authOpen]);

  const signOut = () => {
    localStorage.removeItem('careerforge_auth_user');
    const fresh = uuidv4();
    localStorage.setItem('careerforge_user_id', fresh);
    setAuthUser(null);
    setUserId(fresh);
    setProfile(emptyProfile(fresh));
    setProfileFiles([]);
    setDashboard(null);
    resetAnalysis();
    setView('landing');
    notify('Signed out.');
  };

  // ---------- analysis ----------
  const resetAnalysis = () => {
    setResumeFile(null);
    setJdFile(null);
    setJdText('');
    setAnalysis(null);
    setReport(null);
    setPhase('idle');
    setPhaseError('');
    setMessages([]);
  };

  const pickResume = (file) => {
    const err = validateFile(file);
    if (err) { notify(err, 'warn'); return; }
    setResumeFile(file);
  };
  const pickJd = (file) => {
    const err = validateFile(file);
    if (err) { notify(err, 'warn'); return; }
    setJdFile(file);
  };

  const jdReady = jdMode === 'paste' ? jdText.trim().length > 0 : Boolean(jdFile);

  const runAnalysis = async () => {
    if (!resumeFile || !jdReady) return;
    const sid = uuidv4();
    const jdName = jdMode === 'paste' ? 'Pasted job description' : jdFile.name;
    setPhase('uploading');
    setPhaseError('');
    setReport(null);
    setMessages([]);
    setAnalysis({ sessionId: sid, resumeName: resumeFile.name, jdName });
    try {
      const fd = new FormData();
      fd.append('session_id', sid);
      fd.append('user_id', userId);
      fd.append('resume', resumeFile);
      fd.append('jd', jdMode === 'paste' ? new File([new Blob([jdText], { type: 'text/plain' })], 'job-description.txt') : jdFile);
      const res = await apiFetch('/upload', { method: 'POST', body: fd });
      const body = await res.text();
      let data = {};
      try { data = JSON.parse(body); } catch { data = { error: body }; }
      if (!res.ok || data.error) throw new Error(data.error || 'Upload failed.');
      setPhase('processing');
      const rep = await loadReport(sid);
      if (!mountedRef.current) return;
      if (!rep) throw new Error('The report is taking longer than expected. Open it later from Dashboard → Recent analyses.');
      setReport(rep);
      setPhase('ready');
      fetchDashboard();
    } catch (error) {
      if (!mountedRef.current) return;
      setPhase('error');
      setPhaseError(String(error.message || error));
    }
  };

  const openPastAnalysis = async (session) => {
    setView('app');
    setActiveTab('analyzer');
    setMessages([]);
    setAnalysis({ sessionId: session.session_id, resumeName: '', jdName: '', date: session.created_at });
    setPhase('processing');
    const rep = await loadReport(session.session_id, { attempts: 2 });
    if (!mountedRef.current) return;
    if (rep) { setReport(rep); setPhase('ready'); } else {
      setReport(null);
      setPhase('error');
      setPhaseError('This analysis is no longer available (the server keeps analyses in memory until it restarts). Run it again to get a fresh report.');
    }
  };

  const toggleRec = (rec) => {
    if (!analysis?.sessionId) return;
    const next = { ...doneRecs, [rec]: !doneRecs[rec] };
    setDoneRecs(next);
    localStorage.setItem(`careerforge_done_${analysis.sessionId}`, JSON.stringify(next));
  };

  const exportMarkdown = () => {
    downloadText(`careerforge-report-${new Date().toISOString().slice(0, 10)}.md`,
      reportToMarkdown(report, { resumeName: analysis?.resumeName, jdName: analysis?.jdName }));
    notify('Report downloaded.');
  };

  // ---------- assistant ----------
  const ask = async (text) => {
    const prompt = text.trim();
    if (!prompt || !analysis?.sessionId || asking || phase !== 'ready') return;
    const qid = Date.now();
    setMessages((m) => [...m, { id: qid, role: 'user', content: prompt, time: clock() }, { id: qid + 1, role: 'assistant', content: '', typing: true, time: clock() }]);
    setInput('');
    setAsking(true);
    const fd = new FormData();
    fd.append('session_id', analysis.sessionId);
    fd.append('prompt', detailed ? `${prompt} explain in detail` : prompt);
    try {
      const res = await apiFetch('/query', { method: 'POST', body: fd });
      const answer = await res.text();
      if (!res.ok) throw new Error(answer || 'The assistant could not answer.');
      const words = answer.split(' ');
      for (let i = 1; i <= words.length; i += Math.max(1, Math.ceil(words.length / 60))) {
        if (!mountedRef.current) return;
        const part = words.slice(0, i).join(' ');
        setMessages((m) => m.map((msg) => (msg.id === qid + 1 ? { ...msg, content: part } : msg)));
        await sleep(25);
      }
      setMessages((m) => m.map((msg) => (msg.id === qid + 1 ? { ...msg, content: answer, typing: false } : msg)));
    } catch (error) {
      setMessages((m) => m.map((msg) => (msg.id === qid + 1 ? { ...msg, content: String(error.message || error), typing: false, failed: true } : msg)));
    } finally {
      setAsking(false);
    }
  };

  // ---------- profile / settings ----------
  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      if (profileFile) {
        const err = validateFile(profileFile, IMG_EXT);
        if (err) throw new Error(err);
      }
      const fd = new FormData();
      fd.append('user_id', userId);
      fd.append('email', profile.email || '');
      fd.append('display_name', profile.display_name || 'User');
      fd.append('headline', profile.headline || '');
      fd.append('bio', profile.bio || '');
      if (profileFile) fd.append('profile_image', profileFile);
      const res = await apiFetch('/profile/upsert', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Could not save the profile.');
      setProfileFile(null);
      notify('Profile saved.');
      fetchProfile();
      fetchDashboard();
    } catch (error) {
      notify(String(error.message || error), 'warn');
    } finally {
      setProfileSaving(false);
    }
  };

  const visitProfile = async () => {
    const id = visitId.trim();
    if (!id) return;
    try {
      const res = await apiFetch(`/profile/${id}`);
      const data = res.ok ? await res.json() : null;
      if (!data?.profile) throw new Error('No profile found for that user ID.');
      setVisited({ profile: data.profile, files: data.files || [] });
    } catch (error) {
      setVisited(null);
      notify(String(error.message || error), 'warn');
    }
  };

  const saveAi = () => {
    saveAiSettings(aiSettings);
    setAiSettings(getAiSettings());
    notify('AI settings saved on this device.');
  };

  const sendTestEmail = async () => {
    try {
      const fd = new FormData();
      fd.append('to_email', emailTest.to);
      fd.append('subject', emailTest.subject);
      fd.append('message', emailTest.message);
      const res = await apiFetch('/notifications/test-email', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.error || data.ok === false) throw new Error(data.error || data.detail || 'Email could not be sent.');
      notify(`Test email sent to ${emailTest.to}.`);
    } catch (error) {
      notify(String(error.message || error), 'warn');
    }
  };

  // ---------- P2P ----------
  const wireChannel = (ch) => {
    ch.onopen = () => setP2pConnected(true);
    ch.onclose = () => setP2pConnected(false);
    ch.onmessage = (e) => setP2pMessages((m) => [...m, { role: 'peer', text: e.data, time: clock() }]);
  };
  const ensurePeer = () => {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peer.onicecandidate = () => { if (peer.localDescription) setLocalSdp(JSON.stringify(peer.localDescription)); };
    peer.onconnectionstatechange = () => setP2pConnected(['connected', 'completed'].includes(peer.connectionState));
    peer.ondatachannel = (e) => { channelRef.current = e.channel; wireChannel(e.channel); };
    peerRef.current = peer;
    return peer;
  };
  const p2pAction = async (fn) => {
    try { await fn(); } catch (error) { notify(`Connection step failed: ${error.message || error}`, 'warn'); }
  };
  const createOffer = () => p2pAction(async () => {
    const peer = ensurePeer();
    const ch = peer.createDataChannel('careerforge-p2p');
    channelRef.current = ch;
    wireChannel(ch);
    await peer.setLocalDescription(await peer.createOffer());
    setLocalSdp(JSON.stringify(peer.localDescription));
  });
  const acceptOffer = () => p2pAction(async () => {
    const peer = ensurePeer();
    await peer.setRemoteDescription(JSON.parse(remoteSdp));
    await peer.setLocalDescription(await peer.createAnswer());
    setLocalSdp(JSON.stringify(peer.localDescription));
  });
  const applyAnswer = () => p2pAction(async () => {
    if (!peerRef.current || !remoteSdp) throw new Error('Create an offer first, then paste the answer.');
    await peerRef.current.setRemoteDescription(JSON.parse(remoteSdp));
  });
  const sendP2P = () => {
    if (!p2pInput.trim() || channelRef.current?.readyState !== 'open') return;
    channelRef.current.send(p2pInput);
    setP2pMessages((m) => [...m, { role: 'you', text: p2pInput, time: clock() }]);
    setP2pInput('');
  };

  // ---------- derived ----------
  const paletteItems = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    const items = [
      ...TABS.map((t, i) => ({ id: t.id, label: `Go to ${t.label}`, icon: t.icon, hint: `Alt+${i + 1}`, run: () => { setView('app'); setActiveTab(t.id); } })),
      { id: 'new', label: 'Start a new analysis', icon: FileUp, run: () => { resetAnalysis(); setView('app'); setActiveTab('analyzer'); } },
      { id: 'theme', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: theme === 'dark' ? Sun : Moon, run: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) },
    ];
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  }, [paletteQuery, theme]);

  const displayName = authUser?.display_name || profile.display_name || 'Guest';
  const recentSessions = dashboard?.recent_sessions || [];
  const scoredSessions = recentSessions.filter((s) => typeof s.quality_score === 'number');
  const trend = scoredSessions.length >= 2 ? scoredSessions[0].quality_score - scoredSessions[1].quality_score : null;

  // ---------- render helpers ----------
  const engineBadge = () => (
    <span className="engine-badge" title={engineMode === 'device' ? 'Files and results are stored on this device' : 'Connected to a CareerForge server'}>
      {engineMode === 'device' ? <HardDrive size={14} aria-hidden="true" /> : <Server size={14} aria-hidden="true" />}
      {engineMode === 'device' ? 'On this device' : engineMode === 'server' ? 'Server' : 'Connecting'}
    </span>
  );

  const themeButton = () => (
    <button type="button" className="icon-btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );

  const keywordMap = ({ matched = [], missing = [], onAsk }) => (
    <div className="keyword-map">
      <div>
        <h4><BadgeCheck size={16} aria-hidden="true" /> In your résumé</h4>
        <div className="chips">
          {matched.length ? matched.map((k) => <span key={k} className="chip match"><Check size={13} aria-hidden="true" />{k}</span>) : <p className="muted">None of the job's main keywords were found.</p>}
        </div>
      </div>
      <div>
        <h4><CircleAlert size={16} aria-hidden="true" /> Missing from your résumé</h4>
        <div className="chips">
          {missing.length ? missing.map((k) => (
            onAsk
              ? <button type="button" key={k} className="chip gap" onClick={() => onAsk(k)} title={`Ask how to show ${k}`}><Sparkles size={13} aria-hidden="true" />{k}</button>
              : <span key={k} className="chip gap">{k}</span>
          )) : <p className="muted">No important keywords missing.</p>}
        </div>
      </div>
    </div>
  );

  // ---------- landing ----------
  const renderLanding = () => (
    <div className="landing">
      <header className="landing-bar">
        <div className="brand"><Emblem size={34} /><span>{APP_NAME}</span></div>
        <nav className="landing-actions">
          {themeButton()}
          {authUser ? (
            <button type="button" className="btn ghost" onClick={() => setView('app')}><LayoutDashboard size={16} />Open workspace</button>
          ) : (
            <button type="button" className="btn ghost" onClick={() => { setAuthMode('login'); setAuthOpen(true); }}><LogIn size={16} />Sign in</button>
          )}
        </nav>
      </header>

      <main className="landing-hero">
        <section className="hero-copy">
          <h1>Read your résumé the way the job description does.</h1>
          <p className="lede">
            Drop in your résumé and the job you want. {APP_NAME} shows which of the job's keywords you already cover,
            which ones are missing, and what to change first. Then ask the assistant to help you rewrite.
          </p>
          <div className="hero-ctas">
            <button type="button" className="btn primary lg" onClick={() => { setView('app'); setActiveTab('analyzer'); }}>
              <FileSearch size={18} />Analyze a résumé
            </button>
            {!authUser ? (
              <button type="button" className="btn ghost lg" onClick={() => { setAuthMode('signup'); setAuthOpen(true); }}>
                <UserRound size={18} />Create an account
              </button>
            ) : null}
            <button type="button" className="btn link" onClick={() => setView('app')}>Enter Workspace<ChevronRight size={16} /></button>
          </div>
          <p className="privacy-note"><ShieldCheck size={16} aria-hidden="true" />
            {engineMode === 'device' ? 'Runs on this device. Your files stay here.' : 'Your files go only to the CareerForge server you are connected to.'}
          </p>
        </section>

        <aside className="hero-sample" aria-label="Sample report">
          <div className="sample-head">
            <span className="sample-tag">Sample report</span>
            <span className="sample-role"><Briefcase size={14} aria-hidden="true" />Platform engineer</span>
          </div>
          <div className="sample-body">
            <FitDial score={SAMPLE.quality_score} size={150} />
            {keywordMap({ matched: SAMPLE.matched, missing: SAMPLE.missing })}
          </div>
          <ol className="sample-steps">
            <li>Add Terraform to the skills you used on the payments migration.</li>
            <li>Quantify the CI/CD work: build time, deploys per week.</li>
          </ol>
        </aside>
      </main>

      <section className="landing-features" aria-label="What you get">
        {[
          { icon: Target, title: 'Keyword match', text: 'Every keyword from the job, sorted into covered and missing, with coverage as a percentage.' },
          { icon: ListChecks, title: 'Section and impact checks', text: 'Skills, experience, projects and education, plus action verbs and numbers in your bullets.' },
          { icon: MessageSquareText, title: 'Rewrite with an assistant', text: 'Ask for a plan, a new summary or bullet rewrites grounded in your résumé and the job.' },
          { icon: Download, title: 'Keep the report', text: 'Download it as Markdown or print it to PDF, and track your score across versions.' },
        ].map(({ icon: Icon, title, text }) => (
          <article key={title} className="feature">
            <Icon size={22} aria-hidden="true" />
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <footer className="landing-foot">
        <span>PDF, DOCX, TXT, Markdown and EPUB up to 10 MB. Images up to 5 MB.</span>
        <span>Android, iOS, Windows and web.</span>
      </footer>
    </div>
  );

  // ---------- dashboard ----------
  const renderDashboard = () => (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Welcome{displayName !== 'Guest' ? `, ${displayName.split(' ')[0]}` : ''}</h1>
          <p className="muted">Your analyses, files and profile at a glance.</p>
        </div>
        <button type="button" className="btn primary" onClick={() => { resetAnalysis(); setActiveTab('analyzer'); }}><FileUp size={16} />New analysis</button>
      </div>

      <div className="stat-row">
        <article className="stat">
          <span className="stat-label"><BarChart3 size={16} aria-hidden="true" />Average fit</span>
          <strong>{dashboard?.analyzed_sessions ? `${dashboard.average_quality_score}` : '—'}</strong>
          <small>{dashboard?.analyzed_sessions ? `across ${dashboard.analyzed_sessions} analys${dashboard.analyzed_sessions === 1 ? 'is' : 'es'}` : 'No analyses yet'}</small>
        </article>
        <article className="stat">
          <span className="stat-label"><TrendingUp size={16} aria-hidden="true" />Latest change</span>
          <strong>{trend === null ? '—' : `${trend > 0 ? '+' : ''}${trend}`}</strong>
          <small>{trend === null ? 'Needs two analyses' : 'points versus the previous analysis'}</small>
        </article>
        <article className="stat">
          <span className="stat-label"><FileText size={16} aria-hidden="true" />Files</span>
          <strong>{dashboard?.files_count ?? 0}</strong>
          <small>{dashboard?.sessions_count ?? 0} {(dashboard?.sessions_count ?? 0) === 1 ? 'session' : 'sessions'}</small>
        </article>
        <article className="stat">
          <span className="stat-label"><UserRound size={16} aria-hidden="true" />Profile</span>
          <strong>{dashboard?.profile_completion ?? 0}%</strong>
          <small><button type="button" className="btn link sm" onClick={() => setActiveTab('profile')}>Complete profile</button></small>
        </article>
      </div>

      <div className="two-col">
        <section className="panel">
          <h2><History size={18} aria-hidden="true" />Recent analyses</h2>
          {recentSessions.length === 0 ? (
            <div className="empty">
              <FileSearch size={28} aria-hidden="true" />
              <p>Analyze a résumé against a job to see your fit score here.</p>
              <button type="button" className="btn primary sm" onClick={() => setActiveTab('analyzer')}>Analyze a résumé</button>
            </div>
          ) : (
            <ul className="history">
              {recentSessions.map((s) => (
                <li key={s.session_id}>
                  <button type="button" onClick={() => openPastAnalysis(s)}>
                    <span className={`score-pill band-${typeof s.quality_score === 'number' ? scoreBand(s.quality_score) : 'none'}`}>{s.quality_score ?? '—'}</span>
                    <span className="history-main">
                      <strong>{shortDate(s.created_at) || 'Analysis'}</strong>
                      <small>{typeof s.keyword_coverage === 'number' ? `${s.keyword_coverage}% of job keywords` : 'Report not available'}</small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2><FileText size={18} aria-hidden="true" />Recent uploads</h2>
          {(dashboard?.recent_uploads || []).length === 0 ? <p className="muted">Files you upload appear here.</p> : (
            <ul className="file-list">
              {dashboard.recent_uploads.map((f) => (
                <li key={f.file_id}>
                  {f.file_role === 'jd' ? <Briefcase size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
                  <a href={assetUrl(f.public_url)} target="_blank" rel="noreferrer">{f.original_name}</a>
                  <small>{f.file_role === 'jd' ? 'Job description' : 'Résumé'}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );

  // ---------- analyzer ----------
  const renderUploadStep = () => (
    <section className="panel upload-panel">
      <div className="upload-grid">
        <div>
          <h2><FileText size={18} aria-hidden="true" />Your résumé</h2>
          <Dropzone id="resume-upload" title={resumeFile ? 'Résumé ready' : 'Drop your résumé or click to choose'} hint="PDF, DOCX, TXT, MD, EPUB or an image" accept={ACCEPT} file={resumeFile} onFile={pickResume} />
        </div>
        <div>
          <div className="jd-head">
            <h2><Briefcase size={18} aria-hidden="true" />Job description</h2>
            <div className="segmented" role="tablist" aria-label="Job description input">
              <button type="button" role="tab" aria-selected={jdMode === 'paste'} className={jdMode === 'paste' ? 'on' : ''} onClick={() => setJdMode('paste')}>Paste</button>
              <button type="button" role="tab" aria-selected={jdMode === 'file'} className={jdMode === 'file' ? 'on' : ''} onClick={() => setJdMode('file')}>Upload</button>
            </div>
          </div>
          {jdMode === 'paste' ? (
            <textarea className="jd-text" aria-label="Job description text" value={jdText} onChange={(e) => setJdText(e.target.value)} placeholder="Paste the full job posting: responsibilities, requirements and nice-to-haves." />
          ) : (
            <Dropzone id="jd-upload" title={jdFile ? 'Job description ready' : 'Drop the job description or click to choose'} hint="Same formats as the résumé" accept={ACCEPT} file={jdFile} onFile={pickJd} icon={Briefcase} />
          )}
        </div>
      </div>
      <div className="upload-actions">
        <p className="muted">{!resumeFile ? 'Add your résumé to continue.' : !jdReady ? 'Add the job description to continue.' : 'Ready to analyze.'}</p>
        <button type="button" className="btn primary" disabled={!resumeFile || !jdReady || phase === 'uploading' || phase === 'processing'} onClick={runAnalysis}>
          {phase === 'uploading' || phase === 'processing' ? <RefreshCw size={16} className="spin" /> : <Zap size={16} />}
          {phase === 'uploading' ? 'Uploading…' : phase === 'processing' ? 'Analyzing…' : 'Analyze fit'}
        </button>
      </div>
    </section>
  );

  const renderReport = () => {
    const recs = report.recommendations || [];
    const done = recs.filter((r) => doneRecs[r]).length;
    return (
      <section className="report" aria-label="Fit report">
        <div className="report-head">
          <div>
            <h2>Fit report</h2>
            <p className="muted">
              {analysis?.resumeName ? <><FileText size={14} aria-hidden="true" /> {analysis.resumeName}</> : null}
              {analysis?.jdName ? <> <ChevronRight size={14} aria-hidden="true" /> {analysis.jdName}</> : null}
              {!analysis?.resumeName && analysis?.date ? shortDate(analysis.date) : null}
            </p>
          </div>
          <div className="report-actions no-print">
            <button type="button" className="btn ghost sm" onClick={exportMarkdown}><Download size={15} />Download</button>
            <button type="button" className="btn ghost sm" onClick={() => window.print()}><Printer size={15} />Print or PDF</button>
            <button type="button" className="btn ghost sm" onClick={resetAnalysis}><RefreshCw size={15} />New analysis</button>
          </div>
        </div>

        <div className="report-top">
          <FitDial score={report.quality_score} />
          <div className="meters">
            <MeterRow icon={Target} label="Job keywords in your résumé" value={report.keyword_coverage} />
            <MeterRow icon={BookOpenCheck} label="Section coverage" value={report.section_score} />
            <MeterRow icon={Zap} label="Action verbs" value={Math.min(report.action_verb_count, 25)} max={25} display={`${report.action_verb_count}`} />
            <MeterRow icon={BarChart3} label="Quantified results" value={Math.min(report.quantified_achievement_count, 20)} max={20} display={`${report.quantified_achievement_count}`} />
            <ul className="contact-checks" aria-label="Contact details">
              {[['email', Mail, 'Email'], ['phone', Phone, 'Phone'], ['linkedin', Link2, 'LinkedIn']].map(([k, Icon, label]) => (
                <li key={k} className={report.contact_checks?.[k] ? 'ok' : 'missing'}>
                  <Icon size={15} aria-hidden="true" />{label}{report.contact_checks?.[k] ? <Check size={14} aria-label="found" /> : <X size={14} aria-label="missing" />}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="panel">
          {keywordMap({ matched: report.matched_keywords || [], missing: report.missing_keywords || [], onAsk: (k) => ask(`How do I show ${k} experience naturally in my résumé?`) })}
        </div>

        <div className="panel">
          <h3 className="checklist-head"><ListChecks size={18} aria-hidden="true" />What to fix first <span className="muted">{recs.length ? `${done} of ${recs.length} done` : ''}</span></h3>
          {recs.length === 0 ? <p className="muted">Nothing urgent. Tailor your summary to each role.</p> : (
            <ul className="checklist">
              {recs.map((r) => (
                <li key={r}>
                  <label>
                    <input type="checkbox" checked={Boolean(doneRecs[r])} onChange={() => toggleRec(r)} />
                    <span>{r}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {(report.sections_detected || []).length ? <p className="muted small">Sections found: {report.sections_detected.join(', ')}</p> : null}
        </div>
      </section>
    );
  };

  const renderAssistant = () => (
    <section className="panel assistant no-print" aria-label="Assistant">
      <div className="assistant-head">
        <h2><MessageSquareText size={18} aria-hidden="true" />Assistant</h2>
        <div className="segmented" role="tablist" aria-label="Answer length">
          <button type="button" role="tab" aria-selected={!detailed} className={!detailed ? 'on' : ''} onClick={() => setDetailed(false)}>Brief</button>
          <button type="button" role="tab" aria-selected={detailed} className={detailed ? 'on' : ''} onClick={() => setDetailed(true)}>Detailed</button>
        </div>
      </div>
      <div className="prompt-chips">
        {QUICK_PROMPTS.map((p) => <button type="button" key={p} className="chip prompt" disabled={phase !== 'ready' || asking} onClick={() => ask(p)}>{p}</button>)}
      </div>
      <div className="chat" ref={chatRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="muted chat-empty">{phase === 'ready' ? 'Ask about your fit, missing skills or a rewrite.' : 'The assistant is ready once your report is.'}</p>
        ) : messages.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.failed ? 'failed' : ''}`}>
            <div className="msg-bubble">
              {m.role === 'assistant' ? <ReactMarkdown>{m.content || '…'}</ReactMarkdown> : <p>{m.content}</p>}
              {m.role === 'assistant' && !m.typing && m.content ? (
                <button type="button" className="copy" onClick={() => { navigator.clipboard?.writeText(m.content); notify('Answer copied.'); }} aria-label="Copy answer"><ClipboardCopy size={14} /></button>
              ) : null}
            </div>
            <small>{m.time}</small>
          </div>
        ))}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <textarea
          aria-label="Ask the assistant"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
          placeholder={phase === 'ready' ? 'Ask about fit, gaps, rewrites, ATS…' : 'Run an analysis first'}
          disabled={phase !== 'ready'}
        />
        <button type="submit" className="btn primary icon-only" disabled={!input.trim() || phase !== 'ready' || asking} aria-label="Send"><Send size={17} /></button>
      </form>
    </section>
  );

  const renderAnalyzer = () => (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Analyze</h1>
          <p className="muted">Compare one résumé with one job description.</p>
        </div>
        {engineBadge()}
      </div>
      {phase === 'idle' || phase === 'error' ? renderUploadStep() : null}
      {phase === 'error' ? <p className="callout warn"><CircleAlert size={16} aria-hidden="true" />{phaseError}</p> : null}
      {phase === 'uploading' || phase === 'processing' ? (
        <div className="panel working" role="status">
          <RefreshCw size={22} className="spin" aria-hidden="true" />
          <div>
            <strong>Insights in progress</strong>
            <p className="muted">{phase === 'uploading' ? 'Uploading your files…' : 'Reading the résumé and the job description…'}</p>
          </div>
        </div>
      ) : null}
      {phase === 'ready' && report ? (
        <>
          <p className="status-line"><BadgeCheck size={16} aria-hidden="true" />Insights ready</p>
          <div className="analyzer-grid">
            {renderReport()}
            {renderAssistant()}
          </div>
        </>
      ) : null}
    </section>
  );

  // ---------- direct chat ----------
  const renderP2P = () => (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Direct chat</h1>
          <p className="muted">Chat with a mentor or friend device-to-device. Messages are not stored on any server.</p>
        </div>
        <span className={`engine-badge ${p2pConnected ? 'ok' : ''}`}><Link2 size={14} aria-hidden="true" />{p2pConnected ? 'Connected' : 'Not connected'}</span>
      </div>
      <div className="steps">
        <article className="panel step">
          <h3>1. Start</h3>
          <p className="muted">One person creates an invite and sends the code below.</p>
          <button type="button" className="btn primary sm" onClick={createOffer}>Create invite</button>
        </article>
        <article className="panel step">
          <h3>2. Reply</h3>
          <p className="muted">The other person pastes the invite and sends back the reply code.</p>
          <button type="button" className="btn ghost sm" onClick={acceptOffer} disabled={!remoteSdp}>Create reply from invite</button>
        </article>
        <article className="panel step">
          <h3>3. Connect</h3>
          <p className="muted">The first person pastes the reply code to connect.</p>
          <button type="button" className="btn ghost sm" onClick={applyAnswer} disabled={!remoteSdp}>Connect with reply</button>
        </article>
      </div>
      <div className="two-col">
        <label className="field">Your code (send this)
          <textarea className="code-box" value={localSdp} readOnly />
          <button type="button" className="btn link sm" disabled={!localSdp} onClick={() => { navigator.clipboard?.writeText(localSdp); notify('Code copied.'); }}><ClipboardCopy size={14} />Copy code</button>
        </label>
        <label className="field">Their code (paste here)
          <textarea className="code-box" value={remoteSdp} onChange={(e) => setRemoteSdp(e.target.value)} />
        </label>
      </div>
      <section className="panel">
        <div className="chat short">
          {p2pMessages.length === 0 ? <p className="muted chat-empty">Messages appear here once you are connected.</p> : p2pMessages.map((m, i) => (
            <div key={`${m.time}-${i}`} className={`msg ${m.role === 'you' ? 'user' : 'assistant'}`}><div className="msg-bubble"><p>{m.text}</p></div><small>{m.time}</small></div>
          ))}
        </div>
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); sendP2P(); }}>
          <input aria-label="Message" value={p2pInput} onChange={(e) => setP2pInput(e.target.value)} placeholder={p2pConnected ? 'Type a message' : 'Connect first'} disabled={!p2pConnected} />
          <button type="submit" className="btn primary icon-only" disabled={!p2pConnected || !p2pInput.trim()} aria-label="Send"><Send size={17} /></button>
        </form>
      </section>
    </section>
  );

  // ---------- profile ----------
  const setField = (k) => (e) => setProfile((p) => ({ ...p, [k]: e.target.value }));
  const renderProfile = () => (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Profile</h1>
          <p className="muted">What other people see when they open your profile.</p>
        </div>
        <button type="button" className="btn primary" onClick={saveProfile} disabled={profileSaving}>{profileSaving ? <RefreshCw size={16} className="spin" /> : <Check size={16} />}Save profile</button>
      </div>
      <div className="profile-layout">
        <section className="panel profile-card">
          {profile.profile_image_url ? <img src={assetUrl(profile.profile_image_url)} alt="" className="avatar" /> : <div className="avatar placeholder"><UserRound size={40} aria-hidden="true" /></div>}
          <label className="btn ghost sm file-btn">
            <FileUp size={15} />{profileFile ? profileFile.name : 'Change photo'}
            <input type="file" className="sr-only" accept={IMG_EXT.map((e) => `.${e}`).join(',')} onChange={(e) => setProfileFile(e.target.files?.[0] || null)} />
          </label>
          <p className="muted small">JPG, PNG, WebP, GIF or BMP up to 5 MB. A new photo replaces the old one.</p>
          <div className="id-row">
            <small className="muted">Your user ID</small>
            <code>{userId}</code>
            <button type="button" className="icon-btn" aria-label="Copy user ID" onClick={() => { navigator.clipboard?.writeText(userId); notify('User ID copied.'); }}><ClipboardCopy size={15} /></button>
          </div>
        </section>
        <section className="panel form-grid">
          <label className="field">Name<input value={profile.display_name || ''} onChange={setField('display_name')} placeholder="Your full name" /></label>
          <label className="field">Email<input type="email" value={profile.email || ''} onChange={setField('email')} placeholder="you@example.com" /></label>
          <label className="field wide">Headline<input value={profile.headline || ''} onChange={setField('headline')} placeholder="Backend engineer, Go and distributed systems" /></label>
          <label className="field wide">About<textarea value={profile.bio || ''} onChange={setField('bio')} placeholder="Two or three sentences about what you do and what you are looking for." /></label>
        </section>
      </div>
      <div className="two-col">
        <section className="panel">
          <h2><FileText size={18} aria-hidden="true" />Your files</h2>
          {profileFiles.length === 0 ? <p className="muted">No files yet.</p> : (
            <ul className="file-list">
              {profileFiles.map((f) => (
                <li key={f.file_id}><FileText size={16} aria-hidden="true" /><a href={assetUrl(f.public_url)} target="_blank" rel="noreferrer">{f.original_name}</a><small>{(f.size_bytes / 1024 / 1024).toFixed(2)} MB</small></li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2><Search size={18} aria-hidden="true" />Look up a profile</h2>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); visitProfile(); }}>
            <input aria-label="User ID" value={visitId} onChange={(e) => setVisitId(e.target.value)} placeholder="Paste a user ID" />
            <button type="submit" className="btn ghost sm" disabled={!visitId.trim()}>Open</button>
          </form>
          {visited ? (
            <div className="visited">
              <strong>{visited.profile.display_name || 'User'}</strong>
              <p className="muted">{visited.profile.headline || 'No headline'}</p>
              <p>{visited.profile.bio}</p>
              <ul className="file-list">{visited.files.map((f) => <li key={f.file_id}><FileText size={16} aria-hidden="true" /><a href={assetUrl(f.public_url)} target="_blank" rel="noreferrer">{f.original_name}</a></li>)}</ul>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );

  // ---------- settings ----------
  const renderSettings = () => (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">AI, appearance, notifications and your account.</p>
        </div>
        {engineBadge()}
      </div>
      <section className="panel">
        <h2><KeyRound size={18} aria-hidden="true" />AI settings</h2>
        <p className="muted">
          {engineMode === 'device'
            ? 'Add a free Gemini API key for AI answers and reading text from images. Without one you still get the full report and built-in coaching answers. The key is stored only on this device.'
            : 'You are connected to a CareerForge server, which uses its own AI setup. This key is only used when the app runs on this device.'}
        </p>
        <div className="form-grid">
          <label className="field">Gemini API key<input type="password" autoComplete="off" value={aiSettings.apiKey} onChange={(e) => setAiSettings((s) => ({ ...s, apiKey: e.target.value }))} placeholder="AIza…" /></label>
          <label className="field">Model<input value={aiSettings.model} onChange={(e) => setAiSettings((s) => ({ ...s, model: e.target.value }))} placeholder={DEFAULT_GEMINI_MODEL} /></label>
        </div>
        <div className="row-actions">
          <button type="button" className="btn primary sm" onClick={saveAi}><Check size={15} />Save AI settings</button>
          <a className="btn link sm" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Get a free key</a>
        </div>
      </section>
      <section className="panel">
        <h2>{theme === 'dark' ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}Appearance</h2>
        <div className="segmented" role="tablist" aria-label="Theme">
          <button type="button" role="tab" aria-selected={theme === 'light'} className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}><Sun size={14} />Light</button>
          <button type="button" role="tab" aria-selected={theme === 'dark'} className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}><Moon size={14} />Dark</button>
        </div>
      </section>
      {engineMode === 'server' ? (
        <section className="panel">
          <h2><Mail size={18} aria-hidden="true" />Email notifications</h2>
          <p className="muted">Send a test email to check the server's mail setup.</p>
          <div className="form-grid">
            <label className="field">To<input type="email" value={emailTest.to} onChange={(e) => setEmailTest((s) => ({ ...s, to: e.target.value }))} placeholder="you@example.com" /></label>
            <label className="field">Subject<input value={emailTest.subject} onChange={(e) => setEmailTest((s) => ({ ...s, subject: e.target.value }))} /></label>
          </div>
          <button type="button" className="btn ghost sm" disabled={!emailTest.to} onClick={sendTestEmail}><Send size={15} />Send test email</button>
        </section>
      ) : null}
      <section className="panel">
        <h2><ShieldCheck size={18} aria-hidden="true" />Account and data</h2>
        <p className="muted">
          {engineMode === 'device'
            ? 'Your account, files and analyses are stored in this app on this device. Only text you send to Gemini (when a key is set) leaves the device.'
            : 'Your account, files and analyses are stored on the CareerForge server you are connected to.'}
        </p>
        <div className="row-actions">
          {authUser
            ? <button type="button" className="btn ghost sm" onClick={signOut}><LogOut size={15} />Sign out of {authUser.email || authUser.display_name}</button>
            : <button type="button" className="btn primary sm" onClick={() => { setAuthMode('signup'); setAuthOpen(true); }}><UserRound size={15} />Create an account</button>}
        </div>
      </section>
    </section>
  );

  // ---------- help ----------
  const renderHelp = () => (
    <section className="page">
      <div className="page-head"><div><h1>Help</h1><p className="muted">How CareerForge reads your résumé and what the numbers mean.</p></div></div>
      <div className="help-grid">
        {[
          { icon: Target, q: 'What is the fit score?', a: 'A 0–100 score: 45% keyword coverage, 25% section coverage, plus points for action verbs (up to 25) and numbers in your bullets (up to 20). 75 and above is a strong match.' },
          { icon: Search, q: 'How are keywords chosen?', a: 'The most frequent meaningful words in the job description (filler such as “experience” or “team” is ignored). Coverage is the share of them that also appear in your résumé.' },
          { icon: FileText, q: 'Which files work?', a: 'PDF, DOCX, TXT, Markdown and EPUB up to 10 MB. JPG, PNG, WebP, GIF and BMP up to 5 MB; images need a Gemini key on the device.' },
          { icon: BookOpenCheck, q: 'Why is my section score low?', a: 'Use clear headings such as Skills, Experience, Projects and Education, each on its own line.' },
          { icon: Command, q: 'Keyboard shortcuts', a: 'Ctrl/⌘+K opens quick navigation. Alt+1 to Alt+6 switch sections. Enter sends a message, Shift+Enter adds a line.' },
          { icon: ShieldCheck, q: 'Where is my data?', a: engineMode === 'device' ? 'On this device, inside the app.' : 'On the CareerForge server you are connected to.' },
        ].map(({ icon: Icon, q, a }) => (
          <article key={q} className="panel help-item"><h3><Icon size={18} aria-hidden="true" />{q}</h3><p>{a}</p></article>
        ))}
      </div>
    </section>
  );

  // ---------- shell ----------
  const authModal = authOpen ? (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={authMode === 'signup' ? 'Create an account' : 'Sign in'} onMouseDown={(e) => { if (e.target === e.currentTarget) setAuthOpen(false); }}>
      <form className="modal" onSubmit={submitAuth}>
        <div className="modal-head">
          <div className="brand"><Emblem size={28} /><span>{authMode === 'signup' ? 'Create your account' : 'Sign in'}</span></div>
          <button type="button" className="icon-btn" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={18} /></button>
        </div>
        {authMode === 'signup' ? <label className="field">Name<input value={authForm.display_name} onChange={(e) => setAuthForm((f) => ({ ...f, display_name: e.target.value }))} autoComplete="name" /></label> : null}
        <label className="field">Email<input type="email" required value={authForm.email} onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value }))} autoComplete="email" /></label>
        <label className="field">Password<input type="password" required minLength={authMode === 'signup' ? 6 : undefined} value={authForm.password} onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} /></label>
        {authMode === 'signup' ? <p className="muted small">At least 6 characters.</p> : null}
        {authError ? <p className="callout warn"><CircleAlert size={16} aria-hidden="true" />{authError}</p> : null}
        <button type="submit" className="btn primary block" disabled={authLoading}>{authLoading ? <RefreshCw size={16} className="spin" /> : <LogIn size={16} />}{authMode === 'signup' ? 'Create account' : 'Sign in'}</button>
        {GOOGLE_CLIENT_ID ? <div className="google-slot" ref={googleRef} /> : null}
        <p className="muted small center">
          {authMode === 'signup' ? 'Already have an account? ' : 'New to CareerForge? '}
          <button type="button" className="btn link sm" onClick={() => { setAuthError(''); setAuthMode(authMode === 'signup' ? 'login' : 'signup'); }}>{authMode === 'signup' ? 'Sign in' : 'Create an account'}</button>
        </p>
      </form>
    </div>
  ) : null;

  const toastEl = toast ? <div key={toast.id} className={`toast ${toast.tone}`} role="status">{toast.tone === 'ok' ? <Check size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}{toast.text}</div> : null;

  if (view === 'landing') {
    return <>{renderLanding()}{authModal}{toastEl}</>;
  }

  const current = TABS.find((t) => t.id === activeTab);
  return (
    <div className={`shell ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <aside className="side-nav" aria-label="Main navigation">
        <div className="side-brand">
          <button type="button" className="brand plain" onClick={() => setView('landing')} title="Back to the start page"><Emblem size={30} /><span>{APP_NAME}</span></button>
          <button type="button" className="icon-btn side-toggle" onClick={() => setSidebarCollapsed((c) => !c)} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <nav>
          {TABS.map((t) => (
            <button type="button" key={t.id} className={activeTab === t.id ? 'active' : ''} aria-current={activeTab === t.id ? 'page' : undefined} onClick={() => setActiveTab(t.id)} title={t.label}>
              <t.icon size={18} aria-hidden="true" /><span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          {authUser ? (
            <button type="button" className="account" onClick={() => setActiveTab('settings')} title="Account settings">
              <span className="account-initial">{(authUser.display_name || 'U').slice(0, 1).toUpperCase()}</span>
              <span className="account-text"><strong>{authUser.display_name}</strong><small>{authUser.email}</small></span>
            </button>
          ) : (
            <button type="button" className="btn ghost sm block" onClick={() => { setAuthMode('login'); setAuthOpen(true); }}><LogIn size={15} /><span>Sign in</span></button>
          )}
        </div>
      </aside>

      <header className="top-bar">
        <button type="button" className="icon-btn mobile-only" onClick={() => setView('landing')} aria-label="Back to the start page"><ArrowLeft size={18} /></button>
        <h2 className="top-title">{current?.label}</h2>
        <div className="top-actions">
          <button type="button" className="palette-btn" onClick={() => setPaletteOpen(true)}><Search size={15} aria-hidden="true" /><span>Search or jump</span><kbd>Ctrl K</kbd></button>
          {themeButton()}
          {authUser ? <button type="button" className="icon-btn" onClick={signOut} aria-label="Sign out"><LogOut size={18} /></button> : null}
        </div>
      </header>

      <main className="main">
        {activeTab === 'dashboard' ? renderDashboard() : null}
        {activeTab === 'analyzer' ? renderAnalyzer() : null}
        {activeTab === 'chats' ? renderP2P() : null}
        {activeTab === 'profile' ? renderProfile() : null}
        {activeTab === 'settings' ? renderSettings() : null}
        {activeTab === 'help' ? renderHelp() : null}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {TABS.filter((t) => t.id !== 'help').map((t) => (
          <button type="button" key={t.id} className={activeTab === t.id ? 'active' : ''} onClick={() => setActiveTab(t.id)}>
            <t.icon size={20} aria-hidden="true" /><span>{t.label}</span>
          </button>
        ))}
      </nav>

      {paletteOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Quick navigation" onMouseDown={(e) => { if (e.target === e.currentTarget) setPaletteOpen(false); }}>
          <div className="modal palette">
            <div className="palette-input"><Search size={17} aria-hidden="true" /><input ref={paletteRef} value={paletteQuery} onChange={(e) => setPaletteQuery(e.target.value)} placeholder="Type a section or action" aria-label="Search" onKeyDown={(e) => { if (e.key === 'Enter' && paletteItems[0]) { paletteItems[0].run(); setPaletteOpen(false); setPaletteQuery(''); } }} /></div>
            <ul>
              {paletteItems.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => { item.run(); setPaletteOpen(false); setPaletteQuery(''); }}>
                    <item.icon size={16} aria-hidden="true" /><span>{item.label}</span>{item.hint ? <kbd>{item.hint}</kbd> : null}
                  </button>
                </li>
              ))}
              {paletteItems.length === 0 ? <li className="muted pad">Nothing matches.</li> : null}
            </ul>
          </div>
        </div>
      ) : null}
      {authModal}
      {toastEl}
    </div>
  );
}
