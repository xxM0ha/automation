// Re-exports the native module. Resolves to PrimeNativeModule.web.ts on web,
// PrimeNativeModule.ts on native (Android).
export { default } from './src/PrimeNativeModule';
export * from './src/PrimeNative.types';
