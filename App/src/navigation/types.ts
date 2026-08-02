/** Routes of the root native-stack navigator. */
export type RootStackParamList = {
  /** The bottom-tab layout (Control / Flow / System). */
  Tabs: undefined;
  /** Read-only view of one platform's automation config. */
  ConfigDetail: { platform: string };
  /** Login screen (shown only when signed out). */
  Login: undefined;
  /** Per-device app selection (onboarding + change later). */
  ChooseApp: undefined;
};
