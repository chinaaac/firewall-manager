/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Shield, 
  Server, 
  Terminal, 
  Plus, 
  Trash2, 
  Edit2,
  RefreshCw, 
  AlertTriangle, 
  Brain, 
  Send,
  Loader2,
  Lock,
  Unlock,
  Settings,
  ChevronRight,
  Database,
  Search,
  Activity,
  FileCode,
  Save,
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Machine, Chain, IptablesRule } from './types';
import { parseIptablesIntent, explainRules, modifyConfigFile } from './services/geminiService';

export default function App() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [isAddingMachine, setIsAddingMachine] = useState(false);
  const [editingMachineId, setEditingMachineId] = useState<string | null>(null);

  const [newMachine, setNewMachine] = useState({ 
    name: '', host: '', port: 22, username: '', password: '', 
    configPath: '/etc/sysconfig/iptables',
    restartCommand: 'systemctl restart iptables'
  });

  const [chains, setChains] = useState<Chain[]>([]);
  const [viewMode, setViewMode] = useState<'rules' | 'config'>('rules');
  const [configContent, setConfigContent] = useState('');
  const [originalConfigContent, setOriginalConfigContent] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<{msg: string, type: 'info' | 'error' | 'success'}[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);

  const selectedMachine = machines.find(m => m.id === selectedMachineId);

  useEffect(() => {
    fetchMachines();
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    setLogs(prev => [...prev, { msg: `[${new Date().toLocaleTimeString()}] ${msg}`, type }]);
  };

  const fetchMachines = async () => {
    try {
      const res = await fetch('/api/machines');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMachines(data);
    } catch (err: any) {
      addLog(`Failed to fetch machines: ${err.message}`, 'error');
    }
  };

  const handleSaveMachine = async () => {
    try {
      const url = editingMachineId ? `/api/machines/${editingMachineId}` : '/api/machines';
      const method = editingMachineId ? 'PUT' : 'POST';
      const machineData = {
        ...newMachine,
        id: editingMachineId || Date.now().toString()
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(machineData)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      addLog(`Machine ${editingMachineId ? 'updated' : 'added'} successfully`, 'success');
      fetchMachines();
      setIsAddingMachine(false);
      setEditingMachineId(null);
      setNewMachine({ 
        name: '', host: '', port: 22, username: '', password: '', 
        configPath: '/etc/sysconfig/iptables',
        restartCommand: 'systemctl restart iptables' 
      });
    } catch (err: any) {
      addLog(`Failed to save machine: ${err.message}`, 'error');
    }
  };

  const startEditMachine = (m: Machine, e: React.MouseEvent) => {
    e.stopPropagation();
    setNewMachine({
      name: m.name,
      host: m.host,
      port: m.port,
      username: m.username,
      password: m.password,
      configPath: m.configPath || '',
      restartCommand: m.restartCommand || ''
    });
    setEditingMachineId(m.id);
    setIsAddingMachine(true);
  };

  const deleteMachine = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this machine?')) return;
    try {
      const res = await fetch(`/api/machines/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      addLog('Machine deleted successfully', 'success');
      if (selectedMachineId === id) setSelectedMachineId(null);
      fetchMachines();
    } catch (err: any) {
      addLog(`Failed to delete machine: ${err.message}`, 'error');
    }
  };

  const fetchRules = async () => {
    if (!selectedMachine) return;
    setIsLoading(true);
    addLog(`Fetching rules from ${selectedMachine.name}...`);
    try {
      const res = await fetch('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selectedMachine,
          command: 'sudo iptables -L -n -v --line-numbers'
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      parseIptablesOutput(data.stdout);
      addLog(`Rules fetched successfully.`, 'success');
    } catch (err: any) {
      addLog(`Failed to fetch rules: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const parseIptablesOutput = (output: string) => {
    const chainRegex = /Chain (\w+) \(policy (\w+)/g;
    const ruleRows = output.split('\n');
    let currentChain: Chain | null = null;
    const parsedChains: Chain[] = [];

    ruleRows.forEach(row => {
      const chainMatch = row.match(/Chain (\w+) \(policy (\w+)/);
      if (chainMatch) {
        if (currentChain) parsedChains.push(currentChain);
        currentChain = { name: chainMatch[1], policy: chainMatch[2], rules: [] };
      } else if (currentChain && /^\d+/.test(row.trim())) {
        const parts = row.trim().split(/\s+/);
        // num pkts bytes target prot opt in out source destination
        const rule: IptablesRule = {
          num: parts[0],
          pkts: parts[1],
          bytes: parts[2],
          target: parts[3],
          prot: parts[4],
          opt: parts[5],
          in: parts[6],
          out: parts[7],
          source: parts[8],
          destination: parts[9],
          extra: parts.slice(10).join(' ')
        };
        currentChain.rules.push(rule);
      }
    });
    if (currentChain) parsedChains.push(currentChain);
    setChains(parsedChains);
  };

  const fetchConfigFile = async () => {
    if (!selectedMachine) return;
    setIsLoading(true);
    addLog(`Reading config file from ${selectedMachine.configPath}...`);
    try {
      const res = await fetch('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selectedMachine,
          command: `sudo cat ${selectedMachine.configPath}`
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setConfigContent(data.stdout);
      addLog(`Config file loaded.`, 'success');
    } catch (err: any) {
      addLog(`Failed to read config: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveAndRestart = async (customContent?: string) => {
    if (!selectedMachine) return;
    const contentToSave = customContent || configContent;
    if (!contentToSave) return;

    if (!window.confirm(`Warning: This will overwrite ${selectedMachine.configPath} and execute '${selectedMachine.restartCommand}'. Continue?`)) return;

    setIsLoading(true);
    addLog(`Saving configuration to ${selectedMachine.configPath}...`);
    try {
      // Use base64 to avoid shell escaping issues with large config files
      const base64Content = btoa(unescape(encodeURIComponent(contentToSave)));
      const writeRes = await fetch('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selectedMachine,
          command: `echo "${base64Content}" | base64 -d | sudo tee ${selectedMachine.configPath} > /dev/null`
        })
      });
      const writeData = await writeRes.json();
      if (writeData.error) throw new Error(writeData.error);

      addLog(`Config saved. Executing restart: ${selectedMachine.restartCommand}...`);
      const restartRes = await fetch('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selectedMachine,
          command: `sudo ${selectedMachine.restartCommand}`
        })
      });
      const restartData = await restartRes.json();
      if (restartData.error) throw new Error(restartData.error);
      
      addLog(`Configuration applied successfully! CODE: ${restartData.code}`, 'success');
      fetchRules();
      if(viewMode === 'config') fetchConfigFile();
    } catch (err: any) {
      addLog(`Failed to apply configuration: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAiExecute = async () => {
    if (!aiInput || !selectedMachine) return;
    setIsAiProcessing(true);
    addLog(`AI analyzing intent: "${aiInput}"...`);
    
    try {
      if (viewMode === 'config') {
        setOriginalConfigContent(configContent);
        const updatedConfig = await modifyConfigFile(aiInput, configContent);
        if (updatedConfig.startsWith('ERROR:')) {
           addLog(updatedConfig, 'error');
        } else {
           addLog(`AI successfully generated new configuration content. Comparison mode enabled.`);
           setConfigContent(updatedConfig);
           setShowDiff(true);
           addLog(`Please review the changes (Green: Added, Red: Removed). Click "SAVE & RESTART" to apply.`, 'info');
        }
      } else {
        const currentRaw = chains.map(c => `${c.name} (${c.policy})\n${c.rules.map(r => `${r.num} ${r.target} ${r.source} -> ${r.destination}`).join('\n')}`).join('\n\n');
        const command = await parseIptablesIntent(aiInput, currentRaw);
        
        if (command.startsWith('ERROR:')) {
          addLog(command, 'error');
        } else if (command.startsWith('EXISTS:')) {
          addLog(command.replace('EXISTS:', 'SKIP:'), 'info');
        } else {
          addLog(`AI suggested command: ${command}`);
          if (window.confirm(`AI proposes command:\n\n${command}\n\nExecute safely?`)) {
            const res = await fetch('/api/ssh/exec', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...selectedMachine, command: `sudo ${command}` })
            });
            const result = await res.json();
            if (result.error) throw new Error(result.error);
            addLog(`Rule applied. CODE: ${result.code}`, 'success');
            fetchRules();
          }
        }
      }
    } catch (err: any) {
      addLog(`AI Execution error: ${err.message}`, 'error');
    } finally {
      setIsAiProcessing(false);
      setAiInput('');
    }
  };

  const handleDeleteRule = async (chainName: string, ruleNum: string) => {
    if (!selectedMachine) return;
    if (!window.confirm(`Are you sure you want to delete rule #${ruleNum} from chain ${chainName}?`)) return;
    
    addLog(`Deleting rule #${ruleNum} from ${chainName}...`);
    try {
      const res = await fetch('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selectedMachine,
          command: `sudo iptables -D ${chainName} ${ruleNum}`
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      addLog(`Rule #${ruleNum} deleted. CODE: ${data.code}`, 'success');
      fetchRules();
    } catch (err: any) {
      addLog(`Failed to delete rule: ${err.message}`, 'error');
    }
  };

  const getRuleExplanation = async () => {
    if (chains.length === 0) return;
    setIsAiProcessing(true);
    try {
      const currentRaw = chains.map(c => `${c.name} (${c.policy})\n${c.rules.map(r => `${r.num} ${r.target} ${r.source} -> ${r.destination} ${r.extra}`).join('\n')}`).join('\n\n');
      const explanation = await explainRules(currentRaw);
      setAiExplanation(explanation);
    } catch (err: any) {
      addLog(`AI Analysis failed: ${err.message}`, 'error');
    } finally {
      setIsAiProcessing(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden technical-grid">
      {/* Sidebar - Machine List */}
      <aside className="w-80 glass-panel flex flex-col border-r h-full z-10">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-sky-500/20 rounded-lg">
              <Shield className="w-5 h-5 text-sky-400" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">S-IPTables</h1>
          </div>
          <button 
            onClick={() => setIsAddingMachine(!isAddingMachine)}
            className="p-2 hover:bg-white/5 rounded-full transition-colors"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isAddingMachine && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3"
            >
              <h3 className="text-sm font-bold text-sky-400 mb-2">
                {editingMachineId ? 'Edit Node' : 'New Node'}
              </h3>
              <input 
                placeholder="Name" 
                className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm outline-none focus:border-sky-500/50"
                value={newMachine.name}
                onChange={e => setNewMachine({...newMachine, name: e.target.value})}
              />
              <input 
                placeholder="Host IP" 
                className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm outline-none focus:border-sky-500/50"
                value={newMachine.host}
                onChange={e => setNewMachine({...newMachine, host: e.target.value})}
              />
              <div className="flex gap-2">
                <input 
                  placeholder="Port" 
                  className="w-20 bg-black/30 border border-white/10 rounded-lg p-2 text-sm outline-none"
                  value={newMachine.port}
                  onChange={e => setNewMachine({...newMachine, port: parseInt(e.target.value)})}
                />
                <input 
                  placeholder="Username" 
                  className="flex-1 bg-black/30 border border-white/10 rounded-lg p-2 text-sm outline-none"
                  value={newMachine.username}
                  onChange={e => setNewMachine({...newMachine, username: e.target.value})}
                />
              </div>
              <input 
                type="password" 
                placeholder="Password" 
                className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm outline-none"
                value={newMachine.password}
                onChange={e => setNewMachine({...newMachine, password: e.target.value})}
              />
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 font-mono uppercase">Config File Path</label>
                <input 
                  placeholder="/etc/iptables/rules.v4" 
                  className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs outline-none"
                  value={newMachine.configPath}
                  onChange={e => setNewMachine({...newMachine, configPath: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 font-mono uppercase">Restart Command</label>
                <input 
                  placeholder="iptables-restore < file" 
                  className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs outline-none"
                  value={newMachine.restartCommand}
                  onChange={e => setNewMachine({...newMachine, restartCommand: e.target.value})}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button 
                  onClick={handleSaveMachine}
                  className="flex-1 bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 rounded-lg text-xs"
                >
                  {editingMachineId ? 'Update' : 'Save Node'}
                </button>
                <button 
                  onClick={() => {
                    setIsAddingMachine(false);
                    setEditingMachineId(null);
                  }}
                  className="px-4 bg-white/10 hover:bg-white/20 rounded-lg text-xs"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {machines.map(m => (
            <div 
              key={m.id}
              onClick={() => setSelectedMachineId(m.id)}
              className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer ${
                selectedMachineId === m.id 
                  ? 'bg-sky-500/10 border-sky-500/50 shadow-[0_0_20px_rgba(56,189,248,0.1)]' 
                  : 'bg-white/5 border-transparent hover:border-white/10'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex flex-col">
                  <span className="font-semibold text-sm">{m.name}</span>
                  <span className="text-[10px] text-gray-400 font-mono">{m.host}</span>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={(e) => startEditMachine(m, e)}
                    className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-sky-400 transition-colors"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button 
                    onClick={(e) => deleteMachine(m.id, e)}
                    className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <Server className={`w-4 h-4 ${selectedMachineId === m.id ? 'text-sky-400' : 'text-gray-500'}`} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-3">
                {m.tags.map(t => (
                  <span key={t} className="text-[8px] px-2 py-0.5 bg-white/10 text-gray-300 rounded-full font-mono uppercase">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-white/10 space-y-4">
          <div className="flex items-center gap-3 text-xs text-gray-400 px-2">
            <Activity className="w-3 h-3 text-green-500" />
            <span>AI Brain Connected</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full bg-black/20">
        {selectedMachine ? (
          <>
            {/* Header Control */}
            <header className="p-6 bg-white/5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex flex-col">
                  <h2 className="text-xl font-bold">{selectedMachine.name} Rules</h2>
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Database className="w-3 h-3" /> System: Linux IPTables (v1.8.8)
                  </span>
                </div>
                <div className="h-8 w-[1px] bg-white/10" />
                <button 
                  onClick={() => {
                    setViewMode('rules');
                    fetchRules();
                  }}
                  disabled={isLoading}
                  className={`flex items-center gap-2 px-4 py-2 ${viewMode === 'rules' ? 'bg-sky-500/20 text-sky-300 border-sky-500/30' : 'bg-white/10'} rounded-lg text-sm font-medium transition-colors border border-white/5`}
                >
                  <Terminal className="w-4 h-4" />
                  Live Table
                </button>
                <button 
                  onClick={() => {
                    setViewMode('config');
                    if(!configContent) fetchConfigFile();
                  }}
                  disabled={isLoading}
                  className={`flex items-center gap-2 px-4 py-2 ${viewMode === 'config' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-white/10'} rounded-lg text-sm font-medium transition-colors border border-white/5 relative`}
                >
                  <FileCode className="w-4 h-4" />
                  Config File
                  <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-indigo-500 text-[8px] font-bold rounded-md animate-pulse">PERSISTENT</span>
                </button>
                
                <div className="h-8 w-[1px] bg-white/10" />
                
                {viewMode === 'rules' ? (
                  <button 
                    onClick={fetchRules}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-sm font-medium transition-colors border border-white/5 text-gray-300"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                ) : (
                  <button 
                    onClick={() => handleSaveAndRestart()}
                    disabled={isLoading || !configContent}
                    className="flex items-center gap-2 px-4 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-300 rounded-lg text-sm font-medium transition-colors border border-green-500/30"
                  >
                    <Save className="w-4 h-4" />
                    SAVE & RESTART
                  </button>
                )}

                <button 
                  onClick={viewMode === 'rules' ? getRuleExplanation : () => {}}
                  disabled={isAiProcessing || (viewMode === 'rules' && chains.length === 0)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 rounded-lg text-sm font-medium transition-colors border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.1)]"
                >
                  <Brain className="w-4 h-4" />
                  AI Sync
                </button>
              </div>

              <div className="flex items-center gap-2 p-1 bg-white/5 rounded-xl border border-white/10">
                <button className="p-2 bg-sky-500 text-white rounded-lg shadow-lg">
                  <Unlock className="w-4 h-4" />
                </button>
                <button className="p-2 hover:bg-white/10 rounded-lg text-gray-400">
                  <Lock className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* AI Command Bar */}
            <div className="px-6 py-4 bg-white/5 border-b border-white/10">
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                  <Brain className="w-5 h-5 text-sky-400" />
                </div>
                <input 
                  type="text"
                  placeholder="Instruct AI: 'Allow incoming connections on port 8080' or 'Block IP 1.2.3.4'..."
                  className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 pl-12 pr-28 outline-none focus:border-sky-500/50 shadow-2xl transition-all font-mono text-sm"
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAiExecute()}
                />
                <button 
                   onClick={handleAiExecute}
                   disabled={isAiProcessing}
                   className="absolute right-2 top-2 bottom-2 px-6 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-600 text-white font-bold rounded-xl text-xs transition-all flex items-center gap-2"
                >
                  {isAiProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  GENERATE
                </button>
              </div>
            </div>

              {/* Workspace Area */}
            <div className="flex-1 flex overflow-hidden">
              {/* Rules Grid or Code Editor */}
              <div className="flex-1 overflow-y-auto p-6 technical-grid relative">
                
                {viewMode === 'rules' ? (
                  <>
                    {aiExplanation && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mb-6 p-5 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl relative overflow-hidden group"
                      >
                        <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                           <Brain className="w-16 h-16" />
                        </div>
                        <div className="flex items-center gap-2 mb-3 text-indigo-300 font-bold text-sm">
                          <Brain className="w-4 h-4" /> AI ANALYSIS REPORT
                        </div>
                        <div className="text-sm text-indigo-100/80 prose prose-invert max-w-none prose-sm leading-relaxed whitespace-pre-wrap">
                          {aiExplanation}
                        </div>
                        <button 
                          onClick={() => setAiExplanation(null)}
                          className="absolute top-4 right-4 p-1 hover:bg-white/10 rounded text-indigo-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </motion.div>
                    )}

                    {chains.length > 0 ? (
                      <div className="space-y-10">
                        {chains.map(chain => (
                          <div key={chain.name} className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <h3 className="text-lg font-mono font-bold tracking-widest text-sky-400 uppercase">Chain {chain.name}</h3>
                                <span className="px-2 py-0.5 bg-sky-500/20 text-sky-300 text-[10px] rounded font-mono uppercase">POLICY: {chain.policy}</span>
                              </div>
                              <span className="text-[10px] text-gray-500 font-mono uppercase">{chain.rules.length} ACTIVE RULES</span>
                            </div>
                            
                            <div className="overflow-hidden rounded-xl border border-white/5 bg-white/5 shadow-xl">
                              <table className="w-full text-left text-[11px] font-mono border-collapse">
                                <thead>
                                  <tr className="bg-white/5 text-gray-400 uppercase tracking-tighter">
                                    <th className="px-4 py-3 font-medium border-b border-white/5">#</th>
                                    <th className="px-4 py-3 font-medium border-b border-white/5">Target</th>
                                    <th className="px-4 py-3 font-medium border-b border-white/5">Prot</th>
                                    <th className="px-4 py-3 font-medium border-b border-white/5">Source</th>
                                    <th className="px-4 py-3 font-medium border-b border-white/5">Destination</th>
                                    <th className="px-4 py-3 font-medium border-b border-white/5">Options</th>
                                    <th className="px-4 py-3 font-medium border-b border-white/5 text-right">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                  {chain.rules.map((rule, idx) => (
                                    <tr key={idx} className="hover:bg-sky-500/5 transition-colors group">
                                      <td className="px-4 py-3 text-gray-500">{rule.num}</td>
                                      <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                          rule.target === 'ACCEPT' ? 'bg-green-500/20 text-green-400' :
                                          rule.target === 'DROP' ? 'bg-red-500/20 text-red-400' :
                                          'bg-yellow-500/20 text-yellow-400'
                                        }`}>
                                          {rule.target}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3 text-sky-300 uppercase">{rule.prot}</td>
                                      <td className="px-4 py-3 tracking-tighter">{rule.source}</td>
                                      <td className="px-4 py-3 tracking-tighter text-gray-400">{rule.destination}</td>
                                      <td className="px-4 py-3 text-gray-400 italic max-w-xs truncate">{rule.extra}</td>
                                      <td className="px-4 py-3 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                          onClick={() => handleDeleteRule(chain.name, rule.num)}
                                          className="p-1.5 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center opacity-30 gap-6">
                        <div className="p-8 bg-white/5 rounded-full outline outline-1 outline-white/20 animate-pulse">
                          <Search className="w-16 h-16 text-sky-400" />
                        </div>
                        <p className="text-xl font-mono tracking-widest uppercase">Select a node or refresh rules</p>
                      </div>
                    )}
                  </>
                ) : (
                   <div className="h-full flex flex-col">
                      <div className="flex items-center justify-between mb-4">
                         <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">
                            <FileCode className="w-3 h-3" /> {selectedMachine.configPath}
                         </div>
                         <div className="flex items-center gap-2">
                             <div className="h-2 w-2 rounded-full bg-yellow-500" />
                             <span className="text-[10px] text-gray-500 uppercase font-bold">Unsaved Changes Detection Active</span>
                         </div>
                      </div>
                      <div className="flex-1 relative overflow-hidden bg-black/40 border border-white/10 rounded-2xl flex flex-col">
                         {showDiff ? (
                           <div className="flex-1 overflow-auto p-6 font-mono text-xs leading-relaxed">
                             {(() => {
                               const originalLines = originalConfigContent.split('\n');
                               const newLines = configContent.split('\n');
                               const diffItems: {type: 'add' | 'rem' | 'same', content: string}[] = [];
                               let i = 0, j = 0;
                               while(i < originalLines.length || j < newLines.length) {
                                 if (originalLines[i] === newLines[j]) {
                                   diffItems.push({type: 'same', content: originalLines[i]});
                                   i++; j++;
                                 } else {
                                   if (i < originalLines.length && !newLines.includes(originalLines[i])) {
                                     diffItems.push({type: 'rem', content: originalLines[i]});
                                     i++;
                                   } else if (j < newLines.length) {
                                     diffItems.push({type: 'add', content: newLines[j]});
                                     j++;
                                   } else {
                                     i++; j++;
                                   }
                                 }
                                 if(diffItems.length > 2000) break;
                               }
                               return diffItems.map((item, idx) => (
                                 <div key={idx} className={`flex gap-4 px-2 py-0.5 ${item.type === 'add' ? 'bg-green-500/10 text-green-400' : item.type === 'rem' ? 'bg-red-500/10 text-red-500 line-through opacity-70' : 'text-gray-400'}`}>
                                   <span className="w-6 opacity-30 select-none">{item.type === 'add' ? '+' : item.type === 'rem' ? '-' : ' '}</span>
                                   <span>{item.content || ' '}</span>
                                 </div>
                               ));
                             })()}
                           </div>
                         ) : (
                           <textarea 
                             value={configContent}
                             onChange={e => setConfigContent(e.target.value)}
                             className="w-full h-full p-6 font-mono text-sm outline-none bg-transparent shadow-inner resize-none text-gray-300"
                             spellCheck={false}
                           />
                         )}
                         {isLoading && (
                           <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px] z-10 rounded-2xl flex items-center justify-center">
                              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
                           </div>
                         )}
                      </div>
                   </div>
                )}
              </div>

              {/* Console/Log Panel */}
              <div className="w-96 border-l border-white/10 bg-black/40 flex flex-col">
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-bold font-mono tracking-widest uppercase">Command Log</span>
                  </div>
                  <button 
                    onClick={() => setLogs([])}
                    className="p-1 hover:bg-white/10 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-gray-500" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] space-y-2">
                  {logs.map((log, i) => (
                    <div key={i} className={`p-2 rounded border-l-2 ${
                      log.type === 'error' ? 'bg-red-500/10 border-red-500/50 text-red-200' :
                      log.type === 'success' ? 'bg-green-500/10 border-green-500/50 text-green-200' :
                      'bg-white/5 border-white/20 text-gray-300'
                    }`}>
                      {log.msg}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
                <div className="p-4 border-t border-white/10 bg-white/5">
                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span>SECURE SESSION ACTIVE</span>
                    </div>
                    <span>v1.0.4-BETA</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center technical-grid">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center space-y-6 max-w-md"
            >
              <div className="w-24 h-24 bg-sky-500/10 rounded-3xl outline outline-1 outline-sky-500/30 flex items-center justify-center mx-auto shadow-2xl">
                <Shield className="w-12 h-12 text-sky-400" />
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">System Ready</h2>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Welcome to Smart-IPTables Manager. Select a security node from the sidebar or add a new one to begin intelligent firewall orchestration.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10 text-left">
                  <Brain className="w-5 h-5 text-indigo-400 mb-2" />
                  <span className="block text-xs font-bold uppercase mb-1">AI Powered</span>
                  <p className="text-[10px] text-gray-500">Natural language intent to hardware rules.</p>
                </div>
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10 text-left">
                  <Activity className="w-5 h-5 text-green-400 mb-2" />
                  <span className="block text-xs font-bold uppercase mb-1">Live Sync</span>
                  <p className="text-[10px] text-gray-500">Real-time terminal audit and distribution.</p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </main>
    </div>
  );
}
