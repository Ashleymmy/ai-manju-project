import type { CSSProperties } from "react";
import "./video-duration-input.css";

type Props = {
  value: string;
  durations: ReadonlyArray<string | number>;
  disabled?: boolean;
  presentation?: "default" | "scrubber";
  onChange: (seconds: string) => void;
};

// Two track segments put max / 2 at the physical midpoint even when min > 0.
const trackEnd = 100;
const trackMiddle = trackEnd / 2;

export function VideoDurationInput({ value, durations, disabled, presentation = "default", onChange }: Props) {
  const values = [...new Set(durations.map(Number).filter(duration => Number.isFinite(duration) && duration > 0))].sort((a, b) => a - b);
  const min = values[0];
  const max = values[values.length - 1];
  const middle = max / 2;
  const automatic = value === "-1";
  const supportsAuto = durations.some(duration => Number(duration) === -1);
  const current = Number(value) > 0 ? Number(value) : min;
  const snap = (seconds: number) => values.reduce((best, item) => Math.abs(item - seconds) <= Math.abs(best - seconds) ? item : best);
  // Narrow/discrete ranges cannot place max / 2 below their minimum on the rail.
  const splitTrack = min < middle;
  const toPosition = (seconds: number) => !splitTrack ? (seconds - min) / (max - min) * trackEnd
    : seconds <= middle ? (seconds - min) / (middle - min) * trackMiddle
      : trackMiddle + (seconds - middle) / (max - middle) * trackMiddle;
  const fromPosition = (position: number) => !splitTrack ? min + position / trackEnd * (max - min)
    : position <= trackMiddle ? min + position / trackMiddle * (middle - min)
      : middle + (position - trackMiddle) / trackMiddle * (max - middle);
  const scrubber = presentation === "scrubber";
  const useSlider = values.length > 1 && (splitTrack || scrubber);
  const position = useSlider ? toPosition(snap(current)) : 0;
  const slider = useSlider ? <input
      type="range" aria-label="视频时长" disabled={disabled}
      min={0} max={trackEnd} step="any"
      value={position} aria-valuemin={min} aria-valuemax={max} aria-valuenow={snap(current)}
      aria-valuetext={automatic ? "自动" : `${snap(current)} 秒`}
      onChange={event => onChange(String(snap(fromPosition(Number(event.target.value)))))}
      onKeyDown={event => {
        const index = values.indexOf(snap(current));
        const next = event.key === "Home" ? min : event.key === "End" ? max
          : ["ArrowRight", "ArrowUp"].includes(event.key) ? values[Math.min(values.length - 1, index + 1)]
          : ["ArrowLeft", "ArrowDown"].includes(event.key) ? values[Math.max(0, index - 1)] : undefined;
        if (next !== undefined) { event.preventDefault(); onChange(String(next)); }
      }}
    /> : null;
  return <div className={`video-duration-input${scrubber ? " video-duration-input--scrubber" : ""}`}>
    {useSlider ? <>
    {scrubber ? <div className="video-duration-input-rail" style={{ "--duration-position": `${position}%`, "--duration-progress": `${automatic ? 0 : position}%` } as CSSProperties}>
      <div className="video-duration-input-value-lane" aria-hidden="true">
        <span className="video-duration-input-value">{automatic ? "自动" : `${snap(current)} 秒`}</span>
      </div>
      {slider}
    </div> : slider}
    <div className="video-duration-input-caption">
      <span>{min}s</span>
      <span>{splitTrack ? `${middle}s` : ""}</span>
      <span>{max}s</span>
    </div>
    {!values.includes(middle) || !splitTrack ? <p className="video-duration-input-note">拖动吸附至模型支持的时长</p> : null}
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
