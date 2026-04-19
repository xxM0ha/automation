from rest_framework import serializers
from .models import MenuItem, MenuCategory, MenuItemPlatform


class MenuItemPlatformSerializer(serializers.ModelSerializer):
    platform_id = serializers.CharField(source='platform.slug', read_only=True)
    platform_name_ar = serializers.CharField(source='platform.name_ar', read_only=True)

    class Meta:
        model = MenuItemPlatform
        fields = ['platform_id', 'platform_name_ar', 'platform_name', 'platform_price', 'is_synced']


class MenuItemSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name_ar', read_only=True, default='')
    platform_mappings = MenuItemPlatformSerializer(many=True, read_only=True)
    platforms = serializers.SerializerMethodField()
    price_display = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = MenuItem
        fields = [
            'id', 'name', 'price', 'price_display', 'description', 'image',
            'tag', 'status', 'status_display', 'is_available', 'stock_level',
            'category', 'category_name', 'platforms', 'platform_mappings', 'created_at',
        ]

    def get_platforms(self, obj):
        return [m.platform.slug for m in obj.platform_mappings.all()]

    def get_price_display(self, obj):
        return f'{obj.price} ر.س'

    def create(self, validated_data):
        platform_ids = self.initial_data.get('platforms', [])
        platform_names = self.initial_data.get('platformNames', {})
        item = super().create(validated_data)
        self._save_platform_mappings(item, platform_ids, platform_names)
        return item

    def update(self, instance, validated_data):
        platform_ids = self.initial_data.get('platforms', [])
        platform_names = self.initial_data.get('platformNames', {})
        item = super().update(instance, validated_data)
        if platform_ids:
            self._save_platform_mappings(item, platform_ids, platform_names)
        return item

    def _save_platform_mappings(self, item, platform_ids, platform_names):
        from integrations.models import Platform
        from .models import MenuItemPlatform
        # Remove old mappings not in new list
        MenuItemPlatform.objects.filter(menu_item=item).exclude(
            platform__slug__in=platform_ids
        ).delete()
        for slug in platform_ids:
            try:
                platform = Platform.objects.get(slug=slug)
                MenuItemPlatform.objects.update_or_create(
                    menu_item=item,
                    platform=platform,
                    defaults={'platform_name': platform_names.get(slug, '')},
                )
            except Platform.DoesNotExist:
                pass


class MenuCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuCategory
        fields = ['id', 'name_ar', 'sort_order']
