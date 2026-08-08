// The "You" group on /app/settings — the first place the app asks for anything
// about the person rather than the training.
//
// Two fields reach a metric: bodyweight prices unweighted work (a push-up stops
// costing a flat 40kg for everyone) and birth year supplies 220−age as the
// last-resort HR ceiling.
//
// Everything else here — height, gender, injuries, and the preferences added by
// migration 0030 — is read by `buildPlanAiPrompt` (src/lib/planTemplate.ts),
// which renders it into the prompt the user copies on /app/plan/upload. That is
// the only consumer, and it is why a blank field matters: absence becomes a
// question the AI asks the athlete rather than a silent default.
//
// `body_type` remains the exception, stored and read by nothing. See the note on
// BODY_TYPES in app.config.ts — it is deliberately kept out of prescription.
//
// All of it lives on `user_stats`, which has no anon RLS policy, so none of it
// can reach the public showcase. That is a schema guarantee, not a UI one.
import { useEffect, useState } from 'react';
import {
  BODY_TYPES,
  DISCIPLINES,
  EQUIPMENT,
  EXPERIENCE_KEYS,
  EXPERIENCE_LEVELS,
  GENDERS,
  GENDER_KEYS,
  MUSCLE_REGIONS,
  MUSCLE_REGION_KEYS,
  PLAN_LENGTH,
  STATS_LIMITS,
  type DisciplineKey,
  type EquipmentKey,
  type ExperienceKey,
  type GenderKey,
  type RegionKey,
} from '@/app.config';
import { getUserStats, upsertUserStats } from '@/lib/queries';
import type { Injury, UserStats } from '@/lib/types';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/primitives';

const field =
  'min-h-11 w-full border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-fg';
const numField = `${field} tabular-nums`;
const label = 'mb-1 block t-label text-muted';

// Inputs are strings so a half-typed "17" in a bounded field is not clamped or
// blanked mid-keystroke. Parsing to number/null happens once, on save.
interface FormState {
  weight: string;
  height: string;
  birthYear: string;
  gender: GenderKey | '';
  bodyType: string;
  injuries: Injury[];
  experience: ExperienceKey | '';
  daysPerWeek: string;
  equipment: EquipmentKey[];
  disciplines: DisciplineKey[];
  planWeeks: string;
}

const EMPTY: FormState = {
  weight: '',
  height: '',
  birthYear: '',
  gender: '',
  bodyType: '',
  injuries: [],
  experience: '',
  daysPerWeek: '',
  equipment: [],
  disciplines: [],
  planWeeks: '',
};

function toForm(stats: UserStats | null): FormState {
  if (!stats) return EMPTY;
  return {
    weight: stats.body_weight_kg?.toString() ?? '',
    height: stats.height_cm?.toString() ?? '',
    birthYear: stats.birth_year?.toString() ?? '',
    gender: stats.gender ?? '',
    bodyType: stats.body_type ?? '',
    injuries: stats.injuries ?? [],
    experience: stats.experience ?? '',
    daysPerWeek: stats.days_per_week?.toString() ?? '',
    equipment: stats.equipment ?? [],
    disciplines: stats.disciplines ?? [],
    planWeeks: stats.preferred_plan_weeks?.toString() ?? '',
  };
}

// 6..12. The prompt asks the athlete to confirm a length inside this range, so
// offering anything else here would set an expectation the prompt then argues
// with.
const planWeekOptions = Array.from(
  { length: PLAN_LENGTH.maxWeeks - PLAN_LENGTH.minWeeks + 1 },
  (_, i) => PLAN_LENGTH.minWeeks + i,
);

/** Parse within bounds, or null. Out-of-range reads as "not entered". */
function bounded(raw: string, { min, max }: { min: number; max: number }): number | null {
  const n = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(n)) return null;
  return n >= min && n <= max ? n : null;
}

function bodyTypesFor(gender: GenderKey | ''): readonly { key: string; label: string }[] {
  return gender === '' ? BODY_TYPES.unspecified : BODY_TYPES[gender];
}

