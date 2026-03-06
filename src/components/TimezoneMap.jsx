import { useEffect, useMemo, useRef, useState } from 'react';
import { timezoneRegions } from '../data/timezoneRegions.js';

const FALLBACK_VIEWBOX = '0 0 1000 500';
const CALAMARES_WIDTH = 780;
const CALAMARES_HEIGHT = 340;

function projectCalamares(longitude, latitude) {
  const MAP_Y_OFFSET = 0.125;
  const MAP_X_OFFSET = -0.0370;
  const xBase = (CALAMARES_WIDTH / 2 + (CALAMARES_WIDTH / 2) * longitude / 180.0) + (MAP_X_OFFSET * CALAMARES_WIDTH);
  let yBase = (CALAMARES_HEIGHT / 2 - (CALAMARES_HEIGHT / 2) * latitude / 90.0) + (MAP_Y_OFFSET * CALAMARES_HEIGHT);

  if (latitude > 70.0) {
    yBase -= Math.sin(Math.PI * (latitude - 70.0) / 56.0) * MAP_Y_OFFSET * CALAMARES_HEIGHT * 0.8;
  }
  if (latitude > 74.0) yBase += 4;
  if (latitude > 69.0) yBase -= 2;
  if (latitude > 59.0) yBase -= 4 * Math.trunc((latitude - 54.0) / 5.0);
  if (latitude > 54.0) yBase -= 2;
  if (latitude > 49.0) yBase -= Math.trunc((latitude - 44.0) / 5.0);
  if (latitude < 0.0) yBase += Math.trunc((-latitude) / 5.0);
  if (latitude < -60.0) yBase = CALAMARES_HEIGHT - 1;

  let x = xBase;
  let y = yBase;
  if (x < 0) x = CALAMARES_WIDTH + x;
  if (x >= CALAMARES_WIDTH) x -= CALAMARES_WIDTH;
  if (y < 0) y = CALAMARES_HEIGHT + y;
  if (y >= CALAMARES_HEIGHT) y -= CALAMARES_HEIGHT;

  return {
    x,
    y,
    xPct: (x / CALAMARES_WIDTH) * 100,
    yPct: (y / CALAMARES_HEIGHT) * 100,
  };
}

