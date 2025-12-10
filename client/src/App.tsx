import { useState, useEffect, useRef } from "react";
import { useAccount, useConnect, useDisconnect, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useChainId } from "wagmi";
import { useQuery, useMutation } from "@tanstack/react-query";
import { injected } from "wagmi/connectors";
import { FAUCET_ADDRESS } from "./config";
import ArcMiningFaucetABI from "./abi/ArcMiningFaucet.json";
import USDCABI from "./abi/USDC.json";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wallet, Zap, Timer, AlertCircle, Terminal, Cpu, Play, Pause, Square, Banknote, History, DollarSign, Monitor, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatUnits } from "viem";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ClaimHistory } from "@shared/schema";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const MAX_CLAIM_LIMIT = BigInt(2000 * 1000000); // 2000 USDC with 6 decimals

const formatUSDC = (value: bigint | undefined) => {
  if (!value) return "0.00";
  return parseFloat(formatUnits(value, 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatTime = (ms: number) => {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / 1000 / 60) % 60);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

interface MiningLog {
  id: number;
  timestamp: string;
  type: 'block' | 'share' | 'info' | 'reward';
  message: string;
}

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const currentChainId = useChainId();
  
  const { writeContract, data: hash, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const [miningState, setMiningState] = useState<'idle' | 'mining' | 'paused' | 'completed'>('idle');
  const [progress, setProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(600000);
  const [hashRate, setHashRate] = useState(0);
  const [pausedProgress, setPausedProgress] = useState(0);
  const [pausedTimeLeft, setPausedTimeLeft] = useState(0);
  const [showStopWarning, setShowStopWarning] = useState(false);
  
  const [cpuEnabled, setCpuEnabled] = useState(true);
  const [gpuEnabled, setGpuEnabled] = useState(false);
  
  const [miningLogs, setMiningLogs] = useState<MiningLog[]>([]);
  const [blocksFound, setBlocksFound] = useState(0);
  const [sharesFound, setSharesFound] = useState(0);
  const [canFindShares, setCanFindShares] = useState(false);
  const [displayedReward, setDisplayedReward] = useState(0);
  const logIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isConnected) {
      connect({ connector: injected() });
    }
  }, [connect, isConnected]);

  useEffect(() => {
    if (isConnected && currentChainId !== 5042002) {
      switchChain({ chainId: 5042002 });
    }
  }, [isConnected, currentChainId, switchChain]);

  const { data: claimData, refetch: refetchClaimInfo } = useReadContract({
    address: FAUCET_ADDRESS,
    abi: ArcMiningFaucetABI,
    functionName: "claimInfo",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const { data: contractBalance, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDCABI,
    functionName: "balanceOf",
    args: [FAUCET_ADDRESS],
    query: {
      refetchInterval: 10000,
    },
  });

  const { data: claimHistoryData } = useQuery<ClaimHistory[]>({
    queryKey: ['/api/claim-history'],
    enabled: !!address,
  });

  const createClaimMutation = useMutation({
    mutationFn: async (data: { walletAddress: string; amount: string; transactionHash?: string }) => {
      const res = await apiRequest('POST', '/api/claim-history', data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/claim-history'] });
    },
  });

  const totalClaimed = claimData ? (claimData as any)[0] : BigInt(0);
  const remainingAllowance = claimData ? (claimData as any)[1] : BigInt(0);
  
  // Check if wallet has reached the 2000 USDC limit
  const hasReachedLimit = totalClaimed >= MAX_CLAIM_LIMIT;

  const getHashRateRange = () => {
    if (cpuEnabled && gpuEnabled) {
      return { min: 400, max: 700 };
    } else if (gpuEnabled) {
      return { min: 300, max: 500 };
    } else if (cpuEnabled) {
      return { min: 100, max: 200 };
    }
    return { min: 0, max: 0 };
  };

  const addLog = (type: MiningLog['type'], message: string) => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false });
    logIdRef.current += 1;
    const newLog: MiningLog = {
      id: logIdRef.current,
      timestamp,
      type,
      message,
    };
    setMiningLogs(prev => [...prev.slice(-50), newLog]);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [miningLogs]);

  useEffect(() => {
    if (miningState === 'mining') {
      const startTime = Date.now();
      const initialProgress = pausedProgress;
      const remainingTime = pausedTimeLeft || 600000;
      const endTime = startTime + remainingTime;
      const range = getHashRateRange();

      if (miningLogs.length === 0 || pausedProgress === 0) {
        addLog('info', 'Connecting to Arc Testnet Node...');
        addLog('info', 'Connection established successfully');
        addLog('info', `Mining started with ${cpuEnabled ? 'CPU' : ''}${cpuEnabled && gpuEnabled ? ' + ' : ''}${gpuEnabled ? 'GPU' : ''}`);
      }

      const timer = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(0, endTime - now);
        const elapsed = remainingTime - remaining;
        const additionalProgress = (elapsed / 600000) * 100;
        const p = Math.min(100, initialProgress + additionalProgress);
        
        setTimeLeft(remaining);
        setProgress(p);
        
        const newHashRate = range.min + Math.random() * (range.max - range.min);
        setHashRate(newHashRate);

        if (remaining <= 0) {
          setMiningState('completed');
          setProgress(100);
          setDisplayedReward(200);
          clearInterval(timer);
          addLog('reward', 'Mining session completed! 200 USDC ready to claim');
          toast({
            title: "Mining Complete!",
            description: "200 USDC ready to claim.",
          });
        }
      }, 100);

      const logTimer = setInterval(() => {
        const rand = Math.random();
        if (rand < 0.15) {
          const blockHash = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
          addLog('block', `Block found! Hash: 0x${blockHash}...`);
          setBlocksFound(prev => prev + 1);
          setCanFindShares(true);
        } else if (rand < 0.45) {
          setCanFindShares(prev => {
            if (prev) {
              const shareNum = Math.floor(Math.random() * 1000000);
              addLog('share', `Share accepted #${shareNum.toString(16).toUpperCase()}`);
              setSharesFound(prevShares => prevShares + 1);
              setDisplayedReward(prevReward => {
                const increment = (200 / 100) * (100 / 600);
                return Math.min(200, prevReward + increment);
              });
            }
            return prev;
          });
        } else if (rand < 0.6) {
          const range = getHashRateRange();
          const hr = range.min + Math.random() * (range.max - range.min);
          addLog('info', `Hashrate: ${hr.toFixed(2)} MH/s`);
        }
      }, 800);

      return () => {
        clearInterval(timer);
        clearInterval(logTimer);
      };
    }
  }, [miningState, pausedProgress, pausedTimeLeft, cpuEnabled, gpuEnabled]);

  const startMining = () => {
    if (hasReachedLimit) {
      toast({
        variant: "destructive",
        title: "Limit Reached",
        description: "Your wallet has reached the maximum claim limit of 2000 USDC.",
      });
      return;
    }
    if (!cpuEnabled && !gpuEnabled) {
      toast({
        variant: "destructive",
        title: "No Mining Device",
        description: "Please enable CPU or GPU to start mining.",
      });
      return;
    }
    setMiningState('mining');
    setTimeLeft(600000);
    setProgress(0);
    setDisplayedReward(0);
    setPausedProgress(0);
    setPausedTimeLeft(0);
    setMiningLogs([]);
    setBlocksFound(0);
    setSharesFound(0);
    setCanFindShares(false);
  };

  const pauseMining = () => {
    setPausedProgress(progress);
    setPausedTimeLeft(timeLeft);
    setMiningState('paused');
    addLog('info', 'Mining paused by user');
  };

  const continueMining = () => {
    addLog('info', 'Mining resumed');
    setMiningState('mining');
  };

  const openStopWarning = () => {
    setShowStopWarning(true);
  };

  const confirmStop = () => {
    setShowStopWarning(false);
    setMiningState('idle');
    setProgress(0);
    setTimeLeft(600000);
    setDisplayedReward(0);
    setPausedProgress(0);
    setPausedTimeLeft(0);
    setMiningLogs([]);
    setBlocksFound(0);
    setSharesFound(0);
    setCanFindShares(false);
    toast({
      variant: "destructive",
      title: "Mining Stopped",
      description: "All mined balance has been lost. Start again to mine.",
    });
  };

  const cancelStopWarning = () => {
    setShowStopWarning(false);
  };

  const handleClaim = () => {
    if (!isConnected || !address) return;
    
    writeContract({
      address: FAUCET_ADDRESS,
      abi: ArcMiningFaucetABI,
      functionName: "claim",
      chainId: 5042002,
    });
  };

  useEffect(() => {
    if (isConfirmed && hash && address) {
      createClaimMutation.mutate({
        walletAddress: address,
        amount: "200.000000",
        transactionHash: hash,
      });

      toast({
        title: "Claim Successful!",
        description: "200 USDC has been sent to your wallet.",
      });
      setMiningState('idle');
      setDisplayedReward(0);
      setProgress(0);
      setPausedProgress(0);
      setPausedTimeLeft(0);
      setMiningLogs([]);
      setCanFindShares(false);
      setBlocksFound(0);
      setSharesFound(0);
      refetchClaimInfo();
      refetchBalance();
    }
  }, [isConfirmed, hash, address]);

  useEffect(() => {
    if (writeError) {
      toast({
        variant: "destructive",
        title: "Claim Failed",
        description: writeError.message,
      });
    }
  }, [writeError]);

  const getLogColor = (type: MiningLog['type']) => {
    switch (type) {
      case 'block': return 'text-yellow-400';
      case 'share': return 'text-green-400';
      case 'reward': return 'text-cyan-400';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8 font-mono relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50"></div>
      
      <div className="max-w-6xl mx-auto space-y-8 relative z-10">
        
        <header className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-border/40 pb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/50">
              <Cpu className="w-6 h-6 text-primary animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tighter" data-testid="text-app-title">ArcMiner</h1>
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Testnet Simulation Node</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {isConnected ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 bg-card border border-border rounded-md px-4 py-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium" data-testid="text-wallet-address">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
                    <Badge variant="outline" className="text-xs px-1 py-0 h-4 w-fit" data-testid="badge-network">Arc Testnet</Badge>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => disconnect()} className="h-6 ml-2 text-xs" data-testid="button-disconnect">
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => connect({ connector: injected() })} className="bg-primary hover:bg-primary/90 text-primary-foreground" data-testid="button-connect">
                <Wallet className="w-4 h-4 mr-2" /> Connect Wallet
              </Button>
            )}
          </div>
        </header>

        {!isConnected && (
          <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-6">
            <div className="w-24 h-24 rounded-2xl bg-primary/20 flex items-center justify-center border border-primary/50 shadow-[0_0_30px_rgba(124,58,237,0.3)]">
              <Cpu className="w-12 h-12 text-primary" />
            </div>
            <div className="space-y-2 max-w-md">
              <h2 className="text-3xl font-bold tracking-tighter">Welcome to ArcMiner</h2>
              <p className="text-muted-foreground">Connect your wallet to start simulating mining operations on the Arc Testnet and earn USDC rewards.</p>
            </div>
          </div>
        )}

        {isConnected && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Wallet className="w-4 h-4" /> Total Claimed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-total-claimed">{formatUSDC(totalClaimed)} USDC</div>
                  <Progress value={Number(totalClaimed) / 20000} className="h-1 mt-2 bg-primary/10" />
                  <p className="text-xs text-muted-foreground mt-1">Limit: 2,000.00 USDC</p>
                </CardContent>
              </Card>

              <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Zap className="w-4 h-4" /> Allowance Remaining
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-allowance-remaining">{formatUSDC(remainingAllowance)} USDC</div>
                  <Progress value={Number(remainingAllowance) / 20000} className="h-1 mt-2 bg-primary/10" />
                </CardContent>
              </Card>

              <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <DollarSign className="w-4 h-4" /> Contract Balance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-500" data-testid="text-contract-balance">{formatUSDC(contractBalance as bigint)} USDC</div>
                  <p className="text-xs text-muted-foreground mt-1">Available in Mining Pool</p>
                </CardContent>
              </Card>
            </div>

            {hasReachedLimit && (
              <Alert className="bg-red-500/10 border-red-500/50">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <AlertTitle className="text-red-500">Mining Disabled</AlertTitle>
                <AlertDescription className="text-red-400">
                  Your wallet has reached the maximum claim limit of 2,000 USDC. Mining is no longer available for this wallet.
                </AlertDescription>
              </Alert>
            )}

            <Card className="border-primary/50 bg-black/40 backdrop-blur-md overflow-hidden relative">
              <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
              
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="w-5 h-5 text-primary" />
                      Mining Console v1.0.5
                    </CardTitle>
                    <CardDescription>
                      Select your mining devices and start earning USDC rewards.
                    </CardDescription>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      variant={cpuEnabled ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCpuEnabled(!cpuEnabled)}
                      disabled={miningState === 'mining' || miningState === 'paused'}
                      className={`gap-2 ${cpuEnabled ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                      data-testid="button-toggle-cpu"
                    >
                      <Cpu className="w-4 h-4" />
                      CPU
                    </Button>
                    <Button
                      variant={gpuEnabled ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGpuEnabled(!gpuEnabled)}
                      disabled={miningState === 'mining' || miningState === 'paused'}
                      className={`gap-2 ${gpuEnabled ? 'bg-green-600 hover:bg-green-700' : ''}`}
                      data-testid="button-toggle-gpu"
                    >
                      <Monitor className="w-4 h-4" />
                      GPU
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-6 relative">
                
                <div 
                  ref={scrollRef}
                  className="h-48 rounded-lg border border-border bg-black/60 p-4 font-mono text-xs overflow-y-auto relative"
                >
                  {miningState === 'idle' && miningLogs.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center flex-col gap-4">
                      <div className="w-16 h-16 rounded-full border-2 border-dashed border-muted-foreground animate-[spin_10s_linear_infinite]"></div>
                      <p className="text-muted-foreground">System Idle. Ready to initialize.</p>
                    </div>
                  )}

                  {miningState === 'paused' && (
                    <div className="absolute inset-0 flex items-center justify-center flex-col gap-4 bg-black/80">
                      <Pause className="w-16 h-16 text-yellow-500" />
                      <p className="text-yellow-500 font-bold">Mining Paused</p>
                      <p className="text-muted-foreground text-center">Timer paused. Click Continue to resume.</p>
                    </div>
                  )}

                  {miningState === 'completed' && (
                    <div className="absolute inset-0 flex items-center justify-center flex-col gap-4 bg-black/80">
                      <Banknote className="w-16 h-16 text-green-500" />
                      <p className="text-green-500 font-bold text-xl">200 USDC Ready!</p>
                      <p className="text-muted-foreground text-center">Click Claim to receive your rewards.</p>
                    </div>
                  )}

                  {miningLogs.length > 0 && miningState !== 'paused' && miningState !== 'completed' && (
                    <div className="space-y-1">
                      {miningState === 'mining' && (
                        <div className="absolute inset-0 opacity-10 animate-scan bg-gradient-to-b from-transparent via-primary to-transparent h-[50%] w-full pointer-events-none"></div>
                      )}
                      {miningLogs.map((log) => (
                        <p key={log.id} className={getLogColor(log.type)}>
                          <span className="text-muted-foreground">[{log.timestamp}]</span> {log.message}
                        </p>
                      ))}
                      {miningState === 'mining' && <p className="text-green-500 animate-pulse">_</p>}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div className="bg-black/40 rounded-md p-3 border border-border">
                    <p className="text-xs text-muted-foreground">Hashrate</p>
                    <p className="text-lg font-bold text-primary" data-testid="text-hashrate">
                      {miningState === 'mining' ? hashRate.toFixed(2) : '0.00'} MH/s
                    </p>
                  </div>
                  <div className="bg-black/40 rounded-md p-3 border border-border">
                    <p className="text-xs text-muted-foreground">Shares Found</p>
                    <p className="text-lg font-bold text-green-500" data-testid="text-shares">{sharesFound}</p>
                  </div>
                  <div className="bg-black/40 rounded-md p-3 border border-border">
                    <p className="text-xs text-muted-foreground">Blocks Found</p>
                    <p className="text-lg font-bold text-yellow-500" data-testid="text-blocks">{blocksFound}</p>
                  </div>
                  <div className="bg-black/40 rounded-md p-3 border border-border">
                    <p className="text-xs text-muted-foreground">Pending Reward</p>
                    <p className="text-lg font-bold text-cyan-400" data-testid="text-pending-reward">{displayedReward.toFixed(2)} USDC</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Session Progress</span>
                    <div className="flex gap-4">
                      <span className="text-primary font-bold">{displayedReward.toFixed(2)} / 200.00 USDC</span>
                      <span className="font-bold">{Math.round(progress)}%</span>
                    </div>
                  </div>
                  <Progress value={progress} className="h-3 bg-secondary" />
                  
                  <div className="flex justify-between items-center pt-4 flex-wrap gap-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Time Remaining: </span>
                      <span className="font-bold font-mono">{formatTime(timeLeft)}</span>
                    </div>

                    {miningState === 'idle' && (
                      <Button 
                        onClick={startMining} 
                        disabled={hasReachedLimit || (!cpuEnabled && !gpuEnabled)}
                        className="w-48 bg-primary hover:bg-primary/90"
                        data-testid="button-start-mining"
                      >
                        <Play className="w-4 h-4 mr-2" /> Iniciar Mineracao
                      </Button>
                    )}

                    {miningState === 'mining' && (
                      <div className="flex gap-2 flex-wrap">
                        <Button 
                          onClick={pauseMining}
                          variant="secondary"
                          data-testid="button-pause-mining"
                        >
                          <Pause className="w-4 h-4 mr-2" /> Pausar Mineracao
                        </Button>
                        <Button 
                          onClick={openStopWarning}
                          variant="destructive"
                          data-testid="button-stop-mining"
                        >
                          <Square className="w-4 h-4 mr-2" /> Parar Mineracao
                        </Button>
                      </div>
                    )}

                    {miningState === 'paused' && (
                      <div className="flex gap-2 flex-wrap">
                        <Button 
                          onClick={continueMining}
                          className="bg-primary hover:bg-primary/90"
                          data-testid="button-continue-mining"
                        >
                          <Play className="w-4 h-4 mr-2" /> Continuar Mineracao
                        </Button>
                        <Button 
                          onClick={openStopWarning}
                          variant="destructive"
                          data-testid="button-stop-mining-paused"
                        >
                          <Square className="w-4 h-4 mr-2" /> Parar Mineracao
                        </Button>
                      </div>
                    )}

                    {miningState === 'completed' && (
                      <Button 
                        onClick={handleClaim} 
                        disabled={isConfirming}
                        className="w-48 bg-green-600 hover:bg-green-700 text-white"
                        data-testid="button-claim"
                      >
                        {isConfirming ? (
                          <>Confirming...</>
                        ) : (
                          <><Banknote className="w-4 h-4 mr-2" /> Claim 200 USDC</>
                        )}
                      </Button>
                    )}
                  </div>
                </div>

              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Alert className="bg-primary/5 border-primary/20">
                <AlertCircle className="h-4 w-4 text-primary" />
                <AlertTitle>System Rules</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground space-y-1 mt-2">
                  <p>Each mining session lasts 10 minutes.</p>
                  <p>Complete session reward: 200 USDC.</p>
                  <p>Each wallet can receive up to 2,000 USDC total.</p>
                  <p>Pausing the mining also pauses the timer.</p>
                  <p className="text-red-400 font-semibold">Stopping the mining will reset all mined balance!</p>
                  <p className="break-all mt-2">Contract: {FAUCET_ADDRESS}</p>
                </AlertDescription>
              </Alert>

              <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <History className="w-4 h-4" /> Claim History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {claimHistoryData && claimHistoryData.length > 0 ? (
                      claimHistoryData.map((claim) => (
                        <div key={claim.id} className="flex justify-between items-center text-xs border-b border-border/20 pb-2" data-testid={`claim-history-${claim.id}`}>
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-muted-foreground">{claim.walletAddress.slice(0, 6)}...{claim.walletAddress.slice(-4)}</span>
                            <span className="text-muted-foreground">{new Date(claim.claimedAt).toLocaleDateString()}</span>
                          </div>
                          <span className="font-bold text-green-500">+{parseFloat(claim.amount).toFixed(2)} USDC</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-4">No claims yet</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        <footer className="border-t border-border/40 pt-6 pb-4">
          <div className="text-center space-y-2">
            <p className="text-lg font-bold">ArcMiner</p>
            <p className="text-xs text-muted-foreground">2025 ArcMiner - Built on Arc Network. All rights reserved.</p>
          </div>
        </footer>
      </div>

      <Dialog open={showStopWarning} onOpenChange={setShowStopWarning}>
        <DialogContent data-testid="dialog-stop-warning" className="border-red-500/50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <AlertTriangle className="w-5 h-5" />
              Warning: Stop Mining
            </DialogTitle>
            <DialogDescription className="text-red-400">
              Are you sure you want to stop mining?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Alert className="bg-red-500/10 border-red-500/50">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <AlertTitle className="text-red-500">You will lose all mined balance!</AlertTitle>
              <AlertDescription className="text-red-400 mt-2">
                <p>Current mined: <span className="font-bold">{displayedReward.toFixed(2)} USDC</span></p>
                <p>Progress: <span className="font-bold">{Math.round(progress)}%</span></p>
                <p className="mt-2">If you stop now, you will need to start from zero and mine for 10 minutes again to earn 200 USDC.</p>
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              onClick={cancelStopWarning}
              variant="outline"
              className="w-full sm:w-auto"
              data-testid="button-cancel-stop"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmStop}
              variant="destructive"
              className="w-full sm:w-auto"
              data-testid="button-confirm-stop"
            >
              <Square className="w-4 h-4 mr-2" />
              Yes, Stop Mining
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
