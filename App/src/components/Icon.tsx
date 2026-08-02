import { MaterialIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

// The Stitch designs reference Material Symbols by snake_case name.
// @expo/vector-icons exposes MaterialIcons with kebab-case names.
// This wrapper keeps the design-aligned snake_case API and converts on the way out.
export type IconName =
  | 'menu'
  | 'add'
  | 'terminal'
  | 'dynamic_feed'
  | 'memory'
  | 'two_wheeler'
  | 'delivery_dining'
  | 'directions_car'
  | 'point_of_sale'
  | 'check_circle'
  | 'restart_alt'
  | 'power_settings_new'
  | 'admin_panel_settings'
  | 'accessibility_new'
  | 'battery_charging_full'
  | 'developer_mode'
  | 'layers'
  | 'check'
  | 'sync'
  | 'error'
  | 'info'
  | 'smart_toy'
  | 'arrow_forward'
  | 'tune'
  | 'my_location'
  | 'lock'
  | 'visibility'
  | 'visibility_off'
  | 'schedule'
  | 'bolt'
  | 'swap_vert'
  | 'touch_app'
  | 'launch'
  | 'call_split'
  | 'download';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
} & Omit<ComponentProps<typeof MaterialIcons>, 'name' | 'size' | 'color'>;

export function Icon({ name, size = 24, color, ...rest }: Props) {
  const mapped = name.replace(/_/g, '-') as ComponentProps<typeof MaterialIcons>['name'];
  return <MaterialIcons name={mapped} size={size} color={color} {...rest} />;
}
