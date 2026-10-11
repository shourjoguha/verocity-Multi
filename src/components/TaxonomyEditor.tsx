import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/primitives';
import {
  MODALITY_KEYS,
  MOVEMENT_MODALITIES,
  MOVEMENT_PLANES,
  MUSCLES,
  MUSCLE_KEYS,
  MUSCLE_REGIONS,
  MUSCLE_REGION_KEYS,
  PLANE_KEYS,
  ROTARY_ROLES,
  TOUCH,
  type ModalityKey,
  type MovementProfile,
  type MuscleKey,
  type PlaneKey,
  type RotaryRole,
} from '@/app.config';
import {
  BODY_FACES,
  BODY_MUSCLE_SHAPES,
  BODY_MUSCLE_SILHOUETTE,
  BODY_VIEWBOX,
  type BodyFace,
} from '@/lib/bodyRegions';
import {
  nearestWithin,
  roleOf,
  selectionFromProfile,
  splitReadout,
  toggleMuscle,
  weightsFromSelection,
  type HitCandidate,
  type MuscleRole,
  type MuscleSelection,
} from '@/lib/muscleSelection';
import type { MovementTaxonomyOverride } from '@/lib/types';

// Corrects what the static rules in lib/movementTaxonomy.ts got wrong — or
// could not get at all, as with the truncated "Wtd". The user picks MUSCLES on
// a flat Plates figure (first tap = primary, further taps = helpers), never
// weights; the split is MUSCLE_SHARES in lib/muscleSelection.ts (decision D3).
// Saves `muscles` only: applyOverride derives the regions and marks the
// profile `authored`.

const selectClass =
  'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none focus:border-subtle';

// Plates ink per role. Monochrome by house rule: role is carried by ink depth
// here and by the list's pressed/inverted state below, never by hue.
const INK: Record<'primary' | 'helper' | 'none', number> = { primary: 0.9, helper: 0.45, none: 0.1 };
const GAP_WIDTH = 0.8;
// Small muscles (tibialis, side delts, glute med, hip flexors, forearms) are
// far under a 44px target at phone width, so a tap that lands on no muscle
// resolves to the nearest muscle edge within half a target of the finger.
const HIT_RADIUS_PX = TOUCH.minTargetPx / 2;
const SAMPLES_PER_PIECE = 24;

export interface TaxonomyDraft {
  muscles: MuscleKey[];
  modality: ModalityKey;
  plane: PlaneKey;
  rotary: RotaryRole | '';
  systemic: boolean;
}

export function emptyTaxonomyDraft(): TaxonomyDraft {
  return { muscles: [], modality: 'resistance', plane: 'sagittal', rotary: '', systemic: false };
}

export function draftFromProfile(p?: Partial<MovementProfile> | null): TaxonomyDraft {
  const base = emptyTaxonomyDraft();
  if (!p) return base;
  const planes = Object.entries(p.planes ?? {}).sort((a, b) => b[1] - a[1]);
  return {
    muscles: selectionFromProfile(p),
    modality: p.modality ?? base.modality,
    plane: (planes[0]?.[0] as PlaneKey) ?? base.plane,
    rotary: p.rotary ?? '',
    systemic: p.systemic ?? false,
  };
}

export function profileFromDraft(d: TaxonomyDraft): MovementTaxonomyOverride | null {
  if (d.muscles.length === 0) return null;
  return {
    muscles: weightsFromSelection(d.muscles),
    modality: d.modality,
    planes: { [d.plane]: 1 },
    rotary: d.rotary === '' ? null : d.rotary,
    systemic: d.systemic,
  };
}

function inkFor(role: MuscleRole): number {
  return INK[role ?? 'none'];
}

// One flat face: no slab, no drag, no motion. Every muscle piece carries
// data-muscle so the hit-test below can find it, mirrored copies included.
function FlatFace({ face, sel }: { face: BodyFace; sel: MuscleSelection }) {
  const shapes = BODY_MUSCLE_SHAPES[face];
  return (
    <svg viewBox={BODY_VIEWBOX} className="block h-auto w-full" aria-hidden="true">
      <path
        d={BODY_MUSCLE_SILHOUETTE[face]}
        fill="var(--color-fg)"
        fillOpacity={0.06}
        stroke="var(--color-fg)"
        strokeOpacity={0.25}
        strokeWidth={0.6}
        vectorEffect="non-scaling-stroke"
      />
      {MUSCLE_KEYS.flatMap((m) =>
        (shapes[m] ?? []).map((shape, j) => {
          const piece = (
            <path
              data-muscle={m}
              d={shape.d}
              fill="var(--color-fg)"
              fillOpacity={inkFor(roleOf(sel, m))}
              stroke="var(--color-surface)"
              strokeWidth={GAP_WIDTH}
              strokeLinejoin="round"
            />
          );
          return (
            <g key={`${m}-${j}`}>
              {piece}
              {shape.mirrorX ? <g transform="translate(100,0) scale(-1,1)">{piece}</g> : null}
            </g>
          );
        }),
      )}
    </svg>
  );
}

