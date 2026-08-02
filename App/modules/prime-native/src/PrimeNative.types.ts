export type DemoEventPayload = {
  count: number;
  timestamp: number;
};

export type AccessibilityStatePayload = {
  /** True when the accessibility service is connected and usable. */
  running: boolean;
};

/** One log line streamed from the Kotlin engine. */
export type EngineLogPayload = {
  platform: string;
  level: 'info' | 'step' | 'success' | 'error';
  message: string;
  depth: number;
  /** Wall-clock ms when the engine emitted this line. */
  timestamp: number;
};

/** Engine status update streamed from the Kotlin engine. */
export type EngineStatePayload = {
  platform: string;
  status: 'running' | 'idle' | 'error';
  /** Number of completed iterations so far (continuous mode). */
  iteration?: number;
  /** Present when status === 'error'. */
  error?: string;
};

export type PrimeNativeModuleEvents = {
  onDemo: (params: DemoEventPayload) => void;
  onAccessibilityState: (params: AccessibilityStatePayload) => void;
  onEngineLog: (params: EngineLogPayload) => void;
  onEngineState: (params: EngineStatePayload) => void;
};

/** A selector as the Kotlin side expects it (matches the config Selector). */
export type NativeSelector = {
  strategy: string;
  value: string;
  match?: string;
  packageScope?: string;
};

/** Params for the native extractList primitive. */
export type ExtractListParams = {
  list: NativeSelector;
  item: NativeSelector;
  fields: Record<string, NativeSelector>;
  maxScrollPasses: number;
};

/** Params for the native scrollUntil primitive. */
export type ScrollUntilParams = {
  until: NativeSelector;
  container?: NativeSelector;
  direction: 'up' | 'down';
  maxScrollPasses: number;
};

/** Params for the native tapInRow primitive. */
export type TapInRowParams = {
  anchor: NativeSelector;
  target: NativeSelector;
};

/** Params for the native swipe primitive. */
export type SwipeParams = {
  direction: 'up' | 'down' | 'left' | 'right';
  selector?: NativeSelector;
};

/** One node returned in a screen snapshot. */
export type NativeScreenNode = {
  text?: string;
  contentDesc?: string;
  viewId?: string;
  clickable?: boolean;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
};

/** Full snapshot of the active window. */
export type NativeScreenSnapshot = {
  package: string | null;
  texts: string[];
  nodes: NativeScreenNode[];
};
