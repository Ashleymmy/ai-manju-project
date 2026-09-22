import "./video-duration-input.css";

type Props = {
  value: string;
  durations: ReadonlyArray<string | number>;
  disabled?: boolean;
  onChange: (seconds: string) => void;
};

// Two track segments put max / 2 at the physical midpoint even when min > 0.
const trackEnd = 100;
const trackMiddle = trackEnd / 2;

export function VideoDurationInput({ value, durations, disabled, onChange }: Props) {
  const values = [...new Set(durations.map(Number).filter(duration => Number.isFinite(duration) && duration > 0))].sort((a, b) => a - b);
  const min = values[0];
  const max = values[values.length - 1];
  const middle = max / 2;
  const automatic = value === "-1";
  const supportsAuto = durations.some(duration => Number(duration) === -1);
  const current = Number(value) > 0 ? Number(value) : min;
  const snap = (seconds: number) => values.reduce((best, item) => Math.abs(item - seconds) <= Math.abs(best - seconds) ? item : best);
  const toPosition = (seconds: number) => seconds <= middle
    ? (seconds - min) / (middle - min) * trackMiddle
    : trackMiddle + (seconds - middle) / (max - middle) * trackMiddle;
  const fromPosition = (position: number) => position <= trackMiddle
    ? min + position / trackMiddle * (middle - min)
    : middle + (position - trackMiddle) / trackMiddle * (max - middle);
  const useSlider = values.length > 1 && min < middle;
  return <div className="video-duration-input">
    {useSlider ? <><input
      type="range" aria-label="视频时长" disabled={disabled}
      min={0} max={trackEnd} step="any"
      value={toPosition(snap(current))} aria-valuemin={min} aria-valuemax={max} aria-valuenow={snap(current)}
      aria-valuetext={automatic ? "自动" : `${value} 秒`}
      onChange={event => onChange(String(snap(fromPosition(Number(event.target.value)))))}
      onKeyDown={event => {
        const index = values.indexOf(snap(current));
        const next = event.key === "Home" ? min : event.key === "End" ? max
          : ["ArrowRight", "ArrowUp"].includes(event.key) ? values[Math.min(values.length - 1, index + 1)]
          : ["ArrowLeft", "ArrowDown"].includes(event.key) ? values[Math.max(0, index - 1)] : undefined;
        if (next !== undefined) { event.preventDefault(); onChange(String(next)); }
      }}
    />
    <div className="video-duration-input-caption">
      <span>{min}s</span>
      <span>{middle}s</span>
      <span>{max}s</span>
    </div>
    {!values.includes(middle) ? <p className="video-duration-input-note">拖动吸附至模型支持的时长</p> : null}
    </> : values.length ? <div className="video-duration-input-choices">
      {values.map(seconds => <button key={seconds} type="button" disabled={disabled}
        className={current === seconds && !automatic ? "active" : ""} aria-pressed={current === seconds && !automatic}
        onClick={() => onChange(String(seconds))}>{seconds} 秒</button>)}
    </div> : !supportsAuto ? <>
      <input type="number" aria-label="视频时长（秒）" min={1} step={1} value={value} disabled={disabled}
        onChange={event => { if (Number(event.target.value) > 0) onChange(event.target.value); }} />
      <p className="video-duration-input-note">该模型未提供时长范围，请按模型说明填写</p>
    </> : null}
    {supportsAuto ? <button
      type="button" className={automatic ? "active" : ""} aria-pressed={automatic} disabled={disabled}
      onClick={() => onChange(automatic && values.length ? String(min) : "-1")}
    >自动时长</button> : null}
  </div>;
}
