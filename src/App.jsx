import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from './components/Layout.jsx';
import FooterFixed from './components/FooterFixed.jsx';
import Welcome from './pages/Welcome.jsx';
import Eula from './pages/Eula.jsx';
import Localization from './pages/Localization.jsx';
import Timezone from './pages/Timezone.jsx';
import Network from './pages/Network.jsx';
import Disks from './pages/Disks.jsx';
import Users from './pages/Users.jsx';
import Summary from './pages/Summary.jsx';
import Install from './pages/Install.jsx';

const STEPS = [
  {
    id: 'welcome',
    title: 'RAGos Think Installer',
    subtitle: 'Fluxo imersivo, fullscreen, sem rolagem global e com foco em robustez operacional.',
  },
  {
    id: 'eula',
    title: 'EULA e Avisos',
    subtitle: 'Aceite explícito antes de qualquer ação destrutiva ou configuração do sistema.',
  },
  {
    id: 'localization',
    title: 'Localização',
    subtitle: 'Todos os países, idiomas/locales e keymaps em listas pesquisáveis, como installers completos.',
  },
  {
    id: 'timezone',
    title: 'Fuso Horário',
    subtitle: '',
  },
  {
    id: 'network',
    title: 'Topologia de Rede',
    subtitle: 'WAN, LAN, hostname e parâmetros essenciais do servidor sem navegação ambígua.',
  },
  {
    id: 'disks',
    title: 'Particionamento',
    subtitle: 'Visualização estilo GParted com cálculo memoizado para evitar travamentos e loops de renderização.',
  },
  {
    id: 'users',
    title: 'Usuário e SSH',
    subtitle: 'Conta administrativa, senha forte e chaves SSH autorizadas.',
  },
  {
    id: 'summary',
    title: 'Resumo final',
    subtitle: 'Revisão final antes de gerar o plano e iniciar a instalação.',
  },
  {
    id: 'install',
    title: 'Instalação',
    subtitle: 'Execução em tempo real com status, logs e resultado final.',
  },
];

const initialWizard = {
  eulaAccepted: false,
  country: 'BR',
  locale: 'pt_BR.UTF-8',
  keyMap: 'br-abnt2',
  timeZone: 'America/Cuiaba',
  timeZonePin: null,
  hostName: 'srv-rag',
  mgmtInterface: '',
  wanInterface: '',
  netIfacesCount: 0,
  wanIdentified: false,
  lanIdentified: false,
  wanMode: 'dhcp',
  pppoeUser: '',
  pppoePassword: '',
  wanAddress: '',
  wanGateway: '',
  wanDns: '',
  lanAddress: '192.168.100.1',
  lanNetmask: '255.255.255.0',
  serverIp: '192.168.100.2',
  mgmtNetmask: '255.255.255.0',
  mgmtGateway: '192.168.100.1',
  mgmtDns: '1.1.1.1,8.8.8.8',
  httpPort: 8080,
  diskMode: 'one',
  storageProfile: 'single-btrfs-subvol',
  diskProfile: 'single',
  selectedDisks: [],
  raidLevel: 'raid1',
  luksEnabled: false,
  sysDisk: '',
  dataDisk: '',
  rootFs: 'btrfs',
  dataFs: 'btrfs',
  adminUser: 'rag',
  adminUid: 1000,
  adminEmail: 'admin@localhost',
  adminPassword: '',
  adminPasswordConfirm: '',
  adminAuthorizedKeys: '',
  destructiveConfirmed: false,
};

function isValidIpv4(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (part === '' || Number.isNaN(Number(part))) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function isValidHostname(value) {
  const host = String(value || '').trim();
  if (!host || host.length > 63) return false;
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host);
}

function isValidDnsList(value) {
  const items = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (items.length === 0) return false;
  return items.every(isValidIpv4);
}

function isStrongPassword(value) {
  const pw = String(value || '');
  if (pw.length < 12) return false;
  let classes = 0;
  if (/[a-z]/.test(pw)) classes += 1;
  if (/[A-Z]/.test(pw)) classes += 1;
  if (/[0-9]/.test(pw)) classes += 1;
  if (/[^A-Za-z0-9\s]/.test(pw)) classes += 1;
  return classes >= 3;
}

function getSubnet24(ip) {
  if (!isValidIpv4(ip)) return '';
  return ip.split('.').slice(0, 3).join('.');
}

