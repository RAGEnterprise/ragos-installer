import { useEffect, useMemo, useState } from 'react';
import TimezoneMap from '../components/TimezoneMap.jsx';
import { findTimezoneRegion, timezoneGroups, timezoneRegions } from '../data/timezoneRegions.js';

export default function Timezone({ wizard, onChange }) {
  const [timezones, setTimezones] = useState([]);
  const [timezoneLocations, setTimezoneLocations] = useState([]);
  const [query, setQuery] = useState(wizard.timeZone || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function getLocationPin(timezone) {
    const found = timezoneLocations.find((item) => item.timezone === timezone);
    if (!found) return wizard.timeZonePin;
    return {
      label: found.timezone.split('/').slice(-1)[0]?.replaceAll('_', ' ') || found.timezone,
    };
  }

  async function fetchTimezones() {
    try {
      const [listResponse, locationsResponse] = await Promise.all([
        fetch('/api/v1/timezones', { cache: 'no-store' }),
        fetch('/api/v1/timezone-locations', { cache: 'no-store' }),
      ]);

      const [listRaw, locationsRaw] = await Promise.all([listResponse.text(), locationsResponse.text()]);
      const listPayload = JSON.parse(listRaw);
      const locationsPayload = JSON.parse(locationsRaw);

      if (!listResponse.ok) throw new Error('Falha ao carregar a lista de timezones.');
      const items = Array.isArray(listPayload?.items) ? listPayload.items : [];
      const locations = Array.isArray(locationsPayload?.items) ? locationsPayload.items : [];
      return { items, locations };
    } catch {
      return {
        items: timezoneRegions.map((item) => item.timezone),
        locations: [],
      };
    }
  }

  useEffect(() => {
    setQuery(wizard.timeZone || '');
  }, [wizard.timeZone]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError('');
        const next = await fetchTimezones();
        if (!cancelled) {
          setTimezones(next.items);
          setTimezoneLocations(next.locations);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erro ao buscar timezones.');
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
  }, []);

  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return timezones.slice(0, 200);
    return timezones.filter((item) => item.toLowerCase().includes(lower)).slice(0, 250);
  }, [query, timezones]);

  const featuredRegions = useMemo(() => timezoneRegions, []);
  const selectedRegion = useMemo(() => findTimezoneRegion(wizard.timeZone), [wizard.timeZone]);
  const quickRegions = useMemo(() => featuredRegions.slice(0, 16), [featuredRegions]);

  return (
    <div className="grid h-full min-h-0 gap-5 overflow-hidden lg:grid-cols-[2.55fr_0.62fr]">
      <div className="flex-1 flex flex-col min-h-0 relative w-full h-full">
        <TimezoneMap
          locations={timezoneLocations}
          value={wizard.timeZone}
          pin={wizard.timeZonePin}
          onChange={({ timeZone, pin }) => onChange({ timeZone, timeZonePin: pin })}
        />
      </div>

      <section className="section-panel flex min-h-0 flex-col overflow-y-auto p-4">
        <div>
          <label htmlFor="timezone-search" className="label-text">Timezone IANA</label>
          <input
            id="timezone-search"
            className="input-shell"
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              onChange((prev) => ({
                timeZone: next,
                timeZonePin: next ? getLocationPin(next) : prev.timeZonePin,
              }));
            }}
            placeholder="Ex.: America/Sao_Paulo"
          />
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Use o mapa maior para seleção visual. O campo IANA continua disponível para ambientes com padronização rígida de logs, cron e monitoração.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary !px-4 !py-2.5"
            onClick={() => onChange({ timeZone: 'Etc/UTC', timeZonePin: { label: 'UTC' } })}
          >
            Usar UTC
          </button>
          <div className="metric-chip !text-[11px]">Selecionado: {wizard.timeZone || '—'}</div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Região atual</div>
          <div className="mt-2 text-sm font-bold text-white">{selectedRegion?.label || 'Sem região mapeada'}</div>
          <div className="mt-1 text-sm text-slate-400">{selectedRegion?.group || 'Busca manual / UTC'}</div>
        </div>

        <div className="mt-4 max-h-[140px] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/60 p-3">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Atalhos por regiões</div>
          <div className="grid grid-cols-1 gap-2">
            {quickRegions.map((region) => (
              <button
                key={region.id}
                type="button"
                className={region.timezone === wizard.timeZone ? 'btn-primary !px-3 !py-2 text-xs !leading-5' : 'btn-secondary !px-3 !py-2 text-xs !leading-5'}
                onClick={() => onChange({
                  timeZone: region.timezone,
                  timeZonePin: { label: region.label },
                })}
              >
                {region.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 min-h-[180px] flex-1 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70">
          <div className="border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            Resultados {loading ? '• carregando' : `• ${filtered.length} itens`} • {timezoneGroups.length} macro-regiões
          </div>
          <div className="h-[220px] overflow-y-auto px-2 py-2 lg:h-full">
            {error ? <div className="px-3 py-4 text-sm text-rose-300">{error}</div> : null}
            {!error && filtered.length === 0 && !loading ? (
              <div className="px-3 py-4 text-sm text-slate-400">Nenhum timezone encontrado.</div>
            ) : null}
            {filtered.map((item) => {
              const active = item === wizard.timeZone;
              return (
                <button
                  key={item}
                  type="button"
                  className={`mb-2 flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm transition ${
                    active
                      ? 'border-accent-400/60 bg-accent-500/15 text-white'
                      : 'border-white/5 bg-white/[0.03] text-slate-300 hover:border-white/10 hover:bg-white/[0.05]'
                  }`}
                  onClick={() => onChange((prev) => ({
                    timeZone: item,
                    timeZonePin: getLocationPin(item) || prev.timeZonePin,
                  }))}
                >
                  <span className="truncate">{item}</span>
                  {active ? <span className="text-xs font-bold text-cyan-300">ATIVO</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
