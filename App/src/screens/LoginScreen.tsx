import { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { useSession } from '../state/SessionContext';
import { colors, spacing, radius, fontFamily } from '../theme';

const DEFAULT_BASE_URL = 'https://api.3alijny.com';

export function LoginScreen() {
  const { signIn } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSignIn = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // Trim both: mobile keyboards/autofill often append a space or capitalize,
      // and a stray space in the password is silently rejected as "wrong creds".
      await signIn(DEFAULT_BASE_URL, email.trim(), password.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ غير متوقع.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
    >
      <View style={styles.brandBlock}>
        <Logo height={68} />
        <Text
          variant="bodyLg"
          color={colors.onSurfaceVariant}
          style={{ textAlign: 'center', marginTop: spacing.lg }}
        >
          سجّل الدخول للاتصال بحساب المطعم وبدء الأتمتة.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.field}>
          <Text variant="labelLg" color={colors.onSurfaceVariant}>البريد الإلكتروني</Text>
          <View style={[styles.inputWrap, focusedField === 'email' && styles.inputWrapFocused]}>
            <Icon
              name="my_location"
              size={20}
              color={focusedField === 'email' ? colors.onSurface : colors.onSurfaceVariant}
            />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              placeholder="name@example.com"
              placeholderTextColor={colors.outline}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!submitting}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text variant="labelLg" color={colors.onSurfaceVariant}>كلمة المرور</Text>
          <View style={[styles.inputWrap, focusedField === 'password' && styles.inputWrapFocused]}>
            <Icon
              name="lock"
              size={20}
              color={focusedField === 'password' ? colors.onSurface : colors.onSurfaceVariant}
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              placeholder="••••••••"
              placeholderTextColor={colors.outline}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!showPassword}
              textContentType="password"
              editable={!submitting}
            />
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
              <Icon
                name={showPassword ? 'visibility_off' : 'visibility'}
                size={20}
                color={colors.onSurfaceVariant}
              />
            </Pressable>
          </View>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Icon name="error" size={18} color={colors.onErrorContainer} />
            <Text variant="bodySm" color={colors.onErrorContainer} style={{ flex: 1 }}>
              {error}
            </Text>
          </View>
        )}

        {submitting ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.onSurface} />
            <Text variant="labelLg" color={colors.onSurfaceVariant}>جارٍ تسجيل الدخول…</Text>
          </View>
        ) : (
          <Button label="تسجيل الدخول" icon="lock" fullWidth disabled={submitting} onPress={handleSignIn} />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingTop: spacing.xl2,
    paddingBottom: spacing.xl3,
    gap: spacing.xl,
  },
  brandBlock: {
    alignItems: 'center',
  },
  logoTile: {
    width: 124,
    height: 124,
    borderRadius: radius.xl + spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceContainerHighest,
    padding: spacing.lg,
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    paddingHorizontal: spacing.md,
  },
  inputWrapFocused: {
    borderColor: colors.onSurface,
    backgroundColor: colors.surfaceContainerLowest,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.md - 2,
    color: colors.onSurface,
    fontFamily: fontFamily.regular,
    fontSize: 16,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.errorContainer,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
});