function getStepIssues(stepId, wizard) {
  switch (stepId) {
    case 'welcome':
      return [];
    case 'eula':
      return wizard.eulaAccepted ? [] : ['É necessário aceitar os termos e o aviso de destruição de dados.'];
    case 'localization': {
      const issues = [];
      if (!String(wizard.country || '').trim()) issues.push('Selecione um país/região.');
      if (!String(wizard.locale || '').trim()) issues.push('Selecione um idioma/locale.');
      if (!String(wizard.keyMap || '').trim()) issues.push('Selecione um layout de teclado.');
      return issues;
    }
    case 'timezone':
      return wizard.timeZone.trim() ? [] : ['Selecione um timezone válido.'];
    case 'network': {
      const issues = [];
      if (Number(wizard.netIfacesCount || 0) < 2) {
        issues.push('Este gateway exige no mínimo 2 placas de rede: 1 LAN/PXE e 1 WAN.');
      }
      if (!wizard.mgmtInterface.trim()) issues.push('Selecione a interface LAN/PXE (rede interna).');
      if (!wizard.wanInterface.trim()) issues.push('Selecione a interface WAN (entrada da internet).');
      if (
        wizard.mgmtInterface.trim()
        && wizard.wanInterface.trim()
        && wizard.mgmtInterface.trim() === wizard.wanInterface.trim()
      ) {
        issues.push('LAN/PXE e WAN devem usar placas distintas.');
      }
      if (wizard.wanMode === 'pppoe') {
        if (!String(wizard.pppoeUser || '').trim()) issues.push('PPPoE: informe o usuário.');
        if (!String(wizard.pppoePassword || '').trim()) issues.push('PPPoE: informe a senha.');
      }
      if (!wizard.wanIdentified) issues.push('Confirme a identificação física da porta WAN.');
      if (!wizard.lanIdentified) issues.push('Confirme a identificação física da porta LAN/PXE.');
      if (!isValidHostname(wizard.hostName)) issues.push('Hostname inválido para um servidor Linux.');
      if (!isValidIpv4(wizard.serverIp)) issues.push('IP do servidor inválido.');
      if (!isValidIpv4(wizard.mgmtNetmask)) issues.push('Máscara de gerenciamento inválida.');
      if (!isValidIpv4(wizard.mgmtGateway)) issues.push('Gateway inválido.');
      if (!isValidDnsList(wizard.mgmtDns)) issues.push('DNS deve conter IPv4 válidos separados por vírgula.');
      if (!isValidIpv4(wizard.lanAddress)) issues.push('IP da LAN inválido.');
      if (!isValidIpv4(wizard.lanNetmask)) issues.push('Máscara da LAN inválida.');
      if (getSubnet24(wizard.serverIp) === getSubnet24(wizard.lanAddress)) issues.push('LAN e gerência não podem compartilhar a mesma sub-rede /24.');
      if (!(Number(wizard.httpPort) >= 1 && Number(wizard.httpPort) <= 65535)) issues.push('Porta HTTP deve ficar entre 1 e 65535.');
      return issues;
    }
    case 'disks': {
      const issues = [];
      const selectedDisks = Array.isArray(wizard.selectedDisks) ? wizard.selectedDisks : [];
      if (selectedDisks.length === 0) issues.push('Selecione pelo menos 1 disco físico.');
      if (!wizard.sysDisk) issues.push('Escolha o disco do sistema.');
      if (wizard.dataFs !== 'btrfs') {
        issues.push('Filesystem de dados obrigatório: btrfs.');
      }

      if (selectedDisks.length === 1 && wizard.rootFs !== 'btrfs') {
        issues.push('No modo de 1 disco, o filesystem raiz é obrigatório: btrfs (subvolumes).');
      }

      if (wizard.diskProfile === 'raid') {
        const minByLevel = {
          raid0: 2,
          raid1: 2,
          raid5: 3,
          raid10: 4,
        };
        const minRequired = minByLevel[wizard.raidLevel] || 2;
        if (selectedDisks.length < minRequired) {
          issues.push(`Erro: ${String(wizard.raidLevel || 'RAID').toUpperCase()} exige pelo menos ${minRequired} discos físicos.`);
        }
      }

      if (wizard.diskMode === 'two') {
        if (!wizard.dataDisk) issues.push('Escolha o disco de dados.');
        if (wizard.dataDisk && wizard.dataDisk === wizard.sysDisk) issues.push('Disco de dados não pode ser igual ao disco do sistema.');
      }
      return issues;
    }
    case 'users': {
      const issues = [];
      if (!String(wizard.adminUser || '').trim()) issues.push('Informe o usuário administrador.');
      if (!(Number(wizard.adminUid) > 0)) issues.push('UID do administrador inválido.');
      if (!String(wizard.adminEmail || '').trim()) issues.push('Informe o e-mail do administrador.');
      if (!isStrongPassword(wizard.adminPassword)) issues.push('Use uma senha forte com 12+ caracteres e 3 classes de caracteres.');
      if (wizard.adminPassword !== wizard.adminPasswordConfirm) issues.push('Senha e confirmação não conferem.');
      return issues;
    }
    case 'summary':
      return wizard.destructiveConfirmed ? [] : ['Confirme o aviso destrutivo para continuar.'];
    case 'install':
      return ['A instalação é iniciada dentro desta etapa.'];
    default:
      return [];
  }
}

