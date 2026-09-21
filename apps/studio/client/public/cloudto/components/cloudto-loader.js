/* cloudto 云格 · dependency-free Web Component. */
(() => {
  'use strict';
  const ART = {"intro": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 720 400\" role=\"img\" aria-label=\"云格品牌展开动画\" ><defs>\n    <linearGradient id=\"ct-gradient\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0.8\"><stop stop-color=\"#65C9F4\"/><stop offset=\".48\" stop-color=\"#6387FF\"/><stop offset=\"1\" stop-color=\"#A879F5\"/></linearGradient>\n    <linearGradient id=\"ct-soft\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"#65C9F4\" stop-opacity=\".2\"/><stop offset=\"1\" stop-color=\"#A879F5\" stop-opacity=\".06\"/></linearGradient>\n    </defs><style>svg{--ct-stroke:#CFD8EC;--ct-panel:#FFFFFF;--ct-ink:#202632} @media(prefers-color-scheme:dark){svg{--ct-stroke:#3A455E;--ct-panel:#1B2232;--ct-ink:#EFF3FF}} .ct-static{display:none} @media(prefers-reduced-motion:reduce){svg *{animation:none!important;stroke-dashoffset:0!important}.ct-draw{stroke-dasharray:none!important}.ct-sweep{display:none}.ct-static{display:initial}}\n.ct-frame{transform-origin:360px 197px;animation:ct-open 2.6s cubic-bezier(.16,1,.3,1) both}.ct-frame-b{animation-delay:.15s}.ct-frame-c{animation-delay:.3s}\n.ct-draw{stroke-dasharray:810;animation:ct-draw 1.65s .3s cubic-bezier(.45,0,.2,1) both}\n.ct-seed{transform-box:fill-box;transform-origin:center;animation:ct-seed 1.2s 1.65s cubic-bezier(.16,1,.3,1) both}\n.ct-brand{animation:ct-brand 1.2s 1.35s both}.ct-flare{transform-origin:360px 197px;animation:ct-flare 2.5s .25s both}\n@keyframes ct-open{0%{opacity:0;transform:scale(.52)}65%{opacity:.75}100%{opacity:.46;transform:scale(1)}}\n@keyframes ct-draw{from{stroke-dashoffset:810}to{stroke-dashoffset:0}}\n@keyframes ct-seed{0%{opacity:0;transform:scale(.1)}50%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:scale(1)}}\n@keyframes ct-brand{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:translateY(0)}}\n@keyframes ct-flare{0%{opacity:0;transform:scale(.4)}40%{opacity:1}100%{opacity:.25;transform:scale(1)}}</style>\n<ellipse class=\"ct-flare\" cx=\"360\" cy=\"198\" rx=\"225\" ry=\"164\" fill=\"url(#ct-soft)\"/>\n<g fill=\"none\" stroke=\"var(--ct-stroke,#CFD8EC)\" stroke-width=\"1.3\">\n<rect class=\"ct-frame\" x=\"171\" y=\"81\" width=\"378\" height=\"235\" rx=\"24\"/>\n<rect class=\"ct-frame ct-frame-b\" x=\"125\" y=\"59\" width=\"470\" height=\"279\" rx=\"30\"/>\n<rect class=\"ct-frame ct-frame-c\" x=\"79\" y=\"36\" width=\"562\" height=\"326\" rx=\"38\"/>\n</g>\n<g class=\"ct-frame ct-frame-c\" fill=\"#8EADF6\"><circle cx=\"79\" cy=\"148\" r=\"4\"/><circle cx=\"641\" cy=\"251\" r=\"4\"/></g>\n<g transform=\"translate(243 109) scale(.7)\"><path class=\"ct-draw\" d=\"M85 77 C87 35 112 25 145 25 C197 25 216 104 153 104 H73 C5 104 5 198 73 198 H236 C269 198 269 150 236 150 H96\" pathLength=\"810\" fill=\"none\" stroke=\"url(#ct-gradient)\" stroke-width=\"36\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle class=\"ct-seed\" cx=\"310\" cy=\"150\" r=\"21\" fill=\"#A879F5\"/></g><g class=\"ct-brand\"><g transform=\"translate(270 289) scale(.49)\"><g fill=\"none\" stroke=\"var(--ct-ink,#202632)\" stroke-width=\"8.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M44 42 C32 24 7 34 7 55 C7 78 32 82 44 68 M63 14 V75\"/>\n    <ellipse cx=\"102\" cy=\"55\" rx=\"23\" ry=\"22\"/>\n    <path d=\"M143 34 V56 C143 84 187 84 187 56 V34 M249 14 V75 M249 55 C249 25 203 25 203 55 C203 85 249 85 249 55 M277 18 V61 Q277 78 291 74 M265 35 H294\"/>\n    <ellipse cx=\"332\" cy=\"55\" rx=\"23\" ry=\"22\"/></g></g></g></svg>", "page": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 340 230\" role=\"img\" aria-label=\"页面加载中\" ><defs>\n    <linearGradient id=\"ct-gradient\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0.8\"><stop stop-color=\"#65C9F4\"/><stop offset=\".48\" stop-color=\"#6387FF\"/><stop offset=\"1\" stop-color=\"#A879F5\"/></linearGradient>\n    <linearGradient id=\"ct-soft\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"#65C9F4\" stop-opacity=\".2\"/><stop offset=\"1\" stop-color=\"#A879F5\" stop-opacity=\".06\"/></linearGradient>\n    </defs><style>svg{--ct-stroke:#CFD8EC;--ct-panel:#FFFFFF;--ct-ink:#202632} @media(prefers-color-scheme:dark){svg{--ct-stroke:#3A455E;--ct-panel:#1B2232;--ct-ink:#EFF3FF}} .ct-static{display:none} @media(prefers-reduced-motion:reduce){svg *{animation:none!important;stroke-dashoffset:0!important}.ct-draw{stroke-dasharray:none!important}.ct-sweep{display:none}.ct-static{display:initial}}\n.ct-sweep{stroke-dasharray:170 640;animation:ct-flow 1.1s linear infinite}.ct-pulse{transform-box:fill-box;transform-origin:center;animation:ct-pulse 1.1s ease-in-out infinite}\n@keyframes ct-flow{from{stroke-dashoffset:810}to{stroke-dashoffset:0}}@keyframes ct-pulse{0%,100%{opacity:.4;transform:scale(.78)}50%{opacity:1;transform:scale(1)}}</style><path class=\"\" d=\"M85 77 C87 35 112 25 145 25 C197 25 216 104 153 104 H73 C5 104 5 198 73 198 H236 C269 198 269 150 236 150 H96\" pathLength=\"810\" fill=\"none\" stroke=\"url(#ct-gradient)\" stroke-width=\"36\" opacity=\".16\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle opacity=\".12\" class=\"\" cx=\"310\" cy=\"150\" r=\"21\" fill=\"#A879F5\"/><path class=\"ct-sweep\" d=\"M85 77 C87 35 112 25 145 25 C197 25 216 104 153 104 H73 C5 104 5 198 73 198 H236 C269 198 269 150 236 150 H96\" pathLength=\"810\" fill=\"none\" stroke=\"url(#ct-gradient)\" stroke-width=\"36\" stroke-linecap=\"round\"/><circle class=\"ct-pulse\" cx=\"310\" cy=\"150\" r=\"21\" fill=\"url(#ct-gradient)\"/><g class=\"ct-static\"><path class=\"\" d=\"M85 77 C87 35 112 25 145 25 C197 25 216 104 153 104 H73 C5 104 5 198 73 198 H236 C269 198 269 150 236 150 H96\" pathLength=\"810\" fill=\"none\" stroke=\"url(#ct-gradient)\" stroke-width=\"36\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle class=\"\" cx=\"310\" cy=\"150\" r=\"21\" fill=\"#A879F5\"/></g></svg>", "creation": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 640 388\" role=\"img\" aria-label=\"正在生成创作内容\" ><defs>\n    <linearGradient id=\"ct-gradient\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0.8\"><stop stop-color=\"#65C9F4\"/><stop offset=\".48\" stop-color=\"#6387FF\"/><stop offset=\"1\" stop-color=\"#A879F5\"/></linearGradient>\n    <linearGradient id=\"ct-soft\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"#65C9F4\" stop-opacity=\".2\"/><stop offset=\"1\" stop-color=\"#A879F5\" stop-opacity=\".06\"/></linearGradient>\n    </defs><style>svg{--ct-stroke:#CFD8EC;--ct-panel:#FFFFFF;--ct-ink:#202632} @media(prefers-color-scheme:dark){svg{--ct-stroke:#3A455E;--ct-panel:#1B2232;--ct-ink:#EFF3FF}} .ct-static{display:none} @media(prefers-reduced-motion:reduce){svg *{animation:none!important;stroke-dashoffset:0!important}.ct-draw{stroke-dasharray:none!important}.ct-sweep{display:none}.ct-static{display:initial}}\n.ct-orbit{transform-origin:320px 194px;animation:ct-orbit 8s linear infinite}.ct-orbit-b{animation-duration:8s;animation-direction:reverse}\n.ct-card-a{animation:ct-hover 4s ease-in-out infinite}.ct-card-b{animation:ct-hover 4s -2s ease-in-out infinite}.ct-core{animation:ct-breathe 4s ease-in-out infinite;transform-origin:320px 194px}\n.ct-route{stroke-dasharray:12 12;animation:ct-route 2s linear infinite}.ct-glint{animation:ct-glint 4s ease-in-out infinite}\n@keyframes ct-orbit{to{transform:rotate(360deg)}}@keyframes ct-hover{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}\n@keyframes ct-breathe{0%,100%{opacity:.75;transform:scale(.96)}50%{opacity:1;transform:scale(1.035)}}\n@keyframes ct-route{to{stroke-dashoffset:-48}}@keyframes ct-glint{0%,100%{opacity:.4}50%{opacity:1}}</style>\n<circle cx=\"320\" cy=\"194\" r=\"133\" fill=\"url(#ct-soft)\" opacity=\".7\"/>\n<g fill=\"none\" stroke=\"var(--ct-stroke,#CFD8EC)\"><circle cx=\"320\" cy=\"194\" r=\"136\"/><circle cx=\"320\" cy=\"194\" r=\"112\" stroke-dasharray=\"2 10\"/><path class=\"ct-route\" d=\"M153 221 Q212 120 320 194 T489 147\"/></g>\n<g class=\"ct-orbit\"><circle cx=\"320\" cy=\"58\" r=\"6\" fill=\"#7999FB\"/><circle cx=\"320\" cy=\"330\" r=\"4\" fill=\"#A879F5\"/></g>\n<g class=\"ct-orbit ct-orbit-b\"><circle cx=\"432\" cy=\"194\" r=\"4\" fill=\"#65C9F4\"/></g>\n<g class=\"ct-core\"><circle cx=\"320\" cy=\"194\" r=\"83\" fill=\"url(#ct-soft)\"/><circle cx=\"320\" cy=\"194\" r=\"69\" fill=\"var(--ct-panel,#fff)\" stroke=\"var(--ct-stroke,#CFD8EC)\"/></g>\n<g transform=\"translate(261 151) scale(.35)\"><path class=\"\" d=\"M85 77 C87 35 112 25 145 25 C197 25 216 104 153 104 H73 C5 104 5 198 73 198 H236 C269 198 269 150 236 150 H96\" pathLength=\"810\" fill=\"none\" stroke=\"url(#ct-gradient)\" stroke-width=\"36\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle class=\"\" cx=\"310\" cy=\"150\" r=\"21\" fill=\"#A879F5\"/></g>\n<g class=\"ct-card-a\"><g transform=\"translate(102 180) rotate(-9 53 47)\">\n<rect x=\"0\" y=\"5\" width=\"108\" height=\"96\" rx=\"16\" fill=\"#6387FF\" opacity=\".05\"/>\n<rect width=\"108\" height=\"96\" rx=\"16\" fill=\"var(--ct-panel,#fff)\" stroke=\"var(--ct-stroke,#CFD8EC)\"/>\n<rect x=\"10\" y=\"10\" width=\"88\" height=\"58\" rx=\"9\" fill=\"url(#ct-soft)\"/>\n<circle class=\"ct-glint\" cx=\"35\" cy=\"28\" r=\"7\" fill=\"#A4BAFF\"/>\n<path d=\"M15 58 40 38 58 50 75 31 94 58\" fill=\"none\" stroke=\"url(#ct-gradient)\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<path d=\"M14 80H56M69 80H92\" stroke=\"var(--ct-stroke,#CFD8EC)\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n</g></g>\n<g class=\"ct-card-b\"><g transform=\"translate(430 102) rotate(9 48 46)\">\n<rect y=\"5\" width=\"98\" height=\"92\" rx=\"16\" fill=\"#6387FF\" opacity=\".05\"/>\n<rect width=\"98\" height=\"92\" rx=\"16\" fill=\"var(--ct-panel,#fff)\" stroke=\"var(--ct-stroke,#CFD8EC)\"/>\n<rect x=\"10\" y=\"10\" width=\"78\" height=\"53\" rx=\"9\" fill=\"url(#ct-soft)\"/><path d=\"m42 24 19 12-19 12Z\" fill=\"url(#ct-gradient)\"/>\n<path d=\"M15 76H50M64 76H83\" stroke=\"var(--ct-stroke,#CFD8EC)\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n</g></g>\n<g class=\"ct-glint\" fill=\"none\" stroke=\"#99A7F5\" stroke-linecap=\"round\"><path d=\"M184 91v12M178 97h12M457 284v12M451 290h12\"/></g></svg>"};
  let serial = 0;
  const defaults = {
    intro: ['让灵感，自由展开', '无限画布，由 AI 延展更多可能'],
    page: ['正在打开页面', ''],
    creation: ['灵感，正在成形', '正在生成创作内容，请稍候']
  };
  const stateCopy = {
    queued: ['任务排队中', '资源就绪后将开始生成'],
    complete: ['创作已完成', '作品已准备好'],
    error: ['这次生成未完成', '请重试，或检查任务详情'],
    cancelled: ['任务已取消', '可以随时发起新的创作']
  };
  class CloudtoLoader extends HTMLElement {
    static get observedAttributes() { return ['variant', 'theme', 'status', 'progress', 'message', 'detail', 'motion', 'paused']; }
    constructor() { super(); this.attachShadow({mode: 'open'}); this._timer = null; }
    connectedCallback() { this.render(); }
    disconnectedCallback() { clearTimeout(this._timer); }
    attributeChangedCallback(name, oldValue, newValue) {
      if (!this.isConnected || oldValue === newValue) return;
      if (name === 'variant') this.render(); else this.sync();
    }
    get variant() { return Object.hasOwn(defaults, this.getAttribute('variant')) ? this.getAttribute('variant') : 'creation'; }
    get status() { return ['queued','running','complete','error','cancelled'].includes(this.getAttribute('status')) ? this.getAttribute('status') : 'running'; }
    render() {
      clearTimeout(this._timer);
      const id = `cloudto-${++serial}`;
      const art = ART[this.variant].replaceAll('ct-gradient', `${id}-gradient`).replaceAll('ct-soft', `${id}-soft`);
      this.shadowRoot.innerHTML = `<style>
        :host{display:block;color:var(--ct-ink,#202632);font-family:inherit;--ct-copy:#737C90;--ct-track:#E7EBF5;--ct-success:#389E7D;--ct-error:#BD586E}
        *{box-sizing:border-box}.wrap{text-align:center;position:relative;width:100%;padding:0 16px 24px}.art{max-width:640px;margin:auto}.art svg{width:100%;height:auto;display:block}
        :host([variant=page]) .art{width:66px;padding:12px 0}.headline{font-size:17px;line-height:1.5;font-weight:550;letter-spacing:.02em;margin:0}.detail{color:var(--ct-copy);font-size:12px;line-height:1.8;margin:8px 0 0}.detail:empty{display:none}
        .progress{height:3px;border-radius:4px;background:var(--ct-track);width:min(190px,70%);margin:20px auto 0;overflow:hidden}.bar{height:100%;background:linear-gradient(90deg,#65C9F4,#6387FF,#A879F5);transform-origin:left;transition:transform .2s ease}
        .percent{font-size:11px;font-variant-numeric:tabular-nums;color:var(--ct-copy);margin-top:7px;letter-spacing:.08em}.terminal{display:none;align-items:center;justify-content:center;height:180px}.terminal svg{width:70px;height:70px;stroke:var(--ct-success);stroke-width:1.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
        :host([status=error]) .terminal svg{stroke:var(--ct-error)}:host([status=cancelled]) .terminal svg{stroke:var(--ct-copy)}
        :host([status=complete]) .art,:host([status=error]) .art,:host([status=cancelled]) .art{display:none}
        :host([status=complete]) .terminal,:host([status=error]) .terminal,:host([status=cancelled]) .terminal{display:flex}
        :host([variant=intro]) .terminal{height:300px}:host([variant=page]) .terminal{height:68px}:host([variant=page]) .terminal svg{width:30px;height:30px}
        :host([paused]) .art svg *,:host([status=queued]) .art svg *{animation-play-state:paused!important}
        :host([motion=off]) .art svg *{animation:none!important;stroke-dashoffset:0!important}:host([motion=off]) .ct-draw{stroke-dasharray:none!important}:host([motion=off]) .ct-sweep{display:none}:host([motion=off]) .ct-static{display:initial}
        :host([theme=dark]){--ct-ink:#EFF3FF;--ct-copy:#A7B1C7;--ct-track:#303B51;--ct-success:#68C6A2;--ct-error:#EE96A6}
        :host([theme=dark]) svg{--ct-stroke:#3A455E;--ct-panel:#1B2232;--ct-ink:#EFF3FF}
        :host([theme=light]) svg{--ct-stroke:#CFD8EC;--ct-panel:#FFFFFF;--ct-ink:#202632}
        @media(prefers-color-scheme:dark){:host(:not([theme=light])){--ct-ink:#EFF3FF;--ct-copy:#A7B1C7;--ct-track:#303B51;--ct-success:#68C6A2;--ct-error:#EE96A6}}
        @media(prefers-reduced-motion:reduce){.bar{transition:none}}
        [hidden]{display:none!important}
      </style><div class="wrap">
        <div class="art" aria-hidden="true">${art}</div>
        <div class="terminal" aria-hidden="true"></div>
        <div class="copy" role="status" aria-live="polite" aria-atomic="true"><p class="headline"></p><p class="detail"></p></div>
        <div class="progress" role="progressbar" aria-label="生成进度" aria-valuemin="0" aria-valuemax="100" hidden><div class="bar"></div></div>
        <div class="percent" aria-hidden="true" hidden></div>
      </div>`;
      this.sync();
      if (this.variant === 'intro') this._timer = setTimeout(() => {
        if(this.isConnected) this.dispatchEvent(new CustomEvent('cloudto-intro-end',{bubbles:true,composed:true}));
      }, 3200);
    }
    sync() {
      if (!this.shadowRoot.querySelector('.wrap')) return;
      const active = ['queued','running'].includes(this.status);
      this.setAttribute('aria-busy', String(active));
      const copy = stateCopy[this.status] || defaults[this.variant];
      this.shadowRoot.querySelector('.headline').textContent = this.getAttribute('message') ?? copy[0];
      this.shadowRoot.querySelector('.detail').textContent = this.getAttribute('detail') ?? copy[1];
      this.shadowRoot.querySelector('.copy').setAttribute('role', this.status === 'error' ? 'alert' : 'status');
      const raw = this.getAttribute('progress');
      const value = this.status === 'complete' ? 100 : (raw !== null && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Math.max(0,Math.min(100,Number(raw))) : null);
      const track = this.shadowRoot.querySelector('.progress');
      const percentage = this.shadowRoot.querySelector('.percent');
      const show = value !== null && ['running','complete'].includes(this.status) && this.variant === 'creation';
      track.hidden = percentage.hidden = !show;
      if (show) {
        track.setAttribute('aria-valuenow',String(value));
        this.shadowRoot.querySelector('.bar').style.transform = `scaleX(${value/100})`;
        percentage.textContent = `${Math.round(value)}%`;
      } else track.removeAttribute('aria-valuenow');
      const paths = this.status === 'complete' ? '<circle cx="24" cy="24" r="19"/><path d="m15 24 6 6 13-13"/>' : this.status === 'error' ? '<circle cx="24" cy="24" r="19"/><path d="M24 14v13M24 33v.2"/>' : '<circle cx="24" cy="24" r="19"/><path d="m17 17 14 14M17 31l14-14"/>';
      this.shadowRoot.querySelector('.terminal').innerHTML = `<svg viewBox="0 0 48 48">${paths}</svg>`;
    }
    setProgress(value) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) this.removeAttribute('progress');
      else this.setAttribute('progress', String(Math.max(0,Math.min(100,Number(value)))));
    }
    setState(status, message, detail) {
      if (!['queued','running','complete','error','cancelled'].includes(status)) throw new TypeError('Unknown cloudto status');
      for(const [name,value] of [['message',message],['detail',detail]]) {
        if(value === undefined) this.removeAttribute(name); else this.setAttribute(name,String(value));
      }
      this.setAttribute('status',status);
    }
    replay() { this.render(); }
  }
  if (!customElements.get('cloudto-loader')) customElements.define('cloudto-loader', CloudtoLoader);

  /** A first-visit overlay tied to a real readiness Promise; no artificial delay. */
  async function showIntro(ready, {root=document.body, theme='auto', once=true, key='cloudto.intro.v1'}={}) {
    let seen = false;
    try { seen = once && sessionStorage.getItem(key) === '1'; } catch (_) {}
    if (seen) return await ready;
    const layer = document.createElement('div');
    Object.assign(layer.style,{position:'fixed',inset:'0',zIndex:'10000',display:'grid',placeItems:'center',background:theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches) ? '#10131F' : '#F7F8FC'});
    const loader = document.createElement('cloudto-loader');
    loader.setAttribute('variant','intro');loader.setAttribute('theme',theme);loader.style.width='min(720px,100vw)';
    layer.append(loader);root.append(layer);
    try {
      const result = await ready;
      try { if(once) sessionStorage.setItem(key,'1'); } catch (_) {}
      return result;
    } finally { layer.remove(); }
  }
  window.Cloudto = Object.freeze({showIntro,version:'1.0.0'});
})();