// Direct hit first (isPointInFill, topmost piece wins), then the nearest
// muscle outline within HIT_RADIUS_PX. Both run in client pixels via each
// piece's screen CTM, which already includes the mirror transform.
function muscleAt(root: HTMLElement, x: number, y: number): MuscleKey | null {
  const paths = Array.from(root.querySelectorAll<SVGPathElement>('path[data-muscle]'));
  let direct: MuscleKey | null = null;
  const candidates: HitCandidate[] = [];
  for (const p of paths) {
    const ctm = p.getScreenCTM();
    if (!ctm) continue;
    const key = p.dataset.muscle as MuscleKey;
    const local = new DOMPoint(x, y).matrixTransform(ctm.inverse());
    if (p.isPointInFill(local)) direct = key;
    if (direct) continue;
    const len = p.getTotalLength();
    const points = Array.from({ length: SAMPLES_PER_PIECE }, (_, i) => {
      const q = p.getPointAtLength((len * i) / SAMPLES_PER_PIECE);
      return new DOMPoint(q.x, q.y).matrixTransform(ctm);
    });
    candidates.push({ key, points });
  }
  return direct ?? nearestWithin({ x, y }, candidates, HIT_RADIUS_PX);
}

export function TaxonomyEditor({
  open,
  movementName,
  initial,
  busy,
  onSave,
  onClose,
}: {
  open: boolean;
  movementName: string;
  initial?: Partial<MovementProfile> | null;
  busy?: boolean;
  onSave: (profile: MovementTaxonomyOverride) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TaxonomyDraft>(() => draftFromProfile(initial));
  const figureRef = useRef<HTMLDivElement>(null);

  // Re-seed whenever the editor is opened for a different movement.
  useEffect(() => {
    if (open) setDraft(draftFromProfile(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, movementName]);

  const profile = profileFromDraft(draft);
  const toggle = (m: MuscleKey) => setDraft((d) => ({ ...d, muscles: toggleMuscle(d.muscles, m) }));

  const onFigureClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const root = figureRef.current;
    if (!root) return;
    const m = muscleAt(root, e.clientX, e.clientY);
    if (m) toggle(m);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Muscle map · ${movementName}`}>
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <span className="t-label text-muted">Muscles</span>
          {/* aria-hidden: the toggle list below mirrors this figure and is the
              keyboard and screen-reader path. */}
          <div
            ref={figureRef}
            onClick={onFigureClick}
            aria-hidden="true"
            className="mx-auto grid w-full max-w-[300px] cursor-pointer grid-cols-2 gap-4"
          >
            {BODY_FACES.map((face) => (
              <div key={face} className="flex flex-col items-center gap-1">
                <FlatFace face={face} sel={draft.muscles} />
                <span className="t-label text-muted">{face}</span>
              </div>
            ))}
          </div>
          <p className="min-h-5 text-sm tabular-nums text-fg" aria-live="polite">
            {draft.muscles.length > 0
              ? splitReadout(draft.muscles)
              : 'Tap the main muscle, then any helpers.'}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {MUSCLE_REGION_KEYS.map((r) => {
            const muscles = MUSCLE_KEYS.filter((m) => MUSCLES[m].region === r);
            return (
              <div key={r} role="group" aria-label={MUSCLE_REGIONS[r].label} className="flex flex-col gap-1">
                <span className="t-label text-muted">{MUSCLE_REGIONS[r].label}</span>
                <div className="flex flex-wrap gap-2">
                  {muscles.map((m) => {
                    const role = roleOf(draft.muscles, m);
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={role !== null}
                        onClick={() => toggle(m)}
                        className="hill-btn t-control inline-flex min-h-11 items-center gap-2 border border-border bg-surface px-3 text-fg"
                      >
                        {MUSCLES[m].label}
                        {/* Pressed fill marks any selection; the primary also
                            says so in words, since .hill-btn's pressed rule is
                            unlayered and owns the fill. */}
                        {role === 'primary' ? (
                          <span className="t-label text-muted">primary</span>
                        ) : role === 'helper' ? (
                          <span className="sr-only">, helper</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">Modality</span>
          <select
            className={selectClass}
            value={draft.modality}
            onChange={(e) => setDraft({ ...draft, modality: e.target.value as ModalityKey })}
          >
            {MODALITY_KEYS.map((k) => (
              <option key={k} value={k}>
                {MOVEMENT_MODALITIES[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">Plane of motion</span>
          <select
            className={selectClass}
            value={draft.plane}
            onChange={(e) => setDraft({ ...draft, plane: e.target.value as PlaneKey })}
          >
            {PLANE_KEYS.map((k) => (
              <option key={k} value={k}>
                {MOVEMENT_PLANES[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">Rotary role</span>
          <select
            className={selectClass}
            value={draft.rotary}
            onChange={(e) => setDraft({ ...draft, rotary: e.target.value as RotaryRole | '' })}
          >
            <option value="">None</option>
            {(['rotational', 'antiRotational'] as const).map((k) => (
              <option key={k} value={k}>
                {ROTARY_ROLES[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-h-11 items-center gap-3 text-sm text-subtle">
          <input
            type="checkbox"
            checked={draft.systemic}
            onChange={(e) => setDraft({ ...draft, systemic: e.target.checked })}
            className="h-5 w-5 accent-[var(--color-fg)]"
          />
          Whole-body / systemic demand
        </label>
      </div>

      <div className="flex gap-3 border-t border-border p-4">
        <Button
          type="button"
          disabled={busy || !profile}
          onClick={() => profile && onSave(profile)}
        >
          Save map
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
