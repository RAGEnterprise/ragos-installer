import { useEffect, useMemo, useState } from 'react';

const filesystemOptions = ['btrfs', 'ext4', 'xfs'];
const raidLevels = [
  { id: 'raid0', label: 'RAID 0 (Performance)', minDisks: 2 },
  { id: 'raid1', label: 'RAID 1 (Espelhamento)', minDisks: 2 },
  { id: 'raid5', label: 'RAID 5 (Paridade)', minDisks: 3 },
  { id: 'raid10', label: 'RAID 10 (Espelhamento + Striping)', minDisks: 4 },
];

function bytesToHuman(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = units[0];
  for (let i = 0; i < units.length; i += 1) {
    unit = units[i];
    if (size < 1024 || i === units.length - 1) break;
    size /= 1024;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${unit}`;
}

function getSizeBytes(node) {
  const raw = node?.sizeBytes ?? node?.size;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeSegments(layoutPayload) {
  const disk = layoutPayload?.disk;
  if (!disk) {
    return { totalBytes: 0, segments: [] };
  }

  const totalBytes = Number(layoutPayload?.sizeBytes || getSizeBytes(disk));
  const children = Array.isArray(disk.children) ? disk.children : [];

  const segments = children.map((child) => ({
    id: child.path || child.name || child.mountpoint || Math.random().toString(36),
    label: child.path || child.name || child.mountpoint || 'partição',
    mountpoint: child.mountpoint || '—',
    fsType: child.fstype || 'raw',
    sizeBytes: getSizeBytes(child),
  }));

  return { totalBytes, segments };
}

function createPlanSegments(totalBytes, wizard, role) {
  if (!totalBytes) return [];

  const efiBytes = Math.max(Math.min(totalBytes * 0.04, 1024 ** 3), 512 * 1024 * 1024);

  if (wizard.diskProfile === 'raid') {
    return [
      { id: 'efi', label: 'EFI', fsType: 'vfat', mountpoint: '/boot', sizeBytes: efiBytes, tone: 'bg-cyan-400/70' },
      {
        id: 'raid',
        label: `${String(wizard.raidLevel || 'RAID').toUpperCase()} array`,
        fsType: role === 'system' ? wizard.rootFs : wizard.dataFs,
        mountpoint: role === 'system' ? '/' : '/srv/data',
        sizeBytes: Math.max(totalBytes - efiBytes, 0),
        tone: role === 'system' ? 'bg-indigo-400/70' : 'bg-emerald-400/70',
      },
    ];
  }

  if (wizard.diskMode === 'one') {
    return [
      { id: 'efi', label: 'EFI', fsType: 'vfat', mountpoint: '/boot', sizeBytes: efiBytes, tone: 'bg-cyan-400/70' },
      { id: 'root', label: 'RAGos Root', fsType: 'btrfs', mountpoint: '/', sizeBytes: Math.max(totalBytes - efiBytes, 0), tone: 'bg-indigo-400/70' },
    ];
  }

  if (role === 'system') {
    const rootBytes = Math.max(Math.min(totalBytes * 0.72, 160 * 1024 ** 3), 48 * 1024 ** 3);
    const remaining = Math.max(totalBytes - efiBytes - rootBytes, 0);
    return [
      { id: 'efi', label: 'EFI', fsType: 'vfat', mountpoint: '/boot', sizeBytes: efiBytes, tone: 'bg-cyan-400/70' },
      { id: 'root', label: 'Sistema', fsType: wizard.rootFs, mountpoint: '/', sizeBytes: Math.min(rootBytes, Math.max(totalBytes - efiBytes, 0)), tone: 'bg-indigo-400/70' },
      ...(remaining > 0 ? [{ id: 'free', label: 'Reserva', fsType: '—', mountpoint: 'livre', sizeBytes: remaining, tone: 'bg-white/10' }] : []),
    ];
  }

  return [{ id: 'data', label: 'Dados /srv/data', fsType: wizard.dataFs, mountpoint: '/srv/data', sizeBytes: totalBytes, tone: 'bg-emerald-400/70' }];
}

function barTone(segment) {
  if (segment.tone) return segment.tone;
  if (segment.mountpoint === '/') return 'bg-indigo-400/70';
  if (segment.mountpoint === '/boot') return 'bg-cyan-400/70';
  if (segment.mountpoint === '/srv/data') return 'bg-emerald-400/70';
  return 'bg-slate-500/40';
}

function DiskBar({ totalBytes, segments }) {
  if (!totalBytes || segments.length === 0) {
    return <div className="rounded-2xl border border-dashed border-white/10 p-3 text-sm text-slate-500">Sem dados para exibir.</div>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
      <div className="flex h-10 w-full overflow-hidden">
        {segments.map((segment) => {
          const width = Math.max((segment.sizeBytes / totalBytes) * 100, 6);
          return (
            <div
              key={segment.id}
              className={`${barTone(segment)} flex items-center justify-center px-2 text-[11px] font-bold text-white`}
              style={{ width: `${width}%` }}
              title={`${segment.label} • ${bytesToHuman(segment.sizeBytes)}`}
            >
              <span className="truncate">{segment.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SegmentList({ title, segments }) {
  return (
    <div className="min-h-0 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
      <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</div>
      <div className="max-h-[210px] overflow-y-auto p-2.5">
        {segments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-3 text-sm text-slate-500">Nenhuma partição detectada.</div>
        ) : (
          segments.map((segment) => (
            <div key={segment.id} className="mb-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-white">{segment.label}</span>
                <span className="text-xs uppercase tracking-[0.14em] text-slate-400">{segment.fsType}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-slate-400">
                <span>Mount: {segment.mountpoint}</span>
                <span>{bytesToHuman(segment.sizeBytes)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function useDiskLayout(disk) {
  const [state, setState] = useState({ loading: false, data: null, error: '' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!disk) {
        setState({ loading: false, data: null, error: '' });
        return;
      }

      try {
        setState({ loading: true, data: null, error: '' });
        const response = await fetch(`/api/v1/disk-layout?disk=${encodeURIComponent(disk)}`);
        const payload = await response.json();
        if (!response.ok) throw new Error('Falha ao obter layout do disco.');
        if (!cancelled) setState({ loading: false, data: payload, error: '' });
      } catch (err) {
        if (!cancelled) {
          setState({
            loading: false,
            data: null,
            error: err instanceof Error ? err.message : 'Erro ao carregar layout do disco.',
          });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [disk]);

  return state;
}

function raidInfoText(level) {
  switch (level) {
    case 'raid0':
      return 'RAID 0 distribui blocos entre discos para máximo desempenho. Capacidade final aproximada: soma dos discos. Tolerância a falha: 0 discos.';
    case 'raid1':
      return 'O RAID 1 criará um espelho exato. A capacidade final será equivalente ao menor disco do array. Tolerância a falha: 1 disco.';
    case 'raid5':
      return 'RAID 5 usa paridade distribuída. Capacidade final aproximada: (N-1) × menor disco. Tolerância a falha: 1 disco.';
    case 'raid10':
      return 'RAID 10 combina espelhamento e striping. Capacidade final aproximada: (N/2) × menor disco. Tolerância a falha: depende do par, com alta resiliência.';
    default:
      return 'Selecione um nível RAID para ver o cálculo técnico de capacidade e tolerância a falhas.';
  }
}

export default function Disks({ wizard, onChange }) {
  const [disks, setDisks] = useState([]);
  const [loadingDisks, setLoadingDisks] = useState(true);
  const [diskError, setDiskError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoadingDisks(true);
        setDiskError('');
        const response = await fetch('/api/v1/disks');
        const payload = await response.json();
        if (!response.ok) throw new Error('Falha ao carregar discos.');

        const nextDisks = Array.isArray(payload.disks) ? payload.disks : [];
        if (!cancelled) {
          setDisks(nextDisks);

          if (!Array.isArray(wizard.selectedDisks) || wizard.selectedDisks.length === 0) {
            const fallback = nextDisks[0] ? [nextDisks[0]] : [];
            onChange({
              selectedDisks: fallback,
              sysDisk: fallback[0] || '',
              dataDisk: '',
              diskMode: fallback.length >= 2 ? 'two' : 'one',
              diskProfile: fallback.length >= 2 ? wizard.diskProfile || 'single' : 'single',
              rootFs: 'btrfs',
              dataFs: 'btrfs',
            });
          }
        }
      } catch (err) {
        if (!cancelled) setDiskError(err instanceof Error ? err.message : 'Erro ao carregar discos.');
      } finally {
        if (!cancelled) setLoadingDisks(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [onChange, wizard.selectedDisks, wizard.diskProfile]);

  const selectedDisks = useMemo(() => {
    const raw = Array.isArray(wizard.selectedDisks) ? wizard.selectedDisks : [];
    return raw.filter((item) => disks.includes(item));
  }, [wizard.selectedDisks, disks]);

  const selectedCount = selectedDisks.length;
  const canUseRaid = selectedCount >= 2;
  const isSingleDisk = selectedCount === 1;

  const activeRaid = raidLevels.find((item) => item.id === wizard.raidLevel) || raidLevels[1];
  const raidMin = activeRaid.minDisks;
  const raidInvalid = wizard.diskProfile === 'raid' && selectedCount < raidMin;

  const sysDisk = selectedDisks[0] || '';
  const dataDisk = selectedDisks[1] || '';

  useEffect(() => {
    const nextDataDisk = selectedCount >= 2 ? dataDisk : '';
    const nextDiskMode = selectedCount >= 2 ? 'two' : 'one';

    const patch = {};
    const changedSelection = JSON.stringify(selectedDisks) !== JSON.stringify(Array.isArray(wizard.selectedDisks) ? wizard.selectedDisks : []);
    if (changedSelection) patch.selectedDisks = selectedDisks;
    if (wizard.sysDisk !== sysDisk) patch.sysDisk = sysDisk;
    if (wizard.dataDisk !== nextDataDisk) patch.dataDisk = nextDataDisk;
    if (wizard.diskMode !== nextDiskMode) patch.diskMode = nextDiskMode;

    if (!canUseRaid && wizard.diskProfile === 'raid') {
      patch.diskProfile = 'single';
    }

    if (wizard.dataFs !== 'btrfs') patch.dataFs = 'btrfs';
    if (isSingleDisk) {
      if (wizard.rootFs !== 'btrfs') patch.rootFs = 'btrfs';
      if (wizard.storageProfile !== 'single-btrfs-subvol') patch.storageProfile = 'single-btrfs-subvol';
    }

    if (Object.keys(patch).length > 0) {
      onChange(patch);
    }
  }, [selectedDisks, selectedCount, canUseRaid, isSingleDisk, sysDisk, dataDisk, wizard.selectedDisks, wizard.sysDisk, wizard.dataDisk, wizard.diskMode, wizard.diskProfile, wizard.rootFs, wizard.dataFs, wizard.storageProfile, onChange]);

  const sysLayoutState = useDiskLayout(sysDisk);
  const dataLayoutState = useDiskLayout(dataDisk);

  const systemCurrent = useMemo(() => normalizeSegments(sysLayoutState.data), [sysLayoutState.data]);
  const dataCurrent = useMemo(() => normalizeSegments(dataLayoutState.data), [dataLayoutState.data]);

  const systemPlanned = useMemo(
    () => createPlanSegments(systemCurrent.totalBytes, wizard, 'system'),
    [systemCurrent.totalBytes, wizard],
  );
  const dataPlanned = useMemo(
    () => createPlanSegments(dataCurrent.totalBytes, wizard, 'data'),
    [dataCurrent.totalBytes, wizard],
  );

  function toggleDisk(disk) {
    const current = selectedDisks;
    const exists = current.includes(disk);
    const next = exists ? current.filter((item) => item !== disk) : [...current, disk];

    const sorted = disks.filter((item) => next.includes(item));
    onChange({ selectedDisks: sorted });
  }

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[0.92fr_1.08fr]">
      <section className="section-panel min-h-0 overflow-y-auto p-3">
        <div className="mb-4">
          <h3 className="text-lg font-bold text-white">Política de discos e RAID</h3>
          <p className="mt-1 text-sm text-slate-400">Selecione discos físicos e perfil de armazenamento com validação matemática estrita.</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label-text">Discos físicos (seleção múltipla)</label>
            <div className="mt-2 grid gap-2">
              {disks.map((disk) => {
                const checked = selectedDisks.includes(disk);
                return (
                  <label key={disk} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm ${checked ? 'border-accent-400/50 bg-accent-500/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300'}`}>
                    <span>{disk}</span>
                    <input type="checkbox" checked={checked} onChange={() => toggleDisk(disk)} className="h-4 w-4 rounded" />
                  </label>
                );
              })}
            </div>
            {selectedCount === 0 ? <p className="mt-2 text-sm text-rose-300">Selecione ao menos um disco para continuar.</p> : null}
          </div>

          <div>
            <label className="label-text">Perfil inteligente</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className={wizard.diskProfile !== 'raid' ? 'btn-primary' : 'btn-secondary'}
                onClick={() => onChange({ diskProfile: 'single', rootFs: isSingleDisk ? 'btrfs' : wizard.rootFs })}
              >
                BTRFS / Padrão
              </button>
              <button
                type="button"
                disabled={!canUseRaid}
                className={wizard.diskProfile === 'raid' ? 'btn-primary' : 'btn-secondary'}
                onClick={() => onChange({ diskProfile: 'raid', diskMode: 'two' })}
              >
                RAID (Software)
              </button>
            </div>
            {!canUseRaid ? <p className="mt-2 text-sm text-slate-400">RAID liberado apenas com 2 ou mais discos marcados.</p> : null}
          </div>

          {wizard.diskProfile === 'raid' ? (
            <div>
              <label className="label-text" htmlFor="raidLevel">Nível de RAID</label>
              <select
                id="raidLevel"
                className="input-shell"
                value={wizard.raidLevel}
                onChange={(event) => onChange({ raidLevel: event.target.value })}
              >
                {raidLevels.map((level) => (
                  <option key={level.id} value={level.id} disabled={selectedCount < level.minDisks}>
                    {level.label} {selectedCount < level.minDisks ? `(mínimo ${level.minDisks})` : ''}
                  </option>
                ))}
              </select>

              {raidInvalid ? (
                <p className="mt-2 text-sm text-rose-300">Erro: {activeRaid.label.split(' ')[0].toUpperCase()} {activeRaid.label.match(/RAID\s\d+/)?.[0] || ''} exige pelo menos {raidMin} discos físicos.</p>
              ) : null}

              <div className="mt-3 rounded-2xl border border-blue-500 bg-blue-900/30 p-3 text-sm text-blue-100">
                {raidInfoText(wizard.raidLevel)}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label-text" htmlFor="rootFs">Filesystem raiz</label>
              {isSingleDisk ? (
                <div className="input-shell flex items-center justify-between">
                  <span className="font-semibold text-white">btrfs</span>
                  <span className="text-xs uppercase tracking-[0.18em] text-emerald-300">subvolume obrigatório</span>
                </div>
              ) : (
                <select id="rootFs" className="input-shell" value={wizard.rootFs} onChange={(e) => onChange({ rootFs: e.target.value })}>
                  {filesystemOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              )}
            </div>

            <div>
              <label className="label-text" htmlFor="dataFs">Filesystem de dados</label>
              <div className="input-shell flex items-center justify-between">
                <span className="font-semibold text-white">btrfs</span>
                <span className="text-xs uppercase tracking-[0.18em] text-emerald-300">obrigatório</span>
              </div>
            </div>
          </div>

          {isSingleDisk ? (
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-200">
              <input
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={Boolean(wizard.luksEnabled)}
                onChange={(event) => onChange({ luksEnabled: event.target.checked })}
              />
              Habilitar LUKS (criptografia opcional)
            </label>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
            <div className="font-semibold text-white">Diagnóstico</div>
            <ul className="mt-2 space-y-1.5 text-slate-400">
              <li>• Discos detectados: {loadingDisks ? 'carregando…' : disks.length}</li>
              <li>• Discos marcados: {selectedCount}</li>
              <li>• Perfil: {wizard.diskProfile === 'raid' ? 'RAID software' : 'BTRFS padrão'}</li>
              <li>• Erro de carregamento: {diskError || sysLayoutState.error || dataLayoutState.error || 'nenhum'}</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="grid min-h-0 gap-3 overflow-hidden lg:grid-rows-2">
        <div className="section-panel min-h-0 overflow-hidden p-3">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white">Sistema — antes e depois</h3>
              <p className="mt-0.5 text-xs text-slate-400">Prévia técnica do disco primário selecionado.</p>
            </div>
            <div className="metric-chip">{sysDisk || 'Sem disco'}</div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Antes</div>
              <DiskBar totalBytes={systemCurrent.totalBytes} segments={systemCurrent.segments} />
              <div className="mt-2.5">
                <SegmentList title={sysLayoutState.loading ? 'Carregando…' : 'Partições atuais'} segments={systemCurrent.segments} />
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Depois</div>
              <DiskBar totalBytes={systemCurrent.totalBytes} segments={systemPlanned} />
              <div className="mt-2.5">
                <SegmentList title="Plano aplicado" segments={systemPlanned} />
              </div>
            </div>
          </div>
        </div>

        <div className="section-panel min-h-0 overflow-hidden p-3">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white">Dados — antes e depois</h3>
              <p className="mt-0.5 text-xs text-slate-400">Prévia do segundo disco marcado (quando existir).</p>
            </div>
            <div className="metric-chip">{dataDisk || 'Sem disco'}</div>
          </div>

          {selectedCount >= 2 ? (
            <div className="grid gap-3 xl:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Antes</div>
                <DiskBar totalBytes={dataCurrent.totalBytes} segments={dataCurrent.segments} />
                <div className="mt-2.5">
                  <SegmentList title={dataLayoutState.loading ? 'Carregando…' : 'Partições atuais'} segments={dataCurrent.segments} />
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Depois</div>
                <DiskBar totalBytes={dataCurrent.totalBytes} segments={dataPlanned} />
                <div className="mt-2.5">
                  <SegmentList title="Plano aplicado" segments={dataPlanned} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
              Marque 2+ discos para habilitar cenários avançados (dados dedicados / RAID).
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
