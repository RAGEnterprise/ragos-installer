import { useEffect, useMemo, useState } from 'react';

const lanSuggestions = [
  { value: '10.0.0.1', label: 'Padrão enterprise' },
  { value: '172.16.0.1', label: 'Rede privada classe B' },
  { value: '192.168.100.1', label: 'Classe C isolada' },
];

function isValidIpv4(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (part === '' || Number.isNaN(Number(part))) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function subnet24(ip) {
  if (!isValidIpv4(ip)) return '';
  return ip.split('.').slice(0, 3).join('.');
}

export default function Network({ wizard, onChange }) {
  const [interfaces, setInterfaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPppoePassword, setShowPppoePassword] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError('');
        const response = await fetch('/api/v1/netifs');
        const payload = await response.json();
        if (!response.ok) {
          throw new Error('Falha ao carregar interfaces de rede.');
        }
        const next = Array.isArray(payload.interfaces) ? payload.interfaces : [];
        if (!cancelled) {
          setInterfaces(next);
          const nextPatch = { netIfacesCount: next.length };

          const hasMgmt = wizard.mgmtInterface && next.includes(wizard.mgmtInterface);
          const hasWan = wizard.wanInterface && next.includes(wizard.wanInterface);

          if (!hasMgmt && next.length > 0) {
            nextPatch.mgmtInterface = next[0];
          }

          if (!hasWan) {
            if (next.length > 1) {
              const lan = nextPatch.mgmtInterface || wizard.mgmtInterface || next[0];
              nextPatch.wanInterface = next.find((item) => item !== lan) || '';
            } else {
              nextPatch.wanInterface = '';
            }
          }

          onChange(nextPatch);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar interfaces.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [onChange, wizard.mgmtInterface, wizard.wanInterface]);

  const subnetConflict = useMemo(() => subnet24(wizard.serverIp) === subnet24(wizard.lanAddress), [wizard.serverIp, wizard.lanAddress]);
  const sameNicSelected = wizard.mgmtInterface && wizard.wanInterface && wizard.mgmtInterface === wizard.wanInterface;
  const hasTwoNics = interfaces.length >= 2;

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-2">
      <section className="section-panel flex min-h-0 flex-col overflow-hidden">
        <div className="mb-4 flex items-center justify-between gap-4 border-b border-white/10 pb-3">
          <div>
            <h3 className="text-xl font-bold text-white">WAN (Uplink)</h3>
            <p className="mt-1 text-sm text-slate-400">Interface de entrada da internet (uplink) para o gateway.</p>
          </div>
          <div className={`metric-chip ${wizard.wanInterface ? 'text-emerald-300' : 'text-rose-300'}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${wizard.wanInterface ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            {wizard.wanInterface || (loading ? 'Detectando…' : 'Sem WAN')}
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            <div className="font-semibold text-amber-50">Obrigatório para gateway: 2 placas distintas</div>
            <div className="mt-1">1 interface dedicada para WAN (entrada da internet) e 1 interface dedicada para LAN/PXE/Wi-Fi interna.</div>
          </div>

          <div>
            <label className="label-text" htmlFor="wanInterface">Interface WAN</label>
            <select
              id="wanInterface"
              className="input-shell"
              value={wizard.wanInterface}
              onChange={(event) => onChange({ wanInterface: event.target.value, wanIdentified: false })}
            >
              <option value="">Selecione uma interface</option>
              {interfaces.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
            {!error && !hasTwoNics && !loading ? (
              <p className="mt-2 text-sm text-rose-300">
                São necessárias 2 placas físicas: 1 LAN/PXE e 1 WAN. Apenas {interfaces.length} detectada(s).
              </p>
            ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              className={wizard.wanMode === 'dhcp' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => onChange({ wanMode: 'dhcp' })}
            >
              DHCP (Automático)
            </button>
            <button
              type="button"
              className={wizard.wanMode === 'static' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => onChange({ wanMode: 'static' })}
            >
              IP Estático
            </button>
            <button
              type="button"
              className={wizard.wanMode === 'pppoe' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => onChange({ wanMode: 'pppoe' })}
            >
              PPPoE
            </button>
          </div>

          {wizard.wanMode === 'dhcp' ? (
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              A UI está pronta para DHCP. Para status real de link/IP obtido, basta o backend expor `nmcli`/`ip` em um endpoint dedicado.
            </div>
          ) : wizard.wanMode === 'static' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label-text" htmlFor="wanAddress">IP WAN</label>
                <input id="wanAddress" className="input-shell" value={wizard.wanAddress} onChange={(e) => onChange({ wanAddress: e.target.value })} />
              </div>
              <div>
                <label className="label-text" htmlFor="wanGateway">Gateway WAN</label>
                <input id="wanGateway" className="input-shell" value={wizard.wanGateway} onChange={(e) => onChange({ wanGateway: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label-text" htmlFor="wanDns">DNS WAN</label>
                <input id="wanDns" className="input-shell" value={wizard.wanDns} onChange={(e) => onChange({ wanDns: e.target.value })} />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-blue-500/30 bg-blue-900/20 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label-text" htmlFor="pppoeUser">Usuário PPPoE</label>
                  <input
                    id="pppoeUser"
                    className="input-shell"
                    placeholder="usuario@provedor"
                    value={wizard.pppoeUser || ''}
                    onChange={(e) => onChange({ pppoeUser: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label-text" htmlFor="pppoePassword">Senha PPPoE</label>
                  <div className="flex gap-2">
                    <input
                      id="pppoePassword"
                      type={showPppoePassword ? 'text' : 'password'}
                      className="input-shell flex-1"
                      value={wizard.pppoePassword || ''}
                      onChange={(e) => onChange({ pppoePassword: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn-secondary !px-3 !py-2"
                      onClick={() => setShowPppoePassword((prev) => !prev)}
                      aria-label={showPppoePassword ? 'Ocultar senha PPPoE' : 'Revelar senha PPPoE'}
                    >
                      {showPppoePassword ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
              </div>
              {!String(wizard.pppoeUser || '').trim() || !String(wizard.pppoePassword || '').trim() ? (
                <p className="mt-2 text-sm text-rose-300">PPPoE exige usuário e senha para habilitar o avanço.</p>
              ) : null}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label-text" htmlFor="hostName">Hostname</label>
              <input id="hostName" className="input-shell" value={wizard.hostName} onChange={(e) => onChange({ hostName: e.target.value })} />
            </div>
            <div>
              <label className="label-text" htmlFor="serverIp">IP do Servidor</label>
              <input id="serverIp" className="input-shell" value={wizard.serverIp} onChange={(e) => onChange({ serverIp: e.target.value })} />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
            <div className="font-semibold text-white">Plano de identificação física das portas</div>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-slate-300">
              <li>Conecte apenas o cabo de internet na porta candidata à WAN.</li>
              <li>Conecte notebook/switch de teste apenas na porta candidata à LAN/PXE.</li>
              <li>Selecione as interfaces abaixo e valide: WAN com uplink, LAN sem rota para internet direta.</li>
            </ol>

            <div className="mt-4 space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/20 bg-slate-950"
                  checked={Boolean(wizard.wanIdentified)}
                  onChange={(event) => onChange({ wanIdentified: event.target.checked })}
                />
                <span>Confirmei fisicamente a porta WAN ({wizard.wanInterface || 'não selecionada'}).</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/20 bg-slate-950"
                  checked={Boolean(wizard.lanIdentified)}
                  onChange={(event) => onChange({ lanIdentified: event.target.checked })}
                />
                <span>Confirmei fisicamente a porta LAN/PXE ({wizard.mgmtInterface || 'não selecionada'}).</span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="section-panel flex min-h-0 flex-col overflow-hidden">
        <div className="mb-4 flex items-center justify-between gap-4 border-b border-white/10 pb-3">
          <div>
            <h3 className="text-xl font-bold text-white">LAN (Interna)</h3>
            <p className="mt-1 text-sm text-slate-400">Interface da rede interna (PXE/Wi-Fi/LAN) e parâmetros de serviço local.</p>
          </div>
          <div className={`metric-chip ${wizard.mgmtInterface ? 'text-emerald-300' : 'text-rose-300'}`}>LAN/PXE</div>
        </div>

        <div className="grid gap-4">
          <div>
            <label className="label-text" htmlFor="mgmtInterface">Interface LAN/PXE</label>
            <select
              id="mgmtInterface"
              className="input-shell"
              value={wizard.mgmtInterface}
              onChange={(event) => onChange({ mgmtInterface: event.target.value, lanIdentified: false })}
            >
              <option value="">Selecione uma interface</option>
              {interfaces.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          {sameNicSelected ? (
            <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-200">
              WAN e LAN/PXE não podem usar a mesma placa de rede.
            </div>
          ) : null}

          <div>
            <label className="label-text" htmlFor="lanAddress">Endereço IP da LAN</label>
            <input
              id="lanAddress"
              list="lan-suggestions"
              className="input-shell"
              value={wizard.lanAddress}
              onChange={(event) => onChange({ lanAddress: event.target.value })}
            />
            <datalist id="lan-suggestions">
              {lanSuggestions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </datalist>
            {subnetConflict ? (
              <p className="mt-2 text-sm text-rose-300">A LAN não pode estar na mesma sub-rede da WAN/gerência.</p>
            ) : (
              <p className="mt-2 text-sm text-slate-400">Sugestões rápidas baseadas em redes privadas padrão.</p>
            )}
          </div>

          <div>
            <label className="label-text" htmlFor="lanNetmask">Máscara da LAN</label>
            <select id="lanNetmask" className="input-shell" value={wizard.lanNetmask} onChange={(e) => onChange({ lanNetmask: e.target.value })}>
              <option value="255.255.255.0">255.255.255.0 (/24)</option>
              <option value="255.255.0.0">255.255.0.0 (/16)</option>
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label-text" htmlFor="mgmtGateway">Gateway</label>
              <input id="mgmtGateway" className="input-shell" value={wizard.mgmtGateway} onChange={(e) => onChange({ mgmtGateway: e.target.value })} />
            </div>
            <div>
              <label className="label-text" htmlFor="mgmtDns">DNS</label>
              <input id="mgmtDns" className="input-shell" value={wizard.mgmtDns} onChange={(e) => onChange({ mgmtDns: e.target.value })} />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
            <div className="font-semibold text-white">Validação visual</div>
            <ul className="mt-3 space-y-2 text-slate-400">
              <li>• Interfaces detectadas: {interfaces.length}</li>
              <li>• WAN selecionada: {wizard.wanInterface || 'pendente'}</li>
              <li>• LAN/PXE selecionada: {wizard.mgmtInterface || 'pendente'}</li>
              <li>• WAN/LAN distintas: {sameNicSelected ? 'não' : 'sim'}</li>
              <li>• WAN confirmada fisicamente: {wizard.wanIdentified ? 'sim' : 'não'}</li>
              <li>• LAN/PXE confirmada fisicamente: {wizard.lanIdentified ? 'sim' : 'não'}</li>
              <li>• IP do servidor válido: {isValidIpv4(wizard.serverIp) ? 'sim' : 'não'}</li>
              <li>• LAN válida: {isValidIpv4(wizard.lanAddress) ? 'sim' : 'não'}</li>
              <li>• Conflito de rota/sub-rede: {subnetConflict ? 'sim' : 'não'}</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
