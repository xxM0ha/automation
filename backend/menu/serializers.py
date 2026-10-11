from rest_framework import serializers
from .models import MenuItem, MenuCategory, MenuItemPlatform


class MenuItemPlatformSerializer(serializers.ModelSerializer):
    platform_id = serializers.CharField(source='platform.slug', read_only=True)
    platform_name_ar = serializers.CharField(source='platform.name_ar', read_only=True)
    aliases = serializers.SerializerMethodField()

    class Meta:
        model = MenuItemPlatform
        fields = ['platform_id', 'platform_name_ar', 'platform_name', 'platform_price', 'pos_category', 'is_synced', 'aliases']

    def get_aliases(self, obj):
        return list(obj.aliases.values_list('name', flat=True))


class MenuItemSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name_ar', read_only=True, default='')
    platform_mappings = MenuItemPlatformSerializer(many=True, read_only=True)
    platforms = serializers.SerializerMethodField()
    price_display = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, default=0)
    foodics_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)

    class Meta:
        model = MenuItem
        fields = [
            'id', 'name', 'price', 'price_display', 'description', 'image',
            'tag', 'status', 'status_display', 'is_available', 'stock_level',
            'category', 'category_name', 'platforms', 'platform_mappings', 'pos_category', 'foodics_price',
            'foodics_product_id', 'created_at',
        ]

    def get_platforms(self, obj):
        return [m.platform.slug for m in obj.platform_mappings.all()]

    def get_price_display(self, obj):
        return f'{obj.price} ر.س'

    def create(self, validated_data):
        platform_ids     = self.initial_data.get('platforms', [])
        platform_names   = self.initial_data.get('platformNames') or self.initial_data.get('platform_names', {})
        platform_aliases = self.initial_data.get('platformAliases') or self.initial_data.get('platform_aliases', {})
        platform_cats    = self.initial_data.get('platformPosCategories') or self.initial_data.get('platform_pos_categories', {})
        item = super().create(validated_data)
        self._save_platform_mappings(item, platform_ids, platform_names, platform_aliases, platform_cats)
        return item

    def update(self, instance, validated_data):
        platform_ids     = self.initial_data.get('platforms', [])
        platform_names   = self.initial_data.get('platformNames') or self.initial_data.get('platform_names', {})
        platform_aliases = self.initial_data.get('platformAliases') or self.initial_data.get('platform_aliases', {})
        platform_cats    = self.initial_data.get('platformPosCategories') or self.initial_data.get('platform_pos_categories', {})
        item = super().update(instance, validated_data)
        self._save_platform_mappings(item, platform_ids, platform_names, platform_aliases, platform_cats)
        return item

    def _save_platform_mappings(self, item, platform_ids, platform_names, platform_aliases=None, platform_cats=None):
        from integrations.models import Platform
        from .models import MenuItemPlatform, MenuItemPlatformAlias
        if platform_aliases is None:
            platform_aliases = {}
        if platform_cats is None:
            platform_cats = {}
        MenuItemPlatform.objects.filter(menu_item=item).exclude(
            platform__slug__in=platform_ids
        ).delete()
        for slug in platform_ids:
            try:
                platform = Platform.objects.get(slug=slug)
                pname = platform_names.get(slug, '').replace('ی', 'ي')
                mapping, _ = MenuItemPlatform.objects.update_or_create(
                    menu_item=item,
                    platform=platform,
                    defaults={
                        'platform_name': pname,
                        'pos_category': (platform_cats.get(slug, '') or '').strip(),
                    },
                )
                new_aliases = [a.strip().replace('ی', 'ي') for a in platform_aliases.get(slug, []) if a.strip()]
                mapping.aliases.all().delete()
                for alias_name in new_aliases:
                    MenuItemPlatformAlias.objects.get_or_create(mapping=mapping, name=alias_name)
            except Platform.DoesNotExist:
                pass


class MenuCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuCategory
        fields = ['id', 'name_ar', 'sort_order']
