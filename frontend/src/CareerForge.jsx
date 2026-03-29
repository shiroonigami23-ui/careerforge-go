import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { v4 as uuidv4 } from 'uuid';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const APP_DISPLAY_NAME = 'CareerForge';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const DOC_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'epub'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
const RESUME_EXTENSIONS = [...DOC_EXTENSIONS, ...IMAGE_EXTENSIONS];
const JD_EXTENSIONS = [...DOC_EXTENSIONS, ...IMAGE_EXTENSIONS];
const DOC_LIMIT_BYTES = 10 * 1024 * 1024;
const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'analyzer', label: 'Resume Lab' },
  { id: 'chats', label: 'Direct Chat' },
  { id: 'profile', label: 'Profile' },
  { id: 'help', label: 'Help' },
];
const TAB_SHORTCUTS = { 1: 'dashboard', 2: 'analyzer', 3: 'chats', 4: 'profile', 5: 'help' };

const QUICK_PROMPTS = [
  'Am I qualified for this role?',
  'What are my top 5 missing skills?',
  'Give me a 14-day roadmap to close gaps.',
  'Rewrite my summary for this job.',
];

const extensionOf = (filename) => {
  const parts = (filename || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
};

const validateFile = (file, allowedExtensions) => {
  if (!file) return 'No file selected.';
  const ext = extensionOf(file.name);
  if (!allowedExtensions.includes(ext)) return `Unsupported file type: ${ext || 'unknown'}`;
  const limit = IMAGE_EXTENSIONS.includes(ext) ? IMAGE_LIMIT_BYTES : DOC_LIMIT_BYTES;
  if (file.size > limit) return `File too large for .${ext}. Max ${IMAGE_EXTENSIONS.includes(ext) ? 5 : 10}MB.`;
  return '';
};

const inferMissingKeywords = (jdText, messages) => {
  const text = `${jdText || ''} ${(messages || []).map((m) => m.content).join(' ')}`.toLowerCase();
  const base = ['aws', 'flask', 'react', 'testing', 'sql', 'docker', 'communication', 'system design'];
  return base.filter((keyword) => !text.includes(keyword)).slice(0, 5);
};

const computeScore = (messages) => {
  if (!messages.length) return 0;
  const joined = messages.map((m) => m.content.toLowerCase()).join(' ');
  if (joined.includes('not qualified') || joined.includes('major gap')) return 52;
  if (joined.includes('strong') || joined.includes('qualified')) return 84;
  return 73;
};

const formatClock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const createDefaultProfile = (userId, email = '') => ({ user_id: userId, email, display_name: 'Your Name', headline: '', bio: '', profile_image_url: '' });

const CareerForge = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showAuth, setShowAuth] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [authLoading, setAuthLoading] = useState(false);
  const [authForm, setAuthForm] = useState({ display_name: '', email: '', password: '' });
  const [authUser, setAuthUser] = useState(() => {
    const raw = localStorage.getItem('careerforge_auth_user');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  });

  const [resumeFile, setResumeFile] = useState(null);
  const [jdFile, setJdFile] = useState(null);
  const [jdText, setJdText] = useState('');
  const [jobDescription, setJobDescription] = useState(null);
  const [showJdModal, setShowJdModal] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [navQuery, setNavQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showGuide, setShowGuide] = useState(() => localStorage.getItem('careerforge_hide_guide') !== '1');

  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [responseMode, setResponseMode] = useState('brief');
  const [isLoading, setIsLoading] = useState(false);

  const [errorText, setErrorText] = useState('');
  const [userId, setUserId] = useState(() => {
    if (authUser?.user_id) return authUser.user_id;
    const existing = localStorage.getItem('careerforge_user_id');
    if (existing) return existing;
    const created = uuidv4();
    localStorage.setItem('careerforge_user_id', created);
    return created;
  });

  const [profile, setProfile] = useState(() => createDefaultProfile(userId, authUser?.email || ''));
  const [profileFile, setProfileFile] = useState(null);
  const [profileFiles, setProfileFiles] = useState([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [visitUserId, setVisitUserId] = useState('');
  const [visitedProfile, setVisitedProfile] = useState(null);
  const [visitedFiles, setVisitedFiles] = useState([]);
  const [isVisitingProfile, setIsVisitingProfile] = useState(false);
  const [dashboardData, setDashboardData] = useState(null);
  const [qualityReport, setQualityReport] = useState(null);
  const [emailTest, setEmailTest] = useState({ to: '', subject: 'CareerForge Update', message: 'Your profile and notifications are active.' });
  const [emailStatus, setEmailStatus] = useState('');

  const [localSdp, setLocalSdp] = useState('');
  const [remoteSdp, setRemoteSdp] = useState('');
  const [p2pConnected, setP2pConnected] = useState(false);
  const [p2pInput, setP2pInput] = useState('');
  const [p2pMessages, setP2pMessages] = useState([]);

  const peerRef = useRef(null);
  const dataChannelRef = useRef(null);
  const chatContainerRef = useRef(null);
  const mountedRef = useRef(true);
  const googleButtonRef = useRef(null);
  const commandInputRef = useRef(null);

  const missingKeywords = useMemo(() => inferMissingKeywords(jobDescription?.content || jdText, messages), [jobDescription?.content, jdText, messages]);
  const score = useMemo(() => computeScore(messages), [messages]);
  const filteredTabs = useMemo(() => {
    const query = navQuery.trim().toLowerCase();
    if (!query) return TABS;
    return TABS.filter((tab) => tab.label.toLowerCase().includes(query));
  }, [navQuery]);
  const workflowStatus = useMemo(() => ([
    { label: 'Resume Added', done: Boolean(resumeFile) },
    { label: 'JD Added', done: Boolean(jobDescription || jdText || jdFile) },
    { label: 'Session Started', done: Boolean(sessionId) },
    { label: 'Analysis Ready', done: Boolean(qualityReport || messages.length) },
  ]), [resumeFile, jobDescription, jdText, jdFile, sessionId, qualityReport, messages.length]);
  const completedWorkflowSteps = useMemo(() => workflowStatus.filter((item) => item.done).length, [workflowStatus]);
  const completionPct = Math.round((completedWorkflowSteps / workflowStatus.length) * 100);

  useEffect(() => {
    if (chatContainerRef.current) chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    fetchProfile();
    fetchDashboard();
  }, [userId]);

  useEffect(() => {
    if (activeTab === 'dashboard') fetchDashboard();
  }, [activeTab, userId]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowCommandPalette((prev) => !prev);
        return;
      }
      if (event.altKey && TAB_SHORTCUTS[event.key]) {
        event.preventDefault();
        setActiveTab(TAB_SHORTCUTS[event.key]);
      }
      if (event.key === 'Escape') {
        setShowCommandPalette(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (showCommandPalette && commandInputRef.current) {
      commandInputRef.current.focus();
    }
  }, [showCommandPalette]);

  useEffect(() => {
    if (!showAuth || !GOOGLE_CLIENT_ID) return;
    const renderGoogle = () => {
      if (!window.google || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (response?.credential) await handleGoogleLogin(response.credential);
        },
      });
      googleButtonRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleButtonRef.current, { theme: 'outline', size: 'large', width: 300 });
    };

    const existingScript = document.getElementById('google-identity-script');
    if (existingScript) {
      renderGoogle();
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-identity-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = renderGoogle;
    document.body.appendChild(script);
  }, [showAuth]);

  const persistAuth = (payload) => {
    const next = {
      user_id: payload.user_id,
      email: payload.email || '',
      display_name: payload.display_name || 'User',
      auth_provider: payload.auth_provider || 'email',
    };
    localStorage.setItem('careerforge_auth_user', JSON.stringify(next));
    localStorage.setItem('careerforge_user_id', next.user_id);
    setAuthUser(next);
    setUserId(next.user_id);
    setShowAuth(false);
    setProfile(createDefaultProfile(next.user_id, next.email));
    setUploadMessage(`Welcome ${next.display_name || 'back'}!`);
    setTimeout(() => setUploadMessage(''), 2600);
  };

  const submitAuth = async () => {
    setAuthLoading(true);
    setErrorText('');
    try {
      const formData = new FormData();
      formData.append('email', authForm.email.trim());
      formData.append('password', authForm.password);
      if (authMode === 'signup') formData.append('display_name', authForm.display_name.trim());
      const endpoint = authMode === 'signup' ? '/auth/signup' : '/auth/login';
      const response = await fetch(`${API_BASE_URL}${endpoint}`, { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Authentication failed');
      persistAuth(data);
    } catch (error) {
      setErrorText(String(error.message || error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLogin = async (credential) => {
    setAuthLoading(true);
    setErrorText('');
    try {
      const formData = new FormData();
      formData.append('credential', credential);
      const response = await fetch(`${API_BASE_URL}/auth/google`, { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Google sign-in failed');
      persistAuth(data);
    } catch (error) {
      setErrorText(String(error.message || error));
    } finally {
      setAuthLoading(false);
    }
  };

  const fetchProfile = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/profile/${userId}`);
      if (!response.ok) {
        if (!mountedRef.current) return;
        setProfile(createDefaultProfile(userId, ''));
        setProfileFiles([]);
        return;
      }
      const data = await response.json();
      if (!mountedRef.current) return;
      setProfile(data.profile);
      setProfileFiles(data.files || []);
    } catch {
      // noop
    }
  };

  const fetchDashboard = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/dashboard/${userId}`);
      if (!response.ok) {
        setDashboardData(null);
        return;
      }
      const data = await response.json();
      if (!mountedRef.current) return;
      setDashboardData(data);
    } catch {
      if (!mountedRef.current) return;
      setDashboardData(null);
    }
  };

  const fetchQualityReport = async (sid) => {
    if (!sid) return;
    try {
      const formData = new FormData();
      formData.append('session_id', sid);
      const response = await fetch(`${API_BASE_URL}/analysis/quality`, { method: 'POST', body: formData });
      if (!response.ok) {
        setQualityReport(null);
        return;
      }
      const data = await response.json();
      if (!mountedRef.current) return;
      setQualityReport(data);
    } catch {
      if (!mountedRef.current) return;
      setQualityReport(null);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('careerforge_user_id');
    localStorage.removeItem('careerforge_auth_user');
    const freshId = uuidv4();
    localStorage.setItem('careerforge_user_id', freshId);
    setUserId(freshId);
    setAuthUser(null);
    setShowAuth(true);
    setProfile(createDefaultProfile(freshId));
    setProfileFile(null);
    setProfileFiles([]);
    setVisitedProfile(null);
    setVisitedFiles([]);
    setVisitUserId('');
    setResumeFile(null);
    setJdFile(null);
    setJdText('');
    setJobDescription(null);
    setSessionId(null);
    setMessages([]);
    setInputValue('');
    setQualityReport(null);
    setDashboardData(null);
    setActiveTab('dashboard');
    setUploadMessage('Logged out successfully.');
    setTimeout(() => setUploadMessage(''), 2000);
  };

  const sendEmailNotification = async () => {
    setEmailStatus('');
    try {
      const formData = new FormData();
      formData.append('to_email', emailTest.to);
      formData.append('subject', emailTest.subject);
      formData.append('message', emailTest.message);
      const response = await fetch(`${API_BASE_URL}/notifications/test-email`, { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || 'Email request failed.');
      setEmailStatus(`Email sent: ${data.detail}`);
    } catch (error) {
      setEmailStatus(`Email failed: ${String(error.message || error)}`);
    }
  };

  const visitProfile = async () => {
    const targetUserId = visitUserId.trim();
    if (!targetUserId) {
      setErrorText('Enter a user ID to visit profile.');
      return;
    }

    setIsVisitingProfile(true);
    setErrorText('');
    try {
      const response = await fetch(`${API_BASE_URL}/profile/${targetUserId}`);
      if (!response.ok) throw new Error('Profile not found for this user ID.');
      const data = await response.json();
      setVisitedProfile(data.profile);
      setVisitedFiles(data.files || []);
    } catch (error) {
      setVisitedProfile(null);
      setVisitedFiles([]);
      setErrorText(String(error.message || 'Failed to load profile.'));
    } finally {
      setIsVisitingProfile(false);
    }
  };
  const startUpload = async (resume, jdValue) => {
    if (!resume || !jdValue) return;
    setIsUploading(true);
    setUploadProgress(8);
    setErrorText('');
    const sid = uuidv4();
    setSessionId(sid);

    const formData = new FormData();
    formData.append('session_id', sid);
    formData.append('user_id', userId);
    formData.append('resume', resume);

    if (typeof jdValue === 'string') {
      const blob = new Blob([jdValue], { type: 'text/plain' });
      formData.append('jd', new File([blob], 'jd.txt'));
    } else {
      formData.append('jd', jdValue);
    }

    const timer = setInterval(() => setUploadProgress((prev) => (prev > 92 ? prev : prev + 7)), 260);

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      setUploadProgress(100);
      setUploadMessage('Files uploaded. Analyzer is ready.');
      setJobDescription({
        name: typeof jdValue === 'string' ? 'pasted_jd.txt' : jdValue.name,
        content: typeof jdValue === 'string' ? jdValue : 'Uploaded file',
        url: result.jd_url,
      });
      setTimeout(() => setUploadMessage(''), 3000);
      fetchProfile();
      fetchDashboard();
      fetchQualityReport(sid);
      setActiveTab('analyzer');
    } catch (error) {
      setErrorText(String(error.message || 'Upload failed'));
    } finally {
      clearInterval(timer);
      setIsUploading(false);
    }
  };

  const onResumeSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const error = validateFile(file, RESUME_EXTENSIONS);
    if (error) {
      setErrorText(error);
      return;
    }
    setErrorText('');
    setResumeFile(file);
  };

  const onJdSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const error = validateFile(file, JD_EXTENSIONS);
    if (error) {
      setErrorText(error);
      return;
    }
    setJdFile(file);
    setJdText('');
    setErrorText('');
  };

  const confirmJd = () => {
    const value = jdFile || jdText;
    if (!value || !resumeFile) {
      if (!resumeFile) setErrorText('Upload a resume first.');
      return;
    }
    setShowJdModal(false);
    startUpload(resumeFile, value);
    setJdFile(null);
    setJdText('');
  };

  const askAssistant = async (promptText) => {
    if (!promptText.trim() || !sessionId || isLoading) return;
    const userMessage = { id: Date.now(), role: 'user', content: promptText, time: formatClock() };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    const assistantId = Date.now() + 1;
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', isTyping: true, time: formatClock() }]);

    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('prompt', responseMode === 'detailed' ? `${promptText} explain in detail` : promptText);

    try {
      const response = await fetch(`${API_BASE_URL}/query`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error(await response.text());
      const text = await response.text();
      const words = text.split(' ');
      let index = 0;

      const reveal = () => {
        if (index >= words.length) {
          setIsLoading(false);
          return;
        }
        setMessages((prev) => prev.map((msg) => (
          msg.id !== assistantId ? msg : { ...msg, content: words.slice(0, index + 1).join(' '), isTyping: index + 1 < words.length }
        )));
        index += 1;
        setTimeout(reveal, 40);
      };

      reveal();
    } catch {
      setMessages((prev) => prev.map((msg) => (
        msg.id !== assistantId ? msg : { ...msg, content: 'Query failed. Please retry.', isTyping: false }
      )));
      setIsLoading(false);
    }
  };

  const saveProfile = async () => {
    setProfileSaving(true);
    setErrorText('');
    try {
      if (profileFile) {
        const validation = validateFile(profileFile, IMAGE_EXTENSIONS);
        if (validation) throw new Error(validation);
      }
      const formData = new FormData();
      formData.append('user_id', userId);
      formData.append('email', profile.email || '');
      formData.append('display_name', profile.display_name || 'User');
      formData.append('headline', profile.headline || '');
      formData.append('bio', profile.bio || '');
      if (profileFile) formData.append('profile_image', profileFile);

      const response = await fetch(`${API_BASE_URL}/profile/upsert`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error(await response.text());
      const updated = await response.json();
      setProfile(updated);
      setProfileFile(null);
      setUploadMessage('Profile saved.');
      setTimeout(() => setUploadMessage(''), 2600);
      fetchProfile();
      fetchDashboard();
    } catch (error) {
      setErrorText(String(error.message || 'Profile save failed'));
    } finally {
      setProfileSaving(false);
    }
  };

  const resetAnalyzer = () => {
    setResumeFile(null);
    setJobDescription(null);
    setMessages([]);
    setSessionId(null);
    setUploadProgress(0);
    setQualityReport(null);
  };

  const jumpToTab = (tabId) => {
    setActiveTab(tabId);
    setShowCommandPalette(false);
    setNavQuery('');
  };
  const dismissGuide = () => {
    localStorage.setItem('careerforge_hide_guide', '1');
    setShowGuide(false);
  };

  const ensurePeer = () => {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peer.onicecandidate = () => { if (peer.localDescription) setLocalSdp(JSON.stringify(peer.localDescription)); };
    peer.onconnectionstatechange = () => setP2pConnected(['connected', 'completed'].includes(peer.connectionState));
    peer.ondatachannel = (event) => {
      dataChannelRef.current = event.channel;
      wireDataChannel(event.channel);
    };
    peerRef.current = peer;
    return peer;
  };

  const wireDataChannel = (channel) => {
    channel.onopen = () => setP2pConnected(true);
    channel.onclose = () => setP2pConnected(false);
    channel.onmessage = (event) => setP2pMessages((prev) => [...prev, { role: 'peer', text: event.data, time: formatClock() }]);
  };

  const startP2POffer = async () => {
    const peer = ensurePeer();
    const channel = peer.createDataChannel('careerforge-p2p');
    dataChannelRef.current = channel;
    wireDataChannel(channel);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    setLocalSdp(JSON.stringify(peer.localDescription));
  };

  const acceptP2POffer = async () => {
    const peer = ensurePeer();
    await peer.setRemoteDescription(JSON.parse(remoteSdp));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    setLocalSdp(JSON.stringify(peer.localDescription));
  };

  const finalizeP2PAnswer = async () => {
    if (!peerRef.current || !remoteSdp) return;
    await peerRef.current.setRemoteDescription(JSON.parse(remoteSdp));
  };

  const sendP2P = () => {
    if (!p2pInput.trim() || !dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;
    dataChannelRef.current.send(p2pInput);
    setP2pMessages((prev) => [...prev, { role: 'you', text: p2pInput, time: formatClock() }]);
    setP2pInput('');
  };
  const renderDashboard = () => (
    <section className="content-panel panel-animate">
      <div className="panel-head"><h2>Dashboard</h2></div>
      {showGuide ? (
        <div className="guide-card">
          <div>
            <strong>Quick Start Guide</strong>
            <p>Complete these steps to unlock full analysis quality and profile insights.</p>
          </div>
          <div className="guide-actions">
            <span>{completionPct}% complete</span>
            <button className="ghost-btn" onClick={dismissGuide}>Dismiss</button>
          </div>
        </div>
      ) : null}
      <div className="workflow-strip">
        {workflowStatus.map((step) => (
          <div key={step.label} className={`workflow-item ${step.done ? 'done' : ''}`}>
            <span className="workflow-dot" />
            <p>{step.label}</p>
          </div>
        ))}
      </div>
      <div className="stats-grid">
        <article className="stat-card"><span>Average Quality</span><strong>{dashboardData?.average_quality_score ?? score}%</strong></article>
        <article className="stat-card"><span>Profile Completion</span><strong>{dashboardData?.profile_completion ?? 0}%</strong></article>
        <article className="stat-card"><span>Total Sessions</span><strong>{dashboardData?.sessions_count ?? 0}</strong></article>
        <article className="stat-card"><span>Uploaded Files</span><strong>{dashboardData?.files_count ?? 0}</strong></article>
      </div>
      <div className="quick-actions">
        <button className="action-card" onClick={() => jumpToTab('analyzer')}>
          <strong>Run Resume Analysis</strong>
          <span>Upload resume + JD and get fit insights</span>
        </button>
        <button className="action-card" onClick={() => jumpToTab('profile')}>
          <strong>Polish Your Profile</strong>
          <span>Update headline, bio, and image for better impact</span>
        </button>
        <button className="action-card" onClick={() => jumpToTab('chats')}>
          <strong>Open Direct Chat</strong>
          <span>Start secure peer-to-peer discussion instantly</span>
        </button>
      </div>
      <div className="panel-head spaced-top"><h3>Recent Uploads</h3></div>
      <div className="files-list">
        {(dashboardData?.recent_uploads || []).length === 0 ? <p>No uploads yet.</p> : (dashboardData?.recent_uploads || []).map((file) => (
          <a key={file.file_id} href={`${API_BASE_URL}${file.public_url}`} target="_blank" rel="noreferrer">{file.file_role}: {file.original_name}</a>
        ))}
      </div>
      <div className="panel-head spaced-top"><h3>Missing Keyword Radar</h3></div>
      <div className="chip-row">
        {(missingKeywords || []).length === 0 ? <p className="empty">No missing keywords detected yet.</p> : missingKeywords.map((item) => (
          <button key={item} className="chip" onClick={() => askAssistant(`How do I add ${item} experience naturally in my resume?`)} disabled={!sessionId || isLoading}>{item}</button>
        ))}
      </div>
    </section>
  );

  const renderAnalyzer = () => (
    <section className="content-panel panel-animate">
      <div className="panel-head"><h2>Resume Analyzer</h2></div>
      <div className="analyzer-meta">
        <p><strong>Session:</strong> {sessionId || 'Not started'}</p>
        <p><strong>Questions Asked:</strong> {messages.filter((m) => m.role === 'user').length}</p>
        <p><strong>Status:</strong> {qualityReport ? 'Insights ready' : 'Waiting for upload/processing'}</p>
      </div>
      <div className="upload-grid">
        <label className="upload-card" htmlFor="resume-upload"><p className="upload-title">Upload Resume</p><p>10MB docs / 5MB images</p><p className="upload-file">{resumeFile ? resumeFile.name : 'Select resume file'}</p></label>
        <input id="resume-upload" className="sr-only" type="file" accept=".pdf,.docx,.txt,.md,.epub,.jpg,.jpeg,.png,.webp,.gif,.bmp" onChange={onResumeSelect} />
        <button className="upload-card" onClick={() => setShowJdModal(true)}><p className="upload-title">Add Job Description</p><p>Paste or upload JD</p><p className="upload-file">{jobDescription?.name || 'Open JD modal'}</p></button>
      </div>
      {isUploading ? <div className="progress-wrap"><div className="progress-track"><div className="progress-bar" style={{ width: `${uploadProgress}%` }} /></div><p>{uploadProgress}% processing</p></div> : null}
      <div className="chip-row">{QUICK_PROMPTS.map((text) => <button key={text} className="chip" onClick={() => askAssistant(text)} disabled={!sessionId || isLoading}>{text}</button>)}</div>
      <div className="panel-head spaced-top"><h3>Assistant</h3><button className="ghost-btn" onClick={() => setResponseMode((prev) => (prev === 'brief' ? 'detailed' : 'brief'))}>Mode: {responseMode}</button></div>
      <details className="collapse-card" open>
        <summary>Resume Quality Insights</summary>
        {qualityReport ? (
          <div className="quality-grid">
            <p><strong>Quality Score:</strong> {qualityReport.quality_score}%</p><p><strong>Keyword Coverage:</strong> {qualityReport.keyword_coverage}%</p><p><strong>Section Score:</strong> {qualityReport.section_score}%</p>
            <p><strong>Action Verbs:</strong> {qualityReport.action_verb_count}</p><p><strong>Quantified Achievements:</strong> {qualityReport.quantified_achievement_count}</p>
            <p><strong>Contact Checks:</strong> email {qualityReport.contact_checks?.email ? 'yes' : 'no'}, phone {qualityReport.contact_checks?.phone ? 'yes' : 'no'}, linkedin {qualityReport.contact_checks?.linkedin ? 'yes' : 'no'}</p>
            <p><strong>Missing Keywords:</strong> {(qualityReport.missing_keywords || []).join(', ') || 'none'}</p>
            <div className="quality-reco"><strong>Improvement Actions:</strong><ul>{(qualityReport.recommendations || []).map((item) => <li key={item}>{item}</li>)}</ul></div>
          </div>
        ) : <p className="upload-note">Quality report appears after upload processing completes.</p>}
      </details>

      <div className="chat-window" ref={chatContainerRef}>
        {messages.length === 0 ? <p className="empty">Upload files and ask your first question.</p> : messages.map((message) => (
          <div key={message.id} className={`message-row ${message.role}`}><article className="message-bubble"><div className="message-meta"><span>{message.role}</span><small>{message.time}</small></div><ReactMarkdown>{message.content}</ReactMarkdown>{message.role === 'assistant' ? <button className="inline-action" onClick={() => navigator.clipboard.writeText(message.content)}>Copy</button> : null}{message.isTyping ? <p className="typing">typing...</p> : null}</article></div>
        ))}
      </div>

      <div className="chat-input-wrap">
        <textarea value={inputValue} onChange={(event) => setInputValue(event.target.value)} placeholder="Ask about fit score, missing skills, rewrite, ATS, roadmap..." onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); askAssistant(inputValue); } }} />
        <button onClick={() => askAssistant(inputValue)} disabled={!inputValue.trim() || !sessionId || isLoading}>{isLoading ? 'Sending' : 'Send'}</button>
      </div>

      <div className="panel-head spaced-top"><button className="ghost-btn" onClick={resetAnalyzer}>Clear Analyzer</button></div>
    </section>
  );

  const renderP2P = () => (
    <section className="content-panel panel-animate">
      <div className="panel-head"><h2>Direct Chat (P2P, No Relay)</h2></div>
      <p className="note">Create offer on one device, paste it on another, generate answer, paste answer back. Chat runs directly via WebRTC data channel.</p>
      <div className="p2p-grid"><div className="p2p-card"><h3>Step 1</h3><button className="solid-btn" onClick={startP2POffer}>Create Offer</button><button className="ghost-btn" onClick={finalizeP2PAnswer}>Apply Remote Answer</button></div><div className="p2p-card"><h3>Step 2</h3><button className="solid-btn" onClick={acceptP2POffer}>Accept Offer / Create Answer</button></div></div>
      <label>Local SDP</label><textarea className="sdp-box" value={localSdp} onChange={(event) => setLocalSdp(event.target.value)} />
      <label>Remote SDP</label><textarea className="sdp-box" value={remoteSdp} onChange={(event) => setRemoteSdp(event.target.value)} />
      <p className={`status ${p2pConnected ? 'ok' : 'warn'}`}>Connection: {p2pConnected ? 'Connected' : 'Not connected'}</p>
      <div className="chat-window">{p2pMessages.length === 0 ? <p className="empty">No P2P messages yet.</p> : p2pMessages.map((msg, idx) => <div key={`${msg.time}-${idx}`} className={`message-row ${msg.role === 'you' ? 'user' : 'assistant'}`}><article className="message-bubble"><div className="message-meta"><span>{msg.role}</span><small>{msg.time}</small></div><p>{msg.text}</p></article></div>)}</div>
      <div className="chat-input-wrap"><input value={p2pInput} onChange={(event) => setP2pInput(event.target.value)} placeholder="Type a direct P2P message" /><button onClick={sendP2P} disabled={!p2pConnected || !p2pInput.trim()}>Send</button></div>
    </section>
  );

  const renderProfile = () => (
    <section className="content-panel panel-animate">
      <div className="panel-head"><h2>Profile</h2></div>
      <div className="profile-grid"><div className="profile-card"><p className="upload-note"><strong>Your User ID:</strong> {userId}</p>{profile.profile_image_url ? <img src={`${API_BASE_URL}${profile.profile_image_url}`} alt="Profile" className="avatar" /> : <div className="avatar placeholder">No Image</div>}<input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" onChange={(event) => setProfileFile(event.target.files?.[0] || null)} /><small>Uploading a new profile image removes the previous one from server storage.</small></div>
        <div className="profile-card"><label>Name</label><input value={profile.display_name || ''} onChange={(event) => setProfile((prev) => ({ ...prev, display_name: event.target.value }))} /><label>Email</label><input value={profile.email || ''} onChange={(event) => setProfile((prev) => ({ ...prev, email: event.target.value }))} /><label>Headline</label><input value={profile.headline || ''} onChange={(event) => setProfile((prev) => ({ ...prev, headline: event.target.value }))} /><label>Bio</label><textarea value={profile.bio || ''} onChange={(event) => setProfile((prev) => ({ ...prev, bio: event.target.value }))} /><button className="solid-btn" onClick={saveProfile} disabled={profileSaving}>{profileSaving ? 'Saving...' : 'Save Profile'}</button></div></div>
      <details open className="collapse-card"><summary>Uploaded File Links</summary><div className="files-list">{profileFiles.length === 0 ? <p>No file metadata available yet.</p> : profileFiles.map((file) => <a key={file.file_id} href={`${API_BASE_URL}${file.public_url}`} target="_blank" rel="noreferrer">{file.file_role}: {file.original_name} ({(file.size_bytes / 1024 / 1024).toFixed(2)} MB)</a>)}</div></details>
      <details className="collapse-card"><summary>Visit Another User Profile</summary><div className="visit-grid"><input value={visitUserId} onChange={(event) => setVisitUserId(event.target.value)} placeholder="Enter target user_id" /><button className="solid-btn" onClick={visitProfile} disabled={isVisitingProfile}>{isVisitingProfile ? 'Loading...' : 'Visit Profile'}</button></div>{visitedProfile ? <div className="visited-profile"><p><strong>Name:</strong> {visitedProfile.display_name || 'User'}</p><p><strong>Headline:</strong> {visitedProfile.headline || 'N/A'}</p><p><strong>Bio:</strong> {visitedProfile.bio || 'N/A'}</p>{visitedProfile.profile_image_url ? <img src={`${API_BASE_URL}${visitedProfile.profile_image_url}`} alt="Visited profile" className="avatar" /> : null}<div className="files-list">{visitedFiles.length === 0 ? <p>No shared files found.</p> : visitedFiles.map((file) => <a key={file.file_id} href={`${API_BASE_URL}${file.public_url}`} target="_blank" rel="noreferrer">{file.file_role}: {file.original_name}</a>)}</div></div> : null}</details>
      <details className="collapse-card"><summary>Email Notifications</summary><div className="visit-grid"><input value={emailTest.to} onChange={(event) => setEmailTest((prev) => ({ ...prev, to: event.target.value }))} placeholder="recipient@email.com" /><button className="solid-btn" onClick={sendEmailNotification}>Send Email</button></div><input value={emailTest.subject} onChange={(event) => setEmailTest((prev) => ({ ...prev, subject: event.target.value }))} placeholder="Email subject" /><textarea value={emailTest.message} onChange={(event) => setEmailTest((prev) => ({ ...prev, message: event.target.value }))} placeholder="Email body" />{emailStatus ? <p className="upload-note">{emailStatus}</p> : null}</details>
    </section>
  );
  const renderHelp = () => (
    <section className="content-panel panel-animate">
      <div className="panel-head"><h2>Help</h2></div>
      <details open className="collapse-card"><summary>Supported Files & Limits</summary><p>Docs: up to 10MB each (`pdf`, `docx`, `txt`, `md`, `epub`).</p><p>Images: up to 5MB each (`jpg`, `jpeg`, `png`, `webp`, `gif`, `bmp`).</p></details>
      <details className="collapse-card"><summary>Navigation Guide</summary><p>Desktop uses left sidebar tabs.</p><p>Phone uses bottom tabs for one-thumb switching.</p></details>
      <details className="collapse-card"><summary>Resume Lab</summary><p>Upload resume and job description, then ask targeted questions to refine your fit.</p><p>Switch response mode when you want deeper strategy.</p></details>
      <details className="collapse-card"><summary>Profile</summary><p>No login required. Use the landing page to enter workspace directly.</p><p>Profile image replacement deletes the previous image from server storage.</p></details>
    </section>
  );

  const renderLanding = () => (
    <section className="landing-shell">
      <div className="landing-hero">
        <div className="hero-media">
          <div className="hero-overlay">
            <p className="hero-kicker">Career Intelligence Platform</p>
            <h1>{APP_DISPLAY_NAME}</h1>
            <p className="hero-copy">A cleaner way to turn resumes into interview-ready applications.</p>
            <button className="hero-cta" onClick={() => setShowAuth(false)}>Enter Workspace</button>
          </div>
        </div>
        <div className="hero-points"><span>Role-fit scoring</span><span>Gap mapping</span><span>AI resume guidance</span><span>Profile + file vault</span></div>
      </div>
    </section>
  );

  if (showAuth) {
    return <div className="auth-screen">{errorText ? <p className="status warn auth-status">{errorText}</p> : null}{renderLanding()}</div>;
  }

  return (
    <div className={`app-shell nav-layout ${sidebarCollapsed ? 'side-collapsed' : ''}`}>
      <aside className={`side-nav ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="side-head">
          <h1>{APP_DISPLAY_NAME}</h1>
          <button className="ghost-btn icon-btn" onClick={() => setSidebarCollapsed((prev) => !prev)}>{sidebarCollapsed ? 'Expand' : 'Collapse'}</button>
        </div>
        <div className="nav-search">
          <input value={navQuery} onChange={(event) => setNavQuery(event.target.value)} placeholder="Find section..." />
        </div>
        {filteredTabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
      </aside>
      <header className="top-nav">
        <div><p className="brand-kicker">AI Career Command Center</p><h2>{TABS.find((item) => item.id === activeTab)?.label}</h2></div>
        <div className="top-actions">
          <button className="ghost-btn" onClick={() => setShowCommandPalette(true)}>Jump (Ctrl/Cmd+K)</button>
          <button className="ghost-btn" onClick={() => setShowAuth(true)}>Back To Landing</button>
        </div>
      </header>
      <main className="main-content">{uploadMessage ? <p className="status ok">{uploadMessage}</p> : null}{errorText ? <p className="status warn">{errorText}</p> : null}{activeTab === 'dashboard' ? renderDashboard() : null}{activeTab === 'analyzer' ? renderAnalyzer() : null}{activeTab === 'chats' ? renderP2P() : null}{activeTab === 'profile' ? renderProfile() : null}{activeTab === 'help' ? renderHelp() : null}</main>
      <nav className="bottom-nav">{TABS.map((tab) => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</nav>

      {showCommandPalette ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card command-palette">
            <div className="panel-head">
              <h3>Quick Navigation</h3>
              <button className="ghost-btn" onClick={() => setShowCommandPalette(false)}>Close</button>
            </div>
            <input ref={commandInputRef} value={navQuery} onChange={(event) => setNavQuery(event.target.value)} placeholder="Type dashboard, resume, profile..." />
            <div className="command-list">
              {filteredTabs.map((tab, index) => (
                <button key={tab.id} className="command-item" onClick={() => jumpToTab(tab.id)}>
                  <span>{tab.label}</span>
                  <small>Alt+{index + 1}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {showJdModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="panel-head"><h3>Add Job Description</h3><button className="ghost-btn" onClick={() => setShowJdModal(false)}>Close</button></div>
            <label>Paste JD</label><textarea value={jdText} onChange={(event) => { setJdText(event.target.value); setJdFile(null); }} />
            <label>Or upload JD file</label><input type="file" accept=".pdf,.docx,.txt,.md,.epub,.jpg,.jpeg,.png,.webp,.gif,.bmp" onChange={onJdSelect} />
            {jdFile ? <p className="upload-file">Selected: {jdFile.name}</p> : null}
            <div className="panel-head"><button className="ghost-btn" onClick={() => setShowJdModal(false)}>Cancel</button><button className="solid-btn" onClick={confirmJd} disabled={!jdText.trim() && !jdFile}>Upload & Analyze</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CareerForge;