// `onSaved` lets a parent re-read the row after a successful save. YouView's
// summary card renders the same user_stats row and would otherwise show stale
// numbers until a full reload.
export function UserStatsPanel({ onSaved }: { onSaved?: () => void } = {}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const stats = await getUserStats();
      if (!active) return;
      setForm(toForm(stats));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  // The shape vocabularies differ per gender, so a stored "pear" is not a valid
  // option once gender flips to male. Drop it rather than render a select whose
  // value matches nothing.
  function onGenderChange(next: GenderKey | '') {
    const stillValid = bodyTypesFor(next).some((b) => b.key === form.bodyType);
    patch({ gender: next, bodyType: stillValid ? form.bodyType : '' });
  }

  function toggleEquipment(key: EquipmentKey) {
    patch({
      equipment: form.equipment.includes(key)
        ? form.equipment.filter((k) => k !== key)
        : [...form.equipment, key],
    });
  }

  function toggleDiscipline(key: DisciplineKey) {
    patch({
      disciplines: form.disciplines.includes(key)
        ? form.disciplines.filter((k) => k !== key)
        : [...form.disciplines, key],
    });
  }

  function addInjury() {
    if (form.injuries.length >= STATS_LIMITS.maxInjuries) return;
    patch({
      injuries: [...form.injuries, { id: crypto.randomUUID(), region: null, label: '' }],
    });
  }

  function patchInjury(id: string, p: Partial<Injury>) {
    patch({ injuries: form.injuries.map((i) => (i.id === id ? { ...i, ...p } : i)) });
  }

  function removeInjury(id: string) {
    patch({ injuries: form.injuries.filter((i) => i.id !== id) });
  }

  async function onSave() {
    if (saving) return;
    setSaving(true);
    const ok = await upsertUserStats({
      body_weight_kg: bounded(form.weight, STATS_LIMITS.weightKg),
      height_cm: bounded(form.height, STATS_LIMITS.heightCm),
      birth_year: bounded(form.birthYear, STATS_LIMITS.birthYear),
      gender: form.gender === '' ? null : form.gender,
      body_type: form.bodyType === '' ? null : form.bodyType,
      // Blank rows are noise, not data.
      injuries: form.injuries.filter((i) => i.label.trim() !== ''),
      experience: form.experience === '' ? null : form.experience,
      days_per_week: bounded(form.daysPerWeek, STATS_LIMITS.daysPerWeek),
      equipment: form.equipment,
      disciplines: form.disciplines,
      preferred_plan_weeks: bounded(form.planWeeks, {
        min: PLAN_LENGTH.minWeeks,
        max: PLAN_LENGTH.maxWeeks,
      }),
    });
    setSaving(false);
    toast(ok ? 'Stats saved' : 'Could not save — try again', ok ? 'success' : 'error');
    if (ok) onSaved?.();
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[0.7rem] text-muted">
        Private to you. These never appear on your public showcase or in a share link.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="stat-weight">
            Bodyweight (kg)
          </label>
          <input
            id="stat-weight"
            type="number"
            inputMode="decimal"
            step="0.1"
            min={STATS_LIMITS.weightKg.min}
            max={STATS_LIMITS.weightKg.max}
            value={form.weight}
            onChange={(e) => patch({ weight: e.target.value })}
            className={numField}
          />
        </div>
        <div>
          <label className={label} htmlFor="stat-height">
            Height (cm)
          </label>
          <input
            id="stat-height"
            type="number"
            inputMode="decimal"
            step="0.5"
            min={STATS_LIMITS.heightCm.min}
            max={STATS_LIMITS.heightCm.max}
            value={form.height}
            onChange={(e) => patch({ height: e.target.value })}
            className={numField}
          />
        </div>
        <div>
          <label className={label} htmlFor="stat-birth">
            Birth year
          </label>
          <input
            id="stat-birth"
            type="number"
            inputMode="numeric"
            step="1"
            min={STATS_LIMITS.birthYear.min}
            max={STATS_LIMITS.birthYear.max}
            value={form.birthYear}
            onChange={(e) => patch({ birthYear: e.target.value })}
            className={numField}
          />
        </div>
      </div>

      <p className="text-[0.7rem] text-muted">
        Bodyweight prices unweighted work — push-ups, jumps and planks — against your own
        mass instead of a flat estimate. Birth year sets your heart-rate ceiling until you
        log a higher one, and your age in the AI plan prompt. Height is stored for later.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="stat-gender">
            Gender
          </label>
          <select
            id="stat-gender"
            value={form.gender}
            onChange={(e) => onGenderChange(e.target.value as GenderKey | '')}
            className={field}
          >
            <option value="">—</option>
            {GENDER_KEYS.map((k) => (
              <option key={k} value={k}>
                {GENDERS[k].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="stat-body-type">
            Body type
          </label>
          <select
            id="stat-body-type"
            value={form.bodyType}
            onChange={(e) => patch({ bodyType: e.target.value })}
            className={field}
          >
            <option value="">—</option>
            {bodyTypesFor(form.gender).map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="stat-experience">
            Experience
          </label>
          <select
            id="stat-experience"
            value={form.experience}
            onChange={(e) => patch({ experience: e.target.value as ExperienceKey | '' })}
            className={field}
          >
            <option value="">—</option>
            {EXPERIENCE_KEYS.map((k) => (
              <option key={k} value={k}>
                {EXPERIENCE_LEVELS[k].label}
              </option>
            ))}
          </select>
          {form.experience ? (
            <p className="mt-1 text-[0.7rem] text-muted">{EXPERIENCE_LEVELS[form.experience].blurb}</p>
          ) : null}
        </div>
        <div>
          <label className={label} htmlFor="stat-days">
            Training days / week
          </label>
          <input
            id="stat-days"
            type="number"
            inputMode="numeric"
            step="1"
            min={STATS_LIMITS.daysPerWeek.min}
            max={STATS_LIMITS.daysPerWeek.max}
            value={form.daysPerWeek}
            onChange={(e) => patch({ daysPerWeek: e.target.value })}
            className={numField}
          />
        </div>
        <div>
          <label className={label} htmlFor="stat-plan-weeks">
            Preferred plan length
          </label>
          <select
            id="stat-plan-weeks"
            value={form.planWeeks}
            onChange={(e) => patch({ planWeeks: e.target.value })}
            className={field}
          >
            <option value="">—</option>
            {planWeekOptions.map((w) => (
              <option key={w} value={String(w)}>
                {w} weeks
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className={label}>Equipment available</span>
        <div className="flex flex-wrap gap-2">
          {EQUIPMENT.map((e) => {
            const on = form.equipment.includes(e.key);
            return (
              <button
                key={e.key}
                type="button"
                onClick={() => toggleEquipment(e.key)}
                aria-pressed={on}
                className={`hill-btn min-h-11 border bg-surface px-3 text-sm ${
                  on ? 'border-fg text-fg' : 'border-border text-muted'
                }`}
              >
                {e.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className={label}>Disciplines</span>
        <div className="flex flex-wrap gap-2">
          {DISCIPLINES.map((d) => {
            const on = form.disciplines.includes(d.key);
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => toggleDiscipline(d.key)}
                aria-pressed={on}
                className={`hill-btn min-h-11 border bg-surface px-3 text-sm ${
                  on ? 'border-fg text-fg' : 'border-border text-muted'
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[0.7rem] text-muted">
        Experience, days, equipment, disciplines and plan length are written into the AI prompt
        on the new-plan page, along with your goals, age, sex and injuries. Anything you leave
        blank becomes a question the AI asks you before it writes the plan.
      </p>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <span className={`${label} mb-0`}>Past injuries</span>
          <Button
            variant="ghost"
            onClick={addInjury}
            disabled={form.injuries.length >= STATS_LIMITS.maxInjuries}
            className="text-xs"
          >
            Add
          </Button>
        </div>

        {form.injuries.length === 0 ? (
          <p className="text-[0.7rem] text-muted">None recorded.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {form.injuries.map((inj) => (
              <li key={inj.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                <input
                  type="text"
                  value={inj.label}
                  maxLength={STATS_LIMITS.injuryLabelChars}
                  onChange={(e) => patchInjury(inj.id, { label: e.target.value })}
                  placeholder="What happened"
                  aria-label="Injury"
                  className={field}
                />
                <select
                  value={inj.region ?? ''}
                  onChange={(e) =>
                    patchInjury(inj.id, { region: (e.target.value || null) as RegionKey | null })
                  }
                  aria-label="Region"
                  className={`${field} sm:w-40`}
                >
                  <option value="">Region —</option>
                  {MUSCLE_REGION_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {MUSCLE_REGIONS[k].label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  value={inj.year?.toString() ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    patchInjury(inj.id, {
                      year: e.target.value === '' || !Number.isFinite(n) ? undefined : n,
                    });
                  }}
                  placeholder="Year"
                  // Not "Year": that substring-matches the "Birth year" field
                  // above, leaving two controls a screen reader cannot tell apart.
                  aria-label="Injury year"
                  className={`${numField} sm:w-24`}
                />
                <Button variant="ghost" onClick={() => removeInjury(inj.id)} className="text-xs">
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[0.7rem] text-muted">
          Sent to the AI when you generate a plan, so it can work around them. Naming the
          region is what lets it substitute the right movements.
        </p>
      </div>

      <div>
        <Button onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
