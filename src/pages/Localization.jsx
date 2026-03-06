import { useEffect, useMemo, useState } from 'react';
import {
  allCountryCodes,
  countryCodeToFlag,
  countryPresets,
  fallbackKeymaps,
  fallbackLocales,
  getRegionName,
  parseLocaleLabel,
  scoreKeymapForCountry,
  scoreLocaleForCountry,
} from '../data/localizationMeta.js';
import { sanitizeShellInput } from '../utils/security.js';

async function fetchList(url, fallbackItems = []) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const raw = await response.text();
    let payload = null;

    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(`Falha ao carregar ${url}.`);
    }

    const items = Array.isArray(payload?.items) ? payload.items : [];
    return {
      items: items.length > 0 ? items : fallbackItems,
      usedFallback: items.length === 0 && fallbackItems.length > 0,
    };
  } catch {
    return { items: fallbackItems, usedFallback: fallbackItems.length > 0 };
  }
}

function scoreByQuery(text, query) {
  const q = String(query || '').trim().toLowerCase();
  const t = String(text || '').toLowerCase();
  if (!q) return 0;
  if (t === q) return 400;
  if (t.startsWith(q)) return 240;
  if (t.includes(q)) return 120;
  return 0;
}

function SearchableList({ title, items, selectedValue, query, onQueryChange, onPick, emptyText }) {
  const [open, setOpen] = useState(false);
  const selectedItem = items.find((item) => item.value === selectedValue) || null;
  const previewItems = items.slice(0, 4);

  function handlePick(value) {
    onPick(value);
    setOpen(false);
  }

  return (
    <section className="section-panel relative flex h-full min-h-0 flex-col overflow-visible p-4">
        <div className="mb-4">
          <div className="text-sm font-bold text-white">{title}</div>
          <div className="mt-1 text-sm text-slate-400">Busca ativa com autocomplete seguro e lista resumida.</div>
        </div>

        <div className="flex gap-2">
          <input
            className="input-shell"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              onQueryChange(sanitizeShellInput(event.target.value));
              setOpen(true);
            }}
            placeholder={`Buscar em ${title.toLowerCase()}...`}
          />
          <button type="button" className="btn-secondary !px-4" onClick={() => setOpen(true)}>
            Abrir
          </button>
        </div>

        <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Selecionado</div>
              <div className="mt-2 flex items-center gap-3">
                {selectedItem?.leading ? <span className="text-xl leading-none">{selectedItem.leading}</span> : null}
                <div className="min-w-0">
                  <div className="truncate font-semibold text-white">{selectedItem?.label || 'Nenhum item selecionado'}</div>
                  <div className="truncate text-xs text-slate-400">{selectedItem?.secondary || 'Use a busca para abrir a lista completa.'}</div>
                </div>
              </div>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300">
              {items.length} itens
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {previewItems.length === 0 ? (
              <div className="text-sm text-slate-500">{emptyText}</div>
            ) : (
              previewItems.map((item) => {
                const active = item.value === selectedValue;
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                      active
                        ? 'border-accent-400/60 bg-accent-500/15 text-white'
                        : 'border-white/5 bg-white/[0.03] text-slate-300 hover:border-white/10 hover:bg-white/[0.05]'
                    }`}
                    onClick={() => handlePick(item.value)}
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      {item.leading ? <span className="text-lg leading-none">{item.leading}</span> : null}
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-white">{item.label}</div>
                        {item.secondary ? <div className="truncate text-xs text-slate-400">{item.secondary}</div> : null}
                      </div>
                    </div>
                    {active ? <span className="text-xs font-bold text-cyan-300">ATIVO</span> : null}
                  </button>
                );
              })
            )}
          </div>

          <button type="button" className="mt-3 btn-primary w-full !py-2.5 text-sm" onClick={() => setOpen(true)}>
            Ver autocomplete completo
          </button>
        </div>

      {open ? (
        <div className="absolute inset-0 z-50 rounded-2xl bg-gray-900/96 shadow-2xl backdrop-blur-xl">
          <div className="flex h-full flex-col overflow-hidden p-4">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">{title}</h3>
                <p className="mt-1 text-sm text-slate-400">Autocomplete ampliado para seleção sem conteúdo escondido.</p>
              </div>
              <button type="button" className="btn-secondary !px-4 !py-2" onClick={() => setOpen(false)}>
                Fechar
              </button>
            </div>

            <input
              autoFocus
              className="input-shell"
              value={query}
              onChange={(event) => onQueryChange(sanitizeShellInput(event.target.value))}
              placeholder={`Buscar em ${title.toLowerCase()}...`}
            />

            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{items.length} resultados priorizados</span>
              {selectedItem ? <span className="text-xs text-cyan-300">Atual: {selectedItem.label}</span> : null}
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/70 p-2">
              {items.length === 0 ? <div className="px-3 py-4 text-sm text-slate-500">{emptyText}</div> : null}
              {items.map((item) => {
                const active = item.value === selectedValue;
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={`mb-2 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left text-sm transition ${
                      active
                        ? 'border-accent-400/60 bg-accent-500/15 text-white'
                        : 'border-white/5 bg-white/[0.03] text-slate-300 hover:border-white/10 hover:bg-white/[0.05]'
                    }`}
                    onClick={() => handlePick(item.value)}
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      {item.leading ? <span className="text-lg leading-none">{item.leading}</span> : null}
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-white">{item.label}</div>
                        {item.secondary ? <div className="truncate text-xs text-slate-400">{item.secondary}</div> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.badge ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300">{item.badge}</span> : null}
                      {active ? <span className="text-xs font-bold text-cyan-300">ATIVO</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function Localization({ wizard, onChange }) {
  const [countries, setCountries] = useState([]);
  const [locales, setLocales] = useState([]);
  const [keymaps, setKeymaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [degradedMode, setDegradedMode] = useState(false);

  const [countryQuery, setCountryQuery] = useState('');
  const [localeQuery, setLocaleQuery] = useState('');
  const [keymapQuery, setKeymapQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        setLoading(true);
        setError('');
        const [countriesData, localesData, keymapsData] = await Promise.all([
          fetchList('/api/v1/countries', allCountryCodes),
          fetchList('/api/v1/locales', fallbackLocales),
          fetchList('/api/v1/keymaps', fallbackKeymaps),
        ]);

        if (!cancelled) {
          setCountries(countriesData.items);
          setLocales(localesData.items);
          setKeymaps(keymapsData.items);
          setDegradedMode(Boolean(countriesData.usedFallback || localesData.usedFallback || keymapsData.usedFallback));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPreset = countryPresets[wizard.country] || null;
  const availableCountries = useMemo(() => {
    const merged = [...countries, ...allCountryCodes];
    return Array.from(new Set(merged.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [countries]);

  const countryItems = useMemo(() => {
    return availableCountries
      .map((code) => {
        const label = getRegionName(code);
        const score = scoreByQuery(`${code} ${label}`, countryQuery) + (code === wizard.country ? 1000 : 0);
        return {
          value: code,
          label,
          secondary: code,
          leading: countryCodeToFlag(code),
          score,
          badge: selectedPreset && code === wizard.country ? 'preset' : '',
        };
      })
      .filter((item) => !countryQuery || item.score > 0)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, 500);
  }, [availableCountries, countryQuery, wizard.country, selectedPreset]);

  const localeItems = useMemo(() => {
    return locales
      .map((locale) => {
        const label = parseLocaleLabel(locale);
        const countryScore = scoreLocaleForCountry(locale, wizard.country);
        const presetScore = selectedPreset?.locale === locale ? 140 : 0;
        const activeScore = wizard.locale === locale ? 1000 : 0;
        const queryScore = scoreByQuery(`${locale} ${label}`, localeQuery);
        return {
          value: locale,
          label,
          secondary: locale,
          score: activeScore + presetScore + countryScore + queryScore,
          badge: presetScore ? 'sugerido' : countryScore ? 'compatível' : '',
        };
      })
      .filter((item) => !localeQuery || item.score > 0)
      .sort((a, b) => b.score - a.score || a.secondary.localeCompare(b.secondary))
      .slice(0, 500);
  }, [locales, localeQuery, selectedPreset, wizard.country, wizard.locale]);

  const keymapItems = useMemo(() => {
    return keymaps
      .map((keymap) => {
        const compatScore = scoreKeymapForCountry(keymap, wizard.country);
        const presetScore = selectedPreset?.keyMap === keymap ? 140 : 0;
        const activeScore = wizard.keyMap === keymap ? 1000 : 0;
        const queryScore = scoreByQuery(keymap, keymapQuery);
        return {
          value: keymap,
          label: keymap,
          secondary: compatScore ? `Compatível com ${wizard.country}` : 'Layout disponível no sistema',
          score: activeScore + presetScore + compatScore + queryScore,
          badge: presetScore ? 'sugerido' : compatScore ? 'compatível' : '',
        };
      })
      .filter((item) => !keymapQuery || item.score > 0)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, 500);
  }, [keymaps, keymapQuery, selectedPreset, wizard.country, wizard.keyMap]);

  function applyCountry(value) {
    const preset = countryPresets[value] || null;
    onChange((prev) => ({
      country: value,
      locale: preset?.locale || prev.locale,
      keyMap: preset?.keyMap || prev.keyMap,
      timeZone: preset?.timeZone || prev.timeZone,
      timeZonePin: prev.timeZonePin,
    }));
  }

  const localeLabel = useMemo(() => parseLocaleLabel(wizard.locale), [wizard.locale]);
  const countryLabel = useMemo(() => getRegionName(wizard.country), [wizard.country]);

  return (
    <div className="grid h-full min-h-0 gap-4 overflow-y-auto pr-1 pb-2 lg:grid-cols-3 lg:grid-rows-[minmax(0,1fr)_auto]">
      <SearchableList
        title="Países"
        items={countryItems}
        selectedValue={wizard.country}
        query={countryQuery}
        onQueryChange={setCountryQuery}
        onPick={applyCountry}
        emptyText={loading ? 'Carregando países...' : 'Nenhum país encontrado. A lista interna do instalador já foi carregada.'}
      />

      <SearchableList
        title="Idiomas / Locales"
        items={localeItems}
        selectedValue={wizard.locale}
        query={localeQuery}
        onQueryChange={setLocaleQuery}
        onPick={(item) => onChange({ locale: item })}
        emptyText={loading ? 'Carregando locales...' : 'Nenhum idioma encontrado.'}
      />

      <SearchableList
        title="Layout de teclado"
        items={keymapItems}
        selectedValue={wizard.keyMap}
        query={keymapQuery}
        onQueryChange={setKeymapQuery}
        onPick={(item) => onChange({ keyMap: item })}
        emptyText={loading ? 'Carregando keymaps...' : 'Nenhum layout encontrado.'}
      />

      {error ? (
        <div className="lg:col-span-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {degradedMode ? (
        <div className="lg:col-span-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
          Algumas listas foram carregadas do catálogo interno do instalador para manter a operação mesmo quando o backend não responde com JSON válido.
        </div>
      ) : null}

      <div className="lg:col-span-3 grid gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">País atual</div>
          <div className="mt-2 flex items-center gap-3 text-lg font-bold text-white">
            <span className="text-2xl">{countryCodeToFlag(wizard.country)}</span>
            <span>{countryLabel || '—'}</span>
          </div>
          <div className="mt-1 text-sm text-slate-400">{wizard.country || '—'}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Locale atual</div>
          <div className="mt-2 text-lg font-bold text-white break-words">{localeLabel || '—'}</div>
          <div className="mt-1 text-sm text-slate-400 break-all">{wizard.locale || '—'}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Teclado atual</div>
          <div className="mt-2 text-lg font-bold text-white">{wizard.keyMap || '—'}</div>
          <div className="mt-1 text-sm text-slate-400">Layout do console/TTY</div>
        </div>
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Sugestão automática</div>
          <div className="mt-2 text-sm text-cyan-50">
            {selectedPreset ? (
              <>
                <div>Locale: <b>{selectedPreset.locale}</b></div>
                <div className="mt-1">Timezone: <b>{selectedPreset.timeZone}</b></div>
                <div className="mt-1">Teclado: <b>{selectedPreset.keyMap}</b></div>
              </>
            ) : 'Sem preset específico para este país; mantendo escolhas atuais.'}
          </div>
        </div>
      </div>
    </div>
  );
}