function patchSvgMarkup(rawSvg) {
  if (!rawSvg) return '';

  try {
    const doc = new DOMParser().parseFromString(rawSvg, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return rawSvg;

    if (!svg.getAttribute('viewBox')) {
      svg.setAttribute('viewBox', FALLBACK_VIEWBOX);
    }

    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Mapa interativo de fuso horário');
    svg.setAttribute('class', 'h-full w-full object-contain');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');

    svg.querySelectorAll('[fill]').forEach((node) => {
      if (node.getAttribute('fill') !== 'none') {
        node.setAttribute('fill', 'none');
      }
    });

    svg.querySelectorAll('[stroke="none"]').forEach((node) => {
      node.setAttribute('stroke', 'currentColor');
    });

    svg.querySelectorAll('path, polygon, rect, circle, ellipse, polyline, line').forEach((node) => {
      node.setAttribute('fill', 'none');
      node.setAttribute('stroke', 'currentColor');
      node.setAttribute('stroke-width', node.getAttribute('stroke-width') || '3');
      node.setAttribute('stroke-linejoin', 'round');
      node.setAttribute('stroke-linecap', 'round');
      node.setAttribute('vector-effect', 'non-scaling-stroke');
    });

    const firstPath = svg.querySelector('path');
    if (firstPath && /^M10\s+20000/.test(firstPath.getAttribute('d') || '')) {
      firstPath.remove();
    }

    return svg.outerHTML;
  } catch {
    return rawSvg;
  }
}

export default function TimezoneMap({
  assetUrl = '/imgs/mapa.svg',
  locations = [],
  value,
  onChange,
}) {
  const mapPlaneRef = useRef(null);
  const [svgMarkup, setSvgMarkup] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError('');
        const response = await fetch(assetUrl, { cache: 'no-store' });
        const text = await response.text();
        if (!response.ok || !text.trim().startsWith('<')) {
          throw new Error('Falha ao carregar o SVG do mapa.');
        }
        if (!cancelled) {
          setSvgMarkup(text);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar o mapa.');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [assetUrl]);

  const patchedMarkup = useMemo(() => patchSvgMarkup(svgMarkup), [svgMarkup]);

  const projectedLocations = useMemo(() => {
    if (locations.length > 0) {
      return locations.map((item) => ({
        ...item,
        label: item.timezone.split('/').slice(-1)[0]?.replaceAll('_', ' ') || item.timezone,
        group: item.countryCode || 'TZ',
        ...projectCalamares(item.longitude, item.latitude),
      }));
    }

    return timezoneRegions.map((item) => ({
      ...item,
      x: (item.xPct / 100) * CALAMARES_WIDTH,
      y: (item.yPct / 100) * CALAMARES_HEIGHT,
    }));
  }, [locations]);

  const activeLocation = useMemo(
    () => projectedLocations.find((item) => item.timezone === value) || null,
    [projectedLocations, value],
  );

  const handleRegionPick = (region) => {
    onChange?.({
      timeZone: region.timezone,
      pin: {
        xPct: region.xPct,
        yPct: region.yPct,
        label: region.label,
      },
    });
  };

  function handleMapClick(event) {
    const rect = mapPlaneRef.current?.getBoundingClientRect();
    if (!rect || projectedLocations.length === 0) return;

    const clickX = ((event.clientX - rect.left) / rect.width) * CALAMARES_WIDTH;
    const clickY = ((event.clientY - rect.top) / rect.height) * CALAMARES_HEIGHT;

    let closest = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const location of projectedLocations) {
      const distance = Math.abs(clickX - location.x) + Math.abs(clickY - location.y);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = location;
      }
    }

    if (closest) {
      handleRegionPick(closest);
    }
  }

  return (
    <div className="section-panel flex-1 w-full h-full relative min-h-0 flex flex-col overflow-hidden p-2 lg:p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-white">Mapa global</h3>
          <p className="mt-1 text-sm text-slate-400">
            Visual transparente com foco nas linhas de divisão. Clique em uma região operacional para aplicar o timezone.
          </p>
        </div>
        <div className="metric-chip border-amber-200/60 bg-amber-300/25 text-amber-50">
          {activeLocation?.label || value || 'Nenhum fuso selecionado'}
        </div>
      </div>

      <div className="timezone-map relative min-h-0 flex-1 overflow-hidden rounded-[24px] border border-cyan-400/20 bg-[radial-gradient(circle_at_top,rgba(15,23,42,0.96),rgba(2,6,23,0.9))] text-cyan-100/85 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.06)]">
        <div className="absolute inset-0 flex min-h-0 items-center justify-center p-0.5 sm:p-1">
          <div
            ref={mapPlaneRef}
            className="relative aspect-[780/340] w-full max-h-full max-w-full cursor-pointer overflow-hidden rounded-[20px]"
            onClick={handleMapClick}
          >
            {patchedMarkup ? (
              <div className="absolute inset-0">
                <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: patchedMarkup }} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                {error || 'Carregando mapa SVG…'}
              </div>
            )}

            {activeLocation ? (
              <>
                <div
                  className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-[70%] rounded-full border-2 border-cyan-50 bg-cyan-300 shadow-[0_0_0_8px_rgba(34,211,238,0.18),0_20px_40px_rgba(0,0,0,0.5)]"
                  style={{ left: `${activeLocation.xPct}%`, top: `${activeLocation.yPct}%` }}
                />
                <div
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-[170%] rounded-full border border-amber-100/90 bg-amber-300/95 px-3 py-1.5 text-xs font-black text-slate-950 shadow-xl"
                  style={{ left: `${activeLocation.xPct}%`, top: `${activeLocation.yPct}%` }}
                >
                  {activeLocation.label || value}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_28%,rgba(2,6,23,0.12)_70%,rgba(2,6,23,0.42)_100%)]" />

        {activeLocation ? (
          <div className="pointer-events-none absolute left-4 top-4 max-w-[240px] rounded-2xl border border-amber-200/70 bg-slate-950/96 px-3 py-2.5 text-xs text-amber-50 shadow-2xl backdrop-blur-xl">
            <div className="font-black text-amber-200">{activeLocation.label}</div>
            <div className="mt-1 text-amber-50">{activeLocation.timezone}</div>
            <div className="mt-1 text-amber-100">{activeLocation.group}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
