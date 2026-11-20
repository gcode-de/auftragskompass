// EDITOR-LAYOUT-01: one discount is one number field with a compact unit
// switch beside it instead of two number fields of which one was permanently
// disabled. Both stored values stay in the caller's form state: the switch only
// renames the field, so it never converts, resets or hides the other value.
export type DiscountMode = 'percent' | 'amount';

type Props = {
  /** The active mode decides which of the two stored values the field shows. */
  mode: DiscountMode;
  value: string;
  /** Names the unit the single field currently holds, e.g. "Rabatt in Euro". */
  valueLabel: string;
  /** DOC-PRODUCT-01.4: percent caps at 100 %, a euro amount is a plain decimal. */
  valueInvalid?: boolean;
  /** The offer editor requires an entered value; the template form does not. */
  required?: boolean;
  onValueChange: (value: string) => void;
  onModeChange: (mode: DiscountMode) => void;
};

export function DiscountField({
  mode,
  value,
  valueLabel,
  valueInvalid = false,
  required = false,
  onValueChange,
  onModeChange,
}: Props) {
  return (
    <div className="discount-field">
      <label>
        Rabattart
        <select
          value={mode}
          onChange={(event) =>
            onModeChange(event.target.value === 'amount' ? 'amount' : 'percent')
          }
        >
          <option value="percent">Prozent</option>
          <option value="amount">Euro</option>
        </select>
      </label>
      <label>
        {valueLabel}
        <input
          type="text"
          inputMode="decimal"
          value={value}
          required={required}
          aria-invalid={valueInvalid}
          onChange={(event) => onValueChange(event.target.value)}
        />
      </label>
    </div>
  );
}
