import { useEffect, useRef, useState } from "react";
import { clampNumber, parseLocalizedNumber } from "../../utils/localizedNumber";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max"> & {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
};

export function LocalizedNumberInput({ value, onValueChange, min, max, onBlur, onFocus, onKeyDown, ...props }: Props) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  const lastEmitted = useRef(value);

  useEffect(() => { if (!focused.current) { setText(String(value)); lastEmitted.current = value; } }, [value]);

  function emit(value: number) {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    onValueChange(value);
  }

  function commit() {
    const parsed = parseLocalizedNumber(text);
    if (parsed === undefined) { setText(String(value)); return; }
    const next = clampNumber(parsed, min, max);
    setText(String(next));
    emit(next);
  }

  return <input
    {...props}
    type="text"
    inputMode="decimal"
    value={text}
    onChange={(event) => {
      const next = event.target.value;
      if (/^-?[\d\s]*([.,][\d]*)?$/.test(next)) {
        setText(next);
        const parsed = parseLocalizedNumber(next);
        if (parsed !== undefined && !/[.,]$/.test(next.trim())) emit(clampNumber(parsed, min, max));
      }
    }}
    onFocus={(event) => { focused.current = true; onFocus?.(event); }}
    onBlur={(event) => { focused.current = false; commit(); onBlur?.(event); }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); onKeyDown?.(event); }}
  />;
}