export default function App() {
  const [stepIndex, setStepIndex] = useState(0);
  const [wizard, setWizard] = useState(initialWizard);

  const step = STEPS[stepIndex];
  const eulaLocked = step.id === 'eula';
  const progressValue = STEPS.length > 1
    ? Math.round((stepIndex / (STEPS.length - 1)) * 100)
    : 100;

  const updateWizard = useCallback((patch) => {
    setWizard((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }));
  }, []);

  const stepIssues = useMemo(() => getStepIssues(step.id, wizard), [step.id, wizard]);
  const canGoNext = stepIssues.length === 0;

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable;

      if (step.id === 'eula') {
        if (event.altKey || event.key === 'Enter') {
          event.preventDefault();
        }
        return;
      }

      if ((event.key === 'ArrowLeft' && event.altKey) || (event.key === 'Backspace' && event.altKey)) {
        event.preventDefault();
        setStepIndex((prev) => Math.max(0, prev - 1));
        return;
      }

      if ((event.key === 'ArrowRight' && event.altKey) || (event.key === 'Enter' && !isTyping && canGoNext)) {
        event.preventDefault();
        setStepIndex((prev) => Math.min(STEPS.length - 1, prev + 1));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canGoNext, step.id]);

  const stepsWithState = useMemo(
    () => STEPS.map((item, index) => ({
      ...item,
      status: index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'upcoming',
    })),
    [stepIndex],
  );

  const currentPage = (() => {
    switch (step.id) {
      case 'welcome':
        return <Welcome />;
      case 'eula':
        return <Eula wizard={wizard} onChange={updateWizard} />;
      case 'localization':
        return <Localization wizard={wizard} onChange={updateWizard} />;
      case 'timezone':
        return <Timezone wizard={wizard} onChange={updateWizard} />;
      case 'network':
        return <Network wizard={wizard} onChange={updateWizard} />;
      case 'disks':
        return <Disks wizard={wizard} onChange={updateWizard} />;
      case 'users':
        return <Users wizard={wizard} onChange={updateWizard} />;
      case 'summary':
        return <Summary wizard={wizard} onChange={updateWizard} />;
      case 'install':
        return <Install wizard={wizard} />;
      default:
        return null;
    }
  })();

  return (
    <Layout
      title={step.title}
      subtitle={step.subtitle}
      stepLabel={`Etapa ${stepIndex + 1} de ${STEPS.length}`}
      steps={stepsWithState}
      currentStepIndex={stepIndex}
      navigationHint={eulaLocked ? 'Atalhos bloqueados na EULA' : 'Alt + ← / Alt + →'}
      onStepJump={(index) => {
        if (step.id === 'eula') return;
        if (index <= stepIndex || index === stepIndex + 1) setStepIndex(index);
      }}
      footer={
        <FooterFixed
          progressLabel={`${step.title} • ${progressValue}%`}
          progressValue={progressValue}
          issues={stepIssues}
          canBack={stepIndex > 0}
          canNext={step.id === 'install' ? false : canGoNext}
          onBack={() => setStepIndex((prev) => Math.max(0, prev - 1))}
          onNext={() => setStepIndex((prev) => Math.min(STEPS.length - 1, prev + 1))}
          hintText={step.id === 'eula' ? 'Nesta etapa, o avanço só é permitido pelo botão Próximo após marcar o aceite.' : 'Pronto para avançar. Navegação rápida: Alt + ← / Alt + →'}
          nextLabel={step.id === 'summary' ? 'Ir para instalação' : step.id === 'install' ? 'Em execução' : 'Próximo'}
        />
      }
    >
      {currentPage}
    </Layout>
  );
}
