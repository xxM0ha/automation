from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('integrations', '0005_restaurantplatform_pos_category'),
        ('restaurants', '0003_restaurant_foodics_branch'),
    ]

    operations = [
        migrations.CreateModel(
            name='WebhookRejection',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('external_id', models.CharField(blank=True, max_length=100)),
                ('reason', models.CharField(max_length=200)),
                ('items', models.JSONField(default=list)),
                ('raw_text', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('platform', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='integrations.platform')),
                ('restaurant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='webhook_rejections', to='restaurants.restaurant')),
            ],
            options={'ordering': ['-created_at']},
        ),
    ]
