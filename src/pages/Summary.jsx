export default function Summary({ wizard, onChange }) {
  const sshCount = String(wizard.adminAuthorizedKeys || '').split('\n').map((x) => x.trim()).filter(Boolean).length;

  return (
    <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="section-panel min-h-0 overflow-y-auto">
        <div className="mb-5">
          <h2 className="text-xl font-black text-white">Resumo final antes de instalar</h2>
          <p className="mt-2 text-sm text-slate-300">Revise tudo. Este é o último checkpoint antes de gerar o plano e iniciar a instalação com logs em tempo real.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Localização</div>
            <div className="mt-2 text-sm text-white">{wizard.country} • {wizard.locale} • {wizard.keyMap}</div>
            <div className="mt-1 text-sm text-slate-400">Timezone: {wizard.timeZone}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Rede</div>
            <div className="mt-2 text-sm text-white">{wizard.hostName}</div>
            <div className="mt-1 text-sm text-slate-300">WAN: {wizard.wanInterface || 'sem interface'}</div>
            <div className="mt-1 text-sm text-slate-300">LAN/PXE: {wizard.mgmtInterface || 'sem interface'}</div>
            <div className="mt-1 text-sm text-slate-400">IP: {wizard.serverIp} • GW: {wizard.mgmtGateway}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Discos</div>
            <div className="mt-2 text-sm text-white">Modo: {wizard.diskMode === 'two' ? 'Dois discos' : 'Um disco'}</div>
            <div className="mt-1 text-sm text-slate-300">Perfil: {wizard.storageProfile || 'padrão'}</div>
            <div className="mt-1 text-sm text-slate-400">Sistema: {wizard.sysDisk || '—'}{wizard.diskMode === 'two' ? ` • Dados: ${wizard.dataDisk || '—'}` : ''}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Admin</div>
            <div className="mt-2 text-sm text-white">{wizard.adminUser} • UID {wizard.adminUid}</div>
            <div className="mt-1 text-sm text-slate-400">{wizard.adminEmail} • {sshCount} chave(s) SSH</div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
          <div className="font-bold">Plano final de disco com confirmação destrutiva</div>
          <p className="mt-2">Os discos selecionados podem ser limpos e reformatados. Confira novamente sistema, dados, network e usuário antes de prosseguir.</p>
        </div>
      </section>

      <section className="section-panel flex min-h-0 flex-col justify-between">
        <div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Checklist crítico</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              <li>• EULA aceito: {wizard.eulaAccepted ? 'sim' : 'não'}</li>
              <li>• WAN selecionada: {wizard.wanInterface || 'pendente'}</li>
              <li>• LAN/PXE selecionada: {wizard.mgmtInterface || 'pendente'}</li>
              <li>• WAN confirmada fisicamente: {wizard.wanIdentified ? 'sim' : 'não'}</li>
              <li>• LAN/PXE confirmada fisicamente: {wizard.lanIdentified ? 'sim' : 'não'}</li>
              <li>• Timezone: {wizard.timeZone}</li>
              <li>• Senha definida: {wizard.adminPassword ? 'sim' : 'não'}</li>
              <li>• Plano destrutivo entendido: {wizard.destructiveConfirmed ? 'sim' : 'não'}</li>
            </ul>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 rounded border-white/20 bg-slate-950 text-accent-500"
              checked={wizard.destructiveConfirmed}
              onChange={(event) => onChange({ destructiveConfirmed: event.target.checked })}
            />
            <div>
              <div className="font-semibold text-white">Confirmo que este plano pode apagar dados</div>
              <div className="mt-1 text-sm text-slate-300">Entendo que os discos selecionados serão alterados pela instalação unattended.</div>
            </div>
          </label>
        </div>

        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-cyan-50">
          A próxima etapa gera o plano via backend e permite iniciar a instalação com logs ao vivo.
        </div>
      </section>
    </div>
  );
}
