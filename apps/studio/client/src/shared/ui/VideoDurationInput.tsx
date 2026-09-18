import "./video-duration-input.css";

type Props = {
  value: string;
  durations: ReadonlyArray<string | number>;
  continuous: boolean;
  disabled?: boolean;
  onChange: (seconds: string) => void;
};

/** Seedance uses integer seconds; other adapters retain their supported choices. */
export function VideoDurationInput({ value, durations, continuous, disabled, onChange }: Props) {
  const values = durations.map(Number).filter(duration => duration > 0);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const automatic = value === "-1";
  const current = continuous
    ? Math.max(min, Math.min(max, Number(value) || min))
    : Math.max(0, values.indexOf(Number(value)));
  return <div className="video-duration-input">
    <input
      type="range" aria-label="视频时长" disabled={disabled}
      min={continuous ? min : 0} max={continuous ? max : values.length - 1} step={1}
      value={current} aria-valuetext={automatic ? "自动" : `${value} 秒`}
      onChange={event => onChange(continuous ? event.target.value : String(values[Number(event.target.value)]))}
    />
    <div className="video-duration-input-caption">
      <span>{min}s</span>
      <span>{automatic ? "自动" : `${value} 秒`}</span>
      <span>{max}s</span>
    </div>
    {durations.some(duration => Number(duration) === -1) ? <button
      type="button" className={automatic ? "active" : ""} aria-pressed={automatic} disabled={disabled}
      onClick={() => onChange(automatic ? String(min) : "-1")}
    >自动时长</button> : null}
  </div>;
}
