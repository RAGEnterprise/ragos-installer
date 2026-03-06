import { useEffect, useMemo, useState } from 'react';

function toAuthorizedKeys(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function Install({ wizard }) {
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null);
  const [status, setStatus] = useState(null);
  const [logTail, setLogTail] = useState('(sem log ainda)');
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);

  const payload = useMemo(() => ({
    eulaAccepted: wizard.eulaAccepted,
    diskMode: wizard.diskMode,
    sysDisk: wizard.sysDisk,
    dataDisk: wizard.diskMode === 'two' ? wizard.dataDisk || null : null,
    rootFs: wizard.diskMode === 'two' ? wizard.rootFs : null,
    dataFs: wizard.diskMode === 'two' ? wizard.dataFs : null,
    country: wizard.country,
    timeZone: wizard.timeZone,
    locale: wizard.locale,
    keyMap: wizard.keyMap,
    adminUser: wizard.adminUser,
    adminUid: Number(wizard.adminUid),
    adminEmail: wizard.adminEmail,
    adminPassword: wizard.adminPassword,
    adminPasswordConfirm: wizard.adminPasswordConfirm,
    adminAuthorizedKeys: toAuthorizedKeys(wizard.adminAuthorizedKeys),
    hostName: wizard.hostName,
    mgmtInterface: wizard.mgmtInterface,
    serverIp: wizard.serverIp,
    mgmtNetmask: wizard.mgmtNetmask,
    mgmtGateway: wizard.mgmtGateway,
    mgmtDns: wizard.mgmtDns,
    httpPort: Number(wizard.httpPort),
  }), [wizard]);

  useEffect(() => {
    let timer = null;
    if (started) {
      const poll = async () => {
        try {
          const [statusRes, logRes] = await Promise.all([fetch('/api/v1/status'), fetch('/api/v1/log')]);
          const statusJson = await statusRes.json();
          const logJson = await logRes.json();
          setStatus(statusJson);
          setLogTail(logJson.tail || '(sem log ainda)');
        } catch {
          // noop
        }
      };
      poll();
      timer = window.setInterval(poll, 1200);
    }
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [started]);

  async function handleStart() {
    try {
      setBusy(true);
      setError('');
      const planRes = await fetch('/api/v1/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const planJson = await planRes.json();
      if (!planRes.ok) throw new Error(typeof planJson === 'string' ? planJson : 'Falha ao gerar plano.');
      setPlan(planJson);

      const installRes = await fetch('/api/v1/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const installJson = await installRes.json();
      if (!installRes.ok) throw new Error(typeof installJson === 'string' ? installJson : 'Falha ao iniciar instalação.');
      setStarted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar instalação.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[0.95fr_1.05fr]">
      <section className="section-panel flex min-h-0 flex-col">
        <div className="mb-5">
          <h2 className="text-xl font-black text-white">Execução da instalação</h2>
          <p className="mt-2 text-sm text-slate-300">Gere o plano final no backend e acompanhe a instalação em tempo real.</p>
        </div>

        <div className="space-y-4">
          <button type="button" className="btn-primary" disabled={busy || started} onClick={handleStart}>
            {busy ? 'Iniciando…' : started ? 'Instalação iniciada' : 'Gerar plano e iniciar instalação'}
          </button>

          {error ? <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div> : null}

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Status</div>
            <div className="mt-2 text-white">{status?.installRunning ? 'Instalação em andamento' : started ? 'Aguardando resultado final' : 'Pronto para iniciar'}</div>
            <div className="mt-1 text-slate-400">Plano salvo: {status?.havePlan ? 'sim' : plan ? 'sim' : 'não'}</div>
            <div className="mt-1 text-slate-400">Último exit code: {status?.lastInstallExit ?? '—'}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Resumo do plano gerado</div>
            {plan ? (
              <div className="mt-3 space-y-1">
                <div>Host: <b>{plan.hostName}</b></div>
                <div>Timezone: <b>{plan.timeZone}</b></div>
                <div>Admin: <b>{plan.adminUser}</b></div>
                <div>Disco sistema: <b>{plan.sysDisk}</b></div>
              </div>
            ) : (
              <div className="mt-3 text-slate-500">O plano aparecerá aqui após a geração.</div>
            )}
          </div>
        </div>
      </section>

      <section className="section-panel flex min-h-0 flex-col overflow-hidden">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">Logs em tempo real</h3>
            <p className="mt-1 text-sm text-slate-400">Tail de `/var/log/ragos-install.log` via backend.</p>
          </div>
          <div className="metric-chip">{started ? 'polling' : 'idle'}</div>
        </div>

        <pre className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs leading-6 text-slate-200">{logTail}</pre>
      </section>
    </div>
  );
}
